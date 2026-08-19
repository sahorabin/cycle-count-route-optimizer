import type { NodeId, RouteTimeline, WarehouseGraph } from "../domain/types";
import type { SimulationSnapshot } from "../simulation/types";
import { buildCoordinateLookup, type Point } from "./svgPoints";

/**
 * How far along the spur, from its aisle node toward the bin, the operator is
 * drawn. Bins sit inside their rack run, so rendering a body at the bin point
 * would put it inside shelving. Standing close to the aisle centre keeps the
 * whole figure -- including a raised scanner -- clear of the rack face, and the
 * scan arcs cover the remaining gap.
 */
export const OPERATOR_AISLE_STANDOFF = 0.18;

export interface Warehouse3DTransform {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  readonly centerX: number;
  readonly centerY: number;
  readonly visualScale: number;
}

export interface WorldPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * The single canonical renderer world span: `createWarehouse3DTransform` scales
 * any warehouse so its longest display axis becomes this many world units.
 * Camera framing derives from it too (see warehouse3dCamera.ts) so there is one
 * source of truth for 3D framing. It is renderer-only and never operational.
 */
export const WAREHOUSE_WORLD_SPAN = 18;

export class InvalidWarehouse3DCoordinateError extends Error {
  constructor(nodeId: string) {
    super(`Missing or invalid 3D rendering coordinate for warehouse node: ${nodeId}`);
    this.name = "InvalidWarehouse3DCoordinateError";
  }
}

function requireDisplayPoint(point: Point | undefined, nodeId: NodeId): Point {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new InvalidWarehouse3DCoordinateError(nodeId);
  }
  return point;
}

/** Deterministic renderer-only transform. It is never used for operational distance or time. */
export function createWarehouse3DTransform(graph: WarehouseGraph): Warehouse3DTransform {
  const coordinates: Array<{ id: NodeId; point: Point }> = [
    ...graph.aisleNodes.map((node) => ({ id: node.id, point: node })),
    { id: graph.start.id, point: graph.start },
    ...graph.locations.map((location) => ({ id: location.id, point: location })),
  ];

  const valid = coordinates.map(({ id, point }) => requireDisplayPoint(point, id));
  const xs = valid.map((point) => point.x);
  const ys = valid.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const largestSpan = Math.max(maxX - minX, maxY - minY);

  return {
    minX,
    maxX,
    minY,
    maxY,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
    visualScale: largestSpan > 0 ? WAREHOUSE_WORLD_SPAN / largestSpan : 1,
  };
}

/** Maps display x/y to world X/Z. World Y is a fixed visual ground height. */
export function projectDisplayPointToWarehouse3D(
  point: Point,
  transform: Warehouse3DTransform,
): WorldPoint {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new InvalidWarehouse3DCoordinateError("display-point");
  }
  return {
    x: (point.x - transform.centerX) * transform.visualScale,
    y: 0,
    z: (point.y - transform.centerY) * transform.visualScale,
  };
}

export function projectNodeToWarehouse3D(
  graph: WarehouseGraph,
  nodeId: NodeId,
  transform: Warehouse3DTransform,
  coordinates?: ReadonlyMap<NodeId, Point>,
): WorldPoint {
  const lookup = coordinates ?? buildCoordinateLookup(graph);
  const point = requireDisplayPoint(lookup.get(nodeId), nodeId);
  return projectDisplayPointToWarehouse3D(point, transform);
}

/** Pure SimulationSnapshot projection; no route, distance, time, or progress is recomputed here. */
export function projectSimulationMarkerTo3D(
  graph: WarehouseGraph,
  timeline: RouteTimeline,
  snapshot: SimulationSnapshot,
  transform: Warehouse3DTransform,
  coordinates?: ReadonlyMap<NodeId, Point>,
): WorldPoint {
  if (snapshot.current) {
    if (snapshot.current.kind === "service") {
      return projectNodeToWarehouse3D(graph, snapshot.current.locationId, transform, coordinates);
    }
    const from = projectNodeToWarehouse3D(graph, snapshot.current.from, transform, coordinates);
    const to = projectNodeToWarehouse3D(graph, snapshot.current.to, transform, coordinates);
    return {
      x: from.x + (to.x - from.x) * snapshot.current.progress,
      y: 0,
      z: from.z + (to.z - from.z) * snapshot.current.progress,
    };
  }

  const finalNodeId = timeline.order.at(-1);
  if (!finalNodeId) {
    throw new Error("Cannot project a 3D simulation marker for an empty route timeline.");
  }
  if (!snapshot.isComplete) {
    throw new Error("Incomplete simulation snapshot has no active segment.");
  }
  return projectNodeToWarehouse3D(graph, finalNodeId, transform, coordinates);
}

/**
 * Display coordinates for the operator and the walking overlay. Aisle nodes keep
 * their own position; attachment points (bins, the office door) resolve to a
 * standing position in the adjacent aisle. Renderer-only -- routing distance
 * still comes exclusively from the aisle graph.
 */
export function buildOperatorCoordinateLookup(graph: WarehouseGraph): Map<NodeId, Point> {
  const lookup = buildCoordinateLookup(graph);
  const aisleNodes = new Map(graph.aisleNodes.map((node) => [node.id, node]));

  for (const attachment of [graph.start, ...graph.locations]) {
    const aisleNode = aisleNodes.get(attachment.aisleNodeId);
    if (!aisleNode) continue;
    lookup.set(attachment.id, {
      x: aisleNode.x + (attachment.x - aisleNode.x) * OPERATOR_AISLE_STANDOFF,
      y: aisleNode.y + (attachment.y - aisleNode.y) * OPERATOR_AISLE_STANDOFF,
    });
  }

  return lookup;
}
