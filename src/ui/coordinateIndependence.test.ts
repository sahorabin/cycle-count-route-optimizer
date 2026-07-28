import { describe, expect, test } from "vitest";
import { nearestNeighborRoute } from "../domain/nearestNeighbor";
import { twoOptRoute } from "../domain/twoOpt";
import { sampleWarehouse } from "../data/sampleWarehouse";
import type { WarehouseGraph } from "../domain/types";

/**
 * Returns a new graph with every display x/y replaced by an anisotropic
 * affine transform of the original (unequal x/y scale factors, plus an axis
 * swap and a large offset) -- never a plain translation. A pure translation,
 * rotation, or uniform scale preserves every pairwise Euclidean distance, so
 * it could pass this test even if the implementation secretly used
 * coordinate-based distance. This transform does not preserve pairwise
 * distances, so it would expose that bug.
 *
 * Topology (edges, aisleNodeId links, accessDistance, edge.length) and the
 * input graph itself are left completely untouched.
 */
function withDisplacedCoordinates(graph: WarehouseGraph): WarehouseGraph {
  const transform = (x: number, y: number) => ({ x: y * 3.7 - 900, y: x * -2.1 + 400 });

  return {
    ...graph,
    aisleNodes: graph.aisleNodes.map((node) => ({ ...node, ...transform(node.x, node.y) })),
    start: { ...graph.start, ...transform(graph.start.x, graph.start.y) },
    locations: graph.locations.map((location) => ({
      ...location,
      ...transform(location.x, location.y),
    })),
  };
}

describe("SVG coordinate independence", () => {
  test("displacing every display x/y leaves both routes' order and total distance unchanged", () => {
    const targetIds = sampleWarehouse.locations.map((location) => location.id);
    const originalStartX = sampleWarehouse.start.x;
    const originalStartY = sampleWarehouse.start.y;

    const originalNN = nearestNeighborRoute(sampleWarehouse, targetIds);
    const originalOpt = twoOptRoute(sampleWarehouse, targetIds, originalNN);

    const displaced = withDisplacedCoordinates(sampleWarehouse);

    // Confirm the coordinates actually moved substantially, so this isn't a vacuous check.
    expect(displaced.start.x).not.toBe(sampleWarehouse.start.x);
    expect(displaced.start.y).not.toBe(sampleWarehouse.start.y);
    expect(Math.abs(displaced.start.x - originalStartX) + Math.abs(displaced.start.y - originalStartY)).toBeGreaterThan(
      500,
    );

    const displacedNN = nearestNeighborRoute(displaced, targetIds);
    const displacedOpt = twoOptRoute(displaced, targetIds, displacedNN);

    expect(displacedNN.order).toEqual(originalNN.order);
    expect(displacedNN.totalDistance).toBe(originalNN.totalDistance);
    expect(displacedOpt.order).toEqual(originalOpt.order);
    expect(displacedOpt.totalDistance).toBe(originalOpt.totalDistance);

    // The shared sample fixture must not have been mutated in place.
    expect(sampleWarehouse.start.x).toBe(originalStartX);
    expect(sampleWarehouse.start.y).toBe(originalStartY);
  });
});
