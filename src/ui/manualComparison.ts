import { compareRoutes } from "./routeComparison";
import type { RouteComputation } from "../domain/types";

export interface DurationComparison {
  manualDistance: number;
  recommendedDistance: number;
  distanceSaved: number;
  improvementPct: number;
  manualDurationMinutes: number;
  recommendedDurationMinutes: number;
  timeSavedMinutes: number;
  hasSavings: boolean;
}

/**
 * Wraps the existing zero-clamped compareRoutes (never negative, never
 * NaN/Infinity) with duration-at-walking-speed math. `hasSavings` is the
 * single source of truth the UI must check before showing any "faster"
 * claim -- it is false whenever distanceSaved is exactly 0, including the
 * identical-route, single-stop, and zero-stop cases. This is the only
 * place Manual-vs-Recommended numbers are computed; UI components must
 * call this, never recompute distance/duration/improvement themselves.
 */
export function compareManualToRecommended(
  manual: RouteComputation,
  recommended: RouteComputation,
  walkingSpeedMetersPerMinute: number,
): DurationComparison {
  const { distanceSaved, improvementPct } = compareRoutes(manual, recommended);

  const manualDurationMinutes = manual.totalDistance / walkingSpeedMetersPerMinute;
  const recommendedDurationMinutes = recommended.totalDistance / walkingSpeedMetersPerMinute;

  return {
    manualDistance: manual.totalDistance,
    recommendedDistance: recommended.totalDistance,
    distanceSaved,
    improvementPct,
    manualDurationMinutes,
    recommendedDurationMinutes,
    timeSavedMinutes: Math.max(0, manualDurationMinutes - recommendedDurationMinutes),
    hasSavings: distanceSaved > 0,
  };
}
