import type { NodeId, RouteTimeline, WarehouseGraph } from "../domain/types";
import type { Point } from "./svgPoints";
import {
  projectNodeToWarehouse3D,
  type Warehouse3DTransform,
  type WorldPoint,
} from "./warehouse3dProjection";

/**
 * Rendering-only hierarchy constants shared identically by both route scenes.
 *
 * Sizes are tuned for an industrial-simulation read rather than a game one:
 * the route is a surveyed line rather than a painted stripe, destination
 * markers are survey beacons rather than floating gems, and the operator is
 * roughly seven heads tall so it scans as a person, not a pawn.
 */
export const WAREHOUSE_3D_VISUALS = {
  rack: {
    color: "#96a3ad",
    height: 1.24,
    roughness: 0.95,
  },
  route: {
    /** Planned-but-not-yet-walked legs stay faint; the walked path resolves. */
    radius: 0.032,
    traversedRadius: 0.04,
    /** Slightly heavier line for the leg the operator is walking right now. */
    activeRadius: 0.058,
    opacity: 0.42,
    traversedOpacity: 0.78,
    activeOpacity: 1,
    y: 0.11,
    radialSegments: 6,
    depthTest: false,
    depthWrite: false,
  },
  destination: {
    ringInnerRadius: 0.16,
    ringOuterRadius: 0.24,
    stemRadius: 0.02,
    stemHeight: 1.08,
    stemY: 0.64,
    beaconRadius: 0.09,
    /** Kept above rack height so a target bin is locatable over the racking. */
    beaconY: 1.3,
  },
  worker: {
    discRadius: 0.24,
    ringInnerRadius: 0.22,
    ringOuterRadius: 0.3,
    bodyTopRadius: 0.165,
    bodyBottomRadius: 0.19,
    bodyHeight: 0.57,
    bodyY: 1.165,
    headRadius: 0.125,
    headY: 1.62,
    shoulderY: 1.45,
  },
} as const;

/**
 * One place for the scene's art direction. A muted, low-chroma industrial
 * palette with real value separation between floor, structure, and stored
 * goods reads as operations software; the previous bright, near-uniform tints
 * read as a toy set.
 */
export const WAREHOUSE_3D_MATERIALS = {
  background: "#171e27",
  floor: { color: "#6b747d", roughness: 1 },
  localAisle: { color: "#767f88", roughness: 1 },
  internalCrossAisle: { color: "#6f7881", roughness: 1 },
  blockSeparation: { color: "#68717a", roughness: 1 },
  aisleMarking: { color: "#c8a446", roughness: 0.9 },
  perimeterMarking: { color: "#a98b3a", roughness: 0.9 },
  wall: { color: "#3a434e", roughness: 0.96, opacity: 0.42 },
  column: { color: "#48525d", roughness: 0.86, metalness: 0.12 },
  overheadFixture: {
    color: "#dbe6ea",
    roughness: 0.4,
    emissive: "#b3c6ce",
    emissiveIntensity: 0.6,
  },
  /** Painted steel racking: uprights read darker and cooler than the beams. */
  rackUpright: { color: "#4d5a68", roughness: 0.58, metalness: 0.24 },
  rackBeam: { color: "#5a6773", roughness: 0.66, metalness: 0.18 },
  rackShelf: { color: "#6d7884", roughness: 0.92, opacity: 0.9 },
  rackGuard: { color: "#bd9739", roughness: 0.85 },
  aisleSign: { color: "#8d99a6", roughness: 0.8 },
  pallet: { color: "#7b6747", roughness: 1 },
  carton: { color: "#9a8562", roughness: 0.96 },
  unselectedLocation: { color: "#818d99", roughness: 0.88 },
  office: { color: "#b8873a", roughness: 0.72 },
  progressTrack: "#525d69",
  completedLocation: "#7d8a96",
  /** Restrained operational accent, used only for the count actually running. */
  activeAccent: "#4fd6c4",
  lighting: {
    sky: "#7d8b99",
    ground: "#2b333c",
    hemisphereIntensity: 0.82,
    keyPosition: [9, 13, 8],
    keyIntensity: 1,
    /** A weak opposite fill keeps unlit faces from going flat without shadows. */
    fillPosition: [-8, 7, -6],
    fillIntensity: 0.42,
  },
  /**
   * Repeated rack geometry cast a dense shadow grid across the aisles and made
   * the warehouse unreadable, so structure no longer casts at all. Only the
   * operator does: it is the one object whose contact with the floor carries
   * operational meaning.
   */
  shadowCasters: {
    rackUpright: false,
    rackBeam: false,
    rackShelf: false,
    rackGuard: false,
    aisleSign: false,
    pallet: false,
    carton: false,
    worker: true,
  },
  shadow: {
    mapSize: 1024,
    frustum: 13,
    near: 1,
    far: 40,
    bias: -0.0012,
    /** Below this canvas width the grounding pass is dropped for mobile headroom. */
    minimumCanvasWidth: 640,
    /** Restrained: the operator should be grounded, not dramatically lit. */
    opacity: 0.28,
  },
} as const;

export interface Warehouse3DRouteVisualSegment {
  readonly fromId: string;
  readonly toId: string;
  /** Index of the visit-to-visit leg this segment belongs to; renderer emphasis only. */
  readonly legIndex: number;
  readonly from: WorldPoint;
  readonly to: WorldPoint;
  readonly midpoint: WorldPoint;
  /** Cylinder length in renderer world units; never used as operational distance. */
  readonly visualLength: number;
}

/**
 * Projects the existing timeline segment sequence into renderer-only cylinder
 * descriptors. It neither finds a route nor feeds visual lengths back into
 * distance, timing, KPI, or simulation state.
 */
export function buildWarehouse3DRouteVisualSegments(
  graph: WarehouseGraph,
  timeline: RouteTimeline,
  transform: Warehouse3DTransform,
  coordinates?: ReadonlyMap<NodeId, Point>,
): Warehouse3DRouteVisualSegment[] {
  return timeline.legs.flatMap((leg, legIndex) =>
    leg.segments.map((segment) => {
      const projectedFrom = projectNodeToWarehouse3D(graph, segment.from, transform, coordinates);
      const projectedTo = projectNodeToWarehouse3D(graph, segment.to, transform, coordinates);
      const from = { ...projectedFrom, y: WAREHOUSE_3D_VISUALS.route.y };
      const to = { ...projectedTo, y: WAREHOUSE_3D_VISUALS.route.y };
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const dz = to.z - from.z;

      return {
        fromId: segment.from,
        toId: segment.to,
        legIndex,
        from,
        to,
        midpoint: {
          x: (from.x + to.x) / 2,
          y: (from.y + to.y) / 2,
          z: (from.z + to.z) / 2,
        },
        visualLength: Math.hypot(dx, dy, dz),
      };
    }),
  );
}
