import { MathUtils, Object3D, Quaternion, Vector3 } from "three";
import type { WarehouseReferenceGaitPose } from "./warehouse3dWorker";

export const WAREHOUSE_CHARACTER_BASIS = {
  forward: [0, 0, 1],
  up: [0, 1, 0],
  right: [1, 0, 0],
} as const;

export const WAREHOUSE_ANATOMICAL_BONE_NAMES = {
  root: "RootNode",
  pelvis: "Hips",
  spine: "Torso",
  upperLegLeft: "UpperLegL",
  lowerLegLeft: "LowerLegL",
  ankleLeft: "LowerLegL_end",
  footLeft: "FootL",
  upperLegRight: "UpperLegR",
  lowerLegRight: "LowerLegR",
  ankleRight: "LowerLegR_end",
  footRight: "FootR",
  upperArmLeft: "UpperArmL",
  lowerArmLeft: "LowerArmL",
  upperArmRight: "UpperArmR",
  lowerArmRight: "LowerArmR",
} as const;

type BoneKey = keyof typeof WAREHOUSE_ANATOMICAL_BONE_NAMES;

interface ReferenceTransform {
  readonly position: Vector3;
  readonly quaternion: Quaternion;
}

export interface WarehouseAnatomicalCalibration {
  readonly root: Object3D;
  readonly bones: Readonly<Record<BoneKey, Object3D>>;
  readonly reference: Readonly<Record<BoneKey, ReferenceTransform>>;
  /** Bone-local axes whose positive direction has the named anatomical meaning. */
  readonly axes: {
    readonly hipLeft: Vector3;
    readonly hipRight: Vector3;
    readonly kneeLeft: Vector3;
    readonly kneeRight: Vector3;
    readonly shoulderLeft: Vector3;
    readonly shoulderRight: Vector3;
    readonly footLeft: Vector3;
    readonly footRight: Vector3;
  };
  readonly referenceAnkleHeight: { readonly left: number; readonly right: number };
  readonly referenceKneeFlexion: { readonly left: number; readonly right: number };
}

export interface WarehouseGaitGeometryMetrics {
  readonly thighElevationLeftDegrees: number;
  readonly thighElevationRightDegrees: number;
  readonly kneeFlexionLeftDegrees: number;
  readonly kneeFlexionRightDegrees: number;
  readonly footClearanceLeft: number;
  readonly footClearanceRight: number;
  readonly footForwardSeparation: number;
}

const MODEL_FORWARD = new Vector3(...WAREHOUSE_CHARACTER_BASIS.forward);
const MODEL_UP = new Vector3(...WAREHOUSE_CHARACTER_BASIS.up);
const MODEL_RIGHT = new Vector3(...WAREHOUSE_CHARACTER_BASIS.right);
const MODEL_LEFT = MODEL_RIGHT.clone().negate();
const DELTA = new Quaternion();
const ROOT_QUATERNION = new Quaternion();
const BONE_QUATERNION = new Quaternion();
const MODEL_QUATERNION = new Quaternion();
const POINT = new Vector3();

function requireBone(root: Object3D, name: string): Object3D {
  const bone = root.getObjectByName(name);
  if (!bone) throw new Error(`Missing anatomical gait bone "${name}"`);
  return bone;
}

/** Convert a verified model-space hinge direction into a bone-local rest-space axis. */
function modelAxisInBoneLocal(root: Object3D, bone: Object3D, modelAxis: Vector3): Vector3 {
  root.updateWorldMatrix(true, true);
  root.getWorldQuaternion(ROOT_QUATERNION).invert();
  bone.getWorldQuaternion(BONE_QUATERNION);
  MODEL_QUATERNION.copy(ROOT_QUATERNION).multiply(BONE_QUATERNION).invert();
  return modelAxis.clone().applyQuaternion(MODEL_QUATERNION).normalize();
}

function modelPosition(root: Object3D, object: Object3D): Vector3 {
  object.getWorldPosition(POINT);
  return root.worldToLocal(POINT.clone());
}

export function createWarehouseAnatomicalCalibration(root: Object3D): WarehouseAnatomicalCalibration {
  const bones = Object.fromEntries(Object.entries(WAREHOUSE_ANATOMICAL_BONE_NAMES)
    .map(([key, name]) => [key, requireBone(root, name)])) as Record<BoneKey, Object3D>;
  const reference = Object.fromEntries(Object.entries(bones).map(([key, bone]) => [key, {
    position: bone.position.clone(),
    quaternion: bone.quaternion.clone(),
  }])) as Record<BoneKey, ReferenceTransform>;

  const hipL = modelPosition(root, bones.upperLegLeft);
  const kneeL = modelPosition(root, bones.lowerLegLeft);
  const ankleL = modelPosition(root, bones.ankleLeft);
  const hipR = modelPosition(root, bones.upperLegRight);
  const kneeR = modelPosition(root, bones.lowerLegRight);
  const ankleR = modelPosition(root, bones.ankleRight);
  return {
    root,
    bones,
    reference,
    axes: {
      // Positive hip/shoulder flexion means forward; positive knee means folding behind.
      hipLeft: modelAxisInBoneLocal(root, bones.upperLegLeft, MODEL_LEFT),
      hipRight: modelAxisInBoneLocal(root, bones.upperLegRight, MODEL_LEFT),
      kneeLeft: modelAxisInBoneLocal(root, bones.lowerLegLeft, MODEL_RIGHT),
      kneeRight: modelAxisInBoneLocal(root, bones.lowerLegRight, MODEL_RIGHT),
      shoulderLeft: modelAxisInBoneLocal(root, bones.upperArmLeft, MODEL_LEFT),
      shoulderRight: modelAxisInBoneLocal(root, bones.upperArmRight, MODEL_LEFT),
      footLeft: modelAxisInBoneLocal(root, bones.footLeft, MODEL_LEFT),
      footRight: modelAxisInBoneLocal(root, bones.footRight, MODEL_LEFT),
    },
    referenceAnkleHeight: {
      left: ankleL.y,
      right: ankleR.y,
    },
    referenceKneeFlexion: {
      left: kneeFlexion(hipL, kneeL, ankleL),
      right: kneeFlexion(hipR, kneeR, ankleR),
    },
  };
}

function restoreReference(calibration: WarehouseAnatomicalCalibration): void {
  for (const key of Object.keys(calibration.bones) as BoneKey[]) {
    calibration.bones[key].position.copy(calibration.reference[key].position);
    calibration.bones[key].quaternion.copy(calibration.reference[key].quaternion);
  }
}

function applyLocalDelta(bone: Object3D, rest: Quaternion, axis: Vector3, angle: number): void {
  // Verified contract: local delta after the immutable authored reference quaternion.
  bone.quaternion.copy(rest).multiply(DELTA.setFromAxisAngle(axis, angle));
}

function snapFootToAnkle(foot: Object3D, ankle: Object3D): void {
  if (!foot.parent) return;
  ankle.getWorldPosition(POINT);
  foot.position.copy(foot.parent.worldToLocal(POINT));
}

export function applyWarehouseAnatomicalGaitPose(
  calibration: WarehouseAnatomicalCalibration,
  pose: WarehouseReferenceGaitPose,
  weight = 1,
): void {
  restoreReference(calibration);
  const { bones, reference, axes, root } = calibration;
  const angle = (value: number) => value * Math.min(1, Math.max(0, weight));

  applyLocalDelta(bones.upperLegLeft, reference.upperLegLeft.quaternion,
    axes.hipLeft, angle(pose.upperLegLeft));
  applyLocalDelta(bones.upperLegRight, reference.upperLegRight.quaternion,
    axes.hipRight, angle(pose.upperLegRight));
  applyLocalDelta(bones.lowerLegLeft, reference.lowerLegLeft.quaternion,
    axes.kneeLeft, angle(pose.lowerLegLeft));
  applyLocalDelta(bones.lowerLegRight, reference.lowerLegRight.quaternion,
    axes.kneeRight, angle(pose.lowerLegRight));
  root.updateMatrixWorld(true);

  // This source rig's foot bones are siblings of the legs, not ankle children.
  snapFootToAnkle(bones.footLeft, bones.ankleLeft);
  snapFootToAnkle(bones.footRight, bones.ankleRight);
  applyLocalDelta(bones.footLeft, reference.footLeft.quaternion,
    axes.footLeft, angle(pose.footLeft));
  applyLocalDelta(bones.footRight, reference.footRight.quaternion,
    axes.footRight, angle(pose.footRight));
  applyLocalDelta(bones.upperArmLeft, reference.upperArmLeft.quaternion,
    axes.shoulderLeft, angle(pose.upperArmLeft));
  applyLocalDelta(bones.upperArmRight, reference.upperArmRight.quaternion,
    axes.shoulderRight, angle(pose.upperArmRight));

  // Torso/head stay static in S7K.7; no vertical or root channel exists.
  root.updateMatrixWorld(true);
}

function angleFromDown(vector: Vector3): number {
  return MathUtils.radToDeg(vector.angleTo(MODEL_UP.clone().negate()));
}

function kneeFlexion(hip: Vector3, knee: Vector3, ankle: Vector3): number {
  const toHip = hip.clone().sub(knee).normalize();
  const toAnkle = ankle.clone().sub(knee).normalize();
  return 180 - MathUtils.radToDeg(toHip.angleTo(toAnkle));
}

export function measureWarehouseGaitGeometry(
  calibration: WarehouseAnatomicalCalibration,
): WarehouseGaitGeometryMetrics {
  const { root, bones, referenceAnkleHeight, referenceKneeFlexion } = calibration;
  root.updateMatrixWorld(true);
  const hipL = modelPosition(root, bones.upperLegLeft);
  const kneeL = modelPosition(root, bones.lowerLegLeft);
  const ankleL = modelPosition(root, bones.ankleLeft);
  const hipR = modelPosition(root, bones.upperLegRight);
  const kneeR = modelPosition(root, bones.lowerLegRight);
  const ankleR = modelPosition(root, bones.ankleRight);
  return {
    thighElevationLeftDegrees: angleFromDown(kneeL.clone().sub(hipL)),
    thighElevationRightDegrees: angleFromDown(kneeR.clone().sub(hipR)),
    // The authored bind stance is already bent; report added gait flexion.
    kneeFlexionLeftDegrees: Math.abs(kneeFlexion(hipL, kneeL, ankleL)
      - referenceKneeFlexion.left),
    kneeFlexionRightDegrees: Math.abs(kneeFlexion(hipR, kneeR, ankleR)
      - referenceKneeFlexion.right),
    footClearanceLeft: ankleL.y - referenceAnkleHeight.left,
    footClearanceRight: ankleR.y - referenceAnkleHeight.right,
    footForwardSeparation: Math.abs(ankleL.dot(MODEL_FORWARD) - ankleR.dot(MODEL_FORWARD)),
  };
}
