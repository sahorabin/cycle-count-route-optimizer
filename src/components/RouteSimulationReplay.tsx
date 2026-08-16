import { useId, useMemo } from "react";
import type { NodeId, RouteComputation, RouteTimeline, WarehouseGraph } from "../domain/types";
import { useTranslation } from "../i18n/useTranslation";
import type { SimulationSnapshot } from "../simulation/types";
import { projectSimulationMarkerToSvg } from "../ui/simulationMarker";
import { NN_OFFSET, OPT_OFFSET } from "../ui/svgPoints";
import { WarehouseMap } from "./WarehouseMap";

export type ReplayRouteMode = "worker" | "recommended";

export interface ReplayRouteInput {
  route: RouteComputation;
  timeline: RouteTimeline;
}

interface RouteSimulationViewportProps {
  graph: WarehouseGraph;
  visitIds: NodeId[];
  pathMatrix: NodeId[][][];
  input: ReplayRouteInput;
  snapshot: SimulationSnapshot;
  mode: ReplayRouteMode;
}

function formatReplayTime(totalSeconds: number): string {
  const roundedSeconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(roundedSeconds / 3_600);
  const minutes = Math.floor((roundedSeconds % 3_600) / 60);
  const seconds = roundedSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatDistance(distanceMeters: number): string {
  return distanceMeters.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function routeStatus(snapshot: SimulationSnapshot): "ready" | "inProgress" | "completed" {
  if (snapshot.isComplete) return "completed";
  if (snapshot.timeSeconds === 0) return "ready";
  return "inProgress";
}

export function RouteSimulationViewport({
  graph,
  visitIds,
  pathMatrix,
  input,
  snapshot,
  mode,
}: RouteSimulationViewportProps) {
  const { t } = useTranslation();
  const viewportId = useId();
  const projectedMarker = useMemo(
    () => projectSimulationMarkerToSvg(graph, input.timeline, snapshot),
    [graph, input.timeline, snapshot],
  );
  const marker = useMemo(() => {
    const offset = mode === "worker" ? NN_OFFSET : OPT_OFFSET;
    return { x: projectedMarker.x + offset.x, y: projectedMarker.y + offset.y };
  }, [mode, projectedMarker]);
  const selectedIds = useMemo(
    () => new Set(input.timeline.order.slice(1)),
    [input.timeline.order],
  );
  const completedIds = useMemo(
    () => new Set(snapshot.completedDestinationIds),
    [snapshot.completedDestinationIds],
  );
  const emptySearchMatches = useMemo(() => new Set<NodeId>(), []);
  const destinationCount = Math.max(0, input.timeline.order.length - 1);
  const status = routeStatus(snapshot);
  const statusLabel = {
    ready: t("replay.status.ready"),
    inProgress: t("replay.status.inProgress"),
    completed: t("replay.status.completed"),
  }[status];

  return (
    <article
      className={`route-simulation-viewport route-simulation-viewport--${mode}`}
      data-simulation-viewport={mode}
      aria-labelledby={`${viewportId}-title`}
    >
      <header className="route-simulation-viewport__header">
        <h3 id={`${viewportId}-title`}>
          {mode === "worker" ? t("comparison.manual") : t("comparison.recommended")}
        </h3>
        <span
          className={`route-simulation-viewport__status route-simulation-viewport__status--${status}`}
          aria-label={`${t("replay.status")}: ${statusLabel}`}
        >
          {statusLabel}
        </span>
      </header>

      <WarehouseMap
        graph={graph}
        selected={selectedIds}
        visitIds={visitIds}
        pathMatrix={pathMatrix}
        workerRoute={mode === "worker" ? input.route : null}
        recommendedRoute={mode === "recommended" ? input.route : null}
        routeVisibility={mode}
        manualStopIds={[...input.timeline.order.slice(1)]}
        completedIds={completedIds}
        searchMatchIds={emptySearchMatches}
        simulationMarker={marker}
        onLocationClick={() => undefined}
      />

      <div className="route-simulation-viewport__stats" aria-label={t("replay.kpis")}>
        <div>
          <span>{t("replay.distance")}</span>
          <strong>
            {formatDistance(snapshot.distanceTraveled)} {t("units.meters")} /{" "}
            {formatDistance(input.timeline.totalDistance)} {t("units.meters")}
          </strong>
        </div>
        <div>
          <span>{t("replay.completed")}</span>
          <strong>
            {snapshot.completedDestinationIds.length} / {destinationCount}
          </strong>
        </div>
        <div>
          <span>{t("replay.routeDuration")}</span>
          <strong>{formatReplayTime(input.timeline.totalDurationSeconds)}</strong>
        </div>
      </div>
    </article>
  );
}
