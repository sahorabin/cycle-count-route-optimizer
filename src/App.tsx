import { useEffect, useMemo, useRef, useState } from "react";
import { largeWarehouse } from "./data/largeWarehouse";
import { buildValidatedDistanceMatrix } from "./domain/distanceMatrix";
import { nearestNeighborRoute } from "./domain/nearestNeighbor";
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
import { ComparisonHero } from "./components/ComparisonHero";
import { LanguageSwitcher } from "./components/LanguageSwitcher";
import { TechnicalDetails } from "./components/TechnicalDetails";
import { WorkflowSteps, type WorkflowStep } from "./components/WorkflowSteps";
import "./App.css";

const KNOWN_LOCATION_IDS = new Set(largeWarehouse.locations.map((l) => l.id));

/** Cross-checks persisted ids against the current 100-location fixture -- an id from a since-removed/renamed location must never resurrect as "completed", "selected", or part of the manual route. */
function sanitizeKnownIds(ids: string[]): NodeId[] {
  return ids.filter((id) => KNOWN_LOCATION_IDS.has(id));
}

/**
 * Restores the manual route's stop order, but only for ids that are both
 * known to the fixture and present in the restored selection -- the manual
 * route's stop set must always be a subset of today's targets, the same
 * invariant `toggleSelected` enforces during live editing. Also de-dupes,
 * since storage could in principle contain a stale/tampered duplicate.
 */
function sanitizeManualRouteStopIds(ids: string[], selectedIds: ReadonlySet<NodeId>): NodeId[] {
  const seen = new Set<NodeId>();
  const result: NodeId[] = [];
  for (const id of sanitizeKnownIds(ids)) {
    if (selectedIds.has(id) && !seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }
  return result;
}

interface ManualRouteData {
  computation: RouteComputation | null;
  visitIds: NodeId[];
  pathMatrix: NodeId[][][];
}

/**
 * Computes the manual route's total distance and, in the same pass, the
 * visitIds/pathMatrix the map needs to draw it -- built once here rather
 * than separately in the map component, so there is exactly one
 * distance-matrix computation per render, not two.
 */
function computeManualRoute(graph: WarehouseGraph, stopIds: NodeId[]): ManualRouteData {
  if (stopIds.length === 0) return { computation: null, visitIds: [], pathMatrix: [] };
  const order = [graph.start.id, ...stopIds];
  const routeGraph: WarehouseGraph = {
    ...graph,
    locations: graph.locations.filter((l) => stopIds.includes(l.id)),
  };
  try {
    const { visitIds, distanceMatrix, pathMatrix } = buildValidatedDistanceMatrix(routeGraph);
    const indexOf = new Map(visitIds.map((id, i) => [id, i]));
    let total = 0;
    for (let i = 0; i < order.length - 1; i++) {
      total += distanceMatrix[indexOf.get(order[i])!][indexOf.get(order[i + 1])!];
    }
    return { computation: { order, totalDistance: total }, visitIds, pathMatrix };
  } catch {
    return { computation: null, visitIds: [], pathMatrix: [] };
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

function computeWorkflowStep(selectedCount: number, manualStopCount: number): WorkflowStep {
  if (selectedCount === 0) return 1;
  if (manualStopCount < 2) return 2;
  return 3;
}

function Dashboard({ persisted }: { persisted: PersistedState }) {
  const { t } = useTranslation();

  const [selected, setSelected] = useState<Set<NodeId>>(
    () => new Set(sanitizeKnownIds(persisted.selectedIds)),
  );
  const [completedIds, setCompletedIds] = useState<Set<NodeId>>(
    () => new Set(sanitizeKnownIds(persisted.completedIds)),
  );
  const [targetCount, setTargetCount] = useState(persisted.targetCount);
  const [walkingSpeed, setWalkingSpeed] = useState(persisted.walkingSpeed);
  const [search, setSearch] = useState("");
  const [zone, setZone] = useState("");
  const [comparisonRequested, setComparisonRequested] = useState(persisted.comparisonRequested);
  const [routeVisibility, setRouteVisibility] = useState<RouteVisibility>("both");
  const manualRoute = useManualRoute(
    sanitizeManualRouteStopIds(persisted.manualRouteStopIds, new Set(sanitizeKnownIds(persisted.selectedIds))),
  );
  const routeEditorRef = useRef<HTMLDivElement>(null);

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

  const currentStep = computeWorkflowStep(selected.size, manualRoute.stopIds.length);

  function toggleSelected(id: NodeId) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        // Today's target list is the source of truth for what may appear
        // in the route -- dropping a target also drops it from the route,
        // so the two never disagree about which locations are in play.
        manualRoute.removeStop(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function markSelectedComplete() {
    setCompletedIds((prev) => {
      const next = new Set(prev);
      selected.forEach((id) => next.add(id));
      return next;
    });
  }

  function undoSelectedCompletion() {
    setCompletedIds((prev) => {
      const next = new Set(prev);
      selected.forEach((id) => next.delete(id));
      return next;
    });
  }

  return (
    <div className="app">
      <header className="app__header">
        <h1>{t("app.title")}</h1>
        <LanguageSwitcher />
      </header>

      <WorkflowSteps step={currentStep} />

      <ComparisonHero
        step={currentStep}
        manual={manualComputation}
        recommended={recommendedComputation}
        walkingSpeed={walkingSpeed}
        onWalkingSpeedChange={setWalkingSpeed}
        manualStopCount={manualRoute.stopIds.length}
        comparisonRequested={comparisonRequested}
        routeVisibility={routeVisibility}
        onRouteVisibilityChange={setRouteVisibility}
      />

      <ProgressPanel
        targetCount={targetCount}
        completedIds={completedIds}
        selectedIds={selected}
        onTargetCountChange={setTargetCount}
        onMarkSelectedComplete={markSelectedComplete}
        onUndoSelectedCompletion={undoSelectedCompletion}
      />

      <main className="app__main">
        <TargetSelector
          locations={largeWarehouse.locations}
          selected={selected}
          search={search}
          zone={zone}
          onSearchChange={setSearch}
          onZoneChange={setZone}
          onToggle={toggleSelected}
          onSelectVisible={(ids) => setSelected(new Set(ids))}
          onClearAll={() => {
            setSelected(new Set());
            manualRoute.clear();
          }}
          onContinueToRoute={() => routeEditorRef.current?.scrollIntoView({ block: "start" })}
        />

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
          onLocationClick={manualRoute.addStop}
        />

        <div ref={routeEditorRef}>
          <ManualRouteEditor
            stopIds={manualRoute.stopIds}
            labels={labels}
            onMoveUp={manualRoute.moveUp}
            onMoveDown={manualRoute.moveDown}
            onRemove={manualRoute.removeStop}
            onClear={manualRoute.clear}
            onGenerate={() => setComparisonRequested(true)}
          />
        </div>

        <TechnicalDetails graph={largeWarehouse} targetIds={manualRoute.stopIds} />
      </main>
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
