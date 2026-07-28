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

export class InvalidTargetSelectionError extends Error {
  readonly errors: TargetSelectionError[];

  constructor(errors: TargetSelectionError[]) {
    super(`Invalid target selection: ${errors.map(describeTargetSelectionError).join("; ")}`);
    this.name = "InvalidTargetSelectionError";
    this.errors = errors;
  }
}

function describeTargetSelectionError(error: TargetSelectionError): string {
  return error.type === "duplicate-target-id"
    ? `target "${error.nodeId}" was selected more than once`
    : `"${error.nodeId}" is not a known cycle-count location`;
}

/**
 * The application-facing boundary around validateTargetSelection: throws a
 * descriptive InvalidTargetSelectionError instead of letting route
 * computation code (nearestNeighborRoute, later 2-opt) proceed with a
 * malformed target list.
 */
export function assertValidTargetSelection(graph: WarehouseGraph, targetIds: NodeId[]): void {
  const result = validateTargetSelection(graph, targetIds);
  if (!result.valid) {
    throw new InvalidTargetSelectionError(result.errors);
  }
}
