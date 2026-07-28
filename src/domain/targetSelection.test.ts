import { describe, expect, test } from "vitest";
import { validateTargetSelection } from "./targetSelection";
import { sampleWarehouse } from "../data/sampleWarehouse";

describe("validateTargetSelection", () => {
  test("accepts every catalogued location selected once each", () => {
    const result = validateTargetSelection(sampleWarehouse, [
      "loc-A",
      "loc-B",
      "loc-C",
      "loc-D",
    ]);

    expect(result).toEqual({ valid: true, errors: [] });
  });

  test("accepts a proper subset of locations", () => {
    const result = validateTargetSelection(sampleWarehouse, ["loc-B", "loc-D"]);

    expect(result).toEqual({ valid: true, errors: [] });
  });

  test("rejects the same location id selected twice, e.g. [loc-A, loc-B, loc-A]", () => {
    const result = validateTargetSelection(sampleWarehouse, ["loc-A", "loc-B", "loc-A"]);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual({
      type: "duplicate-target-id",
      nodeId: "loc-A",
    });
    expect(result.errors).toHaveLength(1);
  });

  test("reports a duplicate only once even if the id repeats three times", () => {
    const result = validateTargetSelection(sampleWarehouse, ["loc-A", "loc-A", "loc-A"]);

    expect(result.errors).toEqual([{ type: "duplicate-target-id", nodeId: "loc-A" }]);
  });

  test("rejects a target id that is not a known cycle-count location", () => {
    const result = validateTargetSelection(sampleWarehouse, ["loc-A", "not-a-real-location"]);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual({
      type: "unknown-target-id",
      nodeId: "not-a-real-location",
    });
    expect(result.errors).toHaveLength(1);
  });

  test("rejects the start/office id used as a target", () => {
    const result = validateTargetSelection(sampleWarehouse, ["office", "loc-A"]);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual({
      type: "unknown-target-id",
      nodeId: "office",
    });
  });

  test("rejects an aisle node id used as a target", () => {
    const result = validateTargetSelection(sampleWarehouse, ["F1", "loc-A"]);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual({
      type: "unknown-target-id",
      nodeId: "F1",
    });
  });

  test("reports both a duplicate and an unknown id in the same call", () => {
    const result = validateTargetSelection(sampleWarehouse, ["loc-A", "loc-A", "bogus"]);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual({ type: "duplicate-target-id", nodeId: "loc-A" });
    expect(result.errors).toContainEqual({ type: "unknown-target-id", nodeId: "bogus" });
    expect(result.errors).toHaveLength(2);
  });

  test("an empty selection is valid (no targets chosen yet)", () => {
    const result = validateTargetSelection(sampleWarehouse, []);

    expect(result).toEqual({ valid: true, errors: [] });
  });
});
