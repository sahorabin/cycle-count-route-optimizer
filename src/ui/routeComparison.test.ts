import { describe, expect, test } from "vitest";
import { compareRoutes } from "./routeComparison";

describe("compareRoutes", () => {
  test("computes distance saved and improvement percentage", () => {
    const result = compareRoutes(
      { order: ["office", "a", "b"], totalDistance: 100 },
      { order: ["office", "b", "a"], totalDistance: 80 },
    );

    expect(result.distanceSaved).toBe(20);
    expect(result.improvementPct).toBeCloseTo(20, 10);
  });

  test("returns 0% improvement, not NaN or Infinity, when the baseline distance is zero", () => {
    const result = compareRoutes(
      { order: ["office"], totalDistance: 0 },
      { order: ["office"], totalDistance: 0 },
    );

    expect(result.distanceSaved).toBe(0);
    expect(result.improvementPct).toBe(0);
    expect(Number.isNaN(result.improvementPct)).toBe(false);
    expect(Number.isFinite(result.improvementPct)).toBe(true);
  });

  test("returns 0% when the two routes are identical", () => {
    const result = compareRoutes(
      { order: ["office", "a"], totalDistance: 50 },
      { order: ["office", "a"], totalDistance: 50 },
    );

    expect(result.distanceSaved).toBe(0);
    expect(result.improvementPct).toBe(0);
  });

  test("never reports a negative improvement, even if given a worse 'optimized' distance", () => {
    // Defensive clamp: the real algorithms guarantee optimized <= baseline,
    // but the display layer must not show a negative number regardless.
    const result = compareRoutes(
      { order: ["office", "a"], totalDistance: 50 },
      { order: ["office", "a"], totalDistance: 70 },
    );

    expect(result.distanceSaved).toBe(0);
    expect(result.improvementPct).toBe(0);
  });
});
