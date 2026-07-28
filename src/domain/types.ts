export type NodeId = string;

export interface ValidationResult<E> {
  valid: boolean;
  errors: E[];
}

/** A walkable point in the aisle network. Not a cycle-count target itself. */
export interface AisleNode {
  id: NodeId;
  x: number;
  y: number;
}

/** An undirected, traversable segment of aisle connecting two aisle nodes. */
export interface AisleEdge {
  from: NodeId;
  to: NodeId;
  length: number;
}

/**
 * A point that is not part of the walkable aisle network itself, but is
 * reached by a single spur off one aisle node (an office door, a bin face).
 * `accessDistance` is a routing length, independent of the SVG (x, y) used
 * only for drawing.
 */
export interface AttachmentPoint {
  id: NodeId;
  x: number;
  y: number;
  label: string;
  aisleNodeId: NodeId;
  accessDistance: number;
}

/** `zone`/`aisle` are optional so existing fixtures/tests without them keep compiling. */
export interface CycleCountLocation extends AttachmentPoint {
  zone?: string;
  aisle?: string;
}

export interface WarehouseGraph {
  aisleNodes: AisleNode[];
  edges: AisleEdge[];
  start: AttachmentPoint;
  locations: CycleCountLocation[];
}

/**
 * The raw output of a single routing method: a fixed-start open order and
 * its total aisle distance. `improvementPct` isn't known here -- it's only
 * meaningful once compared against the "original" baseline, which happens
 * when results from multiple methods are assembled together.
 */
export interface RouteComputation {
  order: NodeId[];
  totalDistance: number;
}

export type RouteMethod = "original" | "nearest-neighbor" | "two-opt";

/**
 * `order` always starts with the start point's id, followed by every
 * cycle-count location's id exactly once. It never contains intermediate
 * aisle node ids — use `pathMatrix` (see distanceMatrix.ts) to render the
 * actual aisle-following route.
 */
export interface RouteResult {
  method: RouteMethod;
  order: NodeId[];
  totalDistance: number;
  improvementPct: number;
}
