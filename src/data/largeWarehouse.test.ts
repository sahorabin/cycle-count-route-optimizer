import { describe, expect, test } from "vitest";
import { buildEdges, buildLocations, largeWarehouse, ZONE_IDS } from "./largeWarehouse";
import { validateGraph } from "../domain/validateGraph";
import { buildValidatedDistanceMatrix } from "../domain/distanceMatrix";
import { calculateRouteDistance } from "../domain/routeDistance";
import { buildRouteTraversal } from "../domain/routeTraversal";
import { buildRouteTimeline } from "../domain/routeTimeline";

describe("largeWarehouse", () => {
  test("has exactly 100 cycle-count locations", () => {
    expect(largeWarehouse.locations).toHaveLength(100);
  });

  test("every location id is unique", () => {
    const ids = largeWarehouse.locations.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("every aisle node id is unique and distinct from location/start ids", () => {
    const aisleIds = largeWarehouse.aisleNodes.map((n) => n.id);
    expect(new Set(aisleIds).size).toBe(aisleIds.length);
    const allIds = [
      ...aisleIds,
      largeWarehouse.start.id,
      ...largeWarehouse.locations.map((l) => l.id),
    ];
    expect(new Set(allIds).size).toBe(allIds.length);
  });

  test("the whole graph passes structural validation (reachability, positive lengths, valid refs)", () => {
    const result = validateGraph(largeWarehouse);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  test("every location has a zone and an aisle assigned, drawn from ZONE_IDS", () => {
    expect(ZONE_IDS).toHaveLength(10);
    for (const location of largeWarehouse.locations) {
      expect(location.zone).toBeDefined();
      expect(ZONE_IDS).toContain(location.zone);
      expect(location.aisle).toBeDefined();
    }
  });

  test("each zone has exactly 10 locations", () => {
    for (const zone of ZONE_IDS) {
      const count = largeWarehouse.locations.filter((l) => l.zone === zone).length;
      expect(count).toBe(10);
    }
  });

  test("generation is deterministic: calling the builder again produces an identical result", () => {
    expect(buildLocations()).toEqual(largeWarehouse.locations);
    expect(buildEdges()).toEqual(largeWarehouse.edges);
  });

  test("every graph edge length matches its demo spatial coordinates", () => {
    const nodes = new Map(largeWarehouse.aisleNodes.map((node) => [node.id, node]));
    for (const edge of largeWarehouse.edges) {
      const from = nodes.get(edge.from)!;
      const to = nodes.get(edge.to)!;
      expect(edge.length).toBe(Math.hypot(to.x - from.x, to.y - from.y));
    }
  });

  test("attachment distances match the displayed spur lengths", () => {
    const nodes = new Map(largeWarehouse.aisleNodes.map((node) => [node.id, node]));
    for (const attachment of [largeWarehouse.start, ...largeWarehouse.locations]) {
      const aisleNode = nodes.get(attachment.aisleNodeId)!;
      expect(attachment.accessDistance).toBe(
        Math.hypot(attachment.x - aisleNode.x, attachment.y - aisleNode.y),
      );
    }
  });

  test("all locations remain mutually reachable across both rack blocks", () => {
    const matrix = buildValidatedDistanceMatrix(largeWarehouse);
    expect(matrix.visitIds).toHaveLength(101);
    expect(matrix.distanceMatrix.flat().every(Number.isFinite)).toBe(true);
    const firstBlock = matrix.visitIds.indexOf("loc-A01");
    const secondBlock = matrix.visitIds.indexOf("loc-J10");
    expect(matrix.distanceMatrix[firstBlock][secondBlock]).toBeGreaterThan(0);
    const sameRackRowA = matrix.visitIds.indexOf("loc-A04");
    const sameRackRowE = matrix.visitIds.indexOf("loc-E04");
    expect(matrix.pathMatrix[sameRackRowA][sameRackRowE].some((id) => id.startsWith("X")))
      .toBe(true);
  });

  test("updated spatial distance remains the single traversal and timeline truth", () => {
    const targetIds = ["loc-A04", "loc-E04", "loc-J10"];
    const routeGraph = {
      ...largeWarehouse,
      locations: largeWarehouse.locations.filter(({ id }) => targetIds.includes(id)),
    };
    const matrix = buildValidatedDistanceMatrix(routeGraph);
    const order = [largeWarehouse.start.id, ...targetIds];
    const totalDistance = calculateRouteDistance(order, matrix.visitIds, matrix.distanceMatrix);
    const traversal = buildRouteTraversal(
      routeGraph,
      { order, totalDistance },
      matrix,
    );
    const timeline = buildRouteTimeline(traversal, 60);

    expect(traversal.totalDistance).toBe(totalDistance);
    expect(traversal.legs.flatMap(({ segments }) => segments)
      .reduce((sum, { distance }) => sum + distance, 0)).toBeCloseTo(totalDistance, 10);
    expect(timeline.totalDistance).toBe(totalDistance);
    expect(timeline.totalDurationSeconds).toBeCloseTo(totalDistance, 10);
  });
});
