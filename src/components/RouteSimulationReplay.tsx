import { useId, useMemo, useState } from "react";
import type { NodeId, RouteComputation, RouteTimeline, WarehouseGraph } from "../domain/types";
import { useSimulationPlayback } from "../hooks/useSimulationPlayback";
import { useTranslation } from "../i18n/useTranslation";
import { projectSimulationMarkerToSvg } from "../ui/simulationMarker";
import { NN_OFFSET, OPT_OFFSET } from "../ui/svgPoints";
import { WarehouseMap } from "./WarehouseMap";

export type ReplayRouteMode = "worker" | "recommended";

export interface ReplayRouteInput {
  route: RouteComputation;
  timeline: RouteTimeline;
}

interface RouteSimulationReplayProps {
  graph: WarehouseGraph;
  visitIds: NodeId[];
  pathMatrix: NodeId[][][];
  simulationInputKey: string;
  worker: ReplayRouteInput;
  recommended: ReplayRouteInput;
}

const PLAYBACK_RATES = [0.5, 1, 2, 5, 10] as const;

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

export function RouteSimulationReplay({
  graph,
  visitIds,
  pathMatrix,
  simulationInputKey,
  worker,
  recommended,
}: RouteSimulationReplayProps) {
  const { t } = useTranslation();
  const replayId = useId();
  const [mode, setMode] = useState<ReplayRouteMode>("worker");
  const activeInput = mode === "worker" ? worker : recommended;
  const playback = useSimulationPlayback(activeInput.timeline, simulationInputKey);
  const projectedMarker = useMemo(
    () => projectSimulationMarkerToSvg(graph, activeInput.timeline, playback.snapshot),
    [activeInput.timeline, graph, playback.snapshot],
  );
  const marker = useMemo(() => {
    const offset = mode === "worker" ? NN_OFFSET : OPT_OFFSET;
    return { x: projectedMarker.x + offset.x, y: projectedMarker.y + offset.y };
  }, [mode, projectedMarker]);
  const selectedIds = useMemo(
    () => new Set(activeInput.timeline.order.slice(1)),
    [activeInput.timeline.order],
  );
  const completedIds = useMemo(
    () => new Set(playback.snapshot.completedDestinationIds),
    [playback.snapshot.completedDestinationIds],
  );
  const emptySearchMatches = useMemo(() => new Set<NodeId>(), []);
  const destinationCount = Math.max(0, activeInput.timeline.order.length - 1);

  return (
    <section className="route-simulation-replay" aria-labelledby={`${replayId}-title`}>
      <div className="route-simulation-replay__heading">
        <div>
          <p className="route-simulation-replay__eyebrow">{t("replay.eyebrow")}</p>
          <h2 id={`${replayId}-title`}>{t("replay.title")}</h2>
        </div>

        <fieldset className="route-simulation-replay__selector">
          <legend>{t("replay.routeSelector")}</legend>
          <div>
            {(["worker", "recommended"] as const).map((routeMode) => (
              <label key={routeMode}>
                <input
                  type="radio"
                  name={`${replayId}-route`}
                  value={routeMode}
                  checked={mode === routeMode}
                  onChange={() => setMode(routeMode)}
                />
                <span>
                  {routeMode === "worker" ? t("comparison.manual") : t("comparison.recommended")}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      <div className="route-simulation-replay__stats" aria-label={t("replay.kpis")}>
        <div>
          <span>{t("replay.elapsed")}</span>
          <strong>
            {formatReplayTime(playback.snapshot.timeSeconds)} /{" "}
            {formatReplayTime(activeInput.timeline.totalDurationSeconds)}
          </strong>
        </div>
        <div>
          <span>{t("replay.distance")}</span>
          <strong>
            {formatDistance(playback.snapshot.distanceTraveled)} {t("units.meters")} /{" "}
            {formatDistance(activeInput.timeline.totalDistance)} {t("units.meters")}
          </strong>
        </div>
        <div>
          <span>{t("replay.completed")}</span>
          <strong>
            {playback.snapshot.completedDestinationIds.length} / {destinationCount}
          </strong>
        </div>
      </div>

      <WarehouseMap
        graph={graph}
        selected={selectedIds}
        visitIds={visitIds}
        pathMatrix={pathMatrix}
        workerRoute={mode === "worker" ? activeInput.route : null}
        recommendedRoute={mode === "recommended" ? activeInput.route : null}
        routeVisibility={mode}
        manualStopIds={[...activeInput.timeline.order.slice(1)]}
        completedIds={completedIds}
        searchMatchIds={emptySearchMatches}
        simulationMarker={marker}
        onLocationClick={() => undefined}
      />

      <div className="route-simulation-replay__controls">
        <div className="route-simulation-replay__transport">
          <button
            type="button"
            className="route-simulation-replay__primary"
            disabled={playback.snapshot.isComplete}
            onClick={playback.clock.isPlaying ? playback.pause : playback.play}
          >
            {playback.clock.isPlaying ? t("replay.pause") : t("replay.play")}
          </button>
          <button type="button" onClick={playback.reset}>
            {t("replay.reset")}
          </button>
        </div>

        <label className="route-simulation-replay__seek">
          <span>{t("replay.seek")}</span>
          <input
            type="range"
            min={0}
            max={activeInput.timeline.totalDurationSeconds}
            step="any"
            value={playback.clock.timeSeconds}
            onChange={(event) => playback.seek(Number(event.target.value))}
          />
        </label>

        <fieldset className="route-simulation-replay__rates">
          <legend>{t("replay.playbackRate")}</legend>
          <div>
            {PLAYBACK_RATES.map((rate) => (
              <button
                key={rate}
                type="button"
                aria-pressed={playback.clock.playbackRate === rate}
                onClick={() => playback.setRate(rate)}
              >
                {rate}×
              </button>
            ))}
          </div>
        </fieldset>
      </div>
    </section>
  );
}
