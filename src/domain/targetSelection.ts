import type { NodeId, ValidationResult, WarehouseGraph } from "./types";

export type TargetSelectionError =
  | { type: "duplicate-target-id"; nodeId: NodeId }
  | { type: "unknown-target-id"; nodeId: NodeId };

/**
 * Validates a list of cycle-count location ids chosen for a route. This is
 * distinct from validateGraph: two locations may legitimately share an
 * aisle node and access distance, but the same location id must not be
 * selected twice for one route, e.g. ["loc-A", "loc-B", "loc-A"].
 */
export function validateTargetSelection(
  graph: WarehouseGraph,
  targetIds: NodeId[],
): ValidationResult<TargetSelectionError> {
  const errors: TargetSelectionError[] = [];
  const knownLocationIds = new Set(graph.locations.map((location) => location.id));

  const seen = new Set<NodeId>();
  const reportedDuplicates = new Set<NodeId>();
  const reportedUnknown = new Set<NodeId>();

  for (const id of targetIds) {
    if (seen.has(id) && !reportedDuplicates.has(id)) {
      errors.push({ type: "duplicate-target-id", nodeId: id });
      reportedDuplicates.add(id);
    }
    seen.add(id);

    if (!knownLocationIds.has(id) && !reportedUnknown.has(id)) {
      errors.push({ type: "unknown-target-id", nodeId: id });
      reportedUnknown.add(id);
    }
  }

  return { valid: errors.length === 0, errors };
}
