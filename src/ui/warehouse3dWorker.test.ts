import { describe, expect, test } from "vitest";
import { sampleWarehouse } from "../data/sampleWarehouse";
import type { RouteTimeline } from "../domain/types";
import { getSimulationSnapshotAtTime } from "../simulation/simulationSnapshot";
import { createWarehouse3DTransform, type WorldPoint } from "./warehouse3dProjection";
import {
  createWarehouseWorkerPose,
  createWarehouseWorkerVisual,
  getWarehouseWorkerFacingYaw,
} from "./warehouse3dWorker";

const timeline: RouteTimeline = {
  order: ["office", "loc-D"],
  walkingSpeedMetersPerMinute: 60,
  totalDistance: 30,
  totalDurationSeconds: 30,
  legs: [{
    from: "office",
    to: "loc-D",
    distance: 30,
    startTimeSeconds: 0,
    durationSeconds: 30,
    endTimeSeconds: 30,
    segments: [
      { from: "office", to: "F1", distance: 8, startTimeSeconds: 0, durationSeconds: 8, endTimeSeconds: 8 },
      { from: "F1", to: "F2", distance: 20, startTimeSeconds: 8, durationSeconds: 20, endTimeSeconds: 28 },
      { from: "F2", to: "loc-D", distance: 2, startTimeSeconds: 28, durationSeconds: 2, endTimeSeconds: 30 },
    ],
  }],
};

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
    const stationaryTimeline: RouteTimeline = {
      order: [sampleWarehouse.start.id],
      walkingSpeedMetersPerMinute: 60,
      legs: [],
      totalDistance: 0,
      totalDurationSeconds: 0,
    };
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
