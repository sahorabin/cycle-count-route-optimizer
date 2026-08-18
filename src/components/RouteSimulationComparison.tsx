import { useId, useMemo, useState } from "react";
import type { NodeId, WarehouseGraph } from "../domain/types";
import { useSimulationPlayback } from "../hooks/useSimulationPlayback";
import { useTranslation } from "../i18n/useTranslation";
import {
  getSharedComparisonDuration,
  getSharedComparisonSnapshots,
} from "../ui/sharedSimulationComparison";
import {
  createWarehouseCameraChannel,
  type WarehouseCameraPreset,
} from "../ui/warehouse3dCamera";
import {
  RouteSimulationViewport,
  type ReplayRouteMode,
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
const CAMERA_PRESETS: readonly WarehouseCameraPreset[] = [
  "overview",
  "top",
  "aisle",
  "worker",
];
const CAMERA_PRESET_KEYS = {
  overview: "replay.camera.overview",
  top: "replay.camera.top",
  aisle: "replay.camera.aisle",
  worker: "replay.camera.worker",
} as const;
type SimulationViewMode = "compare" | "explore";

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
  const [viewMode, setViewMode] = useState<SimulationViewMode>("compare");
  const [exploreRoute, setExploreRoute] = useState<ReplayRouteMode>("worker");
  const [cameraPreset, setCameraPreset] = useState<WarehouseCameraPreset>("overview");
  const [cameraResetRequest, setCameraResetRequest] = useState(0);
  const cameraChannel = useMemo(createWarehouseCameraChannel, []);
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
    worker.timeline.serviceDurationSeconds,
    recommended.timeline.serviceDurationSeconds,
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
  const selectCameraPreset = (preset: WarehouseCameraPreset) => {
    setCameraPreset(preset);
    setCameraResetRequest((request) => request + 1);
  };
  const selectExploreRoute = (route: ReplayRouteMode) => {
    setExploreRoute(route);
    if (cameraPreset === "worker") {
      setCameraResetRequest((request) => request + 1);
    }
  };

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

      {rendererMode === "3d" ? (
        <div className="route-simulation-comparison__camera-controls">
          <fieldset className="route-simulation-comparison__view-modes">
            <legend>{t("replay.viewMode")}</legend>
            <div>
              {(["compare", "explore"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={viewMode === mode}
                  onClick={() => setViewMode(mode)}
                >
                  {mode === "compare" ? t("replay.viewCompare") : t("replay.viewExplore")}
                </button>
              ))}
            </div>
          </fieldset>

          {viewMode === "explore" ? (
            <fieldset className="route-simulation-comparison__explore-routes">
              <legend>{t("replay.exploreRoute")}</legend>
              <div>
                {(["worker", "recommended"] as const).map((route) => (
                  <button
                    key={route}
                    type="button"
                    aria-pressed={exploreRoute === route}
                    onClick={() => selectExploreRoute(route)}
                  >
                    {route === "worker" ? t("comparison.manual") : t("comparison.recommended")}
                  </button>
                ))}
              </div>
            </fieldset>
          ) : null}

          <fieldset className="route-simulation-comparison__camera-presets">
            <legend>{t("replay.camera")}</legend>
            <div>
              {CAMERA_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  aria-pressed={cameraPreset === preset}
                  onClick={() => selectCameraPreset(preset)}
                >
                  {t(CAMERA_PRESET_KEYS[preset])}
                </button>
              ))}
              <button
                type="button"
                className="route-simulation-comparison__camera-reset"
                onClick={() => setCameraResetRequest((request) => request + 1)}
              >
                {t("replay.camera.reset")}
              </button>
            </div>
          </fieldset>
          <p className="route-simulation-comparison__camera-help">
            {t("replay.camera.help")}
          </p>
        </div>
      ) : null}

      <div
        className={`route-simulation-comparison__viewports route-simulation-comparison__viewports--${rendererMode === "3d" ? viewMode : "compare"}`}
      >
        {rendererMode === "3d" && viewMode === "explore" ? (
          <RouteSimulationViewport
            graph={graph}
            visitIds={visitIds}
            pathMatrix={pathMatrix}
            input={exploreRoute === "worker" ? worker : recommended}
            snapshot={exploreRoute === "worker" ? snapshots.worker : snapshots.recommended}
            mode={exploreRoute}
            rendererMode={rendererMode}
            cameraPreset={cameraPreset}
            cameraResetRequest={cameraResetRequest}
            cameraChannel={cameraChannel}
            cameraAuthority
            viewMode="explore"
          />
        ) : (
          <>
            <RouteSimulationViewport
              graph={graph}
              visitIds={visitIds}
              pathMatrix={pathMatrix}
              input={worker}
              snapshot={snapshots.worker}
              mode="worker"
              rendererMode={rendererMode}
              cameraPreset={cameraPreset}
              cameraResetRequest={cameraResetRequest}
              cameraChannel={cameraChannel}
              cameraAuthority
            />
            <RouteSimulationViewport
              graph={graph}
              visitIds={visitIds}
              pathMatrix={pathMatrix}
              input={recommended}
              snapshot={snapshots.recommended}
              mode="recommended"
              rendererMode={rendererMode}
              cameraPreset={cameraPreset}
              cameraResetRequest={cameraResetRequest}
              cameraChannel={cameraChannel}
              cameraAuthority={false}
            />
          </>
        )}
      </div>
    </section>
  );
}
