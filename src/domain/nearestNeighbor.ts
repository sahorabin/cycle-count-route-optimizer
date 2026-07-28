import { buildValidatedDistanceMatrix } from "./distanceMatrix";
import { calculateRouteDistance } from "./routeDistance";
import { assertValidTargetSelection } from "./targetSelection";
import type { NodeId, RouteComputation, WarehouseGraph } from "./types";

/**
 * Greedy nearest-neighbor heuristic for a fixed-start open route: starting
 * at the warehouse's start point, repeatedly move to the closest unvisited
 * selected target (by aisle-constrained distance, from the validated
 * distance matrix -- never Euclidean/SVG-coordinate distance), until every
 * target has been visited exactly once. Never returns to the start.
 *
 * Ties are broken by each target's position in `targetIds`: the first
 * tied candidate encountered while scanning `targetIds` wins.
 */
export function nearestNeighborRoute(graph: WarehouseGraph, targetIds: NodeId[]): RouteComputation {
  assertValidTargetSelection(graph, targetIds);

  const routeGraph: WarehouseGraph = {
    ...graph,
    locations: graph.locations.filter((location) => targetIds.includes(location.id)),
  };
  const { visitIds, distanceMatrix } = buildValidatedDistanceMatrix(routeGraph);
  const indexOf = new Map(visitIds.map((id, index) => [id, index]));

  const startId = graph.start.id;
  const order: NodeId[] = [startId];
  const remaining = new Set(targetIds);
  let currentId = startId;

  while (remaining.size > 0) {
    let bestId: NodeId | null = null;
    let bestDistance = Infinity;

    for (const candidateId of targetIds) {
      if (!remaining.has(candidateId)) continue;
      const distance = distanceMatrix[indexOf.get(currentId)!][indexOf.get(candidateId)!];
      if (distance < bestDistance) {
        bestDistance = distance;
        bestId = candidateId;
      }
    }

    order.push(bestId!);
    remaining.delete(bestId!);
    currentId = bestId!;
  }

  return { order, totalDistance: calculateRouteDistance(order, visitIds, distanceMatrix) };
}
