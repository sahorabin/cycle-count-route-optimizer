import type { NodeId } from "./types";

/**
 * Sums the aisle-constrained distance for each consecutive leg of `order`
 * using a precomputed distance matrix (see distanceMatrix.ts). `order` is
 * expected to contain only ids present in `visitIds`.
 */
export function calculateRouteDistance(
  order: NodeId[],
  visitIds: NodeId[],
  distanceMatrix: number[][],
): number {
  let total = 0;
  for (let i = 0; i < order.length - 1; i++) {
    const fromIndex = visitIds.indexOf(order[i]);
    const toIndex = visitIds.indexOf(order[i + 1]);
    total += distanceMatrix[fromIndex][toIndex];
  }
  return total;
}
