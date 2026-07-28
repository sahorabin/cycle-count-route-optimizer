import type { AttachmentPoint, NodeId, ValidationResult as SharedValidationResult, WarehouseGraph } from "./types";

export type ValidationError =
  | { type: "duplicate-node-id"; nodeId: NodeId }
  | { type: "missing-edge-node"; edgeFrom: NodeId; edgeTo: NodeId; missing: NodeId }
  | { type: "non-positive-edge-length"; edgeFrom: NodeId; edgeTo: NodeId; length: number }
  | { type: "missing-aisle-node-reference"; attachmentId: NodeId; aisleNodeId: NodeId }
  | { type: "non-positive-access-distance"; attachmentId: NodeId; accessDistance: number }
  | { type: "unreachable-target"; nodeId: NodeId };

export type ValidationResult = SharedValidationResult<ValidationError>;

/**
 * Checks the warehouse layout's own shape: ids, edge/attachment references,
 * positive lengths, and that every catalogued location is reachable from
 * the start. It intentionally does NOT check for two locations sharing the
 * same aisle node + access distance -- that's a legitimate layout (e.g.
 * bins on opposite racks at the same spur distance). Whether the same
 * location id was picked twice for a specific route is a separate concern,
 * see targetSelection.ts.
 */
export function validateGraph(graph: WarehouseGraph): ValidationResult {
  const errors: ValidationError[] = [];

  const allAttachmentPoints: AttachmentPoint[] = [graph.start, ...graph.locations];

  errors.push(...findDuplicateNodeIds(graph, allAttachmentPoints));
  errors.push(...findEdgeErrors(graph));
  errors.push(...findAttachmentPointErrors(graph, allAttachmentPoints));
  errors.push(...findUnreachableTargets(graph));

  return { valid: errors.length === 0, errors };
}

function findDuplicateNodeIds(
  graph: WarehouseGraph,
  allAttachmentPoints: AttachmentPoint[],
): ValidationError[] {
  const allIds = [
    ...graph.aisleNodes.map((n) => n.id),
    ...allAttachmentPoints.map((p) => p.id),
  ];

  const seen = new Set<NodeId>();
  const duplicates = new Set<NodeId>();
  for (const id of allIds) {
    if (seen.has(id)) {
      duplicates.add(id);
    }
    seen.add(id);
  }

  return [...duplicates].map((nodeId) => ({ type: "duplicate-node-id" as const, nodeId }));
}

function findEdgeErrors(graph: WarehouseGraph): ValidationError[] {
  const aisleNodeIds = new Set(graph.aisleNodes.map((n) => n.id));
  const errors: ValidationError[] = [];

  for (const edge of graph.edges) {
    if (!aisleNodeIds.has(edge.from)) {
      errors.push({
        type: "missing-edge-node",
        edgeFrom: edge.from,
        edgeTo: edge.to,
        missing: edge.from,
      });
    }
    if (!aisleNodeIds.has(edge.to)) {
      errors.push({
        type: "missing-edge-node",
        edgeFrom: edge.from,
        edgeTo: edge.to,
        missing: edge.to,
      });
    }
    if (edge.length <= 0) {
      errors.push({
        type: "non-positive-edge-length",
        edgeFrom: edge.from,
        edgeTo: edge.to,
        length: edge.length,
      });
    }
  }

  return errors;
}

function findAttachmentPointErrors(
  graph: WarehouseGraph,
  allAttachmentPoints: AttachmentPoint[],
): ValidationError[] {
  const aisleNodeIds = new Set(graph.aisleNodes.map((n) => n.id));
  const errors: ValidationError[] = [];

  for (const point of allAttachmentPoints) {
    if (!aisleNodeIds.has(point.aisleNodeId)) {
      errors.push({
        type: "missing-aisle-node-reference",
        attachmentId: point.id,
        aisleNodeId: point.aisleNodeId,
      });
    }
    if (point.accessDistance <= 0) {
      errors.push({
        type: "non-positive-access-distance",
        attachmentId: point.id,
        accessDistance: point.accessDistance,
      });
    }
  }

  return errors;
}

function findUnreachableTargets(graph: WarehouseGraph): ValidationError[] {
  const aisleNodeIds = new Set(graph.aisleNodes.map((n) => n.id));
  if (!aisleNodeIds.has(graph.start.aisleNodeId)) {
    // Already reported as a missing-aisle-node-reference error; nothing
    // meaningful to say about reachability from a start point that doesn't
    // exist on the graph.
    return [];
  }

  const adjacency = new Map<NodeId, NodeId[]>();
  for (const id of aisleNodeIds) adjacency.set(id, []);
  for (const edge of graph.edges) {
    if (!aisleNodeIds.has(edge.from) || !aisleNodeIds.has(edge.to)) continue;
    adjacency.get(edge.from)!.push(edge.to);
    adjacency.get(edge.to)!.push(edge.from);
  }

  const reachable = new Set<NodeId>([graph.start.aisleNodeId]);
  const queue: NodeId[] = [graph.start.aisleNodeId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const neighbor of adjacency.get(current) ?? []) {
      if (!reachable.has(neighbor)) {
        reachable.add(neighbor);
        queue.push(neighbor);
      }
    }
  }

  const errors: ValidationError[] = [];
  for (const location of graph.locations) {
    if (!aisleNodeIds.has(location.aisleNodeId)) continue; // reported elsewhere
    if (!reachable.has(location.aisleNodeId)) {
      errors.push({ type: "unreachable-target", nodeId: location.id });
    }
  }

  return errors;
}
