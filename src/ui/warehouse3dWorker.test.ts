import { describe, expect, test } from "vitest";
import { sampleWarehouse } from "../data/sampleWarehouse";
import { buildRouteTimeline } from "../domain/routeTimeline";
import { getSimulationSnapshotAtTime } from "../simulation/simulationSnapshot";
import { createWarehouse3DTransform, type WorldPoint } from "./warehouse3dProjection";
import { createWarehouseCountingGesture } from "./warehouse3dServiceVisual";
import { WAREHOUSE_3D_VISUALS } from "./warehouse3dVisuals";
import { WAREHOUSE_WORKER_COLORS } from "./warehouse3dWorker";
import {
  createWarehouseWorkerPose,
  createWarehouseWorkerScanCue,
  createWarehouseWorkerVisual,
  getWarehouseWorkerFacingYaw,
  getWarehouseWorkerFigureScale,
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
    expect(worker.parts.filter(({ id }) => id.endsWith("arm"))).toHaveLength(2);
    expect(worker.parts.filter(({ id }) => id.endsWith("leg"))).toHaveLength(2);
    expect(worker.parts.filter(({ id }) => id.endsWith("boot"))).toHaveLength(2);
    expect(worker.parts.some(({ id }) => id === "scanner")).toBe(true);
  });

  test("generates only finite renderer geometry and rotations", () => {
    const visual = createWarehouseWorkerVisual("#2563eb");
    const numbers = visualNumbers(visual);

    expect(visual.parts).toHaveLength(14);
    expect(numbers.length).toBeGreaterThan(0);
    expect(numbers.every(Number.isFinite)).toBe(true);
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
    expect(travelVisual.parts).toHaveLength(14);
  });

  test("service re-poses the existing primitives without adding or renaming parts", () => {
    expect(countingVisual.parts.map(({ id }) => id))
      .toEqual(travelVisual.parts.map(({ id }) => id));
    expect(countingVisual.figureScale).toBe(travelVisual.figureScale);
    expect(countingVisual).not.toEqual(travelVisual);
  });

  test("raises the scanner arm and carries the scanner forward while counting", () => {
    const travelScanner = partById(travelVisual, "scanner");
    const countingScanner = partById(countingVisual, "scanner");
    const travelArm = partById(travelVisual, "right-arm");
    const countingArm = partById(countingVisual, "right-arm");

    expect(countingScanner.position[1]).toBeGreaterThan(travelScanner.position[1]);
    expect(countingScanner.position[2]).toBeGreaterThan(travelScanner.position[2]);
    expect(countingArm.position[2]).toBeGreaterThan(travelArm.position[2]);
    expect(countingArm.rotation[0]).toBeLessThan(travelArm.rotation[0]);
  });

  test("gives the support arm a smaller gesture than the scanner arm", () => {
    const scannerArm = partById(countingVisual, "right-arm");
    const supportArm = partById(countingVisual, "left-arm");

    expect(Math.abs(supportArm.rotation[0])).toBeGreaterThan(0);
    expect(Math.abs(supportArm.rotation[0])).toBeLessThan(Math.abs(scannerArm.rotation[0]));
    expect(supportArm.position[2]).toBeLessThan(scannerArm.position[2]);
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
    expect(partById(later, "scanner").position).not.toEqual(
      partById(countingVisual, "scanner").position,
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

  test("starts at the scanner head and points away from the operator", () => {
    const cue = createWarehouseWorkerScanCue(gesture)!;
    const scanner = createWarehouseWorkerVisual("#2563eb", gesture).parts
      .find(({ id }) => id === "scanner")!;
    const distanceToScanner = Math.hypot(
      cue.origin[0] - scanner.position[0],
      cue.origin[1] - scanner.position[1],
      cue.origin[2] - scanner.position[2],
    );

    expect(distanceToScanner).toBeLessThan(0.25);
    // Forward is +Z in figure space, which the pose already aims at the location.
    expect(cue.direction[2]).toBeGreaterThan(0.5);
    expect(Math.hypot(...cue.direction)).toBeCloseTo(1);
    expect(cue.length).toBeGreaterThan(0.4);
    expect(cue.length).toBeLessThan(1);
  });

  test("is deterministic and bounded across the scan cycle", () => {
    expect(createWarehouseWorkerScanCue(gesture)).toEqual(createWarehouseWorkerScanCue(gesture));

    for (const elapsed of [0, 0.7, 1.4, 2.1, Number.NaN, -5]) {
      const cue = createWarehouseWorkerScanCue(createWarehouseCountingGesture(elapsed))!;
      expect([...cue.origin, ...cue.direction, cue.length, cue.intensity].every(Number.isFinite))
        .toBe(true);
      expect(cue.intensity).toBeGreaterThan(0);
      expect(cue.intensity).toBeLessThanOrEqual(1);
    }
  });

  test("brightens and extends as the operator reaches into the bay", () => {
    const resting = createWarehouseWorkerScanCue(createWarehouseCountingGesture(0))!;
    const reaching = createWarehouseWorkerScanCue(
      createWarehouseCountingGesture(1 / (2 * 0.45)),
    )!;

    expect(reaching.intensity).toBeGreaterThan(resting.intensity);
    expect(reaching.length).toBeGreaterThan(resting.length);
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
    const arm = part("right-arm");
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

    expect(identityParts).toEqual(["vest-panel", "hard-hat", "hard-hat-brim"]);
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
