import type { RouteTimeline, WarehouseGraph } from "../domain/types";
import type { SimulationSnapshot } from "../simulation/types";
import { buildCoordinateLookup, type Point } from "./svgPoints";

export class MissingSimulationCoordinateError extends Error {
  constructor(nodeId: string) {
    super(`Missing or invalid SVG coordinate for simulation node: ${nodeId}`);
    this.name = "MissingSimulationCoordinateError";
  }
}

function requireCoordinate(coordinates: ReadonlyMap<string, Point>, nodeId: string): Point {
  const point = coordinates.get(nodeId);

  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new MissingSimulationCoordinateError(nodeId);
  }

  return point;
}

export function projectSimulationMarkerToSvg(
  graph: WarehouseGraph,
  timeline: RouteTimeline,
  snapshot: SimulationSnapshot,
): Point {
  const coordinates = buildCoordinateLookup(graph);

  if (snapshot.current) {
    const from = requireCoordinate(coordinates, snapshot.current.from);
    const to = requireCoordinate(coordinates, snapshot.current.to);
    const progress = snapshot.current.progress;

    return {
      x: from.x + (to.x - from.x) * progress,
      y: from.y + (to.y - from.y) * progress,
    };
  }

  const finalNodeId = timeline.order.at(-1);
  if (!finalNodeId) {
    throw new Error("Cannot project a simulation marker for an empty route timeline.");
  }

  if (!snapshot.isComplete) {
    throw new Error("Incomplete simulation snapshot has no active segment.");
  }

  return requireCoordinate(coordinates, finalNodeId);
}
