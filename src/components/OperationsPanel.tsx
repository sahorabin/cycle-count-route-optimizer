import { useTranslation } from "../i18n/useTranslation";
import type { SimulationSnapshot } from "../simulation/types";
import { compareRoutes } from "../ui/routeComparison";
import { getSharedComparisonSavings } from "../ui/sharedSimulationComparison";
import type { ReplayRouteInput, ReplayRouteMode } from "./RouteSimulationReplay";

interface OperationsPanelProps {
  worker: ReplayRouteInput;
  recommended: ReplayRouteInput;
  workerSnapshot: SimulationSnapshot;
  recommendedSnapshot: SimulationSnapshot;
  /** Which route the summary block describes; comparison always shows both. */
  focus: ReplayRouteMode;
  locationLabels: ReadonlyMap<string, string>;
}

function formatClock(totalSeconds: number): string {
  const rounded = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(rounded / 3_600);
  const minutes = Math.floor((rounded % 3_600) / 60);
  const seconds = rounded % 60;
  const base = `${minutes}:${String(seconds).padStart(2, "0")}`;
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}` : base;
}

function formatMeters(distanceMeters: number): string {
  return distanceMeters.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="ops-panel__metric">
      <span className="ops-panel__metric-label">{label}</span>
      <strong className="ops-panel__metric-value">{value}</strong>
      {hint ? <span className="ops-panel__metric-hint">{hint}</span> : null}
    </div>
  );
}

/**
 * Left telemetry column. Every figure here is read from an existing timeline,
 * snapshot, or the existing comparison helpers -- this panel never computes a
 * KPI of its own.
 */
export function OperationsPanel({
  worker,
  recommended,
  workerSnapshot,
  recommendedSnapshot,
  focus,
  locationLabels,
}: OperationsPanelProps) {
  const { t } = useTranslation();
  const input = focus === "worker" ? worker : recommended;
  const snapshot = focus === "worker" ? workerSnapshot : recommendedSnapshot;
  const destinationCount = Math.max(0, input.timeline.order.length - 1);
  const distanceComparison = compareRoutes(worker.route, recommended.route);
  const savings = getSharedComparisonSavings(worker.timeline, recommended.timeline);
  const service = snapshot.current?.kind === "service" ? snapshot.current : null;
  const state = service
    ? t("replay.activity.service")
    : snapshot.isComplete
      ? t("replay.status.completed")
      : t("replay.activity.travel");

  return (
    <div className="ops-panel">
      <section className="ops-panel__section" aria-labelledby="ops-summary-title">
        <h3 className="ops-panel__title" id="ops-summary-title">{t("twin.routeSummary")}</h3>
        <p className="ops-panel__scope">
          {focus === "worker" ? t("comparison.manual") : t("comparison.recommended")}
        </p>

        <div className="ops-panel__grid">
          <Metric
            label={t("twin.locations")}
            value={`${snapshot.completedDestinationIds.length} / ${destinationCount}`}
          />
          <Metric
            label={t("replay.distance")}
            value={`${formatMeters(snapshot.distanceTraveled)} ${t("units.meters")}`}
            hint={`${formatMeters(input.timeline.totalDistance)} ${t("units.meters")} ${t("twin.totalDistance")}`}
          />
          <Metric
            label={t("replay.travelTime")}
            value={formatClock(input.timeline.walkingDurationSeconds)}
          />
          <Metric
            label={t("replay.serviceTime")}
            value={formatClock(input.timeline.serviceDurationSeconds)}
          />
          <Metric
            label={t("replay.totalPhysicalTime")}
            value={formatClock(input.timeline.totalDurationSeconds)}
          />
        </div>
      </section>

      <section className="ops-panel__section" aria-labelledby="ops-comparison-title">
        <h3 className="ops-panel__title" id="ops-comparison-title">{t("twin.comparison")}</h3>
        <p className="ops-panel__conditions">
          {t("replay.sameConditions")}
          <strong>{t("replay.onlyRouteDiffers")}</strong>
        </p>
        <div className="ops-panel__grid ops-panel__grid--pair">
          <Metric
            label={t("comparison.manual")}
            value={formatClock(worker.timeline.totalDurationSeconds)}
          />
          <Metric
            label={t("comparison.recommended")}
            value={formatClock(recommended.timeline.totalDurationSeconds)}
          />
          <Metric
            label={t("twin.distanceImprovement")}
            value={`${distanceComparison.improvementPct.toFixed(1)}%`}
            hint={`${formatMeters(distanceComparison.distanceSaved)} ${t("units.meters")}`}
          />
          <Metric
            label={t("twin.timeSaving")}
            value={formatClock(savings.walkingSecondsSaved)}
          />
        </div>
      </section>

      <section className="ops-panel__section" aria-labelledby="ops-task-title">
        <h3 className="ops-panel__title" id="ops-task-title">{t("twin.taskState")}</h3>
        <p className="ops-panel__state" data-task-state={snapshot.current?.kind ?? (snapshot.isComplete ? "complete" : "idle")}>
          {state}
        </p>
        {service ? (
          <div className="ops-panel__grid">
            <Metric
              label={t("replay.hud.location")}
              value={locationLabels.get(service.locationId) ?? service.locationId}
            />
            {service.serviceClass ? (
              <Metric
                label={t("replay.currentActivity")}
                value={t(`replay.serviceClass.${service.serviceClass}`)}
              />
            ) : null}
          </div>
        ) : null}
        <p className="ops-panel__disclosure">{t("replay.syntheticServiceDisclosure")}</p>
      </section>
    </div>
  );
}
