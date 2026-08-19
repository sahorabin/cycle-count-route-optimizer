// @ts-expect-error Vitest runs in Node; the application intentionally omits Node ambient types.
import { readFile } from "node:fs/promises";
// @ts-expect-error Vitest runs in Node; the application intentionally omits Node ambient types.
import { fileURLToPath } from "node:url";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
import { Group, Quaternion, Vector3 } from "three";
import { beforeAll, describe, expect, test } from "vitest";
import {
  applyWarehouseAnatomicalGaitPose,
  createWarehouseAnatomicalCalibration,
  measureWarehouseGaitGeometry,
  WAREHOUSE_ANATOMICAL_BONE_NAMES,
  WAREHOUSE_CHARACTER_BASIS,
  type WarehouseAnatomicalCalibration,
} from "./warehouse3dAnatomicalGait";
import {
  createWarehouseReferenceGaitPose,
  type WarehouseReferenceGaitPose,
} from "./warehouse3dWorker";

let source: Group;

beforeAll(async () => {
  const url = new URL("../../public/assets/worker/quaternius_man_01/"
    + "quaternius_man_01_rigged.glb", import.meta.url);
  const bytes = await readFile(fileURLToPath(url));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const gltf = await new Promise<{ scene: Group }>((resolve, reject) => {
    new GLTFLoader().parse(buffer, "", resolve, reject);
  });
  source = gltf.scene;
});

const ZERO_POSE: WarehouseReferenceGaitPose = {
  phase: 0,
  upperLegLeft: 0,
  lowerLegLeft: 0,
  footLeft: 0,
  upperLegRight: 0,
  lowerLegRight: 0,
  footRight: 0,
  upperArmLeft: 0,
  upperArmRight: 0,
  pelvisYaw: 0,
  torsoYaw: 0,
};

function setup(): WarehouseAnatomicalCalibration {
  const clone = SkeletonUtils.clone(source) as Group;
  clone.updateMatrixWorld(true);
  return createWarehouseAnatomicalCalibration(clone);
}

function modelPosition(calibration: WarehouseAnatomicalCalibration, name: string): Vector3 {
  const object = calibration.root.getObjectByName(name);
  if (!object) throw new Error(`Missing test bone ${name}`);
  object.getWorldPosition(new Vector3());
  const point = object.getWorldPosition(new Vector3());
  return calibration.root.worldToLocal(point);
}

function pose(overrides: Partial<WarehouseReferenceGaitPose>): WarehouseReferenceGaitPose {
  return { ...ZERO_POSE, ...overrides };
}

describe("production rig anatomical calibration", () => {
  test("pins the measured character frame and exact production hierarchy", () => {
    const calibration = setup();
    expect(WAREHOUSE_CHARACTER_BASIS).toEqual({
      forward: [0, 0, 1], up: [0, 1, 0], right: [1, 0, 0],
    });
    expect(calibration.bones.upperLegLeft.parent?.name).toBe("Body");
    expect(calibration.bones.lowerLegLeft.parent?.name).toBe("UpperLegL");
    expect(calibration.bones.ankleLeft.parent?.name).toBe("LowerLegL");
    // The source-specific trap that broke S7K.6: the foot is not below the calf.
    expect(calibration.bones.footLeft.parent?.name).toBe("Bone");
    expect(calibration.bones.footRight.parent?.name).toBe("Bone");
    expect(Object.values(WAREHOUSE_ANATOMICAL_BONE_NAMES).every((name) =>
      calibration.root.getObjectByName(name))).toBe(true);
  });

  test("a ±5 degree left-hip probe moves the knee fore/aft, not laterally", () => {
    const calibration = setup();
    const rest = modelPosition(calibration, "LowerLegL");
    applyWarehouseAnatomicalGaitPose(calibration, pose({ upperLegLeft: 5 * Math.PI / 180 }));
    const positive = modelPosition(calibration, "LowerLegL").sub(rest);
    applyWarehouseAnatomicalGaitPose(calibration, pose({ upperLegLeft: -5 * Math.PI / 180 }));
    const negative = modelPosition(calibration, "LowerLegL").sub(rest);
    expect(positive.z).toBeGreaterThan(0.06);
    expect(negative.z).toBeLessThan(-0.06);
    expect(Math.abs(positive.x)).toBeLessThan(0.01);
    expect(Math.abs(negative.x)).toBeLessThan(0.01);
  });

  test("a 10 degree knee probe folds the ankle backward/up without lateral error", () => {
    const calibration = setup();
    const rest = modelPosition(calibration, "LowerLegL_end");
    applyWarehouseAnatomicalGaitPose(calibration, pose({ lowerLegLeft: 10 * Math.PI / 180 }));
    const delta = modelPosition(calibration, "LowerLegL_end").sub(rest);
    expect(delta.z).toBeLessThan(-0.2);
    expect(delta.y).toBeGreaterThan(0.05);
    expect(Math.abs(delta.x)).toBeLessThan(0.01);
    expect(modelPosition(calibration, "FootL").distanceTo(
      modelPosition(calibration, "LowerLegL_end"))).toBeLessThan(1e-5);
  });

  test("a ±5 degree shoulder probe swings beside the torso in the sagittal plane", () => {
    const calibration = setup();
    const rest = modelPosition(calibration, "PalmL");
    applyWarehouseAnatomicalGaitPose(calibration, pose({ upperArmLeft: 5 * Math.PI / 180 }));
    const positive = modelPosition(calibration, "PalmL").sub(rest);
    applyWarehouseAnatomicalGaitPose(calibration, pose({ upperArmLeft: -5 * Math.PI / 180 }));
    const negative = modelPosition(calibration, "PalmL").sub(rest);
    expect(positive.z).toBeGreaterThan(0.12);
    expect(negative.z).toBeLessThan(-0.12);
    expect(Math.abs(positive.x)).toBeLessThan(0.03);
    expect(Math.abs(negative.x)).toBeLessThan(0.03);
  });

  test("calibrates mirrored sides to symmetric model-space movement", () => {
    const calibration = setup();
    const kneeL = modelPosition(calibration, "LowerLegL");
    const kneeR = modelPosition(calibration, "LowerLegR");
    applyWarehouseAnatomicalGaitPose(calibration, pose({
      upperLegLeft: 5 * Math.PI / 180,
      upperLegRight: 5 * Math.PI / 180,
    }));
    const left = modelPosition(calibration, "LowerLegL").sub(kneeL);
    const right = modelPosition(calibration, "LowerLegR").sub(kneeR);
    expect(left.z).toBeCloseTo(right.z, 2);
    expect(Math.abs(left.x)).toBeLessThan(0.01);
    expect(Math.abs(right.x)).toBeLessThan(0.01);
  });

  test("always applies restQuaternion * localDelta without accumulating", () => {
    const calibration = setup();
    const target = createWarehouseReferenceGaitPose(0.25);
    applyWarehouseAnatomicalGaitPose(calibration, target);
    const first = Object.values(calibration.bones).map((bone) => bone.quaternion.clone());
    const firstMetrics = measureWarehouseGaitGeometry(calibration);
    applyWarehouseAnatomicalGaitPose(calibration, createWarehouseReferenceGaitPose(0.75));
    applyWarehouseAnatomicalGaitPose(calibration, target);
    const second = Object.values(calibration.bones).map((bone) => bone.quaternion.clone());
    expect(second.map((quaternion) => quaternion.toArray()))
      .toEqual(first.map((quaternion) => quaternion.toArray()));
    expect(measureWarehouseGaitGeometry(calibration)).toEqual(firstMetrics);
    const expected = calibration.reference.upperLegLeft.quaternion.clone().multiply(
      new Quaternion().setFromAxisAngle(calibration.axes.hipLeft, target.upperLegLeft),
    );
    calibration.bones.upperLegLeft.quaternion.toArray().forEach((value, index) => {
      expect(value).toBeCloseTo(expected.toArray()[index], 12);
    });
  });

  test("measures conservative resulting geometry at all four reference phases", () => {
    const calibration = setup();
    const metrics = [0, 0.25, 0.5, 0.75].map((phase) => {
      applyWarehouseAnatomicalGaitPose(calibration, createWarehouseReferenceGaitPose(phase));
      return measureWarehouseGaitGeometry(calibration);
    });
    for (const result of metrics) {
      expect(result.thighElevationLeftDegrees).toBeLessThan(30);
      expect(result.thighElevationRightDegrees).toBeLessThan(30);
      expect(result.kneeFlexionLeftDegrees).toBeLessThan(40);
      expect(result.kneeFlexionRightDegrees).toBeLessThan(40);
      expect(result.footClearanceLeft).toBeLessThan(0.5);
      expect(result.footClearanceRight).toBeLessThan(0.5);
      // Source model units; the production stature scale converts this to < 0.55 m.
      expect(result.footForwardSeparation).toBeLessThan(1.5);
    }
  });

  test("keeps root and torso immutable for the same phase and across repeated sampling", () => {
    const calibration = setup();
    const root = calibration.bones.root.quaternion.clone();
    const torso = calibration.bones.spine.quaternion.clone();
    const target = createWarehouseReferenceGaitPose(0.37);
    for (let i = 0; i < 20; i += 1) applyWarehouseAnatomicalGaitPose(calibration, target);
    expect(calibration.bones.root.quaternion.toArray()).toEqual(root.toArray());
    expect(calibration.bones.spine.quaternion.toArray()).toEqual(torso.toArray());
  });
});
