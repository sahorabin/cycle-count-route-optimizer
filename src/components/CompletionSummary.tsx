import { useTranslation } from "../i18n/useTranslation";
import { compareRoutes } from "../ui/routeComparison";
import { getSharedComparisonSavings } from "../ui/sharedSimulationComparison";
import type { ReplayRouteInput } from "./RouteSimulationReplay";
import { WorkflowDialog } from "./WorkflowDialog";

export function CompletionSummary({ worker, recommended, onReview, onStartNewWork }: {
  worker: ReplayRouteInput; recommended: ReplayRouteInput; onReview: () => void; onStartNewWork: () => void;
}) {
  const { t, language } = useTranslation();
  const distance = compareRoutes(worker.route, recommended.route);
  const savings = getSharedComparisonSavings(worker.timeline, recommended.timeline);
  const meters = (value: number) => `${value.toLocaleString(language, { maximumFractionDigits: 1 })} ${t("units.meters")}`;
  const duration = (seconds: number) => t("comparison.durationFormat", { m: Math.floor(Math.round(seconds) / 60), s: Math.round(seconds) % 60 });
  const count = worker.timeline.order.length - 1;
  return <WorkflowDialog showClose title={t("closure.title")} onClose={onReview} actions={<>
    <button type="button" autoFocus onClick={onReview}>{t("closure.review")}</button>
    <button type="button" onClick={onStartNewWork}>{t("closure.new")}</button>
  </>}>
    <p className="closure-saving"><span>{t("closure.walkingSaved")}</span><strong>{duration(savings.walkingSecondsSaved)}</strong></p>
    <dl className="closure-metrics">
      <div><dt>{t("twin.locations")}</dt><dd>{count} / {count}</dd></div>
      <div><dt>{t("comparison.distanceSaved")}</dt><dd>{meters(distance.distanceSaved)} · {distance.improvementPct.toFixed(1)}%</dd></div>
      {[worker, recommended].map((input, index) => <div key={index}>
        <dt>{t(index === 0 ? "comparison.manual" : "comparison.recommended")}</dt>
        <dd>{meters(input.timeline.totalDistance)}</dd>
        <dd>{t("replay.travelTime")}: {duration(input.timeline.walkingDurationSeconds)}</dd>
      </div>)}
      <div><dt>{t("replay.serviceTime")}</dt><dd>{duration(worker.timeline.serviceDurationSeconds)} · {t("closure.unchanged")}</dd></div>
    </dl>
    <p>{t("closure.same")}</p><p className="closure-persistence">{t("closure.persist")}</p>
  </WorkflowDialog>;
}
