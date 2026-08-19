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
  workwear: "#2f3742",
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
): WarehouseWorkerScanCue | null {
  if (!gesture) return null;

  const scanning = serviceArm(gesture.scanReach);
  const direction = rotateAboutY([0, 0, 1], gesture.torsoTwist);
  const head = clampForwardReach(rotateAboutY(
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
