import type { NodeId, RouteTimeline, WarehouseGraph } from "../domain/types";
import type { SimulationSnapshot } from "../simulation/types";
import { buildCoordinateLookup, type Point } from "./svgPoints";

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

const TARGET_WORLD_SPAN = 18;

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
    visualScale: largestSpan > 0 ? TARGET_WORLD_SPAN / largestSpan : 1,
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
): WorldPoint {
  const point = requireDisplayPoint(buildCoordinateLookup(graph).get(nodeId), nodeId);
  return projectDisplayPointToWarehouse3D(point, transform);
}

/** Pure SimulationSnapshot projection; no route, distance, time, or progress is recomputed here. */
export function projectSimulationMarkerTo3D(
  graph: WarehouseGraph,
  timeline: RouteTimeline,
  snapshot: SimulationSnapshot,
  transform: Warehouse3DTransform,
): WorldPoint {
  if (snapshot.current) {
    if (snapshot.current.kind === "service") {
      return projectNodeToWarehouse3D(graph, snapshot.current.locationId, transform);
    }
    const from = projectNodeToWarehouse3D(graph, snapshot.current.from, transform);
    const to = projectNodeToWarehouse3D(graph, snapshot.current.to, transform);
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
  return projectNodeToWarehouse3D(graph, finalNodeId, transform);
}
