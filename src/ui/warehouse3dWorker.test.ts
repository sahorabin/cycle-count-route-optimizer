import { describe, expect, test } from "vitest";
import { sampleWarehouse } from "../data/sampleWarehouse";
import { buildRouteTimeline } from "../domain/routeTimeline";
import { getSimulationSnapshotAtTime } from "../simulation/simulationSnapshot";
import { createWarehouse3DTransform, type WorldPoint } from "./warehouse3dProjection";
import { createWarehouseCountingGesture } from "./warehouse3dServiceVisual";
import { WAREHOUSE_3D_VISUALS } from "./warehouse3dVisuals";
import { WAREHOUSE_WORKER_COLORS } from "./warehouse3dWorker";
import type { SimulationSnapshot } from "../simulation/types";
import {
  createWarehouseOperatorGait,
  createWarehouseReferenceGaitPose,
  createWarehouseOperatorScanner,
  createWarehouseWorkerPose,
  createWarehouseWorkerScanCue,
  createWarehouseWorkerVisual,
  SCAN_WAVE_COUNT,
  SCAN_WAVE_MAX_RADIUS,
  SCAN_WAVE_MIN_RADIUS,
  SERVICE_FORWARD_REACH_LIMIT,
  getWarehouseWorkerFacingYaw,
  getWarehouseWorkerFigureScale,
  getWarehouseOperatorPartColor,
  getWarehouseOperatorBodyScale,
  WAREHOUSE_OPERATOR_BONES,
  WAREHOUSE_OPERATOR_CLIPS,
  WAREHOUSE_OPERATOR_HAND_ANCHOR,
  WAREHOUSE_REFERENCE_GAIT_KEY_POSES,
  WAREHOUSE_REFERENCE_GAIT_BONES,
  WORKER_ARRIVAL_SETTLE_METERS,
  WORKER_GAIT_CYCLE_METERS,
  WAREHOUSE_OPERATOR_PPE,
  WAREHOUSE_WORKER_DEPTH_POLICY,
  WAREHOUSE_WORKER_SCALE,
} from "./warehouse3dWorker";

const timeline = buildRouteTimeline({
  order: ["office", "loc-D"],
  totalDistance: 30,
  legs: [{
    from: "office",
    to: "loc-D",
    path: ["office", "F1", "F2", "loc-D"],
    distance: 30,
    segments: [
      { from: "office", to: "F1", distance: 8 },
      { from: "F1", to: "F2", distance: 20 },
      { from: "F2", to: "loc-D", distance: 2 },
    ],
  }],
}, 60);

function withoutColor(visual: ReturnType<typeof createWarehouseWorkerVisual>) {
  return visual.parts.map(({ color: _color, ...part }) => part);
}

function visualNumbers(value: unknown): number[] {
  if (typeof value === "number") return [value];
  if (Array.isArray(value)) return value.flatMap(visualNumbers);
  if (value && typeof value === "object") return Object.values(value).flatMap(visualNumbers);
  return [];
}

describe("warehouse3dWorker", () => {
  test("computes deterministic movement-facing yaw without mutating points", () => {
    const from: WorldPoint = { x: 0, y: 0, z: 0 };
    const to: WorldPoint = { x: 3, y: 0, z: 0 };
    const before = JSON.stringify({ from, to });

    expect(getWarehouseWorkerFacingYaw(from, to)).toBeCloseTo(Math.PI / 2);
    expect(getWarehouseWorkerFacingYaw(from, to)).toBeCloseTo(Math.PI / 2);
    expect(JSON.stringify({ from, to })).toBe(before);
  });

  test("uses a stable fallback for stationary or invalid directions", () => {
    const point: WorldPoint = { x: 2, y: 0, z: -3 };
    expect(getWarehouseWorkerFacingYaw(point, point, 0.75)).toBe(0.75);
    expect(getWarehouseWorkerFacingYaw(point, { ...point, x: Number.NaN })).toBe(0);
  });

  test("faces the current movement segment and preserves simulation inputs", () => {
    const transform = createWarehouse3DTransform(sampleWarehouse);
    const snapshot = getSimulationSnapshotAtTime(timeline, 12);
    const before = JSON.stringify({ timeline, snapshot, transform });
    const first = createWarehouseWorkerPose(sampleWarehouse, timeline, snapshot, transform);
    const second = createWarehouseWorkerPose(sampleWarehouse, timeline, snapshot, transform);

    expect(first).toEqual(second);
    expect(first.facingSource).toBe("current-segment");
    expect(Number.isFinite(first.yawRadians)).toBe(true);
    expect(Object.values(first.position).every(Number.isFinite)).toBe(true);
    expect(JSON.stringify({ timeline, snapshot, transform })).toBe(before);
  });

  test("uses the last real segment direction when the route is complete", () => {
    const transform = createWarehouse3DTransform(sampleWarehouse);
    const pose = createWarehouseWorkerPose(
      sampleWarehouse,
      timeline,
      getSimulationSnapshotAtTime(timeline, timeline.totalDurationSeconds),
      transform,
    );

    expect(pose.facingSource).toBe("last-segment");
    expect(Number.isFinite(pose.yawRadians)).toBe(true);
  });

  test("uses one stable forward orientation for a route without movement", () => {
    const stationaryTimeline = buildRouteTimeline({
      order: [sampleWarehouse.start.id],
      legs: [],
      totalDistance: 0,
    }, 60);
    const pose = createWarehouseWorkerPose(
      sampleWarehouse,
      stationaryTimeline,
      getSimulationSnapshotAtTime(stationaryTimeline, 0),
      createWarehouse3DTransform(sampleWarehouse),
    );

    expect(pose.facingSource).toBe("default");
    expect(pose.yawRadians).toBe(0);
  });

  test("uses identical worker structure for blue and green route identities", () => {
    const worker = createWarehouseWorkerVisual("#2563eb");
    const recommended = createWarehouseWorkerVisual("#0f9f75");

    expect(withoutColor(worker)).toEqual(withoutColor(recommended));
    expect(worker.figureScale).toBe(recommended.figureScale);
    expect(worker.figureScale).toBe(WAREHOUSE_WORKER_SCALE.maximum);
    expect(worker.parts.map(({ id }) => id)).toEqual(recommended.parts.map(({ id }) => id));
    expect(worker.parts.some(({ id }) => id === "head")).toBe(true);
    expect(worker.parts.some(({ id }) => id === "torso")).toBe(true);
    expect(worker.parts.filter(({ id }) => id.endsWith("arm"))).toHaveLength(4);
    expect(worker.parts.filter(({ id }) => id.endsWith("leg"))).toHaveLength(2);
    expect(worker.parts.filter(({ id }) => id.endsWith("boot"))).toHaveLength(2);
    expect(worker.parts.some(({ id }) => id === "scanner-body")).toBe(true);
    expect(worker.parts.some(({ id }) => id === "scanner-head")).toBe(true);
  });

  test("generates only finite renderer geometry and rotations", () => {
    const visual = createWarehouseWorkerVisual("#2563eb");
    const numbers = visualNumbers(visual);

    expect(visual.parts).toHaveLength(17);
    expect(numbers.length).toBeGreaterThan(0);
    expect(numbers.every(Number.isFinite)).toBe(true);
  });
});

describe("reference-driven four-pose gait", () => {
  const at = (phase: number) => createWarehouseReferenceGaitPose(phase);

  test("lands exactly on contact and passing key poses", () => {
    for (const phase of [0, 0.25, 0.5, 0.75]) {
      expect(at(phase)).toEqual(WAREHOUSE_REFERENCE_GAIT_KEY_POSES[phase * 4]);
    }
  });

  test("alternates left and right contact symmetrically", () => {
    const left = at(0);
    const right = at(0.5);
    expect(left.upperLegLeft).toBeCloseTo(right.upperLegRight, 10);
    expect(left.upperLegRight).toBeCloseTo(right.upperLegLeft, 10);
    expect(left.lowerLegLeft).toBeCloseTo(right.lowerLegRight, 10);
    expect(left.lowerLegRight).toBeCloseTo(right.lowerLegLeft, 10);
    expect(left.upperArmLeft).toBeCloseTo(-right.upperArmLeft, 10);
    expect(left.upperArmRight).toBeCloseTo(-right.upperArmRight, 10);
  });

  test("keeps every joint within the restrained reference ranges", () => {
    const radians = (degrees: number) => degrees * Math.PI / 180;
    for (const pose of WAREHOUSE_REFERENCE_GAIT_KEY_POSES) {
      expect(Math.abs(pose.upperLegLeft)).toBeLessThanOrEqual(radians(20));
      expect(Math.abs(pose.upperLegRight)).toBeLessThanOrEqual(radians(20));
      expect(pose.lowerLegLeft).toBeGreaterThanOrEqual(0);
      expect(pose.lowerLegRight).toBeGreaterThanOrEqual(0);
      expect(pose.lowerLegLeft).toBeLessThanOrEqual(radians(28));
      expect(pose.lowerLegRight).toBeLessThanOrEqual(radians(28));
      expect(Math.abs(pose.upperArmLeft)).toBeLessThanOrEqual(radians(12));
      expect(Math.abs(pose.upperArmRight)).toBeLessThanOrEqual(radians(9));
      expect(Math.abs(pose.pelvisYaw)).toBeLessThanOrEqual(radians(2));
      expect(Math.abs(pose.torsoYaw)).toBeLessThanOrEqual(radians(2));
    }
  });

  test("names every required arm, leg, foot, pelvis and torso bone", () => {
    expect(WAREHOUSE_REFERENCE_GAIT_BONES).toEqual({
      upperLegLeft: "UpperLegL", lowerLegLeft: "LowerLegL", footLeft: "FootL",
      upperLegRight: "UpperLegR", lowerLegRight: "LowerLegR", footRight: "FootR",
      upperArmLeft: "UpperArmL", upperArmRight: "UpperArmR", pelvis: "Hips", torso: "Torso",
    });
  });

  test("has no root or vertical channel and repeats deterministically", () => {
    for (const pose of WAREHOUSE_REFERENCE_GAIT_KEY_POSES) {
      expect(pose).not.toHaveProperty("root");
      expect(pose).not.toHaveProperty("position");
      expect(pose).not.toHaveProperty("verticalBob");
    }
    for (const phase of [0, 0.13, 0.37, 0.61, 0.99, 4.37]) {
      expect(at(phase)).toEqual(at(phase));
      const repeated = at(phase + 1);
      const original = at(phase);
      for (const field of Object.keys(original) as (keyof typeof original)[]) {
        expect(repeated[field]).toBeCloseTo(original[field], 12);
      }
    }
  });

  test("smooth interpolation never overshoots the key-pose bounds", () => {
    for (let i = 0; i < 100; i += 1) {
      const pose = at(i / 100);
      expect(Math.abs(pose.upperLegLeft)).toBeLessThanOrEqual(20 * Math.PI / 180);
      expect(Math.abs(pose.upperLegRight)).toBeLessThanOrEqual(20 * Math.PI / 180);
      expect(pose.lowerLegLeft).toBeLessThanOrEqual(28 * Math.PI / 180);
      expect(pose.lowerLegRight).toBeLessThanOrEqual(28 * Math.PI / 180);
    }
  });
});

describe("warehouse worker counting pose", () => {
  const gesture = createWarehouseCountingGesture(3);
  const travelVisual = createWarehouseWorkerVisual("#2563eb");
  const countingVisual = createWarehouseWorkerVisual("#2563eb", gesture);
  const partById = (visual: ReturnType<typeof createWarehouseWorkerVisual>, id: string) => {
    const part = visual.parts.find((candidate) => candidate.id === id);
    if (!part) throw new Error(`Missing worker part "${id}"`);
    return part;
  };

  test("travel keeps the existing worker pose untouched", () => {
    expect(createWarehouseWorkerVisual("#2563eb", null)).toEqual(travelVisual);
    expect(travelVisual.parts).toHaveLength(17);
  });

  test("service re-poses the existing primitives without adding or renaming parts", () => {
    expect(countingVisual.parts.map(({ id }) => id))
      .toEqual(travelVisual.parts.map(({ id }) => id));
    expect(countingVisual.figureScale).toBe(travelVisual.figureScale);
    expect(countingVisual).not.toEqual(travelVisual);
  });

  test("raises the scanner arm and carries the scanner forward while counting", () => {
    const travelScanner = partById(travelVisual, "scanner-head");
    const countingScanner = partById(countingVisual, "scanner-head");
    const travelArm = partById(travelVisual, "right-forearm");
    const countingArm = partById(countingVisual, "right-forearm");

    expect(countingScanner.position[1]).toBeGreaterThan(travelScanner.position[1]);
    expect(countingScanner.position[2]).toBeGreaterThan(travelScanner.position[2]);
    expect(countingArm.position[2]).toBeGreaterThan(travelArm.position[2]);
    expect(countingArm.position[1]).toBeGreaterThan(travelArm.position[1]);
  });

  test("gives the support arm a smaller gesture than the scanner arm", () => {
    const scannerArm = partById(countingVisual, "right-forearm");
    const supportArm = partById(countingVisual, "left-forearm");

    expect(supportArm.position[2]).toBeLessThan(scannerArm.position[2]);
    expect(supportArm.position[1]).toBeLessThan(scannerArm.position[1]);
  });

  test("keeps the feet planted and the worker root position unchanged", () => {
    for (const id of ["left-leg", "right-leg", "left-boot", "right-boot"]) {
      expect(partById(countingVisual, id)).toEqual(partById(travelVisual, id));
    }
    const transform = createWarehouse3DTransform(sampleWarehouse);
    const snapshot = getSimulationSnapshotAtTime(timeline, 12);
    const pose = createWarehouseWorkerPose(sampleWarehouse, timeline, snapshot, transform);

    // The gesture lives entirely inside the figure; it can never displace the root.
    expect(pose.position).toEqual(
      createWarehouseWorkerPose(sampleWarehouse, timeline, snapshot, transform).position,
    );
  });

  test("is deterministic for one elapsed time and varies across the scan cycle", () => {
    const repeat = createWarehouseWorkerVisual("#2563eb", createWarehouseCountingGesture(3));
    const later = createWarehouseWorkerVisual("#2563eb", createWarehouseCountingGesture(4.1));

    expect(repeat).toEqual(countingVisual);
    expect(partById(later, "scanner-head").position).not.toEqual(
      partById(countingVisual, "scanner-head").position,
    );
  });

  test("produces only finite geometry across a whole scan cycle and for invalid input", () => {
    const samples = [0, 0.3, 0.9, 1.7, 2.2, 5, Number.NaN, Number.POSITIVE_INFINITY, -3];

    for (const elapsed of samples) {
      const numbers = visualNumbers(
        createWarehouseWorkerVisual("#2563eb", createWarehouseCountingGesture(elapsed)),
      );
      expect(numbers.every(Number.isFinite)).toBe(true);
      expect(numbers.every((value) => Math.abs(value) < 10)).toBe(true);
    }
  });

  test("uses one identical counting pose for both route identities", () => {
    const recommended = createWarehouseWorkerVisual("#0f9f75", gesture);

    expect(withoutColor(recommended)).toEqual(withoutColor(countingVisual));
  });
});

describe("warehouse worker visual scale", () => {
  test("shrinks the operator for wide context and restores full size up close", () => {
    const overview = getWarehouseWorkerFigureScale(1);
    const aisle = getWarehouseWorkerFigureScale(1.2);
    const workerFocus = getWarehouseWorkerFigureScale(1.65);

    expect(overview).toBeLessThan(aisle);
    expect(aisle).toBeLessThan(workerFocus);
    expect(overview).toBe(WAREHOUSE_WORKER_SCALE.minimum);
    expect(workerFocus).toBe(WAREHOUSE_WORKER_SCALE.maximum);
  });

  test("stays bounded and human-readable across the whole zoom range", () => {
    for (const ratio of [0.4, 0.55, 1, 1.35, 2, 3.25, 12]) {
      const scale = getWarehouseWorkerFigureScale(ratio);
      expect(Number.isFinite(scale)).toBe(true);
      expect(scale).toBeGreaterThanOrEqual(WAREHOUSE_WORKER_SCALE.minimum);
      expect(scale).toBeLessThanOrEqual(WAREHOUSE_WORKER_SCALE.maximum);
    }
    expect(WAREHOUSE_WORKER_SCALE.minimum).toBeGreaterThan(0.5);
    expect(getWarehouseWorkerFigureScale(Number.NaN)).toBe(WAREHOUSE_WORKER_SCALE.maximum);
  });

  test("applies one scale rule to both route identities without moving the figure", () => {
    const scale = getWarehouseWorkerFigureScale(1.1);
    const worker = createWarehouseWorkerVisual("#2563eb", null, scale);
    const recommended = createWarehouseWorkerVisual("#0f9f75", null, scale);
    const full = createWarehouseWorkerVisual("#2563eb");

    expect(worker.figureScale).toBe(scale);
    expect(recommended.figureScale).toBe(scale);
    expect(withoutColor(worker)).toEqual(withoutColor(recommended));
    // Scale is a group transform only -- part offsets are untouched.
    expect(withoutColor(worker)).toEqual(withoutColor(full));
    expect(createWarehouseWorkerVisual("#2563eb", null, 0).figureScale)
      .toBe(WAREHOUSE_WORKER_SCALE.maximum);
    expect(createWarehouseWorkerVisual("#2563eb", null, Number.NaN).figureScale)
      .toBe(WAREHOUSE_WORKER_SCALE.maximum);
  });
});

describe("warehouse worker depth policy", () => {
  test("renders the body as ordinary scene geometry that racking can occlude", () => {
    expect(WAREHOUSE_WORKER_DEPTH_POLICY.body.depthTest).toBe(true);
    expect(WAREHOUSE_WORKER_DEPTH_POLICY.body.depthWrite).toBe(true);
    // There is no draw-through pass left: the only exemption is a small locator.
    expect(Object.keys(WAREHOUSE_WORKER_DEPTH_POLICY)).toEqual(["body", "locator"]);
  });

  test("limits depth-independent help to a small locator aid", () => {
    const { locator, body } = WAREHOUSE_WORKER_DEPTH_POLICY;

    expect(locator.depthTest).toBe(false);
    expect(locator.renderOrder).toBeGreaterThan(body.renderOrder);
    expect(locator.pipRadius).toBeGreaterThan(0);
    // Small enough to read as a marker rather than a second body.
    expect(locator.pipRadius).toBeLessThan(WAREHOUSE_3D_VISUALS.worker.headRadius);
  });

  test("gives no worker part its own depth exemption", () => {
    const visual = createWarehouseWorkerVisual("#2f5d9e");

    for (const part of visual.parts) {
      expect(part).not.toHaveProperty("silhouette");
      expect(part).not.toHaveProperty("depthTest");
    }
  });

  test("uses identical part structure for both route identities", () => {
    const worker = createWarehouseWorkerVisual("#2f5d9e");
    const recommended = createWarehouseWorkerVisual("#2f7d5f");

    expect(worker.parts.map(({ id }) => id)).toEqual(recommended.parts.map(({ id }) => id));
  });
});

describe("warehouse worker scan cue", () => {
  const gesture = createWarehouseCountingGesture(3);

  test("exists only while the operator is counting", () => {
    expect(createWarehouseWorkerScanCue(null)).toBeNull();
    expect(createWarehouseWorkerScanCue(gesture)).not.toBeNull();
  });

  test("emits expanding arcs from the scan head toward the bay", () => {
    const cue = createWarehouseWorkerScanCue(gesture)!;
    const head = createWarehouseWorkerVisual("#2f5d9e", gesture).parts
      .find(({ id }) => id === "scanner-head")!;
    const distanceToHead = Math.hypot(
      cue.origin[0] - head.position[0],
      cue.origin[1] - head.position[1],
      cue.origin[2] - head.position[2],
    );

    expect(distanceToHead).toBeLessThan(0.06);
    // Forward is +Z in figure space, which the pose already aims at the rack.
    expect(cue.direction[2]).toBeGreaterThan(0.9);
    expect(Math.hypot(...cue.direction)).toBeCloseTo(1);
    expect(cue.waves).toHaveLength(SCAN_WAVE_COUNT);
  });

  test("spaces the waves across one scan cycle and fades them as they expand", () => {
    const cue = createWarehouseWorkerScanCue(gesture)!;

    for (const wave of cue.waves) {
      expect(wave.radius).toBeGreaterThanOrEqual(SCAN_WAVE_MIN_RADIUS);
      expect(wave.radius).toBeLessThanOrEqual(SCAN_WAVE_MAX_RADIUS);
      expect(wave.opacity).toBeGreaterThanOrEqual(0);
      expect(wave.opacity).toBeLessThanOrEqual(1);
    }
    // Distinct phases, so the burst reads as motion rather than one ring.
    expect(new Set(cue.waves.map(({ radius }) => radius.toFixed(4))).size)
      .toBe(SCAN_WAVE_COUNT);
    const widest = [...cue.waves].sort((a, b) => b.radius - a.radius)[0];
    const tightest = [...cue.waves].sort((a, b) => a.radius - b.radius)[0];
    expect(widest.opacity).toBeLessThan(tightest.opacity);
  });

  test("is a pure function of service elapsed time", () => {
    expect(createWarehouseWorkerScanCue(gesture)).toEqual(createWarehouseWorkerScanCue(gesture));
    expect(createWarehouseWorkerScanCue(createWarehouseCountingGesture(3.4)))
      .not.toEqual(createWarehouseWorkerScanCue(gesture));

    for (const elapsed of [0, 0.7, 1.4, 2.1, Number.NaN, -5]) {
      const cue = createWarehouseWorkerScanCue(createWarehouseCountingGesture(elapsed))!;
      const numbers = [
        ...cue.origin,
        ...cue.direction,
        cue.intensity,
        ...cue.waves.flatMap((wave) => [wave.radius, wave.opacity]),
      ];
      expect(numbers.every(Number.isFinite)).toBe(true);
    }
  });

  test("stays inside the operator's forward reach limit", () => {
    for (const elapsed of [0, 0.5, 1.1, 1.7, 2.3]) {
      const cue = createWarehouseWorkerScanCue(createWarehouseCountingGesture(elapsed))!;
      // The arcs may reach the rack face; the hardware never travels into it.
      expect(cue.origin[2]).toBeLessThanOrEqual(SERVICE_FORWARD_REACH_LIMIT);
    }
  });
});

describe("warehouse worker proportions", () => {
  const visual = createWarehouseWorkerVisual("#2f5d9e");
  const part = (id: string) => {
    const found = visual.parts.find((candidate) => candidate.id === id);
    if (!found) throw new Error(`Missing worker part "${id}"`);
    return found;
  };

  test("reads as an operator rather than a toy pawn", () => {
    const hat = part("hard-hat");
    const head = part("head");
    if (hat.primitive !== "cylinder" || head.primitive !== "sphere") {
      throw new Error("Unexpected worker primitives");
    }
    const totalHeight = hat.position[1] + hat.height / 2;
    const headDiameter = head.radius * 2;

    // Roughly a seven-head figure; a toy/mascot figure is three or four.
    expect(totalHeight / headDiameter).toBeGreaterThan(6);
    expect(headDiameter / totalHeight).toBeLessThan(0.16);
  });

  test("stands on legs long enough to look human", () => {
    const leg = part("left-leg");
    const hat = part("hard-hat");
    if (leg.primitive !== "box" || hat.primitive !== "cylinder") {
      throw new Error("Unexpected worker primitives");
    }
    const totalHeight = hat.position[1] + hat.height / 2;

    expect(leg.size[1] / totalHeight).toBeGreaterThan(0.4);
  });

  test("keeps shoulders narrow relative to height", () => {
    const arm = part("right-upper-arm");
    const hat = part("hard-hat");
    if (arm.primitive !== "box" || hat.primitive !== "cylinder") {
      throw new Error("Unexpected worker primitives");
    }
    const totalHeight = hat.position[1] + hat.height / 2;
    const shoulderSpan = arm.position[0] * 2 + arm.size[0];

    expect(shoulderSpan / totalHeight).toBeLessThan(0.4);
  });

  test("carries route identity on PPE only, over muted workwear", () => {
    const worker = createWarehouseWorkerVisual("#2f5d9e");
    const recommended = createWarehouseWorkerVisual("#2f7d5f");
    const identityParts = worker.parts
      .filter((candidate, index) => candidate.color !== recommended.parts[index].color)
      .map(({ id }) => id);

    // Only the hard hat carries route identity; the vest is real hi-vis PPE.
    expect(identityParts).toEqual(["hard-hat", "hard-hat-brim"]);
    expect(worker.parts.find(({ id }) => id === "vest")?.color)
      .toBe(WAREHOUSE_WORKER_COLORS.hiVis);
    // Trousers, torso, and boots are workwear, not identity paint.
    expect(worker.parts.find(({ id }) => id === "torso")?.color)
      .toBe(WAREHOUSE_WORKER_COLORS.uniform);
    expect(worker.parts.find(({ id }) => id === "left-leg")?.color)
      .toBe(WAREHOUSE_WORKER_COLORS.workwear);
  });

  test("stays well under its previous visual footprint at every zoom", () => {
    // The pre-S7E figure ran 0.85 - 1.30; anything at or above that reads oversized.
    expect(WAREHOUSE_WORKER_SCALE.maximum).toBeLessThan(1.3);
    expect(WAREHOUSE_WORKER_SCALE.minimum).toBeLessThan(0.85);
    expect(getWarehouseWorkerFigureScale(1)).toBe(WAREHOUSE_WORKER_SCALE.minimum);
  });
});

describe("imported operator PPE", () => {
  test("dresses the imported model as a warehouse operator by material name", () => {
    expect(WAREHOUSE_OPERATOR_PPE.Shirt).toBe(WAREHOUSE_WORKER_COLORS.hiVis);
    expect(WAREHOUSE_OPERATOR_PPE.Workwear).toBe(WAREHOUSE_WORKER_COLORS.workwear);
    expect(WAREHOUSE_OPERATOR_PPE.Pants).toBe(WAREHOUSE_WORKER_COLORS.workwear);

    const luminance = (hex: string) => [1, 3, 5]
      .map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16))
      .reduce((total, channel) => total + channel, 0) / 3;
    // Hi-vis has to be the brightest thing on the operator, by a wide margin.
    expect(luminance(WAREHOUSE_OPERATOR_PPE.Shirt))
      .toBeGreaterThan(luminance(WAREHOUSE_OPERATOR_PPE.Workwear) + 80);
  });

  test("leaves anything PPE does not dress in the model's own colour", () => {
    expect(getWarehouseOperatorPartColor("Skin", "#c2a184")).toBe("#c2a184");
    expect(getWarehouseOperatorPartColor("Hair", "#101010")).toBe("#101010");
    expect(getWarehouseOperatorPartColor("Shirt", "#c2a184"))
      .toBe(WAREHOUSE_WORKER_COLORS.hiVis);
  });

  test("never carries route identity on the body", () => {
    // Compare fairness: both operators are the same person in the same PPE, so
    // identity has to live on the locator ring, not on the human.
    const identityColors = ["#2f6fc4", "#1f9d76"];
    for (const color of identityColors) {
      expect(Object.values(WAREHOUSE_OPERATOR_PPE)).not.toContain(color);
    }
    for (const partName of ["Shirt", "Workwear", "Pants", "Skin"]) {
      expect(getWarehouseOperatorPartColor(partName, identityColors[0]))
        .toBe(partName === "Skin" ? identityColors[0] : WAREHOUSE_OPERATOR_PPE[partName]);
    }
  });
});

describe("imported operator scanner", () => {
  test("rests in the operator's hand while travelling", () => {
    const scanner = createWarehouseOperatorScanner(null);

    expect(scanner.position).toEqual([...WAREHOUSE_OPERATOR_HAND_ANCHOR]);
    expect(scanner.yawRadians).toBe(0);
    // The scan head sits just above the grip, still at the hand.
    expect(scanner.head[1]).toBeGreaterThan(scanner.position[1]);
    expect(WAREHOUSE_OPERATOR_HAND_ANCHOR.every(Number.isFinite)).toBe(true);
  });

  test("lifts to a working height while counting, from service time alone", () => {
    const resting = createWarehouseOperatorScanner(null);
    const counting = createWarehouseOperatorScanner(createWarehouseCountingGesture(1.4));

    expect(counting.position[1]).toBeGreaterThan(resting.position[1]);
    // Same elapsed time, same scanner: no clock, no accumulator.
    expect(createWarehouseOperatorScanner(createWarehouseCountingGesture(1.4))).toEqual(counting);
  });

  test("never pushes the scanner past the rack-face reach limit", () => {
    for (const elapsed of [0, 0.3, 0.7, 1.1, 1.9, 2.6, 3.4, 4.8, 7.2]) {
      const scanner = createWarehouseOperatorScanner(createWarehouseCountingGesture(elapsed));
      for (const point of [scanner.position, scanner.head]) {
        expect({ elapsed, withinReach: point[2] <= SERVICE_FORWARD_REACH_LIMIT })
          .toEqual({ elapsed, withinReach: true });
        expect(point.every(Number.isFinite)).toBe(true);
      }
    }
  });

  test("lets the imported operator scan from its own hand", () => {
    const gesture = createWarehouseCountingGesture(1.1);
    const scanner = createWarehouseOperatorScanner(gesture);

    const procedural = createWarehouseWorkerScanCue(gesture);
    const imported = createWarehouseWorkerScanCue(gesture, scanner.head);

    expect(imported?.origin).toEqual(scanner.head);
    expect(procedural?.origin).not.toEqual(scanner.head);
    // Only the emitting point moves; the read itself is the same event.
    expect(imported?.waves).toEqual(procedural?.waves);
    expect(imported?.direction).toEqual(procedural?.direction);
  });

  test("emits no scan cue at all outside service", () => {
    expect(createWarehouseWorkerScanCue(null, [0, 1, 0])).toBeNull();
  });
});

describe("operator locomotion", () => {
  const CLIPS = { walkDurationSeconds: 1.0416666, idleDurationSeconds: 4.1666666 };
  /** The warehouse's physical walking speed, which S7K.1 does not touch. */
  const WALKING_SPEED_METERS_PER_SECOND = 1;
  const STRIDE_METERS = WORKER_GAIT_CYCLE_METERS;

  const travelling = (distanceTraveled: number, overrides = {}): SimulationSnapshot => ({
    timeSeconds: distanceTraveled,
    isComplete: false,
    totalDurationSeconds: 500,
    totalDistance: 240,
    distanceTraveled,
    distanceRemaining: 240 - distanceTraveled,
    completedLegCount: 0,
    completedDestinationIds: [],
    current: {
      kind: "travel",
      legIndex: 0,
      segmentIndex: 2,
      from: "A1",
      to: "A2",
      progress: 0.5,
      distanceTraveledOnSegment: 5,
      distanceRemainingOnSegment: 5,
      ...overrides,
    },
  });

  const servicing = (distanceTraveled: number): SimulationSnapshot => ({
    ...travelling(distanceTraveled),
    current: {
      kind: "service",
      legIndex: 0,
      locationId: "loc-A01",
      serviceClass: "simple",
      progress: 0.3,
      elapsedSeconds: 6,
      durationSeconds: 20,
      remainingSeconds: 14,
    },
  });

  const gait = (snapshot: SimulationSnapshot, ids?: ReadonlySet<string>) =>
    createWarehouseOperatorGait(snapshot, CLIPS, ids);

  test("derives the gait from distance travelled, never from a clock", () => {
    const first = gait(travelling(37.5));

    expect(gait(travelling(37.5))).toEqual(first);
    // One whole stride later the legs are back where they started.
    expect(gait(travelling(37.5 + STRIDE_METERS)).walkTimeSeconds)
      .toBeCloseTo(first.walkTimeSeconds, 6);
    expect(gait(travelling(37.5 + STRIDE_METERS * 3)).walkTimeSeconds)
      .toBeCloseTo(first.walkTimeSeconds, 6);
    // Half a stride later it is demonstrably a different pose.
    expect(gait(travelling(37.5 + STRIDE_METERS / 2)).walkTimeSeconds)
      .not.toBeCloseTo(first.walkTimeSeconds, 3);
  });

  test("reproduces the same pose on seek, forward or backward", () => {
    const path = [0, 4.5, 19, 61.25, 120, 61.25, 19, 4.5, 0];
    const poses = path.map((distance) => gait(travelling(distance)).walkTimeSeconds);

    // The walk back down the list matches the walk up it, exactly.
    expect(poses.slice(5)).toEqual(poses.slice(0, 4).reverse());
    // Reset lands on the start of the cycle.
    expect(gait(travelling(0)).walkTimeSeconds).toBe(0);
    expect(gait(travelling(0)).gaitCycles).toBe(0);
  });

  test("keeps the pose frozen while paused, because nothing but state moves it", () => {
    const paused = travelling(88.125);
    const samples = Array.from({ length: 5 }, () => gait(paused));

    for (const sample of samples) expect(sample).toEqual(samples[0]);
  });

  test("walks only while travelling", () => {
    expect(gait(travelling(50)).walkWeight).toBe(1);
    expect(gait(servicing(50)).walkWeight).toBe(0);

    const complete: SimulationSnapshot = {
      ...travelling(240), isComplete: true, current: null, distanceRemaining: 0,
    };
    expect(gait(complete).walkWeight).toBe(0);
    // A stationary operator still holds a real standing pose, not frame zero of
    // a stride it happened to stop on.
    expect(gait(complete).walkTimeSeconds).toBe(0);
    expect(gait(complete).idleTimeSeconds).toBeGreaterThanOrEqual(0);
  });

  test("settles out of the walk on the short spur in front of a bin", () => {
    const bins = new Set(["loc-A01"]);
    const arriving = (remaining: number) =>
      gait(travelling(50, { to: "loc-A01", distanceRemainingOnSegment: remaining }), bins);

    expect(arriving(WORKER_ARRIVAL_SETTLE_METERS * 2).walkWeight).toBe(1);
    // Well damped before the operator ever turns to face the rack: the spur is
    // about 1.08 m long, and the fade has to be under way by then.
    expect(arriving(1.08).walkWeight).toBeLessThan(0.5);
    expect(arriving(WORKER_ARRIVAL_SETTLE_METERS / 2).walkWeight).toBeLessThan(0.3);
    expect(arriving(0).walkWeight).toBe(0);
    // Monotonic: the operator only ever slows on the way in.
    const weights = [1.6, 1.2, 0.8, 0.4, 0].map((d) => arriving(d).walkWeight);
    expect(weights).toEqual([...weights].sort((a, b) => b - a));
    // Walking down an aisle towards another aisle node is never damped.
    expect(gait(travelling(50, { to: "A9", distanceRemainingOnSegment: 0 }), bins).walkWeight)
      .toBe(1);
  });

  test("walks at a human cadence at the warehouse's own walking speed", () => {
    const cycles = gait(travelling(STRIDE_METERS * 4)).gaitCycles;
    expect(cycles).toBeCloseTo(4, 6);

    // The gate this phase exists for: one cycle per second-ish at 1x, which is
    // what a person walking 1 m/s looks like. Anything near ten seconds reads
    // as slow motion however correct its geometry is.
    const secondsPerCycle = WORKER_GAIT_CYCLE_METERS / WALKING_SPEED_METERS_PER_SECOND;
    expect(secondsPerCycle).toBeGreaterThan(0.8);
    expect(secondsPerCycle).toBeLessThan(1.6);
    // A human stride, not an avatar-sized one.
    expect(WORKER_GAIT_CYCLE_METERS).toBeGreaterThan(0.9);
    expect(WORKER_GAIT_CYCLE_METERS).toBeLessThan(1.5);
  });

  test("takes its cadence from human locomotion, not from the avatar's scale", () => {
    // The operator is drawn several times oversized for readability. If that
    // scale ever leaks back into the gait, cadence collapses into slow motion,
    // so the calibration deliberately has no renderer-scale input at all.
    expect(createWarehouseOperatorGait.length).toBeLessThanOrEqual(3);
    const sample = gait(travelling(12.5));
    expect(gait(travelling(12.5))).toEqual(sample);
    // Ten strides of route distance is ten cycles, whatever the figure's size.
    expect(gait(travelling(WORKER_GAIT_CYCLE_METERS * 10)).gaitCycles).toBeCloseTo(10, 6);
  });

  test("leaves playback rate out of the gait formula entirely", () => {
    // Rate changes how fast distance accumulates; the pose follows distance.
    // Two runs at different rates that reached the same distance must match.
    const slow = gait(travelling(9.2));
    const fast = gait({ ...travelling(9.2), timeSeconds: 9.2 / 10 });

    expect(fast.walkTimeSeconds).toBe(slow.walkTimeSeconds);
    expect(fast.gaitCycles).toBe(slow.gaitCycles);
  });

  test("degrades to standing rather than animating nonsense", () => {
    // A file with no walk clip still produces a usable standing operator.
    for (const walkDurationSeconds of [0, -1, Number.NaN]) {
      const result = createWarehouseOperatorGait(
        travelling(50), { walkDurationSeconds, idleDurationSeconds: 4 },
      );
      expect({ walkDurationSeconds, weight: result.walkWeight })
        .toEqual({ walkDurationSeconds, weight: 0 });
      expect(Number.isFinite(result.idleTimeSeconds)).toBe(true);
    }
  });

  test("emits only finite, in-range animation times", () => {
    for (const distance of [0, 0.001, 7, 113.7, 12345]) {
      const result = gait(travelling(distance));
      expect(result.walkTimeSeconds).toBeGreaterThanOrEqual(0);
      expect(result.walkTimeSeconds).toBeLessThan(CLIPS.walkDurationSeconds);
      expect(result.idleTimeSeconds).toBeLessThan(CLIPS.idleDurationSeconds);
      expect([result.walkWeight, result.gaitCycles].every(Number.isFinite)).toBe(true);
    }
  });

  test("names only the standing clip and bones it needs from the shipped rig", () => {
    expect(WAREHOUSE_OPERATOR_CLIPS).not.toHaveProperty("walk");
    expect(WAREHOUSE_OPERATOR_CLIPS.idle).toBe("Man_Idle");
    expect(WAREHOUSE_OPERATOR_BONES.hand).toBe("MiddleHandR");
    expect(WAREHOUSE_OPERATOR_BONES.head).toBe("Head");
  });

  test("scales the body to its target stature and nothing else", () => {
    // Measured skinned stature of the shipped rig, in model units.
    const stature = 4.812;

    expect(getWarehouseOperatorBodyScale(stature, 1.76) * stature).toBeCloseTo(1.76, 9);
    // The regression this replaced: the enclosing group already applies the
    // zoom LOD, so folding it in here squared it and shrank the operator to a
    // third of its height at ordinary zoom, hiding the walk cycle.
    expect(getWarehouseOperatorBodyScale.length).toBe(2);
    for (const lod of [0.55, 0.7]) {
      expect(getWarehouseOperatorBodyScale(stature, 1.76) * lod * stature)
        .toBeLessThan(1.76);
    }
    expect(getWarehouseOperatorBodyScale(0, 1.76)).toBe(1);
    expect(getWarehouseOperatorBodyScale(Number.NaN, 1.76)).toBe(1);
  });
});
