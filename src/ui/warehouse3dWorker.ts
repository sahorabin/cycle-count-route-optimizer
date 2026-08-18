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
export const WAREHOUSE_WORKER_COLORS = {
  skin: "#c2a184",
  uniform: "#46505f",
  workwear: "#39414d",
  safety: "#c8a13a",
  equipment: "#262b33",
} as const;

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
const HAND_REACH = 0.55;
const SCANNER_REACH = 0.6;
const ARM_CENTER_REACH = 0.26;
const ARM_X = 0.235;
const HAND_X = 0.255;
const SCANNER_X = 0.265;

/**
 * Parts that follow the upper-body twist during counting. Legs, boots, and the
 * worker root are deliberately absent: the operator's feet stay planted.
 */
const COUNTING_UPPER_BODY_IDS: ReadonlySet<string> = new Set([
  "torso",
  "vest-panel",
  "left-arm",
  "right-arm",
  "left-hand",
  "right-hand",
  "head",
  "hard-hat",
  "hard-hat-brim",
  "scanner",
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

/** Position of a point hanging `reach` below the shoulder after swinging forward by `swing`. */
function swungFromShoulder(
  x: number,
  reach: number,
  swing: number,
  forwardOffset = 0,
): readonly [number, number, number] {
  return [x, SHOULDER_Y - reach * Math.cos(swing), reach * Math.sin(swing) + forwardOffset];
}

/**
 * Per-part counting transform. The scanner arm raises and reaches, the support
 * arm swings slightly, and the head dips toward the scanner; everything else
 * keeps its travel placement.
 */
function countingPartTransform(
  part: WarehouseWorkerVisualPart,
  gesture: WarehouseCountingGesture,
): PartTransform {
  const { armLift, supportSwing, headDip } = gesture;
  const headOffset: readonly [number, number, number] = [0, -0.035 * headDip, 0.055 * headDip];

  switch (part.id) {
    case "right-arm":
      return {
        position: swungFromShoulder(ARM_X, ARM_CENTER_REACH, armLift),
        rotation: [-armLift, 0, 0.12],
      };
    case "right-hand":
      return { position: swungFromShoulder(HAND_X, HAND_REACH, armLift), rotation: part.rotation };
    case "scanner":
      return {
        position: swungFromShoulder(SCANNER_X, SCANNER_REACH, armLift, 0.05),
        rotation: [-(armLift + 0.35), 0, 0.05],
      };
    case "left-arm":
      return {
        position: swungFromShoulder(-ARM_X, ARM_CENTER_REACH, supportSwing),
        rotation: [-supportSwing, 0, -0.12],
      };
    case "left-hand":
      return {
        position: swungFromShoulder(-HAND_X, HAND_REACH, supportSwing),
        rotation: part.rotation,
      };
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

function applyCountingGesture(
  part: WarehouseWorkerVisualPart,
  gesture: WarehouseCountingGesture,
): WarehouseWorkerVisualPart {
  if (!COUNTING_UPPER_BODY_IDS.has(part.id)) return part;

  const posed = countingPartTransform(part, gesture);
  return {
    ...part,
    position: rotateAboutY(posed.position, gesture.torsoTwist),
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
      ...basePart("vest-panel", "safety", identityColor, [0, 1.16, 0.175]),
      primitive: "box",
      size: [0.26, 0.3, 0.03],
    },
    {
      ...basePart("left-arm", "workwear", WAREHOUSE_WORKER_COLORS.uniform, [-0.235, 1.19, 0], [0, 0, -0.12]),
      primitive: "box",
      size: [0.1, 0.52, 0.12],
    },
    {
      ...basePart("right-arm", "workwear", WAREHOUSE_WORKER_COLORS.uniform, [0.235, 1.19, 0], [0, 0, 0.12]),
      primitive: "box",
      size: [0.1, 0.52, 0.12],
    },
    {
      ...basePart("left-hand", "skin", WAREHOUSE_WORKER_COLORS.skin, [-0.255, 0.9, 0]),
      primitive: "sphere",
      radius: 0.062,
      scale: [1, 1, 1],
    },
    {
      ...basePart("right-hand", "skin", WAREHOUSE_WORKER_COLORS.skin, [0.255, 0.9, 0]),
      primitive: "sphere",
      radius: 0.062,
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
      ...basePart("scanner", "equipment", WAREHOUSE_WORKER_COLORS.equipment, [0.265, 0.94, 0.075], [-0.25, 0, 0.06]),
      primitive: "box",
      size: [0.075, 0.16, 0.055],
    },
  ];

  return {
    figureScale: Number.isFinite(figureScale) && figureScale > 0
      ? figureScale
      : WAREHOUSE_WORKER_SCALE.maximum,
    parts: gesture ? parts.map((part) => applyCountingGesture(part, gesture)) : parts,
  };
}

export interface WarehouseWorkerScanCue {
  /** Figure-local origin at the scanner head. */
  readonly origin: readonly [number, number, number];
  /** Unit direction the scan head points, in figure-local space. */
  readonly direction: readonly [number, number, number];
  readonly length: number;
  /** 0..1 brightness, peaking when the operator reaches into the bay. */
  readonly intensity: number;
}

const SCAN_HEAD_TILT = 0.35;

/**
 * A short scan indicator from the scanner head toward the bay face the operator
 * is counting. It exists only while a counting gesture does -- i.e. only during
 * service -- and its brightness rides the same gesture, so it needs no timer and
 * freezes, seeks, and scales with playback exactly like the pose does.
 */
export function createWarehouseWorkerScanCue(
  gesture: WarehouseCountingGesture | null,
): WarehouseWorkerScanCue | null {
  if (!gesture) return null;

  const headAngle = gesture.armLift + SCAN_HEAD_TILT;
  const forward: readonly [number, number, number] = [0, -Math.cos(headAngle), Math.sin(headAngle)];
  const direction = rotateAboutY(forward, gesture.torsoTwist);
  const scanner = rotateAboutY(
    swungFromShoulder(SCANNER_X, SCANNER_REACH, gesture.armLift, 0.05),
    gesture.torsoTwist,
  );

  return {
    origin: [
      scanner[0] + direction[0] * 0.11,
      scanner[1] + direction[1] * 0.11,
      scanner[2] + direction[2] * 0.11,
    ],
    direction,
    length: 0.42 + 0.18 * gesture.scanReach,
    intensity: 0.3 + 0.55 * gesture.scanReach,
  };
}
