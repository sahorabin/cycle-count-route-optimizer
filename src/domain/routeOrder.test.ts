import { describe, expect, test } from "vitest";
import { assertValidRouteOrder, InvalidRouteOrderError, validateRouteOrder } from "./routeOrder";
import { sampleWarehouse } from "../data/sampleWarehouse";

describe("validateRouteOrder", () => {
  test("accepts the start followed by every selected target exactly once", () => {
    const result = validateRouteOrder(
      sampleWarehouse,
      ["loc-A", "loc-B", "loc-C", "loc-D"],
      ["office", "loc-D", "loc-B", "loc-A", "loc-C"],
    );

    expect(result).toEqual({ valid: true, errors: [] });
  });

  test("accepts the start followed by a selected subset in any order", () => {
    const result = validateRouteOrder(
      sampleWarehouse,
      ["loc-B", "loc-D"],
      ["office", "loc-D", "loc-B"],
    );

    expect(result).toEqual({ valid: true, errors: [] });
  });

  test("rejects a route where the office/start is not first", () => {
    const result = validateRouteOrder(
      sampleWarehouse,
      ["loc-A", "loc-B"],
      ["loc-A", "loc-B", "office"],
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual({ type: "start-not-first" });
    expect(result.errors).toHaveLength(1);
  });

  test("rejects a route where the start appears more than once", () => {
    const result = validateRouteOrder(
      sampleWarehouse,
      ["loc-A", "loc-B"],
      ["office", "loc-A", "office", "loc-B"],
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual({ type: "duplicate-start" });
    expect(result.errors).toHaveLength(1);
  });

  test("rejects a route missing one of the selected targets", () => {
    const result = validateRouteOrder(sampleWarehouse, ["loc-A", "loc-B"], ["office", "loc-A"]);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual({ type: "missing-target", nodeId: "loc-B" });
    expect(result.errors).toHaveLength(1);
  });

  test("rejects a route with a selected target repeated", () => {
    const result = validateRouteOrder(
      sampleWarehouse,
      ["loc-A", "loc-B"],
      ["office", "loc-A", "loc-A", "loc-B"],
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual({ type: "duplicate-target", nodeId: "loc-A" });
    expect(result.errors).toHaveLength(1);
  });

  test("rejects a route containing a known but unselected location", () => {
    const result = validateRouteOrder(
      sampleWarehouse,
      ["loc-A"],
      ["office", "loc-A", "loc-C"], // loc-C exists but was never selected
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual({ type: "unexpected-id", nodeId: "loc-C" });
    expect(result.errors).toHaveLength(1);
  });

  test("rejects a route containing an id that isn't a real location at all", () => {
    const result = validateRouteOrder(
      sampleWarehouse,
      ["loc-A"],
      ["office", "loc-A", "not-a-real-place"],
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual({ type: "unexpected-id", nodeId: "not-a-real-place" });
    expect(result.errors).toHaveLength(1);
  });

  test("rejects a route containing a walkable aisle node", () => {
    const result = validateRouteOrder(sampleWarehouse, ["loc-A"], ["office", "loc-A", "F2"]);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual({ type: "aisle-node-in-order", nodeId: "F2" });
    expect(result.errors).toHaveLength(1);
  });

  test("reports every violation together, not just the first", () => {
    const result = validateRouteOrder(
      sampleWarehouse,
      ["loc-A", "loc-B"],
      ["loc-A", "loc-A", "F1"], // start missing/not-first, loc-A duplicated, loc-B missing, F1 is an aisle node
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual({ type: "start-not-first" });
    expect(result.errors).toContainEqual({ type: "duplicate-target", nodeId: "loc-A" });
    expect(result.errors).toContainEqual({ type: "missing-target", nodeId: "loc-B" });
    expect(result.errors).toContainEqual({ type: "aisle-node-in-order", nodeId: "F1" });
    expect(result.errors).toHaveLength(4);
  });
});

describe("assertValidRouteOrder", () => {
  test("does not throw for a valid order", () => {
    expect(() =>
      assertValidRouteOrder(
        sampleWarehouse,
        ["loc-A", "loc-B"],
        ["office", "loc-A", "loc-B"],
      ),
    ).not.toThrow();
  });

  test("throws InvalidRouteOrderError carrying the underlying errors", () => {
    try {
      assertValidRouteOrder(sampleWarehouse, ["loc-A", "loc-B"], ["office", "loc-A"]);
      throw new Error("expected assertValidRouteOrder to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidRouteOrderError);
      const typedError = error as InvalidRouteOrderError;
      expect(typedError.errors).toContainEqual({ type: "missing-target", nodeId: "loc-B" });
      expect(typedError.message).toContain("loc-B");
    }
  });
});
