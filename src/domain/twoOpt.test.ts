import { describe, expect, test } from "vitest";
import { twoOptRoute } from "./twoOpt";
import { InvalidTargetSelectionError } from "./targetSelection";
import { InvalidRouteOrderError } from "./routeOrder";
import { buildValidatedDistanceMatrix, UnreachableTargetError } from "./distanceMatrix";
import { calculateRouteDistance } from "./routeDistance";
import { sampleWarehouse } from "../data/sampleWarehouse";
import type { RouteComputation, WarehouseGraph } from "./types";

// ---------------------------------------------------------------------------
// Fixtures. Every expected order/distance below was independently verified
// with a throwaway Node simulation of the exact algorithm the task
// specifies (deterministic best-improvement, ascending i then j, full
// open-route recompute per candidate) BEFORE src/domain/twoOpt.ts was
// written -- these numbers are not derived by reading the implementation.
// ---------------------------------------------------------------------------

const sampleTargets = ["loc-A", "loc-B", "loc-C", "loc-D"];

function routeGraphFor(graph: WarehouseGraph, targetIds: string[]): WarehouseGraph {
  return { ...graph, locations: graph.locations.filter((l) => targetIds.includes(l.id)) };
}

function matrixFor(graph: WarehouseGraph, targetIds: string[]) {
  return buildValidatedDistanceMatrix(routeGraphFor(graph, targetIds));
}

// Hand distances (hub graph, all locations attach the same aisle node, so
// distance(X,Y) = accessDistance(X) + accessDistance(Y)): used wherever the
// test only needs a simple, exactly-controllable metric, not aisle realism.
function hubGraph(startAccess: number, locationAccess: Record<string, number>): WarehouseGraph {
  return {
    aisleNodes: [{ id: "H", x: 0, y: 0 }],
    edges: [],
    start: { id: "S", x: -1, y: 0, label: "S", aisleNodeId: "H", accessDistance: startAccess },
    locations: Object.entries(locationAccess).map(([id, accessDistance]) => ({
      id,
      x: 0,
      y: 0,
      label: id,
      aisleNodeId: "H",
      accessDistance,
    })),
  };
}

// #5/#6: the only possible move is a suffix reversal, and it's beneficial.
// d(S,X)=51, d(S,Y)=6, d(X,Y)=55. [S,X,Y]=106 -> [S,Y,X]=61.
const suffixGraph = hubGraph(1, { X: 50, Y: 5 });

// #9: X and Y are equidistant from S, so swapping them is an exact tie,
// never a strict improvement. d(S,X)=d(S,Y)=11, d(X,Y)=20. Both orders = 31.
const tieWithCurrentGraph = hubGraph(1, { X: 10, Y: 10 });

// #10: two different reversals, (1,4) and (2,4), both land a tied-largest
// target (Y or Z, access=9) in the final slot and reach the same best total
// (34) from 41. (1,4) enumerates first and must be the one applied.
const tieBreakGraph = hubGraph(1, { W: 1, X: 2, Y: 9, Z: 9 });

// #11: "trap" sits visually right next to the start (tiny Euclidean
// distance) but its only walkable path is a long detour (no back
// cross-aisle, same construction as Phase 1/2 fixtures); "near" is the
// opposite. [S,trap,near]=344 -> [S,near,trap]=324.
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
  start: { id: "start", x: -3, y: -3, label: "Start", aisleNodeId: "F1", accessDistance: 1 },
  locations: [
    { id: "trap", x: 0, y: 5, label: "trap", aisleNodeId: "B2", accessDistance: 1 },
    { id: "near", x: 0, y: 100, label: "near", aisleNodeId: "B1", accessDistance: 1 },
  ],
};

function euclidean(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

// #20 regression fixture: a 4-node CYCLE (not a tree), so shortest-path
// distances don't collapse the way they would on sampleWarehouse's tree
// layout. A closed-tour formula that wraps a suffix reversal's "next node"
// index back to the start (index 0) would evaluate the winning move,
// reversing [B,D] in [S,A,B,D], as delta=+6 (worse) and stop with no
// improvement at all -- see the "regression" describe block below.
const regressionGraph: WarehouseGraph = {
  aisleNodes: [
    { id: "N1", x: 0, y: 0 },
    { id: "N2", x: 10, y: 0 },
    { id: "N3", x: 10, y: 10 },
    { id: "N4", x: 0, y: 10 },
  ],
  edges: [
    { from: "N1", to: "N2", length: 3 },
    { from: "N2", to: "N3", length: 10 },
    { from: "N3", to: "N4", length: 12 },
    { from: "N4", to: "N1", length: 1 },
  ],
  start: { id: "S", x: -1, y: -1, label: "S", aisleNodeId: "N1", accessDistance: 1 },
  locations: [
    { id: "A", x: 10, y: -1, label: "A", aisleNodeId: "N2", accessDistance: 1 },
    { id: "B", x: 11, y: 10, label: "B", aisleNodeId: "N3", accessDistance: 1 },
    { id: "D", x: -1, y: 10, label: "D", aisleNodeId: "N4", accessDistance: 1 },
  ],
};

const unreachableGraph: WarehouseGraph = {
  aisleNodes: [
    { id: "F1", x: 0, y: 0 },
    { id: "B1", x: 0, y: 100 },
    { id: "ISO", x: 500, y: 500 },
  ],
  edges: [{ from: "F1", to: "B1", length: 100 }],
  start: { id: "office", x: -5, y: 0, label: "Office", aisleNodeId: "F1", accessDistance: 5 },
  locations: [
    { id: "loc-reachable", x: 0, y: 105, label: "Reachable", aisleNodeId: "B1", accessDistance: 3 },
    { id: "loc-isolated", x: 505, y: 500, label: "Isolated", aisleNodeId: "ISO", accessDistance: 2 },
  ],
};

function route(order: string[], totalDistance = 0): RouteComputation {
  return { order, totalDistance };
}

describe("twoOptRoute", () => {
  // 1. Improves a route where one internal segment reversal is beneficial.
  test("applies a beneficial internal reversal that doesn't touch the final stop", () => {
    // [office,loc-B,loc-A,loc-D,loc-C] (499) -> reverse [loc-B,loc-A] (i=1,j=2,
    // not the last index) -> [office,loc-A,loc-B,loc-D,loc-C] (459).
    const result = twoOptRoute(
      sampleWarehouse,
      sampleTargets,
      route(["office", "loc-B", "loc-A", "loc-D", "loc-C"]),
    );

    expect(result.order).toEqual(["office", "loc-A", "loc-B", "loc-D", "loc-C"]);
    expect(result.totalDistance).toBe(459);
  });

  // 2. Preserves the start at index 0.
  test("keeps the start at index 0", () => {
    const result = twoOptRoute(
      sampleWarehouse,
      sampleTargets,
      route(["office", "loc-C", "loc-D", "loc-A", "loc-B"]),
    );

    expect(result.order[0]).toBe("office");
  });

  // 3. Preserves every selected target exactly once.
  test("visits every selected target exactly once", () => {
    const result = twoOptRoute(
      sampleWarehouse,
      sampleTargets,
      route(["office", "loc-C", "loc-D", "loc-A", "loc-B"]),
    );

    expect(new Set(result.order.slice(1))).toEqual(new Set(sampleTargets));
    expect(result.order.slice(1)).toHaveLength(sampleTargets.length);
  });

  // 4. Returns an open route and excludes a return-to-start edge.
  test("returns an open route: never revisits the start, no aisle nodes", () => {
    const result = twoOptRoute(
      sampleWarehouse,
      sampleTargets,
      route(["office", "loc-C", "loc-D", "loc-A", "loc-B"]),
    );

    expect(result.order).toHaveLength(sampleTargets.length + 1);
    expect(result.order.slice(1)).not.toContain("office");
    expect(result.order).not.toContain("F1");
    expect(result.order).not.toContain("F2");
  });

  // 5. Allows an improving reversal whose end index is the final destination.
  // 6. Includes a case where the best improvement changes the final destination.
  test("allows a suffix reversal that changes the final destination", () => {
    // [S,X,Y]=106 -> reverse the whole tail (i=1,j=2=last index) -> [S,Y,X]=61.
    const result = twoOptRoute(suffixGraph, ["X", "Y"], route(["S", "X", "Y"]));

    expect(result.order).toEqual(["S", "Y", "X"]);
    expect(result.totalDistance).toBe(61);
  });

  // 7. Finds repeated improvements requiring more than one 2-opt iteration.
  test("keeps iterating across multiple rounds until no move improves further", () => {
    // Independently simulated trace:
    //   [office,loc-C,loc-D,loc-A,loc-B] = 573
    //   -> [office,loc-B,loc-A,loc-D,loc-C] = 499   (iteration 1)
    //   -> [office,loc-A,loc-B,loc-D,loc-C] = 459   (iteration 2)
    // A single-iteration implementation would incorrectly stop at 499.
    const result = twoOptRoute(
      sampleWarehouse,
      sampleTargets,
      route(["office", "loc-C", "loc-D", "loc-A", "loc-B"]),
    );

    expect(result.order).toEqual(["office", "loc-A", "loc-B", "loc-D", "loc-C"]);
    expect(result.totalDistance).toBe(459);
    expect(result.totalDistance).toBeLessThan(499);
  });

  // 8. Returns identical order and distance when no strict improvement exists.
  test("leaves an already 2-opt-optimal route unchanged", () => {
    const alreadyOptimal = ["office", "loc-A", "loc-B", "loc-D", "loc-C"];
    const result = twoOptRoute(sampleWarehouse, sampleTargets, route(alreadyOptimal));

    expect(result.order).toEqual(alreadyOptimal);
    expect(result.totalDistance).toBe(459);
  });

  // 9. Does not accept an equal-distance reversal.
  test("does not apply a reversal that exactly ties the current distance", () => {
    // The only possible move (swap X,Y) ties exactly at 31; must be rejected.
    const result = twoOptRoute(tieWithCurrentGraph, ["X", "Y"], route(["S", "X", "Y"]));

    expect(result.order).toEqual(["S", "X", "Y"]);
    expect(result.totalDistance).toBe(31);
  });

  // 10. Resolves equally good improving candidates deterministically.
  test("breaks a tie between two equally-good improving reversals using enumeration order", () => {
    // From [S,Y,Z,W,X]=41, both (i=1,j=4) and (i=2,j=4) reach the same best
    // total (34). (1,4) is enumerated first (ascending i) and must win, not
    // (2,4). A buggy "last improvement wins" or unordered scan could produce
    // [S,Y,X,W,Z] instead -- this test would catch that.
    const result = twoOptRoute(tieBreakGraph, ["W", "X", "Y", "Z"], route(["S", "Y", "Z", "W", "X"]));

    expect(result.order).toEqual(["S", "X", "W", "Z", "Y"]);
    expect(result.totalDistance).toBe(34);
  });

  // 11. Uses aisle distance rather than Euclidean/SVG coordinates.
  test("uses aisle distance, not Euclidean distance, to decide whether to reverse", () => {
    // Prove the trap is real: by raw coordinates "trap" looks far closer to
    // start than "near" does.
    expect(euclidean(euclideanTrapGraph.start, euclideanTrapGraph.locations[0])).toBeLessThan(
      euclidean(euclideanTrapGraph.start, euclideanTrapGraph.locations[1]),
    );

    const result = twoOptRoute(euclideanTrapGraph, ["trap", "near"], route(["start", "trap", "near"]));

    expect(result.order).toEqual(["start", "near", "trap"]);
    expect(result.totalDistance).toBe(324);
  });

  describe("input validation", () => {
    // 12. Rejects an invalid start position.
    test("rejects a route whose first element isn't the start", () => {
      try {
        twoOptRoute(sampleWarehouse, ["loc-A", "loc-B"], route(["loc-A", "office", "loc-B"]));
        throw new Error("expected twoOptRoute to throw");
      } catch (error) {
        expect(error).toBeInstanceOf(InvalidRouteOrderError);
        expect((error as InvalidRouteOrderError).errors).toContainEqual({ type: "start-not-first" });
      }
    });

    // 13. Rejects duplicate, missing, unknown, unselected, and aisle-node entries.
    test("rejects a duplicated target in the order", () => {
      try {
        twoOptRoute(sampleWarehouse, ["loc-A", "loc-B"], route(["office", "loc-A", "loc-A"]));
        throw new Error("expected twoOptRoute to throw");
      } catch (error) {
        expect(error).toBeInstanceOf(InvalidRouteOrderError);
        expect((error as InvalidRouteOrderError).errors).toContainEqual({
          type: "duplicate-target",
          nodeId: "loc-A",
        });
      }
    });

    test("rejects a route missing a selected target", () => {
      try {
        twoOptRoute(sampleWarehouse, ["loc-A", "loc-B"], route(["office", "loc-A"]));
        throw new Error("expected twoOptRoute to throw");
      } catch (error) {
        expect(error).toBeInstanceOf(InvalidRouteOrderError);
        expect((error as InvalidRouteOrderError).errors).toContainEqual({
          type: "missing-target",
          nodeId: "loc-B",
        });
      }
    });

    test("rejects a route containing an unknown id", () => {
      try {
        twoOptRoute(sampleWarehouse, ["loc-A"], route(["office", "loc-A", "not-a-real-place"]));
        throw new Error("expected twoOptRoute to throw");
      } catch (error) {
        expect(error).toBeInstanceOf(InvalidRouteOrderError);
        expect((error as InvalidRouteOrderError).errors).toContainEqual({
          type: "unexpected-id",
          nodeId: "not-a-real-place",
        });
      }
    });

    test("rejects a route containing a known but unselected location", () => {
      try {
        twoOptRoute(sampleWarehouse, ["loc-A"], route(["office", "loc-A", "loc-C"]));
        throw new Error("expected twoOptRoute to throw");
      } catch (error) {
        expect(error).toBeInstanceOf(InvalidRouteOrderError);
        expect((error as InvalidRouteOrderError).errors).toContainEqual({
          type: "unexpected-id",
          nodeId: "loc-C",
        });
      }
    });

    test("rejects a route containing an aisle node", () => {
      try {
        twoOptRoute(sampleWarehouse, ["loc-A"], route(["office", "loc-A", "F2"]));
        throw new Error("expected twoOptRoute to throw");
      } catch (error) {
        expect(error).toBeInstanceOf(InvalidRouteOrderError);
        expect((error as InvalidRouteOrderError).errors).toContainEqual({
          type: "aisle-node-in-order",
          nodeId: "F2",
        });
      }
    });

    test("rejects a duplicate target id in the target list itself", () => {
      try {
        twoOptRoute(sampleWarehouse, ["loc-A", "loc-A"], route(["office", "loc-A"]));
        throw new Error("expected twoOptRoute to throw");
      } catch (error) {
        expect(error).toBeInstanceOf(InvalidTargetSelectionError);
        expect((error as InvalidTargetSelectionError).errors).toContainEqual({
          type: "duplicate-target-id",
          nodeId: "loc-A",
        });
      }
    });

    // 14. Rejects required unreachable targets at the application boundary.
    test("rejects a selected target that is unreachable", () => {
      try {
        twoOptRoute(
          unreachableGraph,
          ["loc-reachable", "loc-isolated"],
          route(["office", "loc-reachable", "loc-isolated"]),
        );
        throw new Error("expected twoOptRoute to throw");
      } catch (error) {
        expect(error).toBeInstanceOf(UnreachableTargetError);
        expect((error as UnreachableTargetError).nodeId).toBe("loc-isolated");
      }
    });

    test("does not reject an unreachable location that wasn't selected", () => {
      const result = twoOptRoute(
        unreachableGraph,
        ["loc-reachable"],
        route(["office", "loc-reachable"]),
      );

      expect(result.order).toEqual(["office", "loc-reachable"]);
    });
  });

  // 15. Handles zero selected targets.
  test("handles zero selected targets", () => {
    const result = twoOptRoute(sampleWarehouse, [], route(["office"]));

    expect(result.order).toEqual(["office"]);
    expect(result.totalDistance).toBe(0);
  });

  // 16. Handles one selected target.
  test("handles exactly one selected target (no possible reversal)", () => {
    const result = twoOptRoute(sampleWarehouse, ["loc-B"], route(["office", "loc-B"]));

    expect(result.order).toEqual(["office", "loc-B"]);
    expect(result.totalDistance).toBe(77);
  });

  // 17. Does not mutate its inputs.
  test("does not mutate the supplied route, target list, or graph", () => {
    const inputOrder = ["office", "loc-C", "loc-D", "loc-A", "loc-B"];
    const inputRoute = route([...inputOrder]);
    const inputTargets = [...sampleTargets];
    const graphSnapshot = JSON.parse(JSON.stringify(sampleWarehouse));

    const result = twoOptRoute(sampleWarehouse, inputTargets, inputRoute);

    expect(inputRoute.order).toEqual(inputOrder); // unchanged
    expect(inputTargets).toEqual(sampleTargets); // unchanged
    expect(sampleWarehouse).toEqual(graphSnapshot); // unchanged
    expect(result.order).not.toBe(inputRoute.order); // a genuinely new array
  });

  // 18. Verifies returned totalDistance using calculateRouteDistance.
  test("reported total distance matches an independent calculateRouteDistance call", () => {
    const result = twoOptRoute(
      sampleWarehouse,
      sampleTargets,
      route(["office", "loc-C", "loc-D", "loc-A", "loc-B"]),
    );

    const { visitIds, distanceMatrix } = matrixFor(sampleWarehouse, sampleTargets);
    const independentlyComputed = calculateRouteDistance(result.order, visitIds, distanceMatrix);

    expect(result.totalDistance).toBe(independentlyComputed);
  });

  // 19. Verifies optimized distance is never greater than the input route distance.
  test("never returns a distance greater than the input route's distance", () => {
    const { visitIds, distanceMatrix } = matrixFor(sampleWarehouse, sampleTargets);
    const startingOrders = [
      ["office", "loc-C", "loc-A", "loc-D", "loc-B"],
      ["office", "loc-D", "loc-C", "loc-B", "loc-A"],
      ["office", "loc-A", "loc-B", "loc-C", "loc-D"], // already near-optimal
      ["office", "loc-A", "loc-B", "loc-D", "loc-C"], // already fully optimal
    ];

    for (const order of startingOrders) {
      const inputDistance = calculateRouteDistance(order, visitIds, distanceMatrix);
      const result = twoOptRoute(sampleWarehouse, sampleTargets, route(order));

      expect(result.totalDistance).toBeLessThanOrEqual(inputDistance);
    }
  });

  // 20. Regression: would fail under closed-tour return-to-start logic.
  describe("closed-tour regression", () => {
    test("finds the improving suffix reversal that a closed-tour wraparound formula would miss", () => {
      // On this cycle graph (not a tree), a formula that evaluates a suffix
      // reversal (i, j=last index) by wrapping "the node after j" around to
      // the start would compute delta = +6 for reversing [B,D] in
      // [S,A,B,D] (i.e. "worse, reject"), and delta = 0 for reversing
      // [A,B,D] (i.e. "no change"), finding no improvement in the whole
      // first iteration at all, and stopping at the original order (31).
      //
      // The true open-path totals (no phantom return edge) are:
      //   [S,A,B,D] = 31
      //   [S,A,D,B] = 25  (reverse [B,D], i=2,j=3 -- the move the bug rejects)
      //   [S,D,A,B] = 21  (one further improving round)
      const result = twoOptRoute(regressionGraph, ["A", "B", "D"], route(["S", "A", "B", "D"]));

      expect(result.order).toEqual(["S", "D", "A", "B"]);
      expect(result.totalDistance).toBe(21);
      expect(result.totalDistance).toBeLessThan(31); // what a closed-tour bug would wrongly report as final
    });
  });
});
