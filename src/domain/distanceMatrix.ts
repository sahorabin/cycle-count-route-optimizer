import { dijkstra, reconstructPath, type DijkstraResult } from "./dijkstra";
import type { AttachmentPoint, NodeId, WarehouseGraph } from "./types";

export interface DistanceMatrixResult {
  /** start point id, followed by every cycle-count location id, in this fixed order. */
  visitIds: NodeId[];
  /** distanceMatrix[i][j] is the aisle-constrained distance between visitIds[i] and visitIds[j]. */
  distanceMatrix: number[][];
  /**
   * pathMatrix[i][j] is the full node sequence travelled from visitIds[i] to
   * visitIds[j], including the attachment points themselves and every
   * intermediate aisle node -- for SVG rendering, not for RouteResult.order.
   * Empty when the target is unreachable.
   */
  pathMatrix: NodeId[][][];
}

/**
 * Builds an all-pairs shortest-distance matrix over the visit set (the
 * start point plus every cycle-count location). Nearest-neighbor and 2-opt
 * (later phases) must operate on this matrix, never on the raw warehouse
 * graph, since two visit points are rarely joined by a single edge.
 */
export function buildDistanceMatrix(graph: WarehouseGraph): DistanceMatrixResult {
  const visitPoints: AttachmentPoint[] = [graph.start, ...graph.locations];
  const visitIds = visitPoints.map((p) => p.id);

  const dijkstraByAisleNode = new Map<NodeId, DijkstraResult>();
  for (const point of visitPoints) {
    if (!dijkstraByAisleNode.has(point.aisleNodeId)) {
      dijkstraByAisleNode.set(
        point.aisleNodeId,
        dijkstra(graph.aisleNodes, graph.edges, point.aisleNodeId),
      );
    }
  }

  const distanceMatrix: number[][] = [];
  const pathMatrix: NodeId[][][] = [];

  for (let i = 0; i < visitPoints.length; i++) {
    distanceMatrix.push([]);
    pathMatrix.push([]);
    for (let j = 0; j < visitPoints.length; j++) {
      const a = visitPoints[i];
      const b = visitPoints[j];

      if (i === j) {
        distanceMatrix[i].push(0);
        pathMatrix[i].push([a.id]);
        continue;
      }

      const fromA = dijkstraByAisleNode.get(a.aisleNodeId)!;
      const aisleDistance = fromA.distances.get(b.aisleNodeId) ?? Infinity;

      if (aisleDistance === Infinity) {
        distanceMatrix[i].push(Infinity);
        pathMatrix[i].push([]);
        continue;
      }

      const aislePath = reconstructPath(fromA, a.aisleNodeId, b.aisleNodeId)!;
      distanceMatrix[i].push(a.accessDistance + aisleDistance + b.accessDistance);
      pathMatrix[i].push([a.id, ...aislePath, b.id]);
    }
  }

  return { visitIds, distanceMatrix, pathMatrix };
}

export class UnreachableTargetError extends Error {
  readonly nodeId: NodeId;

  constructor(nodeId: NodeId) {
    super(`Cycle-count location "${nodeId}" is unreachable from the start point.`);
    this.name = "UnreachableTargetError";
    this.nodeId = nodeId;
  }
}

/**
 * The application-facing boundary around buildDistanceMatrix. Dijkstra is
 * allowed to represent "no path exists" as Infinity/[] -- that's a correct
 * low-level result. Route comparison code (nearest-neighbor, 2-opt) must
 * never receive that Infinity silently, so this wrapper turns it into a
 * loud, descriptive failure instead of a matrix entry a caller could
 * accidentally sum into a total.
 */
export function buildValidatedDistanceMatrix(graph: WarehouseGraph): DistanceMatrixResult {
  const result = buildDistanceMatrix(graph);

  for (let i = 0; i < result.visitIds.length; i++) {
    for (let j = 0; j < result.visitIds.length; j++) {
      if (result.distanceMatrix[i][j] === Infinity) {
        throw new UnreachableTargetError(result.visitIds[j]);
      }
    }
  }

  return result;
}
