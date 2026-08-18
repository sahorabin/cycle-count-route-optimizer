import { useId, useMemo, useState } from "react";
import type { NodeId, WarehouseGraph } from "../domain/types";
import { useSimulationPlayback } from "../hooks/useSimulationPlayback";
import { useTranslation } from "../i18n/useTranslation";
import {
  getSharedComparisonDuration,
  getSharedComparisonSnapshots,
} from "../ui/sharedSimulationComparison";
import { projectSimulationMarkerToSvg } from "../ui/simulationMarker";
import {
  createWarehouseCameraChannel,
  type WarehouseCameraPreset,
} from "../ui/warehouse3dCamera";
import { CameraToolbar } from "./CameraToolbar";
import { OperationsPanel } from "./OperationsPanel";
import { WarehouseMap } from "./WarehouseMap";
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

/**
 * The digital-twin application shell: a compact bar, a telemetry column, the
 * dominant 3D stage, a camera rail, and a simulation timeline. It owns exactly
 * one playback clock and derives both route snapshots from the same time.
 */
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
  const [viewMode, setViewMode] = useState<SimulationViewMode>("explore");
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
  const locationLabels = useMemo(
    () => new Map(graph.locations.map((location) => [location.id, location.label])),
    [graph.locations],
  );
  const focusRoute: ReplayRouteMode = viewMode === "explore" ? exploreRoute : "worker";
  const focusInput = focusRoute === "worker" ? worker : recommended;
  const focusSnapshot = focusRoute === "worker" ? snapshots.worker : snapshots.recommended;

  const selectCameraPreset = (preset: WarehouseCameraPreset) => {
    setCameraPreset(preset);
    setCameraResetRequest((request) => request + 1);
  };
  const selectExploreRoute = (route: ReplayRouteMode) => {
    setExploreRoute(route);
    if (cameraPreset === "worker") setCameraResetRequest((request) => request + 1);
  };

  // The minimap reuses the existing SVG projection of the same truth rather
  // than modelling the warehouse a second time.
  const minimapMarker = useMemo(
    () => projectSimulationMarkerToSvg(graph, focusInput.timeline, focusSnapshot),
    [focusInput.timeline, focusSnapshot, graph],
  );
  const minimapSelected = useMemo(
    () => new Set(focusInput.timeline.order.slice(1)),
    [focusInput.timeline.order],
  );
  const minimapCompleted = useMemo(
    () => new Set(focusSnapshot.completedDestinationIds),
    [focusSnapshot.completedDestinationIds],
  );
  const emptyMatches = useMemo(() => new Set<NodeId>(), []);

  const viewportProps = {
    graph,
    visitIds,
    pathMatrix,
    rendererMode,
    cameraPreset,
    cameraResetRequest,
    cameraChannel,
  };

  return (
    <section className="twin" aria-labelledby={`${comparisonId}-title`}>
      <header className="twin__bar">
        <div className="twin__identity">
          <h2 id={`${comparisonId}-title`}>{t("twin.title")}</h2>
          <p>{t("twin.context")}</p>
        </div>

        <div className="twin__modes">
          <fieldset className="twin__switch">
            <legend>{t("replay.viewMode")}</legend>
            <div>
              {(["explore", "compare"] as const).map((mode) => (
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
            <fieldset className="twin__switch">
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

          <fieldset className="twin__switch">
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
        </div>
      </header>

      <div className="twin__body">
        <aside className="twin__ops" aria-label={t("twin.operations")}>
          <OperationsPanel
            worker={worker}
            recommended={recommended}
            workerSnapshot={snapshots.worker}
            recommendedSnapshot={snapshots.recommended}
            focus={focusRoute}
            locationLabels={locationLabels}
          />
        </aside>

        <div
          className={`twin__stage twin__stage--${viewMode}`}
          aria-label={t("twin.viewport")}
        >
          {viewMode === "explore" ? (
            <RouteSimulationViewport
              {...viewportProps}
              input={focusInput}
              snapshot={focusSnapshot}
              mode={exploreRoute}
              cameraAuthority
              viewMode="explore"
            />
          ) : (
            <>
              <RouteSimulationViewport
                {...viewportProps}
                input={worker}
                snapshot={snapshots.worker}
                mode="worker"
                cameraAuthority
              />
              <RouteSimulationViewport
                {...viewportProps}
                input={recommended}
                snapshot={snapshots.recommended}
                mode="recommended"
                cameraAuthority={false}
              />
            </>
          )}

          {rendererMode === "3d" ? (
            <div className="twin__minimap" aria-label={t("twin.minimap")} role="img">
              <WarehouseMap
                graph={graph}
                selected={minimapSelected}
                visitIds={visitIds}
                pathMatrix={pathMatrix}
                workerRoute={focusRoute === "worker" ? focusInput.route : null}
                recommendedRoute={focusRoute === "recommended" ? focusInput.route : null}
                routeVisibility={focusRoute}
                manualStopIds={[...focusInput.timeline.order.slice(1)]}
                completedIds={minimapCompleted}
                searchMatchIds={emptyMatches}
                simulationMarker={minimapMarker}
                onLocationClick={() => undefined}
              />
            </div>
          ) : null}
        </div>

        {rendererMode === "3d" ? (
          <CameraToolbar
            preset={cameraPreset}
            onSelectPreset={selectCameraPreset}
            onReset={() => setCameraResetRequest((request) => request + 1)}
          />
        ) : null}
      </div>

      <footer className="twin__timeline" aria-label={t("twin.timeline")}>
        <div className="twin__transport">
          <button
            type="button"
            className="twin__primary"
            disabled={playback.clock.timeSeconds >= sharedDurationSeconds}
            onClick={playback.clock.isPlaying ? playback.pause : playback.play}
          >
            {playback.clock.isPlaying ? t("replay.pause") : t("replay.play")}
          </button>
          <button type="button" onClick={playback.reset}>{t("replay.reset")}</button>
        </div>

        <div className="twin__clock">
          <span>{t("replay.simulationTime")}</span>
          <strong>
            {formatReplayTime(playback.clock.timeSeconds)} /{" "}
            {formatReplayTime(sharedDurationSeconds)}
          </strong>
        </div>

        <label className="twin__seek">
          <span className="visually-hidden">{t("replay.seek")}</span>
          <input
            type="range"
            min={0}
            max={sharedDurationSeconds}
            step={1}
            value={playback.clock.timeSeconds}
            aria-label={t("replay.seek")}
            aria-valuetext={t("replay.seekValue", {
              current: formatReplayTime(playback.clock.timeSeconds),
              total: formatReplayTime(sharedDurationSeconds),
            })}
            onChange={(event) => playback.seek(Number(event.target.value))}
            onKeyDown={(event) => {
              let nextTime: number | null = null;
              if (event.key === "ArrowRight") nextTime = playback.clock.timeSeconds + 1;
              else if (event.key === "ArrowLeft") nextTime = playback.clock.timeSeconds - 1;
              else if (event.key === "Home") nextTime = 0;
              else if (event.key === "End") nextTime = sharedDurationSeconds;

              if (nextTime !== null) {
                event.preventDefault();
                playback.seek(nextTime);
              }
            }}
          />
        </label>

        <fieldset className="twin__rates">
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
      </footer>
    </section>
  );
}
