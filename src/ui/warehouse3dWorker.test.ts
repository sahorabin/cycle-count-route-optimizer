import { describe, expect, test } from "vitest";
import { sampleWarehouse } from "../data/sampleWarehouse";
import { buildRouteTimeline } from "../domain/routeTimeline";
import { getSimulationSnapshotAtTime } from "../simulation/simulationSnapshot";
import { createWarehouse3DTransform, type WorldPoint } from "./warehouse3dProjection";
import { createWarehouseCountingGesture } from "./warehouse3dServiceVisual";
import {
  createWarehouseWorkerPose,
  createWarehouseWorkerVisual,
  getWarehouseWorkerFacingYaw,
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
    expect(worker.figureScale).toBeGreaterThan(1);
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
