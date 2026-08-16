import { compareManualToRecommended } from "../ui/manualComparison";
import { splitDuration } from "../ui/formatDuration";
import type { RouteComputation } from "../domain/types";
import type { Language } from "../i18n/translations";
import type { RouteVisibility } from "./WarehouseMap";
import type { WorkflowStep } from "./WorkflowSteps";
import { useTranslation } from "../i18n/useTranslation";
import type { Ref } from "react";

interface ComparisonHeroProps {
  step: WorkflowStep;
  manual: RouteComputation | null;
  recommended: RouteComputation | null;
  walkingSpeed: number;
  onWalkingSpeedChange: (speed: number) => void;
  manualStopCount: number;
  comparisonRequested: boolean;
  routeVisibility: RouteVisibility;
  onRouteVisibilityChange: (visibility: RouteVisibility) => void;
  resultRef?: Ref<HTMLElement>;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

// Locale-aware thousands separators (e.g. "1,145") for both ko-KR and
// en-US -- distances are display formatting only, never fed back into the
// underlying routing math, which stays in raw metres.
function formatDistanceNumber(value: number, language: Language): string {
  return new Intl.NumberFormat(language === "ko" ? "ko-KR" : "en-US", {
    maximumFractionDigits: 1,
  }).format(value);
}

/** The unit is a separate, smaller/muted element so it never competes visually with the number it labels. */
function DistanceValue({ value, unit, language }: { value: number; unit: string; language: Language }) {
  return (
    <p className="comparison-hero__distance">
      {formatDistanceNumber(value, language)}
      <span className="comparison-hero__unit"> {unit}</span>
    </p>
  );
}

export function ComparisonHero({
  step,
  manual,
  recommended,
  walkingSpeed,
  onWalkingSpeedChange,
  manualStopCount,
  comparisonRequested,
  routeVisibility,
  onRouteVisibilityChange,
  resultRef,
}: ComparisonHeroProps) {
  const { t, language } = useTranslation();

  // Steps 1 and 2 each have their own single task -- the hero tells the
  // worker what to do next instead of leading with "Route comparison",
  // which is only relevant once there is a route to compare (step 3).
  if (step === 1) {
    return (
      <section className="comparison-hero comparison-hero--intro" aria-label={t("hero.step1Title")}>
        <h2>{t("hero.step1Title")}</h2>
        <p className="comparison-hero__intro-body">{t("hero.step1Body")}</p>
      </section>
    );
  }
  if (step === 2) {
    return (
      <section className="comparison-hero comparison-hero--intro" aria-label={t("hero.step2Title")}>
        <h2>{t("hero.step2Title")}</h2>
        <p className="comparison-hero__intro-body">{t("hero.step2Body")}</p>
      </section>
    );
  }

  const canShowComparison = comparisonRequested && manualStopCount >= 2 && manual && recommended;

  return (
    <section
      ref={resultRef}
      className="comparison-hero"
      aria-label={t("comparison.title")}
      tabIndex={canShowComparison ? -1 : undefined}
    >
      <div className="comparison-hero__header">
        <h2>{t("comparison.title")}</h2>
        <label className="comparison-hero__speed">
          {t("comparison.walkingSpeedLabel")}
          <input
            type="number"
            min={1}
            value={walkingSpeed}
            onChange={(e) => {
              const value = Number(e.target.value);
              if (Number.isFinite(value) && value > 0) onWalkingSpeedChange(value);
            }}
          />
        </label>
      </div>

      {!canShowComparison ? (
        <p className="comparison-hero__empty">{t("comparison.needMoreStops")}</p>
      ) : (
        (() => {
          const result = compareManualToRecommended(manual, recommended, walkingSpeed);
          const { minutes, seconds } = splitDuration(result.timeSavedMinutes);
          const summary = result.hasSavings
            ? t("comparison.summaryTemplate", {
                distance: formatDistanceNumber(result.distanceSaved, language),
                unit: t("units.meters"),
                duration: t("comparison.durationFormat", { m: minutes, s: seconds }),
                pct: result.improvementPct.toFixed(1),
              })
            : t("comparison.noSavingsYet");

          return (
            <>
              <p className="comparison-hero__summary">{summary}</p>

              <fieldset className="comparison-hero__visibility">
                <legend className="visually-hidden">{t("comparison.routeVisibility")}</legend>
                {(
                  [
                    { value: "worker", label: t("comparison.manual") },
                    { value: "recommended", label: t("comparison.recommended") },
                    { value: "both", label: t("comparison.toggleBoth") },
                  ] as const
                ).map((option) => (
                  <label key={option.value} className="comparison-hero__visibility-option">
                    <input
                      type="radio"
                      name="route-visibility"
                      value={option.value}
                      checked={routeVisibility === option.value}
                      onChange={() => onRouteVisibilityChange(option.value)}
                    />
                    {option.label}
                  </label>
                ))}
              </fieldset>

              <div className="comparison-hero__grid">
                <div className="comparison-hero__column" data-role="manual">
                  <h3>{t("comparison.manual")}</h3>
                  <DistanceValue value={result.manualDistance} unit={t("units.meters")} language={language} />
                  <p className="comparison-hero__duration">
                    {formatNumber(result.manualDurationMinutes)} {t("units.minutes")}
                  </p>
                </div>
                <div className="comparison-hero__column" data-role="recommended">
                  <h3>{t("comparison.recommended")}</h3>
                  <DistanceValue
                    value={result.recommendedDistance}
                    unit={t("units.meters")}
                    language={language}
                  />
                  <p className="comparison-hero__duration">
                    {formatNumber(result.recommendedDurationMinutes)} {t("units.minutes")}
                  </p>
                </div>
              </div>
              <p className="comparison-hero__replay-cue">{t("comparison.replayCue")}</p>
            </>
          );
        })()
      )}
    </section>
  );
}
