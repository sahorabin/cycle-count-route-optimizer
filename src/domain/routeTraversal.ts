import type { DistanceMatrixResult } from "./distanceMatrix";
import { assertValidRouteOrder } from "./routeOrder";
import type {
  AttachmentPoint,
  NodeId,
  RouteComputation,
  RouteTraversal,
  RouteTraversalSegment,
  WarehouseGraph,
} from "./types";

/**
 * Routing distances are currently small integer metre values. This absolute
 * tolerance admits only floating-point summation noise while still rejecting
 * any operationally meaningful discrepancy.
 */
export const ROUTE_TRAVERSAL_DISTANCE_EPSILON = 1e-9;

export class InvalidRouteTraversalError extends Error {
  constructor(message: string) {
    super(`Invalid route traversal: ${message}`);
    this.name = "InvalidRouteTraversalError";
  }
}

function approximatelyEqual(a: number, b: number): boolean {
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= ROUTE_TRAVERSAL_DISTANCE_EPSILON;
}

function segmentDistance(
  from: NodeId,
  to: NodeId,
  attachments: ReadonlyMap<NodeId, AttachmentPoint>,
  aisleNodeIds: ReadonlySet<NodeId>,
  edgeDistances: ReadonlyMap<string, number>,
): number {
  const fromAttachment = attachments.get(from);
  const toAttachment = attachments.get(to);

  if (fromAttachment) {
    if (fromAttachment.aisleNodeId !== to || !aisleNodeIds.has(to)) {
      throw new InvalidRouteTraversalError(
        `attachment "${from}" is not connected to aisle node "${to}"`,
      );
    }
    return fromAttachment.accessDistance;
  }

  if (toAttachment) {
    if (toAttachment.aisleNodeId !== from || !aisleNodeIds.has(from)) {
      throw new InvalidRouteTraversalError(
        `attachment "${to}" is not connected to aisle node "${from}"`,
      );
    }
    return toAttachment.accessDistance;
  }

  if (!aisleNodeIds.has(from) || !aisleNodeIds.has(to)) {
    throw new InvalidRouteTraversalError(`expanded path contains unknown node pair "${from}" → "${to}"`);
  }

  const distance = edgeDistances.get(undirectedEdgeKey(from, to));
  if (distance === undefined) {
    throw new InvalidRouteTraversalError(`expanded path contains non-edge "${from}" → "${to}"`);
  }
  return distance;
}

function undirectedEdgeKey(a: NodeId, b: NodeId): string {
  return a < b ? `${a}\0${b}` : `${b}\0${a}`;
}

/**
 * Expands an already-computed fixed-start open route using only its supplied
 * path matrix. This function performs no pathfinding and never changes the
 * destination order.
 */
export function buildRouteTraversal(
  graph: WarehouseGraph,
  route: RouteComputation,
  matrixResult: DistanceMatrixResult,
): RouteTraversal {
  const targetIds = route.order.slice(1);
  assertValidRouteOrder(graph, targetIds, route.order);

  const indexOf = new Map<NodeId, number>();
  for (let index = 0; index < matrixResult.visitIds.length; index++) {
    const id = matrixResult.visitIds[index];
    if (indexOf.has(id)) {
      throw new InvalidRouteTraversalError(`matrix visitIds contains duplicate id "${id}"`);
    }
    indexOf.set(id, index);
  }

  const attachments = new Map<NodeId, AttachmentPoint>([
    [graph.start.id, graph.start],
    ...graph.locations.map((location): [NodeId, AttachmentPoint] => [location.id, location]),
  ]);
  const aisleNodeIds = new Set(graph.aisleNodes.map((node) => node.id));
  const edgeDistances = new Map<string, number>();
  for (const edge of graph.edges) {
    const key = undirectedEdgeKey(edge.from, edge.to);
    const existing = edgeDistances.get(key);
    // Dijkstra sees every undirected edge, so for parallel edges the shortest
    // edge is the one consistent with a shortest path containing this pair.
    if (existing === undefined || edge.length < existing) edgeDistances.set(key, edge.length);
  }

  const legs = [];
  for (let orderIndex = 0; orderIndex < route.order.length - 1; orderIndex++) {
    const from = route.order[orderIndex];
    const to = route.order[orderIndex + 1];
    const fromIndex = indexOf.get(from);
    const toIndex = indexOf.get(to);
    if (fromIndex === undefined || toIndex === undefined) {
      const missing = fromIndex === undefined ? from : to;
      throw new InvalidRouteTraversalError(`route visit "${missing}" is absent from matrix visitIds`);
    }

    const path = matrixResult.pathMatrix[fromIndex]?.[toIndex];
    const matrixDistance = matrixResult.distanceMatrix[fromIndex]?.[toIndex];
    if (!path || path.length < 2) {
      throw new InvalidRouteTraversalError(`matrix path is missing for leg "${from}" → "${to}"`);
    }
    if (path[0] !== from || path[path.length - 1] !== to) {
      throw new InvalidRouteTraversalError(`matrix path endpoints do not match leg "${from}" → "${to}"`);
    }
    if (matrixDistance === undefined || !Number.isFinite(matrixDistance)) {
      throw new InvalidRouteTraversalError(`matrix distance is invalid for leg "${from}" → "${to}"`);
    }

    const segments: RouteTraversalSegment[] = [];
    for (let pathIndex = 0; pathIndex < path.length - 1; pathIndex++) {
      const segmentFrom = path[pathIndex];
      const segmentTo = path[pathIndex + 1];
      segments.push({
        from: segmentFrom,
        to: segmentTo,
        distance: segmentDistance(segmentFrom, segmentTo, attachments, aisleNodeIds, edgeDistances),
      });
    }

    const segmentTotal = segments.reduce((sum, segment) => sum + segment.distance, 0);
    if (!approximatelyEqual(segmentTotal, matrixDistance)) {
      throw new InvalidRouteTraversalError(
        `segment distance ${segmentTotal} disagrees with matrix distance ${matrixDistance} for leg "${from}" → "${to}"`,
      );
    }

    legs.push({ from, to, path: [...path], distance: segmentTotal, segments });
  }

  const totalDistance = legs.reduce((sum, leg) => sum + leg.distance, 0);
  if (!approximatelyEqual(totalDistance, route.totalDistance)) {
    throw new InvalidRouteTraversalError(
      `traversal distance ${totalDistance} disagrees with route distance ${route.totalDistance}`,
    );
  }

  return { order: [...route.order], legs, totalDistance };
}
