import { describe, expect, test } from "vitest";
import { nearestNeighborRoute } from "./nearestNeighbor";
import { InvalidTargetSelectionError } from "./targetSelection";
import { UnreachableTargetError } from "./distanceMatrix";
import { buildValidatedDistanceMatrix } from "./distanceMatrix";
import { calculateRouteDistance } from "./routeDistance";
import { sampleWarehouse } from "../data/sampleWarehouse";
import type { WarehouseGraph } from "./types";

function euclidean(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

// A dedicated fixture where a location's raw (x, y) coordinates sit right
// next to the start, but the only walkable path to it is a long detour
// (there's no back cross-aisle, same trick as the Phase 1 fixtures). Any
// implementation that used Euclidean/SVG-coordinate distance instead of
// the distance matrix would pick "trap" first; the correct implementation
// must pick "near" first.
const euclideanTrapGraph: WarehouseGraph = {
  aisleNodes: [
    { id: "F1", x: 0, y: 0 },
    { id: "F2", x: 20, y: 0 },
    { id: "B1", x: 0, y: 100 },
    { id: "B2", x: 20, y: 100 },
  ],
  edges: [
    { from: "F1", to: "F2", length: 20 },
    { from: "F1", to: "B1", length: 100 },
    { from: "F2", to: "B2", length: 100 },
  ],
  start: {
    id: "start",
    x: -3,
    y: -3,
    label: "Start",
    aisleNodeId: "F1",
    accessDistance: 1,
  },
  locations: [
    {
      // Aisle distance: 1 + (20 + 100) + 1 = 122
      // Euclidean distance from start (-3,-3): ~8.5 (looks very close!)
      id: "trap",
      x: 0,
      y: 5,
      label: "Deceptively close bin",
      aisleNodeId: "B2",
      accessDistance: 1,
    },
    {
      // Aisle distance: 1 + 100 + 1 = 102
      // Euclidean distance from start (-3,-3): ~103.0
      id: "near",
      x: 0,
      y: 100,
      label: "Actually nearer bin",
      aisleNodeId: "B1",
      accessDistance: 1,
    },
  ],
};

// A fixture with two locations tied at the exact same aisle distance from
// the start, to prove ties are broken by target-list order, not id order
// or insertion order.
const tieGraph: WarehouseGraph = {
  aisleNodes: [{ id: "F1", x: 0, y: 0 }],
  edges: [],
  start: {
    id: "start",
    x: -5,
    y: 0,
    label: "Start",
    aisleNodeId: "F1",
    accessDistance: 5,
  },
  locations: [
    { id: "locP", x: 10, y: 0, label: "P", aisleNodeId: "F1", accessDistance: 10 },
    { id: "locQ", x: 0, y: 10, label: "Q", aisleNodeId: "F1", accessDistance: 10 },
  ],
};

describe("nearestNeighborRoute", () => {
  test("selects the nearest-by-aisle-distance target first", () => {
    const result = nearestNeighborRoute(sampleWarehouse, ["loc-A", "loc-B", "loc-C", "loc-D"]);

    // office distances: loc-A=111, loc-B=77, loc-C=151, loc-D=50 (hand-verified in distanceMatrix.test.ts)
    expect(result.order[1]).toBe("loc-D");
  });

  test("visits every selected target exactly once", () => {
    const targetIds = ["loc-A", "loc-B", "loc-C", "loc-D"];
    const result = nearestNeighborRoute(sampleWarehouse, targetIds);

    expect(new Set(result.order.slice(1))).toEqual(new Set(targetIds));
    expect(result.order.slice(1)).toHaveLength(targetIds.length);
  });

  test("produces a fixed-start open route: starts at the start id, never returns to it", () => {
    const targetIds = ["loc-A", "loc-B", "loc-C", "loc-D"];
    const result = nearestNeighborRoute(sampleWarehouse, targetIds);

    expect(result.order[0]).toBe("office");
    expect(result.order).toHaveLength(targetIds.length + 1);
    expect(result.order.slice(1)).not.toContain("office");
    expect(result.order).not.toContain("F1"); // no intermediate aisle nodes
  });

  test("uses aisle distance, not Euclidean distance, when they disagree", () => {
    // Prove the trap is real: Euclidean says "trap" is far closer than "near".
    expect(
      euclidean(euclideanTrapGraph.start, euclideanTrapGraph.locations[0]),
    ).toBeLessThan(euclidean(euclideanTrapGraph.start, euclideanTrapGraph.locations[1]));

    const result = nearestNeighborRoute(euclideanTrapGraph, ["trap", "near"]);

    expect(result.order[1]).toBe("near");
    expect(result.order[2]).toBe("trap");
  });

  test("breaks exact aisle-distance ties using target-list order, not id or insertion order", () => {
    // locQ is listed first in the target list, alphabetically after locP,
    // and second in the graph's own locations array -- only target-list
    // order should decide the tie.
    const result = nearestNeighborRoute(tieGraph, ["locQ", "locP"]);

    expect(result.order[1]).toBe("locQ");

    const reordered = nearestNeighborRoute(tieGraph, ["locP", "locQ"]);
    expect(reordered.order[1]).toBe("locP");
  });

  test("an empty target list returns just the start with zero distance", () => {
    const result = nearestNeighborRoute(sampleWarehouse, []);

    expect(result.order).toEqual(["office"]);
    expect(result.totalDistance).toBe(0);
  });

  test("reported total distance matches calculateRouteDistance for the same order", () => {
    const targetIds = ["loc-A", "loc-B", "loc-C", "loc-D"];
    const result = nearestNeighborRoute(sampleWarehouse, targetIds);

    const routeGraph: WarehouseGraph = {
      ...sampleWarehouse,
      locations: sampleWarehouse.locations.filter((l) => targetIds.includes(l.id)),
    };
    const { visitIds, distanceMatrix } = buildValidatedDistanceMatrix(routeGraph);
    const independentlyComputed = calculateRouteDistance(result.order, visitIds, distanceMatrix);

    expect(result.totalDistance).toBe(independentlyComputed);
  });

  describe("input validation", () => {
    test("rejects a duplicate target id", () => {
      expect(() =>
        nearestNeighborRoute(sampleWarehouse, ["loc-A", "loc-B", "loc-A"]),
      ).toThrow(InvalidTargetSelectionError);

      try {
        nearestNeighborRoute(sampleWarehouse, ["loc-A", "loc-B", "loc-A"]);
        throw new Error("expected nearestNeighborRoute to throw");
      } catch (error) {
        expect(error).toBeInstanceOf(InvalidTargetSelectionError);
        expect((error as InvalidTargetSelectionError).errors).toContainEqual({
          type: "duplicate-target-id",
          nodeId: "loc-A",
        });
      }
    });

    test("rejects an unknown target id", () => {
      try {
        nearestNeighborRoute(sampleWarehouse, ["loc-A", "not-a-real-place"]);
        throw new Error("expected nearestNeighborRoute to throw");
      } catch (error) {
        expect(error).toBeInstanceOf(InvalidTargetSelectionError);
        expect((error as InvalidTargetSelectionError).errors).toContainEqual({
          type: "unknown-target-id",
          nodeId: "not-a-real-place",
        });
      }
    });

    test("rejects the start id used as a target", () => {
      try {
        nearestNeighborRoute(sampleWarehouse, ["office", "loc-A"]);
        throw new Error("expected nearestNeighborRoute to throw");
      } catch (error) {
        expect(error).toBeInstanceOf(InvalidTargetSelectionError);
        expect((error as InvalidTargetSelectionError).errors).toContainEqual({
          type: "unknown-target-id",
          nodeId: "office",
        });
      }
    });

    test("rejects an aisle-node id used as a target", () => {
      try {
        nearestNeighborRoute(sampleWarehouse, ["F1", "loc-A"]);
        throw new Error("expected nearestNeighborRoute to throw");
      } catch (error) {
        expect(error).toBeInstanceOf(InvalidTargetSelectionError);
        expect((error as InvalidTargetSelectionError).errors).toContainEqual({
          type: "unknown-target-id",
          nodeId: "F1",
        });
      }
    });

    test("rejects an unreachable target", () => {
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

      try {
        nearestNeighborRoute(graphWithUnreachableLocation, ["loc-isolated"]);
        throw new Error("expected nearestNeighborRoute to throw");
      } catch (error) {
        expect(error).toBeInstanceOf(UnreachableTargetError);
        expect((error as UnreachableTargetError).nodeId).toBe("loc-isolated");
      }
    });

    test("does not reject an unreachable location that was not selected as a target", () => {
      // The catalog contains an unreachable location, but this route
      // doesn't visit it, so it must not block the route.
      const graphWithUnreachableLocation: WarehouseGraph = {
        aisleNodes: [
          { id: "F1", x: 0, y: 0 },
          { id: "B1", x: 0, y: 100 },
          { id: "ISO", x: 500, y: 500 },
        ],
        edges: [{ from: "F1", to: "B1", length: 100 }],
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
            id: "loc-reachable",
            x: 0,
            y: 105,
            label: "Reachable Bin",
            aisleNodeId: "B1",
            accessDistance: 3,
          },
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

      const result = nearestNeighborRoute(graphWithUnreachableLocation, ["loc-reachable"]);

      expect(result.order).toEqual(["office", "loc-reachable"]);
    });
  });
});
