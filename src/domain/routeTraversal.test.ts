import { describe, expect, test } from "vitest";
import { sampleWarehouse } from "../data/sampleWarehouse";
import { buildValidatedDistanceMatrix, type DistanceMatrixResult } from "./distanceMatrix";
import { nearestNeighborRoute } from "./nearestNeighbor";
import { calculateRouteDistance } from "./routeDistance";
import {
  buildRouteTraversal,
  InvalidRouteTraversalError,
  ROUTE_TRAVERSAL_DISTANCE_EPSILON,
} from "./routeTraversal";
import { twoOptRoute } from "./twoOpt";
import type { NodeId, RouteComputation, WarehouseGraph } from "./types";

function routeGraphFor(targetIds: NodeId[]): WarehouseGraph {
  return {
    ...sampleWarehouse,
    locations: sampleWarehouse.locations.filter((location) => targetIds.includes(location.id)),
  };
}

function matrixAndRoute(order: NodeId[]): {
  graph: WarehouseGraph;
  matrix: DistanceMatrixResult;
  route: RouteComputation;
} {
  const graph = routeGraphFor(order.slice(1));
  const matrix = buildValidatedDistanceMatrix(graph);
  const totalDistance = calculateRouteDistance(order, matrix.visitIds, matrix.distanceMatrix);
  return { graph, matrix, route: { order, totalDistance } };
}

function cloneMatrix(matrix: DistanceMatrixResult): DistanceMatrixResult {
  return {
    visitIds: [...matrix.visitIds],
    distanceMatrix: matrix.distanceMatrix.map((row) => [...row]),
    pathMatrix: matrix.pathMatrix.map((row) => row.map((path) => [...path])),
  };
}

describe("buildRouteTraversal", () => {
  test("expands a one-destination route into one leg with the preserved shortest path", () => {
    const { graph, matrix, route } = matrixAndRoute(["office", "loc-D"]);

    const traversal = buildRouteTraversal(graph, route, matrix);

    expect(traversal.order).toEqual(["office", "loc-D"]);
    expect(traversal.legs).toHaveLength(1);
    expect(traversal.legs[0].from).toBe("office");
    expect(traversal.legs[0].to).toBe("loc-D");
    expect(traversal.legs[0].path).toEqual(["office", "F1", "F2", "F3", "loc-D"]);
  });

  test("preserves every leg and destination order in a multi-destination route", () => {
    const { graph, matrix, route } = matrixAndRoute(["office", "loc-D", "loc-C", "loc-A"]);

    const traversal = buildRouteTraversal(graph, route, matrix);

    expect(traversal.order).toEqual(route.order);
    expect(traversal.legs.map(({ from, to }) => [from, to])).toEqual([
      ["office", "loc-D"],
      ["loc-D", "loc-C"],
      ["loc-C", "loc-A"],
    ]);
    expect(traversal.legs[1].path).toEqual(["loc-D", "F3", "B3", "loc-C"]);
  });

  test("uses attachment access distances at both ends and aisle edge lengths in between", () => {
    const { graph, matrix, route } = matrixAndRoute(["office", "loc-D"]);

    const [leg] = buildRouteTraversal(graph, route, matrix).legs;

    expect(leg.segments).toEqual([
      { from: "office", to: "F1", distance: 8 },
      { from: "F1", to: "F2", distance: 20 },
      { from: "F2", to: "F3", distance: 20 },
      { from: "F3", to: "loc-D", distance: 2 },
    ]);
    expect(leg.distance).toBe(50);
  });

  test("looks up undirected aisle edges correctly when traversed in reverse", () => {
    const { graph, matrix, route } = matrixAndRoute(["office", "loc-C", "loc-D"]);

    const reverseLeg = buildRouteTraversal(graph, route, matrix).legs[1];

    expect(reverseLeg.path).toEqual(["loc-C", "B3", "F3", "loc-D"]);
    expect(reverseLeg.segments).toEqual([
      { from: "loc-C", to: "B3", distance: 3 },
      { from: "B3", to: "F3", distance: 100 },
      { from: "F3", to: "loc-D", distance: 2 },
    ]);
  });

  test("enforces all segment, leg, traversal, and route distance sums", () => {
    const { graph, matrix, route } = matrixAndRoute(["office", "loc-D", "loc-B", "loc-A"]);

    const traversal = buildRouteTraversal(graph, route, matrix);
    const legSum = traversal.legs.reduce((sum, leg) => sum + leg.distance, 0);

    for (const leg of traversal.legs) {
      const segmentSum = leg.segments.reduce((sum, segment) => sum + segment.distance, 0);
      expect(Math.abs(segmentSum - leg.distance)).toBeLessThanOrEqual(ROUTE_TRAVERSAL_DISTANCE_EPSILON);
    }
    expect(Math.abs(legSum - traversal.totalDistance)).toBeLessThanOrEqual(
      ROUTE_TRAVERSAL_DISTANCE_EPSILON,
    );
    expect(Math.abs(traversal.totalDistance - route.totalDistance)).toBeLessThanOrEqual(
      ROUTE_TRAVERSAL_DISTANCE_EPSILON,
    );
  });

  test("keeps the office first, adds no return leg, and keeps aisle nodes out of order", () => {
    const { graph, matrix, route } = matrixAndRoute(["office", "loc-B", "loc-D"]);

    const traversal = buildRouteTraversal(graph, route, matrix);

    expect(traversal.order[0]).toBe("office");
    expect(traversal.order).toEqual(["office", "loc-B", "loc-D"]);
    expect(traversal.order).not.toContain("F1");
    expect(traversal.order).not.toContain("M2");
    expect(traversal.legs.at(-1)?.to).toBe("loc-D");
    expect(traversal.legs.some((leg) => leg.to === "office")).toBe(false);
  });

  test("supports the valid zero-destination fixed-start route without adding movement", () => {
    const { graph, matrix, route } = matrixAndRoute(["office"]);

    expect(buildRouteTraversal(graph, route, matrix)).toEqual({
      order: ["office"],
      legs: [],
      totalDistance: 0,
    });
  });

  test("consumes a deliberately non-optimized supplied order without recomputing it", () => {
    const suppliedOrder = ["office", "loc-C", "loc-D", "loc-A", "loc-B"];
    const { graph, matrix, route } = matrixAndRoute(suppliedOrder);

    const traversal = buildRouteTraversal(graph, route, matrix);

    expect(traversal.order).toEqual(suppliedOrder);
    expect(traversal.legs.map((leg) => leg.to)).toEqual(suppliedOrder.slice(1));
    expect(traversal.totalDistance).toBe(573);
  });

  test("the same builder accepts both a worker computation and a recommended computation", () => {
    const targetIds = ["loc-A", "loc-B", "loc-C", "loc-D"];
    const graph = routeGraphFor(targetIds);
    const matrix = buildValidatedDistanceMatrix(graph);
    const workerOrder = ["office", "loc-C", "loc-D", "loc-A", "loc-B"];
    const worker: RouteComputation = {
      order: workerOrder,
      totalDistance: calculateRouteDistance(workerOrder, matrix.visitIds, matrix.distanceMatrix),
    };
    const recommended = twoOptRoute(graph, targetIds, nearestNeighborRoute(graph, targetIds));

    const workerTraversal = buildRouteTraversal(graph, worker, matrix);
    const recommendedTraversal = buildRouteTraversal(graph, recommended, matrix);

    expect(workerTraversal.order).toEqual(worker.order);
    expect(recommendedTraversal.order).toEqual(recommended.order);
    expect(workerTraversal.totalDistance).toBe(worker.totalDistance);
    expect(recommendedTraversal.totalDistance).toBe(recommended.totalDistance);
  });

  test("does not mutate the supplied route or matrix paths", () => {
    const { graph, matrix, route } = matrixAndRoute(["office", "loc-D", "loc-C"]);
    const originalOrder = [...route.order];
    const originalMatrix = cloneMatrix(matrix);

    const traversal = buildRouteTraversal(graph, route, matrix);

    expect(route.order).toEqual(originalOrder);
    expect(matrix).toEqual(originalMatrix);
    expect(traversal.order).not.toBe(route.order);
    expect(traversal.legs[0].path).not.toBe(matrix.pathMatrix[0][1]);
  });

  test("rejects an invalid fixed-start route through the existing route-order validator", () => {
    const { graph, matrix } = matrixAndRoute(["office", "loc-D"]);
    const invalidRoute: RouteComputation = { order: ["loc-D", "office"], totalDistance: 50 };

    expect(() => buildRouteTraversal(graph, invalidRoute, matrix)).toThrow("the start point must be first");
  });

  test("rejects a route visit absent from matrix data", () => {
    const graph = routeGraphFor(["loc-A", "loc-D"]);
    const matrix = buildValidatedDistanceMatrix(routeGraphFor(["loc-A"]));
    const route: RouteComputation = { order: ["office", "loc-D"], totalDistance: 50 };

    expect(() => buildRouteTraversal(graph, route, matrix)).toThrow(
      'route visit "loc-D" is absent from matrix visitIds',
    );
  });

  test("rejects an impossible aisle edge in an expanded path", () => {
    const { graph, matrix, route } = matrixAndRoute(["office", "loc-D"]);
    const inconsistent = cloneMatrix(matrix);
    inconsistent.pathMatrix[0][1] = ["office", "F1", "F3", "loc-D"];

    expect(() => buildRouteTraversal(graph, route, inconsistent)).toThrow(
      'expanded path contains non-edge "F1" → "F3"',
    );
  });

  test("rejects an attachment connected to the wrong aisle node in an expanded path", () => {
    const { graph, matrix, route } = matrixAndRoute(["office", "loc-D"]);
    const inconsistent = cloneMatrix(matrix);
    inconsistent.pathMatrix[0][1] = ["office", "F2", "F3", "loc-D"];

    expect(() => buildRouteTraversal(graph, route, inconsistent)).toThrow(
      'attachment "office" is not connected to aisle node "F2"',
    );
  });

  test("rejects a path whose segment sum disagrees with its matrix distance", () => {
    const { graph, matrix, route } = matrixAndRoute(["office", "loc-D"]);
    const inconsistent = cloneMatrix(matrix);
    inconsistent.distanceMatrix[0][1] = 51;

    expect(() => buildRouteTraversal(graph, route, inconsistent)).toThrow(
      "segment distance 50 disagrees with matrix distance 51",
    );
  });

  test("rejects a traversal total that materially disagrees with RouteComputation", () => {
    const { graph, matrix, route } = matrixAndRoute(["office", "loc-D"]);
    const inconsistentRoute = { ...route, totalDistance: route.totalDistance + 0.01 };

    expect(() => buildRouteTraversal(graph, inconsistentRoute, matrix)).toThrow(
      InvalidRouteTraversalError,
    );
    expect(() => buildRouteTraversal(graph, inconsistentRoute, matrix)).toThrow(
      "traversal distance 50 disagrees with route distance 50.01",
    );
  });

  test("accepts only floating-point noise within the explicit distance tolerance", () => {
    const { graph, matrix, route } = matrixAndRoute(["office", "loc-D"]);
    const noisyRoute = {
      ...route,
      totalDistance: route.totalDistance + ROUTE_TRAVERSAL_DISTANCE_EPSILON / 2,
    };

    expect(buildRouteTraversal(graph, noisyRoute, matrix).totalDistance).toBe(50);
  });
});
