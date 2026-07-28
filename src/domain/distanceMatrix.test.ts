import { describe, expect, test } from "vitest";
import { buildDistanceMatrix, buildValidatedDistanceMatrix, UnreachableTargetError } from "./distanceMatrix";
import { sampleWarehouse } from "../data/sampleWarehouse";
import type { WarehouseGraph } from "./types";

function euclidean(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

const graphWithUnreachableLocation: WarehouseGraph = {
  aisleNodes: [
    { id: "F1", x: 0, y: 0 },
    { id: "ISO", x: 500, y: 500 },
  ],
  edges: [],
  start: {
    id: "office",
    x: -5,
    y: 0,
    label: "Office",
    aisleNodeId: "F1",
    accessDistance: 5,
  },
  locations: [
    {
      id: "loc-isolated",
      x: 505,
      y: 500,
      label: "Isolated Bin",
      aisleNodeId: "ISO",
      accessDistance: 2,
    },
  ],
};

describe("buildDistanceMatrix", () => {
  test("visitIds lists the start point first, then every location", () => {
    const { visitIds } = buildDistanceMatrix(sampleWarehouse);
    expect(visitIds).toEqual(["office", "loc-A", "loc-B", "loc-C", "loc-D"]);
  });

  test("matches hand-computed aisle distances from the office", () => {
    const { visitIds, distanceMatrix } = buildDistanceMatrix(sampleWarehouse);
    const officeIdx = visitIds.indexOf("office");

    // office -> loc-A: 8 (spur) + 100 (F1-B1) + 3 (spur) = 111
    expect(distanceMatrix[officeIdx][visitIds.indexOf("loc-A")]).toBe(111);
    // office -> loc-B: 8 + 65 (F1-F2-M2) + 4 = 77
    expect(distanceMatrix[officeIdx][visitIds.indexOf("loc-B")]).toBe(77);
    // office -> loc-C: 8 + 140 (F1-F2-F3-B3) + 3 = 151
    expect(distanceMatrix[officeIdx][visitIds.indexOf("loc-C")]).toBe(151);
    // office -> loc-D: 8 + 40 (F1-F2-F3) + 2 = 50
    expect(distanceMatrix[officeIdx][visitIds.indexOf("loc-D")]).toBe(50);
  });

  test("matches a hand-computed distance between two locations, not just from the start", () => {
    const { visitIds, distanceMatrix } = buildDistanceMatrix(sampleWarehouse);
    // loc-A -> loc-C: 3 + (100 + 20 + 20 + 100) + 3 = 246
    expect(distanceMatrix[visitIds.indexOf("loc-A")][visitIds.indexOf("loc-C")]).toBe(246);
  });

  test("is symmetric with a zero diagonal", () => {
    const { visitIds, distanceMatrix } = buildDistanceMatrix(sampleWarehouse);

    for (let i = 0; i < visitIds.length; i++) {
      expect(distanceMatrix[i][i]).toBe(0);
      for (let j = 0; j < visitIds.length; j++) {
        expect(distanceMatrix[i][j]).toBe(distanceMatrix[j][i]);
      }
    }
  });

  test("aisle-constrained distance differs from straight-line Euclidean distance", () => {
    const { visitIds, distanceMatrix } = buildDistanceMatrix(sampleWarehouse);
    const officeIdx = visitIds.indexOf("office");
    const locCIdx = visitIds.indexOf("loc-C");

    const aisleDistance = distanceMatrix[officeIdx][locCIdx];
    const straightLine = euclidean(sampleWarehouse.start, sampleWarehouse.locations[2]);

    expect(sampleWarehouse.locations[2].id).toBe("loc-C");
    expect(aisleDistance).toBe(151);
    expect(straightLine).toBeCloseTo(127.475, 2);
    expect(aisleDistance).not.toBeCloseTo(straightLine, 0);
  });

  test("pathMatrix traces the actual aisle nodes travelled, including an intermediate node", () => {
    const { visitIds, pathMatrix } = buildDistanceMatrix(sampleWarehouse);
    const officeIdx = visitIds.indexOf("office");
    const locCIdx = visitIds.indexOf("loc-C");

    expect(pathMatrix[officeIdx][locCIdx]).toEqual(["office", "F1", "F2", "F3", "B3", "loc-C"]);
  });

  test("pathMatrix for the same point is just that single point", () => {
    const { visitIds, pathMatrix } = buildDistanceMatrix(sampleWarehouse);
    const officeIdx = visitIds.indexOf("office");

    expect(pathMatrix[officeIdx][officeIdx]).toEqual(["office"]);
  });

  test("reports Infinity distance and an empty path for an unreachable target", () => {
    const { visitIds, distanceMatrix, pathMatrix } = buildDistanceMatrix(
      graphWithUnreachableLocation,
    );
    const officeIdx = visitIds.indexOf("office");
    const isolatedIdx = visitIds.indexOf("loc-isolated");

    expect(distanceMatrix[officeIdx][isolatedIdx]).toBe(Infinity);
    expect(pathMatrix[officeIdx][isolatedIdx]).toEqual([]);
  });
});

// buildDistanceMatrix is the pure, Dijkstra-level layer -- Infinity/[] there
// is a correct representation of "no path exists", not a bug. Route
// comparison code (NN/2-opt, later phases) must never receive that
// Infinity silently, so buildValidatedDistanceMatrix is the boundary that
// turns it into a loud, descriptive failure instead.
describe("buildValidatedDistanceMatrix", () => {
  test("returns the same result as buildDistanceMatrix when every target is reachable", () => {
    expect(buildValidatedDistanceMatrix(sampleWarehouse)).toEqual(
      buildDistanceMatrix(sampleWarehouse),
    );
  });

  test("throws a descriptive UnreachableTargetError naming the unreachable location", () => {
    expect(() => buildValidatedDistanceMatrix(graphWithUnreachableLocation)).toThrow(
      UnreachableTargetError,
    );

    try {
      buildValidatedDistanceMatrix(graphWithUnreachableLocation);
      throw new Error("expected buildValidatedDistanceMatrix to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(UnreachableTargetError);
      expect((error as UnreachableTargetError).nodeId).toBe("loc-isolated");
      expect((error as Error).message).toContain("loc-isolated");
    }
  });
});
