import { buildValidatedDistanceMatrix } from "./distanceMatrix";
import { calculateRouteDistance } from "./routeDistance";
import { assertValidRouteOrder } from "./routeOrder";
import { assertValidTargetSelection } from "./targetSelection";
import type { NodeId, RouteComputation, WarehouseGraph } from "./types";

/**
 * Deterministic 2-opt local search for a fixed-start open route: the start
 * stays at index 0 and is never part of a reversal; every candidate move
 * reverses a contiguous segment starting at index 1 or later, including
 * segments that reach the last index (which changes the final destination
 * -- this is a valid, required move for an open path, not a closed tour).
 *
 * Each candidate's cost is the real open-route total from
 * calculateRouteDistance on the actual candidate order -- never a delta
 * formula -- so there is no risk of a closed-tour formula that assumes a
 * phantom edge back to the start for suffix reversals.
 *
 * Each iteration scans every (i, j) pair with i ascending then j ascending
 * and keeps the single lowest-distance candidate seen so far, using strict
 * `<`. That means: a candidate only replaces the current best when it is
 * strictly better, so among several candidates tied for the best distance
 * in one iteration, the first one enumerated wins, and a candidate merely
 * tied with the route's current distance is never applied. A move is only
 * applied when it strictly improves on the route distance at the start of
 * that iteration; iteration stops the first time no candidate improves.
 *
 * Termination: every applied move strictly decreases total distance, and
 * there are only finitely many permutations of a finite target set, so no
 * route can ever recur -- the loop is guaranteed to reach a point with no
 * improving move without any artificial iteration cap.
 */
export function twoOptRoute(
  graph: WarehouseGraph,
  targetIds: NodeId[],
  route: RouteComputation,
): RouteComputation {
  assertValidTargetSelection(graph, targetIds);
  assertValidRouteOrder(graph, targetIds, route.order);

  const routeGraph: WarehouseGraph = {
    ...graph,
    locations: graph.locations.filter((location) => targetIds.includes(location.id)),
  };
  const { visitIds, distanceMatrix } = buildValidatedDistanceMatrix(routeGraph);

  let currentOrder = [...route.order];
  let currentDistance = calculateRouteDistance(currentOrder, visitIds, distanceMatrix);
  const n = currentOrder.length;

  let improved = true;
  while (improved) {
    improved = false;
    let bestOrder: NodeId[] | null = null;
    let bestDistance = currentDistance;

    for (let i = 1; i <= n - 2; i++) {
      for (let j = i + 1; j <= n - 1; j++) {
        const candidateOrder = reverseSegment(currentOrder, i, j);
        const candidateDistance = calculateRouteDistance(candidateOrder, visitIds, distanceMatrix);
        if (candidateDistance < bestDistance) {
          bestDistance = candidateDistance;
          bestOrder = candidateOrder;
        }
      }
    }

    if (bestOrder !== null) {
      currentOrder = bestOrder;
      currentDistance = bestDistance;
      improved = true;
    }
  }

  return { order: currentOrder, totalDistance: currentDistance };
}

/** Returns a new array with order[i..j] (inclusive) reversed; does not mutate `order`. */
function reverseSegment(order: NodeId[], i: number, j: number): NodeId[] {
  const result = [...order];
  let left = i;
  let right = j;
  while (left < right) {
    const temp = result[left];
    result[left] = result[right];
    result[right] = temp;
    left++;
    right--;
  }
  return result;
}
