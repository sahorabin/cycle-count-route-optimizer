import type { RouteComputation } from "../domain/types";

export interface RouteComparisonSummary {
  distanceSaved: number;
  improvementPct: number;
}

/**
 * Compares a nearest-neighbor route against its 2-opt-optimized
 * counterpart for display. distanceSaved and improvementPct are clamped
 * to zero rather than ever shown negative, and improvementPct is 0 (not
 * NaN/Infinity) when the baseline distance is zero.
 */
export function compareRoutes(
  nearestNeighbor: RouteComputation,
  optimized: RouteComputation,
): RouteComparisonSummary {
  const distanceSaved = Math.max(0, nearestNeighbor.totalDistance - optimized.totalDistance);
  const improvementPct =
    nearestNeighbor.totalDistance === 0 ? 0 : (distanceSaved / nearestNeighbor.totalDistance) * 100;

  return { distanceSaved, improvementPct };
}
