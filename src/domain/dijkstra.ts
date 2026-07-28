import type { AisleEdge, AisleNode, NodeId } from "./types";

export interface DijkstraResult {
  distances: Map<NodeId, number>;
  previous: Map<NodeId, NodeId | null>;
}

/**
 * Single-source shortest paths over the walkable aisle network only
 * (aisle nodes + aisle-to-aisle edges). Cycle-count locations and the
 * start point are attachment points, not aisle nodes, so they never enter
 * this graph and can never be treated as a pass-through waypoint.
 */
export function dijkstra(
  aisleNodes: AisleNode[],
  edges: AisleEdge[],
  sourceId: NodeId,
): DijkstraResult {
  const distances = new Map<NodeId, number>();
  const previous = new Map<NodeId, NodeId | null>();
  const adjacency = new Map<NodeId, Array<{ to: NodeId; length: number }>>();

  for (const node of aisleNodes) {
    distances.set(node.id, Infinity);
    previous.set(node.id, null);
    adjacency.set(node.id, []);
  }
  for (const edge of edges) {
    adjacency.get(edge.from)?.push({ to: edge.to, length: edge.length });
    adjacency.get(edge.to)?.push({ to: edge.from, length: edge.length });
  }

  distances.set(sourceId, 0);
  const unvisited = new Set(aisleNodes.map((n) => n.id));

  while (unvisited.size > 0) {
    let currentId: NodeId | null = null;
    let currentDistance = Infinity;
    for (const id of unvisited) {
      const distance = distances.get(id)!;
      if (distance < currentDistance) {
        currentDistance = distance;
        currentId = id;
      }
    }

    if (currentId === null || currentDistance === Infinity) break;
    unvisited.delete(currentId);

    for (const neighbor of adjacency.get(currentId) ?? []) {
      const candidate = currentDistance + neighbor.length;
      if (candidate < distances.get(neighbor.to)!) {
        distances.set(neighbor.to, candidate);
        previous.set(neighbor.to, currentId);
      }
    }
  }

  return { distances, previous };
}

export function reconstructPath(
  result: DijkstraResult,
  sourceId: NodeId,
  targetId: NodeId,
): NodeId[] | null {
  if (result.distances.get(targetId) === Infinity || result.distances.get(targetId) === undefined) {
    return null;
  }

  const path: NodeId[] = [];
  let current: NodeId | null = targetId;
  while (current !== null) {
    path.unshift(current);
    if (current === sourceId) break;
    current = result.previous.get(current) ?? null;
  }

  return path[0] === sourceId ? path : null;
}
