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
    opacity: 0.5,
    traversedOpacity: 0.82,
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
    /**
     * The locator sits at ankle height and draws over the operator, so a heavy
     * ring hides exactly the part of the body a walk is read from. Thin and
     * semi-transparent keeps the operator findable without masking the feet.
     */
    ringInnerRadius: 0.24,
    ringOuterRadius: 0.265,
    ringOpacity: 0.34,
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
  /** The building envelope stays dark; the workspace inside it does not. */
  background: "#1a212b",
  /** Bright industrial concrete: the primary plane the whole scene reads against. */
  floor: { color: "#c6c9c4", roughness: 0.95 },
  localAisle: { color: "#d2d5cf", roughness: 0.95 },
  internalCrossAisle: { color: "#c9ccc6", roughness: 0.95 },
  blockSeparation: { color: "#bfc2bc", roughness: 0.95 },
  aisleMarking: { color: "#c9a12f", roughness: 0.85 },
  perimeterMarking: { color: "#ad8a2c", roughness: 0.85 },
  wall: { color: "#48525e", roughness: 0.96, opacity: 0.45 },
  column: { color: "#5a6672", roughness: 0.84, metalness: 0.14 },
  overheadFixture: {
    color: "#eef4f6",
    roughness: 0.35,
    emissive: "#cfe0e6",
    emissiveIntensity: 0.7,
  },
  /** Painted steel racking: medium steel, clearly darker than the concrete. */
  rackUpright: { color: "#5d6975", roughness: 0.55, metalness: 0.3 },
  rackBeam: { color: "#6b7784", roughness: 0.62, metalness: 0.22 },
  rackShelf: { color: "#7d8894", roughness: 0.9, opacity: 0.92 },
  rackGuard: { color: "#c9a12f", roughness: 0.8 },
  aisleSign: { color: "#9aa5b1", roughness: 0.78 },
  pallet: { color: "#8a7048", roughness: 1 },
  carton: { color: "#b0946a", roughness: 0.94 },
  unselectedLocation: { color: "#7b8794", roughness: 0.85 },
  office: { color: "#c08d38", roughness: 0.7 },
  progressTrack: "#8d97a2",
  completedLocation: "#69747f",
  /** Restrained operational accent, used only for the count actually running. */
  activeAccent: "#17a8a0",
  lighting: {
    sky: "#e6edf1",
    ground: "#6e7681",
    hemisphereIntensity: 1.15,
    keyPosition: [9, 13, 8],
    keyIntensity: 0.95,
    /** A weak opposite fill keeps unlit faces from going flat without shadows. */
    fillPosition: [-8, 7, -6],
    fillIntensity: 0.4,
  },
  /**
   * Repeated rack geometry cast a dense shadow grid across the aisles and made
   * the warehouse unreadable, so structure no longer casts at all. Only the
   * operator does: it is the one object whose contact with the floor carries
   * operational meaning.
   */
  /**
   * Clamp applied to every imported asset material. glTF metalness defaults to
   * 1, which reads near-black without an environment map; matte steel keeps the
   * imported rack legible against the bright floor.
   */
  importedAsset: { maxMetalness: 0.18, minRoughness: 0.62 },
  shadowCasters: {
    /** Imported racking follows the same no-shadow rule as the procedural frame. */
    rackAsset: false,
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
    opacity: 0.3,
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
