import type { NodeId, ValidationResult, WarehouseGraph } from "./types";

export type RouteOrderError =
  | { type: "start-not-first" }
  | { type: "duplicate-start" }
  | { type: "missing-target"; nodeId: NodeId }
  | { type: "duplicate-target"; nodeId: NodeId }
  | { type: "unexpected-id"; nodeId: NodeId }
  | { type: "aisle-node-in-order"; nodeId: NodeId };

/**
 * Enforces the fixed-start open-route contract for a RouteResult.order:
 * the start id must be first and appear exactly once, every selected
 * target must appear exactly once, and nothing else (an unselected
 * location, an unknown id, or a walkable aisle node) may appear. Kept
 * separate from calculateRouteDistance (routeDistance.ts), which stays a
 * pure summation with no opinion on whether the order is well-formed.
 */
export function validateRouteOrder(
  graph: WarehouseGraph,
  targetIds: NodeId[],
  order: NodeId[],
): ValidationResult<RouteOrderError> {
  const errors: RouteOrderError[] = [];
  const startId = graph.start.id;
  const aisleNodeIds = new Set(graph.aisleNodes.map((n) => n.id));
  const targetIdSet = new Set(targetIds);

  if (order[0] !== startId) {
    errors.push({ type: "start-not-first" });
  }

  const startCount = order.filter((id) => id === startId).length;
  if (startCount > 1) {
    errors.push({ type: "duplicate-start" });
  }

  const targetCounts = new Map<NodeId, number>();
  for (const id of order) {
    if (id === startId) continue;
    targetCounts.set(id, (targetCounts.get(id) ?? 0) + 1);
  }

  for (const targetId of targetIds) {
    const count = targetCounts.get(targetId) ?? 0;
    if (count === 0) {
      errors.push({ type: "missing-target", nodeId: targetId });
    } else if (count > 1) {
      errors.push({ type: "duplicate-target", nodeId: targetId });
    }
  }

  for (const id of order) {
    if (id === startId || targetIdSet.has(id)) continue;
    if (aisleNodeIds.has(id)) {
      errors.push({ type: "aisle-node-in-order", nodeId: id });
    } else {
      errors.push({ type: "unexpected-id", nodeId: id });
    }
  }

  return { valid: errors.length === 0, errors };
}
