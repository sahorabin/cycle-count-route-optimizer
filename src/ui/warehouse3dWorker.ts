import type { RouteTimeline, WarehouseGraph } from "../domain/types";
import type { SimulationSnapshot } from "../simulation/types";
import type { WarehouseCountingGesture } from "./warehouse3dServiceVisual";
import type { NodeId } from "../domain/types";
import type { Point } from "./svgPoints";
import {
  projectNodeToWarehouse3D,
  projectSimulationMarkerTo3D,
  type Warehouse3DTransform,
  type WorldPoint,
} from "./warehouse3dProjection";
import { WAREHOUSE_3D_VISUALS } from "./warehouse3dVisuals";

type WorkerPartRole = "identity" | "skin" | "workwear" | "safety" | "equipment";

interface WarehouseWorkerPartBase {
  readonly id: string;
  readonly role: WorkerPartRole;
  readonly color: string;
  readonly position: readonly [number, number, number];
  readonly rotation: readonly [number, number, number];
}

export interface WarehouseWorkerBoxPart extends WarehouseWorkerPartBase {
  readonly primitive: "box";
  readonly size: readonly [number, number, number];
}

export interface WarehouseWorkerSpherePart extends WarehouseWorkerPartBase {
  readonly primitive: "sphere";
  readonly radius: number;
  readonly scale: readonly [number, number, number];
}

export interface WarehouseWorkerCylinderPart extends WarehouseWorkerPartBase {
  readonly primitive: "cylinder";
  readonly topRadius: number;
  readonly bottomRadius: number;
  readonly height: number;
}

export type WarehouseWorkerVisualPart =
  | WarehouseWorkerBoxPart
  | WarehouseWorkerSpherePart
  | WarehouseWorkerCylinderPart;

export interface WarehouseWorkerVisual {
  readonly figureScale: number;
  readonly parts: readonly WarehouseWorkerVisualPart[];
}

export interface WarehouseWorkerPose {
  readonly position: WorldPoint;
  readonly yawRadians: number;
  readonly facingSource: "current-segment" | "last-segment" | "default";
}

/**
 * Muted workwear rather than saturated primaries. The route identity colour is
 * carried only by the hi-vis vest and hard hat -- the way a real operator is
 * identifiable -- so the figure reads as PPE instead of a painted game token.
 */
/**
 * Real PPE reading, not route paint: a fluorescent hi-vis vest over dark work
 * clothing. Route identity is carried by the hard hat alone, so both operators
 * look like the same warehouse worker.
 */
export const WAREHOUSE_WORKER_COLORS = {
  skin: "#c2a184",
  uniform: "#39424f",
  /** Industrial charcoal: dark enough to read as workwear, light enough that the
   * legs do not dissolve into the floor and rack shadow while walking. */
  workwear: "#414c5c",
  hiVis: "#d8e63c",
  safety: "#c8a13a",
  equipment: "#20252c",
  scannerHead: "#3d4854",
} as const;

/**
 * Maximum forward extent, in figure-local world units, that any posed part may
 * reach. The operator stands in a walkable aisle whose clear distance to the
 * rack face is smaller than a straight arm, so the service pose bends the elbow
 * and keeps the scanner at chest height instead of pushing it into shelving.
 */
export const SERVICE_FORWARD_REACH_LIMIT = 0.24;

/**
 * Renderer-side PPE, keyed by the imported model's own material names. The
 * asset ships in its author's street colours; dressing it as a warehouse
 * operator is a material decision, not a change to the file.
 *
 * Route identity deliberately appears nowhere here: both operators are the same
 * person in the same PPE, and identity lives on the locator ring alone.
 */
export const WAREHOUSE_OPERATOR_PPE: Readonly<Record<string, string>> = {
  Shirt: WAREHOUSE_WORKER_COLORS.hiVis,
  Workwear: WAREHOUSE_WORKER_COLORS.workwear,
  Pants: WAREHOUSE_WORKER_COLORS.workwear,
  Socks: WAREHOUSE_WORKER_COLORS.equipment,
};

/** Falls back to the model's own colour for anything PPE does not dress. */
export function getWarehouseOperatorPartColor(partName: string, sourceColor: string): string {
  return WAREHOUSE_OPERATOR_PPE[partName] ?? sourceColor;
}

/**
 * Where the imported operator's working hand sits, in the same figure-local
 * frame the procedural figure uses (a 1.76-unit-tall operator standing at the
 * origin). Measured from the rig's `MiddleHandR` bone in its idle pose, so the
 * static fallback puts the scanner in the same hand the rigged operator uses.
 */
export const WAREHOUSE_OPERATOR_HAND_ANCHOR = [-0.227, 0.747, 0.042] as const;

/** Only the authored standing clip remains in production; the rejected walk is never sampled. */
export const WAREHOUSE_OPERATOR_CLIPS = { idle: "Man_Idle" } as const;

/**
 * Height, as a fraction of the operator's own stature, below which the model's
 * bare legs are re-dressed as work trousers. Measured from the shipped model's
 * shorts hem.
 */
export const WAREHOUSE_OPERATOR_TROUSER_LINE = 0.336;

/** Bones the renderer anchors accessories to, by their name in the shipped rig. */
export const WAREHOUSE_OPERATOR_BONES = { hand: "MiddleHandR", head: "Head" } as const;

/** Sanitized glTF node names used by three.js for the reference gait deltas. */
export const WAREHOUSE_REFERENCE_GAIT_BONES = {
  upperLegLeft: "UpperLegL",
  lowerLegLeft: "LowerLegL",
  footLeft: "FootL",
  upperLegRight: "UpperLegR",
  lowerLegRight: "LowerLegR",
  footRight: "FootR",
  upperArmLeft: "UpperArmL",
  upperArmRight: "UpperArmR",
  pelvis: "Hips",
  torso: "Torso",
} as const;

/**
 * A restrained industrial hard hat, sized in figure-local units and snapped to
 * the head bone. Deliberately small: PPE, not a costume.
 */
export const WAREHOUSE_OPERATOR_HAT = {
  shellRadius: 0.125,
  brimDepth: 0.085,
  brimReach: 0.075,
  /**
   * The head bone sits at the base of the skull, a measured 0.218 below the
   * crown, so the shell has to be lifted clear of the hair before it reads as a
   * hat rather than a scalp.
   */
  lift: 0.1,
} as const;

/**
 * Route distance covered by one full gait cycle -- a human stride at the
 * warehouse's own walking speed of 60 m/min, which puts a cycle at about 1.15
 * seconds of simulated time. That is what a person walking at 1 m/s looks like.
 *
 * This is deliberately NOT derived from the rendered figure's foot excursion.
 * The operator is drawn several times oversized against the warehouse's
 * horizontal scale so it stays visible, and matching its screen-space feet to
 * the ground would stretch one cycle to roughly eleven seconds -- correct
 * geometry, unwatchable motion. Cadence is what a viewer reads as walking, so
 * cadence is what this constant serves; the resulting foot slip is the price,
 * and it is paid at the scale where the figure is only a few pixels of shoe.
 *
 * Renderer-only. Nothing in routing, timing, or KPI reads it.
 */
export const WORKER_GAIT_CYCLE_METERS = 1.15;
/** The supplied reference GIF contains 28 frames at 24 fps. */
export const WORKER_REFERENCE_GAIT_CYCLE_SECONDS = 28 / 24;

/**
 * Distance over which the operator settles out of its walk as it turns off the
 * aisle onto the short spur in front of a bin. Real people slow to a stop as
 * they arrive, and starting the fade before the turn is also what keeps a
 * swinging foot out of the racking at the moment the operator is closest to it.
 *
 * Sized past the spur's own length so the walk is already well damped by the
 * time the operator faces the rack.
 */
export const WORKER_ARRIVAL_SETTLE_METERS = 1.6;

export interface WarehouseOperatorGait {
  /** 0 = standing, 1 = full reference gait. */
  readonly walkWeight: number;
  readonly walkTimeSeconds: number;
  readonly idleTimeSeconds: number;
  /** Cycles completed since the route began; useful for assertions. */
  readonly gaitCycles: number;
}

export interface WarehouseReferenceGaitPose {
  readonly phase: number;
  readonly upperLegLeft: number;
  readonly lowerLegLeft: number;
  readonly footLeft: number;
  readonly upperLegRight: number;
  readonly lowerLegRight: number;
  readonly footRight: number;
  readonly upperArmLeft: number;
  readonly upperArmRight: number;
  readonly pelvisYaw: number;
  readonly torsoYaw: number;
}

const degrees = (value: number) => value * Math.PI / 180;

/**
 * Four coherent silhouettes copied from the supplied 1.17 s walking reference:
 * contact, passing, opposite contact, opposite passing. These are deliberately
 * conservative local deltas from the rig's authored idle pose, not corrections
 * to the rejected walk clip. The root, head and vertical position are absent by
 * design, so animation can never compete with SimulationSnapshot translation.
 */
export const WAREHOUSE_REFERENCE_GAIT_KEY_POSES: readonly WarehouseReferenceGaitPose[] = [
  { phase: 0, upperLegLeft: degrees(20), lowerLegLeft: degrees(3), footLeft: degrees(-3),
    upperLegRight: degrees(-18), lowerLegRight: degrees(6), footRight: degrees(4),
    upperArmLeft: degrees(-12), upperArmRight: degrees(9), pelvisYaw: degrees(-2), torsoYaw: degrees(2) },
  { phase: 0.25, upperLegLeft: degrees(-4), lowerLegLeft: degrees(5), footLeft: degrees(1),
    upperLegRight: degrees(6), lowerLegRight: degrees(28), footRight: degrees(-7),
    upperArmLeft: 0, upperArmRight: 0, pelvisYaw: 0, torsoYaw: 0 },
  { phase: 0.5, upperLegLeft: degrees(-18), lowerLegLeft: degrees(6), footLeft: degrees(4),
    upperLegRight: degrees(20), lowerLegRight: degrees(3), footRight: degrees(-3),
    upperArmLeft: degrees(12), upperArmRight: degrees(-9), pelvisYaw: degrees(2), torsoYaw: degrees(-2) },
  { phase: 0.75, upperLegLeft: degrees(6), lowerLegLeft: degrees(28), footLeft: degrees(-7),
    upperLegRight: degrees(-4), lowerLegRight: degrees(5), footRight: degrees(1),
    upperArmLeft: 0, upperArmRight: 0, pelvisYaw: 0, torsoYaw: 0 },
] as const;

const REFERENCE_GAIT_FIELDS = [
  "upperLegLeft", "lowerLegLeft", "footLeft", "upperLegRight", "lowerLegRight", "footRight",
  "upperArmLeft", "upperArmRight", "pelvisYaw", "torsoYaw",
] as const;

/** Deterministic smooth interpolation around the four-pose closed cycle. */
export function createWarehouseReferenceGaitPose(gaitCycles: number): WarehouseReferenceGaitPose {
  const phase = fract(Math.max(0, Number.isFinite(gaitCycles) ? gaitCycles : 0));
  const scaled = phase * WAREHOUSE_REFERENCE_GAIT_KEY_POSES.length;
  const from = Math.floor(scaled) % WAREHOUSE_REFERENCE_GAIT_KEY_POSES.length;
  const to = (from + 1) % WAREHOUSE_REFERENCE_GAIT_KEY_POSES.length;
  const linear = scaled - Math.floor(scaled);
  const amount = linear * linear * (3 - 2 * linear);
  const result: Record<string, number> = { phase };
  for (const field of REFERENCE_GAIT_FIELDS) {
    result[field] = WAREHOUSE_REFERENCE_GAIT_KEY_POSES[from][field]
      + (WAREHOUSE_REFERENCE_GAIT_KEY_POSES[to][field]
        - WAREHOUSE_REFERENCE_GAIT_KEY_POSES[from][field]) * amount;
  }
  return result as unknown as WarehouseReferenceGaitPose;
}

export interface WarehouseOperatorClipTiming {
  readonly walkDurationSeconds: number;
  readonly idleDurationSeconds: number;
}

function fract(value: number): number {
  return value - Math.floor(value);
}

/**
 * Derives the operator's locomotion pose from simulation truth alone.
 *
 * Gait phase comes from `distanceTraveled`, not from a clock, which is what
 * makes pause freeze the legs mid-stride, seeking land on the pose that belongs
 * to that point of the route, and 10x playback cycle the legs ten times faster
 * without the animation ever drifting out of step with the position.
 *
 * Playback rate never appears here. It changes how fast distance accumulates,
 * and the gait follows the distance.
 */
export function createWarehouseOperatorGait(
  snapshot: SimulationSnapshot,
  clips: WarehouseOperatorClipTiming,
  /** Ids that are routing destinations rather than pass-through aisle nodes. */
  attachmentIds?: ReadonlySet<NodeId>,
): WarehouseOperatorGait {
  const { walkDurationSeconds, idleDurationSeconds } = clips;
  const idleTimeSeconds = idleDurationSeconds > 0
    ? fract(Math.max(0, snapshot.timeSeconds) / idleDurationSeconds) * idleDurationSeconds
    : 0;
  const standing: WarehouseOperatorGait = {
    walkWeight: 0,
    walkTimeSeconds: 0,
    idleTimeSeconds,
    gaitCycles: 0,
  };

  if (!walkDurationSeconds || walkDurationSeconds <= 0) return standing;

  const cursor = snapshot.current;
  if (!cursor || cursor.kind !== "travel") return standing;

  const gaitCycles = Math.max(0, snapshot.distanceTraveled) / WORKER_GAIT_CYCLE_METERS;
  // Arriving at a bin means the next thing that happens is standing still, so
  // the walk fades out instead of being cut off mid-stride.
  const arriving = attachmentIds?.has(cursor.to) ?? false;
  const settle = arriving
    ? Math.min(1, Math.max(0, cursor.distanceRemainingOnSegment / WORKER_ARRIVAL_SETTLE_METERS))
    : 1;

  return {
    walkWeight: settle * settle,
    walkTimeSeconds: fract(gaitCycles) * walkDurationSeconds,
    idleTimeSeconds,
    gaitCycles,
  };
}

/**
 * Model units to world units for the operator's body.
 *
 * Two things this deliberately does NOT do, both of which were real bugs:
 *
 * - It takes the model's **measured skinned stature**, not a bounding box of
 *   the bind pose. A rigged human rests in a T-pose whose box says nothing
 *   useful about how tall the posed figure draws.
 * - It does not apply the zoom LOD. The group the figure hangs in already
 *   scales by it; folding it in here squared the LOD and rendered an operator
 *   at a third of its intended height at ordinary zoom levels, which made a
 *   correctly animated walk cycle far too small to read.
 */
export function getWarehouseOperatorBodyScale(
  measuredStature: number,
  targetHeight: number,
): number {
  if (![measuredStature, targetHeight].every((value) => Number.isFinite(value) && value > 0)) {
    return 1;
  }
  return targetHeight / measuredStature;
}

export interface WarehouseOperatorScanner {
  /** Figure-local position of the scanner body. */
  readonly position: readonly [number, number, number];
  readonly yawRadians: number;
  /** Figure-local position of the scan head, where the read originates. */
  readonly head: readonly [number, number, number];
}

/** How far the scanner rises from the hip toward chest height while counting. */
export const SCANNER_SERVICE_LIFT = 0.34;

/**
 * Places the handheld scanner on the imported operator. The model is static, so
 * the scanner does the acting: it rests at the hand while travelling and rises
 * to a readable working height, angled at the bay, while counting.
 *
 * Every value comes from the counting gesture, which is itself a pure function
 * of service elapsed time. No clock, no accumulator.
 */
export function createWarehouseOperatorScanner(
  gesture: WarehouseCountingGesture | null,
): WarehouseOperatorScanner {
  const [handX, handY, handZ] = WAREHOUSE_OPERATOR_HAND_ANCHOR;
  if (!gesture) {
    return { position: [handX, handY, handZ], yawRadians: 0, head: [handX, handY + 0.06, handZ] };
  }

  const lift = SCANNER_SERVICE_LIFT * gesture.armLift;
  const reach = 0.09 + 0.1 * gesture.scanReach;
  const position = clampForwardReach(rotateAboutY(
    [handX * 0.6, handY + lift, handZ + reach],
    gesture.torsoTwist,
  ));
  const head = clampForwardReach(rotateAboutY(
    [handX * 0.6, handY + lift + 0.05, handZ + reach + 0.05],
    gesture.torsoTwist,
  ));

  return { position, yawRadians: gesture.torsoTwist, head };
}

const DEFAULT_FACING_YAW = 0;
const DIRECTION_EPSILON = 1e-9;

function basePart(
  id: string,
  role: WorkerPartRole,
  color: string,
  position: readonly [number, number, number],
  rotation: readonly [number, number, number] = [0, 0, 0],
): WarehouseWorkerPartBase {
  return { id, role, color, position, rotation };
}

/**
 * The operator is rendered at an aisle standing position rather than at the bin
 * itself (see OPERATOR_AISLE_STANDOFF), so the body can obey scene depth without
 * being swallowed by racking. Nothing draws the body through geometry.
 */
export const WAREHOUSE_WORKER_DEPTH_POLICY = {
  /** The body is ordinary scene geometry: racking in front of it occludes it. */
  body: { depthTest: true, depthWrite: true, renderOrder: 0 },
  /** Only a small floor ring and locator pip stay depth-independent. */
  locator: { depthTest: false, depthWrite: false, renderOrder: 4, pipRadius: 0.05 },
} as const;

/**
 * Renderer-only visual scale. The operator reads as human-sized in close
 * inspection framing and stops dominating wide contextual views, without any
 * change to the simulated position the figure stands on.
 */
export const WAREHOUSE_WORKER_SCALE = {
  minimum: 0.55,
  maximum: 1,
  minimumZoomRatio: 1,
  maximumZoomRatio: 1.65,
} as const;

export function getWarehouseWorkerFigureScale(zoomRatio: number): number {
  if (!Number.isFinite(zoomRatio)) return WAREHOUSE_WORKER_SCALE.maximum;
  const span = WAREHOUSE_WORKER_SCALE.maximumZoomRatio - WAREHOUSE_WORKER_SCALE.minimumZoomRatio;
  const blend = Math.min(1, Math.max(0, (zoomRatio - WAREHOUSE_WORKER_SCALE.minimumZoomRatio) / span));
  return WAREHOUSE_WORKER_SCALE.minimum
    + (WAREHOUSE_WORKER_SCALE.maximum - WAREHOUSE_WORKER_SCALE.minimum) * blend;
}

/** A deterministic visual yaw for a model whose forward axis is world +Z. */
export function getWarehouseWorkerFacingYaw(
  from: WorldPoint,
  to: WorldPoint,
  fallbackYaw = DEFAULT_FACING_YAW,
): number {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  if (![dx, dz, fallbackYaw].every(Number.isFinite)) return DEFAULT_FACING_YAW;
  if (Math.hypot(dx, dz) <= DIRECTION_EPSILON) return fallbackYaw;
  return Math.atan2(dx, dz);
}

/**
 * Projects existing simulation truth into a renderer-only position and facing direction.
 * It never changes progress, timing, distance, completion, or timeline data.
 */
export function createWarehouseWorkerPose(
  graph: WarehouseGraph,
  timeline: RouteTimeline,
  snapshot: SimulationSnapshot,
  transform: Warehouse3DTransform,
  coordinates?: ReadonlyMap<NodeId, Point>,
): WarehouseWorkerPose {
  const position = projectSimulationMarkerTo3D(graph, timeline, snapshot, transform, coordinates);
  if (snapshot.current?.kind === "travel") {
    const from = projectNodeToWarehouse3D(graph, snapshot.current.from, transform, coordinates);
    const to = projectNodeToWarehouse3D(graph, snapshot.current.to, transform, coordinates);
    return {
      position,
      yawRadians: getWarehouseWorkerFacingYaw(from, to),
      facingSource: "current-segment",
    };
  }

  const facingLeg = snapshot.current?.kind === "service"
    ? timeline.legs[snapshot.current.legIndex]
    : timeline.legs.at(-1);
  const finalSegment = facingLeg?.segments.at(-1);
  if (finalSegment) {
    const from = projectNodeToWarehouse3D(graph, finalSegment.from, transform, coordinates);
    const to = projectNodeToWarehouse3D(graph, finalSegment.to, transform, coordinates);
    return {
      position,
      yawRadians: getWarehouseWorkerFacingYaw(from, to),
      facingSource: "last-segment",
    };
  }

  return { position, yawRadians: DEFAULT_FACING_YAW, facingSource: "default" };
}

/** Shoulder pivot of the arm primitives, so a raised arm swings from the shoulder. */
const SHOULDER_Y = WAREHOUSE_3D_VISUALS.worker.shoulderY;
const UPPER_ARM_LENGTH = 0.28;
const FOREARM_LENGTH = 0.27;
const ARM_X = 0.235;
const HAND_X = 0.245;
/** Shoulder swing and forearm rise during counting, tuned to the reach limit. */
const SERVICE_SHOULDER_SWING = 0.3;
const SERVICE_FOREARM_BASE = 0.36;
const SERVICE_FOREARM_RANGE = 0.09;

/**
 * Parts that follow the upper-body twist during counting. Legs, boots, and the
 * worker root are deliberately absent: the operator's feet stay planted.
 */
const COUNTING_UPPER_BODY_IDS: ReadonlySet<string> = new Set([
  "torso",
  "vest",
  "left-upper-arm",
  "right-upper-arm",
  "left-forearm",
  "right-forearm",
  "left-hand",
  "right-hand",
  "head",
  "hard-hat",
  "hard-hat-brim",
  "scanner-body",
  "scanner-head",
]);

type PartTransform = {
  readonly position: readonly [number, number, number];
  readonly rotation: readonly [number, number, number];
};

function rotateAboutY(
  [x, y, z]: readonly [number, number, number],
  angleRadians: number,
): readonly [number, number, number] {
  const cos = Math.cos(angleRadians);
  const sin = Math.sin(angleRadians);
  return [x * cos + z * sin, y, z * cos - x * sin];
}

interface ArmPose {
  readonly elbow: readonly [number, number];
  readonly hand: readonly [number, number];
  readonly upperCenter: readonly [number, number];
  readonly foreCenter: readonly [number, number];
  readonly upperPitch: number;
  readonly forePitch: number;
}

/**
 * Two-segment arm in the sagittal plane. `shoulderSwing` rotates the upper arm
 * forward from hanging; `forearmRise` lifts the forearm back up toward the
 * chest, which is what keeps the hand high without pushing it into the rack.
 */
function solveArm(shoulderSwing: number, forearmRise: number): ArmPose {
  const elbowY = SHOULDER_Y - UPPER_ARM_LENGTH * Math.cos(shoulderSwing);
  const elbowZ = UPPER_ARM_LENGTH * Math.sin(shoulderSwing);
  const handY = elbowY + FOREARM_LENGTH * Math.cos(forearmRise);
  const handZ = elbowZ + FOREARM_LENGTH * Math.sin(forearmRise);

  return {
    elbow: [elbowY, elbowZ],
    hand: [handY, handZ],
    upperCenter: [(SHOULDER_Y + elbowY) / 2, elbowZ / 2],
    foreCenter: [(elbowY + handY) / 2, (elbowZ + handZ) / 2],
    upperPitch: -shoulderSwing,
    forePitch: Math.PI - forearmRise,
  };
}

/** Arms hang straight down when the operator is walking. */
const RESTING_ARM = solveArm(0, Math.PI);

function serviceArm(scanReach: number): ArmPose {
  return solveArm(
    SERVICE_SHOULDER_SWING,
    SERVICE_FOREARM_BASE + SERVICE_FOREARM_RANGE * scanReach,
  );
}

/**
 * Per-part counting transform. The scanner hand rises to chest height with the
 * elbow bent; the support arm stays close to the body. Every forward offset is
 * bounded by SERVICE_FORWARD_REACH_LIMIT so nothing enters the racking.
 */
function countingPartTransform(
  part: WarehouseWorkerVisualPart,
  gesture: WarehouseCountingGesture,
): PartTransform {
  const { scanReach, supportSwing, headDip } = gesture;
  const scanning = serviceArm(scanReach);
  const support = solveArm(supportSwing * 0.5, Math.PI - supportSwing * 0.8);
  const headOffset: readonly [number, number, number] = [0, -0.03 * headDip, 0.04 * headDip];

  switch (part.id) {
    case "right-upper-arm":
      return {
        position: [ARM_X, scanning.upperCenter[0], scanning.upperCenter[1]],
        rotation: [scanning.upperPitch, 0, 0.1],
      };
    case "right-forearm":
      return {
        position: [ARM_X, scanning.foreCenter[0], scanning.foreCenter[1]],
        rotation: [scanning.forePitch, 0, 0],
      };
    case "right-hand":
      return { position: [HAND_X, scanning.hand[0], scanning.hand[1]], rotation: part.rotation };
    case "scanner-body":
      return {
        position: [HAND_X, scanning.hand[0] - 0.01, scanning.hand[1] + 0.03],
        rotation: [-0.5, 0, 0],
      };
    case "scanner-head":
      return {
        position: [HAND_X, scanning.hand[0] + 0.07, scanning.hand[1] + 0.035],
        rotation: [-0.5, 0, 0],
      };
    case "left-upper-arm":
      return {
        position: [-ARM_X, support.upperCenter[0], support.upperCenter[1]],
        rotation: [support.upperPitch, 0, -0.1],
      };
    case "left-forearm":
      return {
        position: [-ARM_X, support.foreCenter[0], support.foreCenter[1]],
        rotation: [support.forePitch, 0, 0],
      };
    case "left-hand":
      return { position: [-HAND_X, support.hand[0], support.hand[1]], rotation: part.rotation };
    case "head":
    case "hard-hat":
    case "hard-hat-brim":
      return {
        position: [
          part.position[0] + headOffset[0],
          part.position[1] + headOffset[1],
          part.position[2] + headOffset[2],
        ],
        rotation: part.rotation,
      };
    default:
      return { position: part.position, rotation: part.rotation };
  }
}

/**
 * Hard guarantee rather than a tuned number: after the pose and the upper-body
 * twist are applied, nothing may sit further forward than the reach limit, so
 * no gesture can ever push a hand or the scanner into the rack face.
 */
function clampForwardReach(
  [x, y, z]: readonly [number, number, number],
): readonly [number, number, number] {
  return [x, y, Math.min(z, SERVICE_FORWARD_REACH_LIMIT)];
}

function applyCountingGesture(
  part: WarehouseWorkerVisualPart,
  gesture: WarehouseCountingGesture,
): WarehouseWorkerVisualPart {
  if (!COUNTING_UPPER_BODY_IDS.has(part.id)) return part;

  const posed = countingPartTransform(part, gesture);
  return {
    ...part,
    position: clampForwardReach(rotateAboutY(posed.position, gesture.torsoTwist)),
    rotation: [posed.rotation[0], posed.rotation[1] + gesture.torsoTwist, posed.rotation[2]],
  };
}

/**
 * Same lightweight operator structure for both route identities; only identity
 * color varies. Supplying a `gesture` re-poses the existing primitives into
 * counting work -- it never adds, removes, or renames a part, and it never
 * moves the worker root.
 */
export function createWarehouseWorkerVisual(
  identityColor: string,
  gesture: WarehouseCountingGesture | null = null,
  figureScale: number = WAREHOUSE_WORKER_SCALE.maximum,
): WarehouseWorkerVisual {
  const worker = WAREHOUSE_3D_VISUALS.worker;
  const parts: WarehouseWorkerVisualPart[] = [
    {
      ...basePart("torso", "workwear", WAREHOUSE_WORKER_COLORS.uniform, [0, worker.bodyY, 0]),
      primitive: "cylinder",
      topRadius: worker.bodyTopRadius,
      bottomRadius: worker.bodyBottomRadius,
      height: worker.bodyHeight,
    },
    {
      // A hi-vis vest worn over the uniform, not a coloured torso.
      ...basePart("vest", "safety", WAREHOUSE_WORKER_COLORS.hiVis, [0, 1.19, 0]),
      primitive: "cylinder",
      topRadius: 0.185,
      bottomRadius: 0.208,
      height: 0.34,
    },
    {
      ...basePart(
        "left-upper-arm",
        "workwear",
        WAREHOUSE_WORKER_COLORS.uniform,
        [-ARM_X, RESTING_ARM.upperCenter[0], RESTING_ARM.upperCenter[1]],
        [RESTING_ARM.upperPitch, 0, -0.1],
      ),
      primitive: "box",
      size: [0.095, UPPER_ARM_LENGTH, 0.115],
    },
    {
      ...basePart(
        "right-upper-arm",
        "workwear",
        WAREHOUSE_WORKER_COLORS.uniform,
        [ARM_X, RESTING_ARM.upperCenter[0], RESTING_ARM.upperCenter[1]],
        [RESTING_ARM.upperPitch, 0, 0.1],
      ),
      primitive: "box",
      size: [0.095, UPPER_ARM_LENGTH, 0.115],
    },
    {
      ...basePart(
        "left-forearm",
        "workwear",
        WAREHOUSE_WORKER_COLORS.uniform,
        [-ARM_X, RESTING_ARM.foreCenter[0], RESTING_ARM.foreCenter[1]],
        [RESTING_ARM.forePitch, 0, 0],
      ),
      primitive: "box",
      size: [0.088, FOREARM_LENGTH, 0.105],
    },
    {
      ...basePart(
        "right-forearm",
        "workwear",
        WAREHOUSE_WORKER_COLORS.uniform,
        [ARM_X, RESTING_ARM.foreCenter[0], RESTING_ARM.foreCenter[1]],
        [RESTING_ARM.forePitch, 0, 0],
      ),
      primitive: "box",
      size: [0.088, FOREARM_LENGTH, 0.105],
    },
    {
      ...basePart(
        "left-hand",
        "skin",
        WAREHOUSE_WORKER_COLORS.skin,
        [-HAND_X, RESTING_ARM.hand[0], RESTING_ARM.hand[1]],
      ),
      primitive: "sphere",
      radius: 0.058,
      scale: [1, 1, 1],
    },
    {
      ...basePart(
        "right-hand",
        "skin",
        WAREHOUSE_WORKER_COLORS.skin,
        [HAND_X, RESTING_ARM.hand[0], RESTING_ARM.hand[1]],
      ),
      primitive: "sphere",
      radius: 0.058,
      scale: [1, 1, 1],
    },
    {
      ...basePart("left-leg", "workwear", WAREHOUSE_WORKER_COLORS.workwear, [-0.088, 0.48, 0]),
      primitive: "box",
      size: [0.135, 0.8, 0.15],
    },
    {
      ...basePart("right-leg", "workwear", WAREHOUSE_WORKER_COLORS.workwear, [0.088, 0.48, 0]),
      primitive: "box",
      size: [0.135, 0.8, 0.15],
    },
    {
      ...basePart("left-boot", "equipment", WAREHOUSE_WORKER_COLORS.equipment, [-0.088, 0.045, 0.045]),
      primitive: "box",
      size: [0.155, 0.085, 0.26],
    },
    {
      ...basePart("right-boot", "equipment", WAREHOUSE_WORKER_COLORS.equipment, [0.088, 0.045, 0.045]),
      primitive: "box",
      size: [0.155, 0.085, 0.26],
    },
    {
      ...basePart("head", "skin", WAREHOUSE_WORKER_COLORS.skin, [0, worker.headY, 0]),
      primitive: "sphere",
      radius: worker.headRadius,
      scale: [0.86, 1, 0.86],
    },
    {
      ...basePart("hard-hat", "identity", identityColor, [0, 1.715, 0]),
      primitive: "cylinder",
      topRadius: 0.115,
      bottomRadius: 0.142,
      height: 0.075,
    },
    {
      ...basePart("hard-hat-brim", "identity", identityColor, [0, 1.678, 0.03]),
      primitive: "box",
      size: [0.3, 0.022, 0.2],
    },
    {
      // Handheld scanner: grip body plus a distinct scan head.
      ...basePart(
        "scanner-body",
        "equipment",
        WAREHOUSE_WORKER_COLORS.equipment,
        [HAND_X, RESTING_ARM.hand[0] - 0.04, RESTING_ARM.hand[1] + 0.05],
        [-0.35, 0, 0],
      ),
      primitive: "box",
      size: [0.055, 0.145, 0.05],
    },
    {
      ...basePart(
        "scanner-head",
        "equipment",
        WAREHOUSE_WORKER_COLORS.scannerHead,
        [HAND_X, RESTING_ARM.hand[0] + 0.04, RESTING_ARM.hand[1] + 0.08],
        [-0.35, 0, 0],
      ),
      primitive: "box",
      size: [0.072, 0.05, 0.075],
    },
  ];

  return {
    figureScale: Number.isFinite(figureScale) && figureScale > 0
      ? figureScale
      : WAREHOUSE_WORKER_SCALE.maximum,
    parts: gesture ? parts.map((part) => applyCountingGesture(part, gesture)) : parts,
  };
}

export interface WarehouseScanWave {
  readonly index: number;
  /** Arc radius from the scan head, in figure-local world units. */
  readonly radius: number;
  readonly opacity: number;
}

export interface WarehouseWorkerScanCue {
  /** Figure-local origin at the scan head. */
  readonly origin: readonly [number, number, number];
  /** Unit direction the scan head points, in figure-local space. */
  readonly direction: readonly [number, number, number];
  readonly waves: readonly WarehouseScanWave[];
  /** 0..1 brightness, peaking when the operator lines the scanner up. */
  readonly intensity: number;
}

export const SCAN_WAVE_COUNT = 3;
export const SCAN_WAVE_MIN_RADIUS = 0.06;
/** Reaches the rack face without pushing arcs deep into shelving. */
export const SCAN_WAVE_MAX_RADIUS = 0.17;

/**
 * A short burst of expanding arcs from the scan head toward the bay being
 * counted -- an RFID/barcode read, not a beam. It exists only while a counting
 * gesture does, and every wave phase is a pure function of the same service
 * elapsed time, so it freezes on pause and lands correctly on any seek.
 */
export function createWarehouseWorkerScanCue(
  gesture: WarehouseCountingGesture | null,
  /** Overrides the emitting point, so an imported operator scans from its own hand. */
  originOverride?: readonly [number, number, number],
): WarehouseWorkerScanCue | null {
  if (!gesture) return null;

  const scanning = serviceArm(gesture.scanReach);
  const direction = rotateAboutY([0, 0, 1], gesture.torsoTwist);
  const head = originOverride ?? clampForwardReach(rotateAboutY(
    [HAND_X, scanning.hand[0] + 0.07, scanning.hand[1] + 0.035],
    gesture.torsoTwist,
  ));
  const intensity = 0.35 + 0.5 * gesture.scanReach;

  return {
    origin: head,
    direction,
    intensity,
    waves: Array.from({ length: SCAN_WAVE_COUNT }, (_unused, index) => {
      const phase = (gesture.cycle + index / SCAN_WAVE_COUNT) % 1;
      return {
        index,
        radius: SCAN_WAVE_MIN_RADIUS + (SCAN_WAVE_MAX_RADIUS - SCAN_WAVE_MIN_RADIUS) * phase,
        opacity: Math.max(0, 1 - phase) * intensity,
      };
    }),
  };
}
