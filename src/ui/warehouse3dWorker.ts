import type { RouteTimeline, WarehouseGraph } from "../domain/types";
import type { SimulationSnapshot } from "../simulation/types";
import type { WarehouseCountingGesture } from "./warehouse3dServiceVisual";
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

export const WAREHOUSE_WORKER_COLORS = {
  skin: "#e7b98f",
  workwear: "#334155",
  safety: "#f2c14e",
  equipment: "#1f2937",
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
): WarehouseWorkerPose {
  const position = projectSimulationMarkerTo3D(graph, timeline, snapshot, transform);
  if (snapshot.current?.kind === "travel") {
    const from = projectNodeToWarehouse3D(graph, snapshot.current.from, transform);
    const to = projectNodeToWarehouse3D(graph, snapshot.current.to, transform);
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
    const from = projectNodeToWarehouse3D(graph, finalSegment.from, transform);
    const to = projectNodeToWarehouse3D(graph, finalSegment.to, transform);
    return {
      position,
      yawRadians: getWarehouseWorkerFacingYaw(from, to),
      facingSource: "last-segment",
    };
  }

  return { position, yawRadians: DEFAULT_FACING_YAW, facingSource: "default" };
}

/** Shoulder pivot of the arm primitives, so a raised arm swings from the shoulder. */
const SHOULDER_Y = 1.21;
const HAND_REACH = 0.52;
const SCANNER_REACH = 0.62;
const ARM_CENTER_REACH = 0.25;

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
  const headOffset: readonly [number, number, number] = [0, -0.05 * headDip, 0.08 * headDip];

  switch (part.id) {
    case "right-arm":
      return {
        position: swungFromShoulder(0.33, ARM_CENTER_REACH, armLift),
        rotation: [-armLift, 0, 0.16],
      };
    case "right-hand":
      return { position: swungFromShoulder(0.37, HAND_REACH, armLift), rotation: part.rotation };
    case "scanner":
      return {
        position: swungFromShoulder(0.4, SCANNER_REACH, armLift, 0.06),
        rotation: [-(armLift + 0.35), 0, 0.05],
      };
    case "left-arm":
      return {
        position: swungFromShoulder(-0.33, ARM_CENTER_REACH, supportSwing),
        rotation: [-supportSwing, 0, -0.16],
      };
    case "left-hand":
      return {
        position: swungFromShoulder(-0.37, HAND_REACH, supportSwing),
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
): WarehouseWorkerVisual {
  const worker = WAREHOUSE_3D_VISUALS.worker;
  const parts: WarehouseWorkerVisualPart[] = [
    {
      ...basePart("torso", "identity", identityColor, [0, worker.bodyY, 0]),
      primitive: "cylinder",
      topRadius: worker.bodyTopRadius,
      bottomRadius: worker.bodyBottomRadius,
      height: worker.bodyHeight,
    },
    {
      ...basePart("vest-panel", "safety", WAREHOUSE_WORKER_COLORS.safety, [0, 0.98, 0.265]),
      primitive: "box",
      size: [0.28, 0.32, 0.035],
    },
    {
      ...basePart("left-arm", "identity", identityColor, [-0.33, 0.96, 0], [0, 0, -0.16]),
      primitive: "box",
      size: [0.14, 0.5, 0.16],
    },
    {
      ...basePart("right-arm", "identity", identityColor, [0.33, 0.96, 0], [0, 0, 0.16]),
      primitive: "box",
      size: [0.14, 0.5, 0.16],
    },
    {
      ...basePart("left-hand", "skin", WAREHOUSE_WORKER_COLORS.skin, [-0.37, 0.69, 0]),
      primitive: "sphere",
      radius: 0.09,
      scale: [1, 1, 1],
    },
    {
      ...basePart("right-hand", "skin", WAREHOUSE_WORKER_COLORS.skin, [0.37, 0.69, 0]),
      primitive: "sphere",
      radius: 0.09,
      scale: [1, 1, 1],
    },
    {
      ...basePart("left-leg", "workwear", WAREHOUSE_WORKER_COLORS.workwear, [-0.13, 0.38, 0]),
      primitive: "box",
      size: [0.18, 0.52, 0.2],
    },
    {
      ...basePart("right-leg", "workwear", WAREHOUSE_WORKER_COLORS.workwear, [0.13, 0.38, 0]),
      primitive: "box",
      size: [0.18, 0.52, 0.2],
    },
    {
      ...basePart("left-boot", "equipment", WAREHOUSE_WORKER_COLORS.equipment, [-0.13, 0.09, 0.07]),
      primitive: "box",
      size: [0.21, 0.12, 0.34],
    },
    {
      ...basePart("right-boot", "equipment", WAREHOUSE_WORKER_COLORS.equipment, [0.13, 0.09, 0.07]),
      primitive: "box",
      size: [0.21, 0.12, 0.34],
    },
    {
      ...basePart("head", "skin", WAREHOUSE_WORKER_COLORS.skin, [0, worker.headY, 0]),
      primitive: "sphere",
      radius: worker.headRadius,
      scale: [0.88, 1, 0.88],
    },
    {
      ...basePart("hard-hat", "identity", identityColor, [0, 1.67, 0]),
      primitive: "cylinder",
      topRadius: 0.21,
      bottomRadius: 0.25,
      height: 0.12,
    },
    {
      ...basePart("hard-hat-brim", "identity", identityColor, [0, 1.61, 0.035]),
      primitive: "box",
      size: [0.52, 0.035, 0.34],
    },
    {
      ...basePart("scanner", "equipment", WAREHOUSE_WORKER_COLORS.equipment, [0.4, 0.72, 0.13], [-0.25, 0, 0.08]),
      primitive: "box",
      size: [0.11, 0.22, 0.08],
    },
  ];

  return {
    figureScale: 1.3,
    parts: gesture ? parts.map((part) => applyCountingGesture(part, gesture)) : parts,
  };
}
