import { useEffect, useMemo, useRef, useState } from "react";
import { largeWarehouse } from "./data/largeWarehouse";
import { buildDemoCountServiceProfiles } from "./data/demoCountService";
import { buildValidatedDistanceMatrix } from "./domain/distanceMatrix";
import type { DistanceMatrixResult } from "./domain/distanceMatrix";
import { nearestNeighborRoute } from "./domain/nearestNeighbor";
import { buildRouteTimeline } from "./domain/routeTimeline";
import { buildRouteTraversal } from "./domain/routeTraversal";
import { twoOptRoute } from "./domain/twoOpt";
import type { NodeId, RouteComputation, WarehouseGraph } from "./domain/types";
import { LanguageProvider } from "./i18n/LanguageContext";
import { useTranslation } from "./i18n/useTranslation";
import { useManualRoute } from "./hooks/useManualRoute";
import { loadPersistedState, savePersistedState, type PersistedState } from "./persistence/persistedState";
import { TargetSelector } from "./components/TargetSelector";
import { WarehouseMap, type RouteVisibility } from "./components/WarehouseMap";
import { ManualRouteEditor } from "./components/ManualRouteEditor";
import { ProgressPanel } from "./components/ProgressPanel";
import { LanguageSwitcher } from "./components/LanguageSwitcher";
import { WorkflowSteps, type WorkflowStep } from "./components/WorkflowSteps";
import type { ReplayRouteInput } from "./components/RouteSimulationReplay";
import { RouteSimulationComparison } from "./components/RouteSimulationComparison";
import { DigitalTwinPlanningWorkspace } from "./components/DigitalTwinPlanningWorkspace";
import type { WorkspacePanel } from "./components/WorkspacePanels";
import "./App.css";

const KNOWN_LOCATION_IDS = new Set(largeWarehouse.locations.map((l) => l.id));
const DEMO_COUNT_SERVICE_PROFILES = buildDemoCountServiceProfiles(
  largeWarehouse.locations.map((location) => location.id),
);

/** Cross-checks persisted ids against the current 100-location fixture -- an id from a since-removed/renamed location must never resurrect as "completed", "selected", or part of the manual route. */
function sanitizeKnownIds(ids: string[]): NodeId[] {
  return ids.filter((id) => KNOWN_LOCATION_IDS.has(id));
}

function sanitizeSelectableIds(ids: string[], completedIds: ReadonlySet<NodeId>): NodeId[] {
  return sanitizeKnownIds(ids).filter((id) => !completedIds.has(id));
}

/**
 * Restores the manual route's stop order, but only for ids that are both
 * known to the fixture and present in the restored selection -- the manual
 * route's stop set must always be a subset of today's targets, the same
 * invariant `toggleSelected` enforces during live editing. Also de-dupes,
 * since storage could in principle contain a stale/tampered duplicate.
 */
function sanitizeManualRouteStopIds(ids: string[], selectedIds: NodeId[]): NodeId[] {
  const selectedSet = new Set(selectedIds);
  const seen = new Set<NodeId>();
  const result: NodeId[] = [];
  for (const id of sanitizeKnownIds(ids)) {
    if (selectedSet.has(id) && !seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }
  // Migrate older persisted sessions where target selection and route
  // construction were separate: selected destinations missing from the old
  // manual route are appended deterministically in their saved selection order.
  for (const id of selectedIds) {
    if (!seen.has(id)) result.push(id);
  }
  return result;
}

interface ManualRouteData {
  computation: RouteComputation | null;
  visitIds: NodeId[];
  pathMatrix: NodeId[][][];
  matrix: DistanceMatrixResult | null;
  routeGraph: WarehouseGraph | null;
}

/**
 * Computes the manual route's total distance and, in the same pass, the
 * visitIds/pathMatrix the map needs to draw it -- built once here rather
 * than separately in the map component, so there is exactly one
 * distance-matrix computation per render, not two.
 */
function computeManualRoute(graph: WarehouseGraph, stopIds: NodeId[]): ManualRouteData {
  if (stopIds.length === 0) {
    return { computation: null, visitIds: [], pathMatrix: [], matrix: null, routeGraph: null };
  }
  const order = [graph.start.id, ...stopIds];
  const routeGraph: WarehouseGraph = {
    ...graph,
    locations: graph.locations.filter((l) => stopIds.includes(l.id)),
  };
  try {
    const matrix = buildValidatedDistanceMatrix(routeGraph);
    const { visitIds, distanceMatrix, pathMatrix } = matrix;
    const indexOf = new Map(visitIds.map((id, i) => [id, i]));
    let total = 0;
    for (let i = 0; i < order.length - 1; i++) {
      total += distanceMatrix[indexOf.get(order[i])!][indexOf.get(order[i + 1])!];
    }
    return {
      computation: { order, totalDistance: total },
      visitIds,
      pathMatrix,
      matrix,
      routeGraph,
    };
  } catch {
    return { computation: null, visitIds: [], pathMatrix: [], matrix: null, routeGraph: null };
  }
}

/** "System recommended": nearest-neighbor refined by 2-opt, always over the exact same target set as the manual route -- membership can never diverge. */
function computeRecommendedRoute(graph: WarehouseGraph, stopIds: NodeId[]): RouteComputation | null {
  if (stopIds.length === 0) return null;
  try {
    const nn = nearestNeighborRoute(graph, stopIds);
    return twoOptRoute(graph, stopIds, nn);
  } catch {
    return null;
  }
}

function computeWorkflowStep(selectedCount: number, comparisonRequested: boolean): WorkflowStep {
  if (selectedCount === 0) return 1;
  return comparisonRequested ? 3 : 2;
}

function Dashboard({ persisted }: { persisted: PersistedState }) {
  const { t } = useTranslation();
  const restoredCompletedIds = useMemo(
    () => new Set(sanitizeKnownIds(persisted.completedIds)),
    [persisted.completedIds],
  );
  const restoredSelectedIds = useMemo(
    () => sanitizeSelectableIds(persisted.selectedIds, restoredCompletedIds),
    [persisted.selectedIds, restoredCompletedIds],
  );

  const [selected, setSelected] = useState<Set<NodeId>>(
    () => new Set(restoredSelectedIds),
  );
  const [completedIds, setCompletedIds] = useState<Set<NodeId>>(
    () => restoredCompletedIds,
  );
  const [lastCompletedSelection, setLastCompletedSelection] = useState<Set<NodeId>>(new Set());
  const [planningInteractionVersion, setPlanningInteractionVersion] = useState(0);
  const [targetCount, setTargetCount] = useState(persisted.targetCount);
  const [walkingSpeed, setWalkingSpeed] = useState(persisted.walkingSpeed);
  const [search, setSearch] = useState("");
  const [zone, setZone] = useState("");
  const [comparisonRequested, setComparisonRequested] = useState(persisted.comparisonRequested);
  const [routeVisibility, setRouteVisibility] = useState<RouteVisibility>("both");
  const [workerRouteAdjusted, setWorkerRouteAdjusted] = useState(
    () => {
      const selectedIds = sanitizeKnownIds(persisted.selectedIds);
      const selectableIds = selectedIds.filter((id) => !restoredCompletedIds.has(id));
      const restored = sanitizeManualRouteStopIds(persisted.manualRouteStopIds, selectableIds);
      return restored.some((id, index) => id !== selectableIds[index]);
    },
  );
  const [workspacePanel, setWorkspacePanel] = useState<WorkspacePanel>(
    () => persisted.selectedIds.length === 0 ? null : "route",
  );
  const [guidedExperienceStarted, setGuidedExperienceStarted] = useState(
    () => persisted.selectedIds.length > 0 || persisted.comparisonRequested,
  );
  const manualRoute = useManualRoute(
    sanitizeManualRouteStopIds(persisted.manualRouteStopIds, restoredSelectedIds),
  );

  // Any edit to the manual route invalidates a previously generated
  // comparison -- the worker must explicitly re-generate it, so the
  // comparison panel never silently shows stale results. Skipped on the
  // mount-triggered run so a restored comparisonRequested (from a route
  // restored via localStorage) isn't immediately wiped out again.
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    setComparisonRequested(false);
  }, [manualRoute.stopIds]);

  // Single source of truth for persistence: every field that should survive
  // a reload is written here whenever it changes, instead of scattered
  // per-mutation calls -- the previous per-mutation approach is exactly how
  // `selected`/manual-route/comparison state ended up never being wired to
  // storage in the first place. `language` is re-read fresh from storage
  // rather than trusted from the `persisted` prop (captured once at mount)
  // so a live language switch is never clobbered by this effect.
  useEffect(() => {
    savePersistedState(window.localStorage, {
      targetCount,
      completedIds: [...completedIds],
      language: loadPersistedState(window.localStorage).language,
      walkingSpeed,
      selectedIds: [...selected],
      manualRouteStopIds: manualRoute.stopIds,
      comparisonRequested,
    });
  }, [selected, completedIds, targetCount, walkingSpeed, manualRoute.stopIds, comparisonRequested]);

  const labels = useMemo(() => {
    const map = new Map<NodeId, string>();
    for (const location of largeWarehouse.locations) map.set(location.id, location.label);
    return map;
  }, []);

  const searchMatchIds = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return new Set<NodeId>();
    return new Set(
      largeWarehouse.locations
        .filter((l) => l.label.toLowerCase().includes(term) || l.id.toLowerCase().includes(term))
        .map((l) => l.id),
    );
  }, [search]);

  const manualRouteData = useMemo(
    () => computeManualRoute(largeWarehouse, manualRoute.stopIds),
    [manualRoute.stopIds],
  );
  const manualComputation = manualRouteData.computation;

  const recommendedComputation = useMemo(
    () => computeRecommendedRoute(largeWarehouse, manualRoute.stopIds),
    [manualRoute.stopIds],
  );

  const replayInputs = useMemo<{
    worker: ReplayRouteInput;
    recommended: ReplayRouteInput;
  } | null>(() => {
    if (
      !manualComputation ||
      !recommendedComputation ||
      !manualRouteData.matrix ||
      !manualRouteData.routeGraph
    ) {
      return null;
    }

    const workerTraversal = buildRouteTraversal(
      manualRouteData.routeGraph,
      manualComputation,
      manualRouteData.matrix,
    );
    const recommendedTraversal = buildRouteTraversal(
      manualRouteData.routeGraph,
      recommendedComputation,
      manualRouteData.matrix,
    );

    return {
      worker: {
        route: manualComputation,
        timeline: buildRouteTimeline(
          workerTraversal,
          walkingSpeed,
          DEMO_COUNT_SERVICE_PROFILES,
        ),
      },
      recommended: {
        route: recommendedComputation,
        timeline: buildRouteTimeline(
          recommendedTraversal,
          walkingSpeed,
          DEMO_COUNT_SERVICE_PROFILES,
        ),
      },
    };
  }, [manualComputation, manualRouteData, recommendedComputation, walkingSpeed]);

  const currentStep = computeWorkflowStep(selected.size, comparisonRequested);
  const simulationInputKey = useMemo(() => [...selected].sort().join("|"), [selected]);

  function toggleSelected(id: NodeId) {
    if (completedIds.has(id)) return;
    setPlanningInteractionVersion((version) => version + 1);
    const next = new Set(selected);
    if (next.has(id)) {
      next.delete(id);
      manualRoute.removeStop(id);
    } else {
      next.add(id);
      manualRoute.addStop(id);
    }
    setSelected(next);
  }

  function selectVisibleInOrder(ids: NodeId[]) {
    setPlanningInteractionVersion((version) => version + 1);
    const next = new Set(selected);
    for (const id of ids) {
      if (completedIds.has(id)) continue;
      if (next.has(id)) continue;
      next.add(id);
      manualRoute.addStop(id);
    }
    setSelected(next);
  }

  function removeSelectedStop(id: NodeId) {
    setPlanningInteractionVersion((version) => version + 1);
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    manualRoute.removeStop(id);
  }

  function clearSelectedStops() {
    setPlanningInteractionVersion((version) => version + 1);
    setSelected(new Set());
    manualRoute.clear();
    setWorkerRouteAdjusted(false);
  }

  function moveWorkerStop(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex) return;
    manualRoute.moveStop(fromIndex, toIndex);
    setWorkerRouteAdjusted(true);
    setPlanningInteractionVersion((version) => version + 1);
  }

  function moveWorkerStopUp(index: number) {
    if (index <= 0) return;
    manualRoute.moveUp(index);
    setWorkerRouteAdjusted(true);
    setPlanningInteractionVersion((version) => version + 1);
  }

  function moveWorkerStopDown(index: number) {
    if (index >= manualRoute.stopIds.length - 1) return;
    manualRoute.moveDown(index);
    setWorkerRouteAdjusted(true);
    setPlanningInteractionVersion((version) => version + 1);
  }

  function markSelectedComplete() {
    const completedNow = new Set(selected);
    if (completedNow.size === 0) return;
    setCompletedIds((prev) => {
      const next = new Set(prev);
      completedNow.forEach((id) => next.add(id));
      return next;
    });
    setLastCompletedSelection(completedNow);
    setSelected((prev) => {
      const next = new Set(prev);
      completedNow.forEach((id) => next.delete(id));
      return next;
    });
    manualRoute.removeStops(completedNow);
    setPlanningInteractionVersion((version) => version + 1);
  }

  function undoSelectedCompletion() {
    setCompletedIds((prev) => {
      const next = new Set(prev);
      lastCompletedSelection.forEach((id) => next.delete(id));
      return next;
    });
    setLastCompletedSelection(new Set());
    setPlanningInteractionVersion((version) => version + 1);
  }

  function generateComparison() {
    if (!manualComputation || !recommendedComputation || manualRoute.stopIds.length < 2) return;
    setComparisonRequested(true);
    setPlanningInteractionVersion((version) => version + 1);
    setWorkspacePanel(null);
  }

  function changeWorkspacePanel(panel: WorkspacePanel) {
    if (panel) setGuidedExperienceStarted(true);
    if (panel === "route") setPlanningInteractionVersion((version) => version + 1);
    setWorkspacePanel(panel);
  }

  const progressPanel = (
    <ProgressPanel
      targetCount={targetCount}
      completedIds={completedIds}
      selectedIds={selected}
      onTargetCountChange={setTargetCount}
      onMarkSelectedComplete={markSelectedComplete}
      onUndoSelectedCompletion={undoSelectedCompletion}
      undoAvailable={lastCompletedSelection.size > 0}
    />
  );
  const progressDisclosure = (
    <details className="workspace-progress-disclosure">
      <summary>{t("progress.title")}</summary>
      {progressPanel}
    </details>
  );
  const planningSummary = (
    <div className="workspace-planning-summary">
      <section className="workspace-next-step" aria-labelledby="workspace-next-step-title">
        <span>{t("workspace.nextStep")}</span>
        <h2 id="workspace-next-step-title">
          {currentStep === 1 ? t("workflow.step1") : t("workflow.step2")}
        </h2>
        <p>
          {currentStep === 1
            ? t("workspace.selectPrompt")
            : t("workspace.routePrompt", { count: selected.size })}
        </p>
        <button
          type="button"
          className="workspace-next-step__action"
          onClick={() => {
            setGuidedExperienceStarted(true);
            setWorkspacePanel(currentStep === 1 ? "locations" : "route");
          }}
        >
          {currentStep === 1 ? t("workspace.selectLocations") : t("workspace.openRoute")}
        </button>
      </section>
      {progressDisclosure}
    </div>
  );
  const locationsPanel = (
    <TargetSelector
      locations={largeWarehouse.locations}
      selected={selected}
      orderedIds={manualRoute.stopIds}
      completedIds={completedIds}
      search={search}
      zone={zone}
      onSearchChange={setSearch}
      onZoneChange={setZone}
      onToggle={toggleSelected}
      onSelectVisible={selectVisibleInOrder}
      onClearAll={clearSelectedStops}
      onContinueToRoute={() => setWorkspacePanel("route")}
    />
  );
  const routePanel = (
    <div className="workspace-route-panel">
      <div className="workspace-route-panel__settings">
        <label>
          {t("comparison.walkingSpeedLabel")}
          <input
            type="number"
            min={1}
            value={walkingSpeed}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (Number.isFinite(value) && value > 0) {
                setWalkingSpeed(value);
                setPlanningInteractionVersion((version) => version + 1);
              }
            }}
          />
        </label>
        <fieldset>
          <legend>{t("comparison.routeVisibility")}</legend>
          {(["worker", "recommended", "both"] as const).map((visibility) => (
            <label key={visibility}>
              <input
                type="radio"
                name="workspace-route-visibility"
                checked={routeVisibility === visibility}
                onChange={() => {
                  setRouteVisibility(visibility);
                  setPlanningInteractionVersion((version) => version + 1);
                }}
              />
              {visibility === "worker"
                ? t("comparison.manual")
                : visibility === "recommended"
                  ? t("comparison.recommended")
                  : t("comparison.toggleBoth")}
            </label>
          ))}
        </fieldset>
      </div>
      <ManualRouteEditor
        stopIds={manualRoute.stopIds}
        labels={labels}
        onMoveUp={moveWorkerStopUp}
        onMoveDown={moveWorkerStopDown}
        onMove={moveWorkerStop}
        onRemove={removeSelectedStop}
        onClear={clearSelectedStops}
        onGenerate={generateComparison}
        recommendationValid={comparisonRequested}
        interactionVersion={planningInteractionVersion}
      />
    </div>
  );
  const workflow = <WorkflowSteps step={currentStep} />;
  const languageControl = <LanguageSwitcher />;

  return (
    <div className="app">
      {comparisonRequested && replayInputs ? (
        <RouteSimulationComparison
          graph={largeWarehouse}
          visitIds={manualRouteData.visitIds}
          pathMatrix={manualRouteData.pathMatrix}
          simulationInputKey={simulationInputKey}
          worker={replayInputs.worker}
          recommended={replayInputs.recommended}
          progressPanel={progressDisclosure}
          locationsPanel={locationsPanel}
          routePanel={routePanel}
          workflow={workflow}
          languageControl={languageControl}
          activePanel={workspacePanel}
          onPanelChange={changeWorkspacePanel}
        />
      ) : (
        <DigitalTwinPlanningWorkspace
          summary={planningSummary}
          viewport={(
            <WarehouseMap
              graph={largeWarehouse}
              selected={selected}
              visitIds={manualRouteData.visitIds}
              pathMatrix={manualRouteData.pathMatrix}
              workerRoute={manualComputation}
              recommendedRoute={comparisonRequested ? recommendedComputation : null}
              routeVisibility={routeVisibility}
              manualStopIds={manualRoute.stopIds}
              completedIds={completedIds}
              searchMatchIds={searchMatchIds}
              workerRouteAdjusted={workerRouteAdjusted}
              onWorkerRouteReorder={moveWorkerStop}
            />
          )}
          locations={locationsPanel}
          route={routePanel}
          workflow={workflow}
          language={languageControl}
          guidance={currentStep === 1 ? t("hero.step1Body") : t("hero.step2Body")}
          showWelcome={!guidedExperienceStarted}
          onStart={() => {
            setGuidedExperienceStarted(true);
            setWorkspacePanel("locations");
          }}
          onReopenGuide={() => {
            setGuidedExperienceStarted(false);
            setWorkspacePanel(null);
          }}
          activePanel={workspacePanel}
          onPanelChange={changeWorkspacePanel}
        />
      )}
    </div>
  );
}

function App() {
  const persisted = useMemo(() => loadPersistedState(window.localStorage), []);
  return (
    <LanguageProvider
      initialLanguage={persisted.language}
      onLanguageChange={(language) =>
        savePersistedState(window.localStorage, { ...loadPersistedState(window.localStorage), language })
      }
    >
      <Dashboard persisted={persisted} />
    </LanguageProvider>
  );
}

export default App;
