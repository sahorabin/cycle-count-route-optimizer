import { useId, useMemo, useState } from "react";
import type { NodeId, WarehouseGraph } from "../domain/types";
import { useSimulationPlayback } from "../hooks/useSimulationPlayback";
import { useTranslation } from "../i18n/useTranslation";
import {
  getSharedComparisonDuration,
  getSharedComparisonSnapshots,
} from "../ui/sharedSimulationComparison";
import {
  RouteSimulationViewport,
  type ReplayRouteInput,
  type SimulationRendererMode,
} from "./RouteSimulationReplay";

interface RouteSimulationComparisonProps {
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

export function RouteSimulationComparison({
  graph,
  visitIds,
  pathMatrix,
  simulationInputKey,
  worker,
  recommended,
}: RouteSimulationComparisonProps) {
  const { t } = useTranslation();
  const comparisonId = useId();
  const [rendererMode, setRendererMode] = useState<SimulationRendererMode>("3d");
  const sharedDurationSeconds = getSharedComparisonDuration(
    worker.timeline,
    recommended.timeline,
  );
  const physicalInputKey = [
    simulationInputKey,
    worker.timeline.walkingSpeedMetersPerMinute,
    worker.route.order.join(">"),
    recommended.route.order.join(">"),
    worker.timeline.totalDistance,
    recommended.timeline.totalDistance,
  ].join("|");
  const playback = useSimulationPlayback(sharedDurationSeconds, physicalInputKey);
  const snapshots = useMemo(
    () =>
      getSharedComparisonSnapshots(
        worker.timeline,
        recommended.timeline,
        playback.clock.timeSeconds,
      ),
    [playback.clock.timeSeconds, recommended.timeline, worker.timeline],
  );

  return (
    <section className="route-simulation-comparison" aria-labelledby={`${comparisonId}-title`}>
      <header className="route-simulation-comparison__heading">
        <p className="route-simulation-comparison__eyebrow">{t("replay.eyebrow")}</p>
        <h2 id={`${comparisonId}-title`}>{t("replay.title")}</h2>
        <div className="route-simulation-comparison__conditions">
          <p>{t("replay.sameConditions")}</p>
          <strong>{t("replay.onlyRouteDiffers")}</strong>
        </div>
      </header>

      <div className="route-simulation-comparison__shared-controls">
        <div className="route-simulation-comparison__time">
          <span>{t("replay.simulationTime")}</span>
          <strong>
            {formatReplayTime(playback.clock.timeSeconds)} /{" "}
            {formatReplayTime(sharedDurationSeconds)}
          </strong>
        </div>

        <div className="route-simulation-comparison__controls">
          <fieldset className="route-simulation-comparison__renderer-modes">
            <legend>{t("replay.renderer")}</legend>
            <div>
              {(["3d", "2d"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={rendererMode === mode}
                  onClick={() => setRendererMode(mode)}
                >
                  {mode === "3d" ? t("replay.renderer3d") : t("replay.renderer2d")}
                </button>
              ))}
            </div>
          </fieldset>
          <div className="route-simulation-comparison__transport">
            <button
              type="button"
              className="route-simulation-comparison__primary"
              disabled={playback.clock.timeSeconds >= sharedDurationSeconds}
              onClick={playback.clock.isPlaying ? playback.pause : playback.play}
            >
              {playback.clock.isPlaying ? t("replay.pause") : t("replay.play")}
            </button>
            <button type="button" onClick={playback.reset}>
              {t("replay.reset")}
            </button>
          </div>

          <label className="route-simulation-comparison__seek">
            <span>{t("replay.seek")}</span>
            <input
              type="range"
              min={0}
              max={sharedDurationSeconds}
              step={1}
              value={playback.clock.timeSeconds}
              aria-valuetext={t("replay.seekValue", {
                current: formatReplayTime(playback.clock.timeSeconds),
                total: formatReplayTime(sharedDurationSeconds),
              })}
              onChange={(event) => playback.seek(Number(event.target.value))}
              onKeyDown={(event) => {
                let nextTime: number | null = null;
                if (event.key === "ArrowRight") {
                  nextTime = playback.clock.timeSeconds + 1;
                } else if (event.key === "ArrowLeft") {
                  nextTime = playback.clock.timeSeconds - 1;
                } else if (event.key === "Home") {
                  nextTime = 0;
                } else if (event.key === "End") {
                  nextTime = sharedDurationSeconds;
                }

                if (nextTime !== null) {
                  event.preventDefault();
                  playback.seek(nextTime);
                }
              }}
            />
          </label>

          <fieldset className="route-simulation-comparison__rates">
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
      </div>

      <div className="route-simulation-comparison__viewports">
        <RouteSimulationViewport
          graph={graph}
          visitIds={visitIds}
          pathMatrix={pathMatrix}
          input={worker}
          snapshot={snapshots.worker}
          mode="worker"
          rendererMode={rendererMode}
        />
        <RouteSimulationViewport
          graph={graph}
          visitIds={visitIds}
          pathMatrix={pathMatrix}
          input={recommended}
          snapshot={snapshots.recommended}
          mode="recommended"
          rendererMode={rendererMode}
        />
      </div>
    </section>
  );
}
