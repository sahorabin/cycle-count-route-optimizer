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

export interface WarehouseRackSegment {
  readonly startY: number;
  readonly endY: number;
}

/**
 * Optional renderer-facing structure for demo warehouses whose rack blocks
 * contain more than one rack run. Routing still uses only `edges.length` and
 * attachment `accessDistance`; these values let SVG and 3D depict the same
 * local aisles, internal cross-aisles, and block separations.
 */
export interface WarehouseSpatialLayout {
  readonly rackWidth: number;
  readonly localAisleSpacing: number;
  readonly rackSegments: readonly WarehouseRackSegment[];
  readonly internalCrossAisleSpacing: number;
  readonly aislesPerBlock: number;
  readonly blockSeparation: number;
}

export interface WarehouseGraph {
  aisleNodes: AisleNode[];
  edges: AisleEdge[];
  start: AttachmentPoint;
  locations: CycleCountLocation[];
  spatialLayout?: WarehouseSpatialLayout;
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

/** One distance-bearing movement between adjacent nodes in an expanded route leg. */
export interface RouteTraversalSegment {
  readonly from: NodeId;
  readonly to: NodeId;
  readonly distance: number;
}

/** The existing shortest path and routing distance between two consecutive visit points. */
export interface RouteTraversalLeg {
  readonly from: NodeId;
  readonly to: NodeId;
  readonly path: readonly NodeId[];
  readonly distance: number;
  readonly segments: readonly RouteTraversalSegment[];
}

/**
 * A route computation expanded into the exact aisle traversal supplied by a
 * DistanceMatrixResult. It preserves the visit order and never adds a return
 * leg or derives a route from display coordinates.
 */
export interface RouteTraversal {
  readonly order: readonly NodeId[];
  readonly legs: readonly RouteTraversalLeg[];
  readonly totalDistance: number;
}

/** The deterministic time projection of one spatial traversal segment. */
export interface RouteTimelineSegment {
  readonly from: NodeId;
  readonly to: NodeId;
  readonly distance: number;
  readonly startTimeSeconds: number;
  readonly durationSeconds: number;
  readonly endTimeSeconds: number;
}

export type CountServiceClass = "simple" | "standard" | "complex";

/** One deterministic count-time input. It is simulation workload, never routing cost. */
export interface CountServiceProfile {
  readonly locationId: NodeId;
  readonly serviceClass: CountServiceClass;
  readonly durationSeconds: number;
  readonly source: "synthetic-demo";
}

/** One distance-bearing travel interval on the physical simulation axis. */
export interface RouteTimelineTravelPhase extends RouteTimelineSegment {
  readonly kind: "travel";
  readonly legIndex: number;
  readonly segmentIndex: number;
}

/** One stationary cycle-count interval after arrival at a destination. */
export interface RouteTimelineServicePhase {
  readonly kind: "service";
  readonly legIndex: number;
  readonly locationId: NodeId;
  readonly serviceClass: CountServiceClass | null;
  readonly source: "synthetic-demo" | null;
  readonly startTimeSeconds: number;
  readonly durationSeconds: number;
  readonly endTimeSeconds: number;
}

export type RouteTimelinePhase = RouteTimelineTravelPhase | RouteTimelineServicePhase;

/** Consecutive timeline segments belonging to one visit-to-visit leg. */
export interface RouteTimelineLeg {
  readonly from: NodeId;
  readonly to: NodeId;
  readonly distance: number;
  readonly startTimeSeconds: number;
  readonly durationSeconds: number;
  readonly endTimeSeconds: number;
  readonly segments: readonly RouteTimelineSegment[];
}

/** Travel plus stationary counting work projected onto one physical time axis. */
export interface RouteTimeline {
  readonly order: readonly NodeId[];
  readonly walkingSpeedMetersPerMinute: number;
  readonly legs: readonly RouteTimelineLeg[];
  readonly phases: readonly RouteTimelinePhase[];
  readonly totalDistance: number;
  readonly walkingDurationSeconds: number;
  readonly serviceDurationSeconds: number;
  readonly totalDurationSeconds: number;
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
