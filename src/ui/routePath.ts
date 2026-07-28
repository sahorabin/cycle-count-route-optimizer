import type { NodeId } from "../domain/types";

/**
 * Expands a visit order (start + selected stops, no aisle nodes) into the
 * full sequence of nodes actually walked -- start, every intermediate
 * aisle node, and every stop -- by concatenating consecutive legs from
 * `pathMatrix` (see distanceMatrix.ts). This is for drawing the route on
 * the map; it never affects any routing distance.
 *
 * Each leg's first node is the previous leg's last node, so it's dropped
 * to avoid duplicating that shared junction in the result. A single-stop
 * order (just the start) yields a single-node path, never crashing on a
 * missing "previous" leg.
 */
export function expandRoutePath(
  order: NodeId[],
  visitIds: NodeId[],
  pathMatrix: NodeId[][][],
): NodeId[] {
  if (order.length === 0) return [];

  const indexOf = new Map(visitIds.map((id, i) => [id, i]));
  const path: NodeId[] = [order[0]];

  for (let i = 0; i < order.length - 1; i++) {
    const fromIndex = indexOf.get(order[i])!;
    const toIndex = indexOf.get(order[i + 1])!;
    const leg = pathMatrix[fromIndex][toIndex];
    path.push(...leg.slice(1));
  }

  return path;
}
