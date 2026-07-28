import { describe, expect, test } from "vitest";
import { compareManualToRecommended } from "./manualComparison";

describe("compareManualToRecommended", () => {
  test("computes distances, savings, improvement, and durations at the default speed", () => {
    const result = compareManualToRecommended(
      { order: ["office", "a", "b"], totalDistance: 120 },
      { order: ["office", "b", "a"], totalDistance: 90 },
      60,
    );
    expect(result.manualDistance).toBe(120);
    expect(result.recommendedDistance).toBe(90);
    expect(result.distanceSaved).toBe(30);
    expect(result.improvementPct).toBeCloseTo(25, 10);
    expect(result.manualDurationMinutes).toBeCloseTo(2, 10);
    expect(result.recommendedDurationMinutes).toBeCloseTo(1.5, 10);
    expect(result.timeSavedMinutes).toBeCloseTo(0.5, 10);
    expect(result.hasSavings).toBe(true);
  });

  test("never reports savings when manual and recommended are identical", () => {
    const route = { order: ["office", "a"], totalDistance: 50 };
    const result = compareManualToRecommended(route, route, 60);
    expect(result.distanceSaved).toBe(0);
    expect(result.timeSavedMinutes).toBe(0);
    expect(result.hasSavings).toBe(false);
  });

  test("handles a single-stop route (zero possible improvement) honestly", () => {
    const route = { order: ["office", "a"], totalDistance: 10 };
    const result = compareManualToRecommended(route, route, 60);
    expect(result.hasSavings).toBe(false);
    expect(result.improvementPct).toBe(0);
  });

  test("handles a zero-stop route without NaN/Infinity", () => {
    const route = { order: ["office"], totalDistance: 0 };
    const result = compareManualToRecommended(route, route, 60);
    expect(result.manualDurationMinutes).toBe(0);
    expect(result.hasSavings).toBe(false);
    expect(Number.isNaN(result.improvementPct)).toBe(false);
  });

  test("recomputes duration proportionally when walking speed changes", () => {
    const route = { order: ["office", "a"], totalDistance: 120 };
    const result = compareManualToRecommended(route, route, 120);
    expect(result.manualDurationMinutes).toBeCloseTo(1, 10);
  });
});
