import { describe, expect, test } from "vitest";
import { buildDemoCountServiceProfiles } from "../data/demoCountService";
import { sampleWarehouse } from "../data/sampleWarehouse";
import { buildValidatedDistanceMatrix } from "../domain/distanceMatrix";
import { buildRouteTimeline } from "../domain/routeTimeline";
import { buildRouteTraversal } from "../domain/routeTraversal";
import type { NodeId, RouteTimelineServicePhase, WarehouseGraph } from "../domain/types";
import { getSimulationSnapshotAtTime } from "../simulation/simulationSnapshot";
import { buildCoordinateLookup } from "./svgPoints";
import { createWarehouse3DTransform } from "./warehouse3dProjection";
import {
  COUNTING_GESTURE_HZ,
  createWarehouseActiveServiceVisual,
  createWarehouseCountingGesture,
  createWarehouseServiceCompletionVisual,
  createWarehouseServiceProgressRing,
  getWarehouseLocationVisualState,
  getWarehouseWorkerCountingGesture,
  SERVICE_COMPLETION_PULSE_SECONDS,
  SERVICE_PROGRESS_SEGMENTS,
} from "./warehouse3dServiceVisual";

const targetIds: NodeId[] = ["loc-A", "loc-B", "loc-C", "loc-D"];
const routeGraph: WarehouseGraph = {
  ...sampleWarehouse,
  locations: sampleWarehouse.locations.filter((location) => targetIds.includes(location.id)),
};
const matrix = buildValidatedDistanceMatrix(routeGraph);
const order: NodeId[] = ["office", ...targetIds];
const indexById = new Map(matrix.visitIds.map((id, index) => [id, index]));
const totalDistance = order.slice(0, -1).reduce((total, from, index) => (
  total + matrix.distanceMatrix[indexById.get(from)!][indexById.get(order[index + 1])!]
), 0);
const timeline = buildRouteTimeline(
  buildRouteTraversal(routeGraph, { order, totalDistance }, matrix),
  60,
  buildDemoCountServiceProfiles(targetIds),
);
const transform = createWarehouse3DTransform(sampleWarehouse);
const coordinates = buildCoordinateLookup(sampleWarehouse);
const routeIds = new Set(order.slice(1));

const servicePhases = timeline.phases.filter(
  (phase): phase is RouteTimelineServicePhase => phase.kind === "service",
);
const firstService = servicePhases[0];

function snapshotAt(timeSeconds: number) {
  return getSimulationSnapshotAtTime(timeline, timeSeconds);
}

describe("counting gesture", () => {
  test("is a pure bounded function of service elapsed time", () => {
    const gesture = createWarehouseCountingGesture(7.5);

    expect(createWarehouseCountingGesture(7.5)).toEqual(gesture);
    expect(gesture.cycle).toBeCloseTo((7.5 * COUNTING_GESTURE_HZ) % 1);
    expect(gesture.scanReach).toBeGreaterThanOrEqual(0);
    expect(gesture.scanReach).toBeLessThanOrEqual(1);
    expect(Math.abs(gesture.torsoTwist)).toBeLessThanOrEqual(0.08);
    expect(Object.values(gesture).every(Number.isFinite)).toBe(true);
  });

  test("advances with elapsed service time and repeats each cycle", () => {
    const start = createWarehouseCountingGesture(0);
    const quarter = createWarehouseCountingGesture(0.25 / COUNTING_GESTURE_HZ);
    const nextCycle = createWarehouseCountingGesture(1 / COUNTING_GESTURE_HZ);

    expect(quarter.scanReach).toBeGreaterThan(start.scanReach);
    expect(quarter.armLift).toBeGreaterThan(start.armLift);
    expect(nextCycle.cycle).toBeCloseTo(start.cycle);
    expect(nextCycle.armLift).toBeCloseTo(start.armLift);
  });

  test("produces bounded output for invalid or negative elapsed time", () => {
    for (const elapsed of [Number.NaN, Number.POSITIVE_INFINITY, -4]) {
      const gesture = createWarehouseCountingGesture(elapsed);
      expect(Object.values(gesture).every(Number.isFinite)).toBe(true);
      expect(gesture).toEqual(createWarehouseCountingGesture(0));
    }
  });

  test("is present only while the shared snapshot says this route is counting", () => {
    const travelling = snapshotAt(1);
    const counting = snapshotAt(firstService.startTimeSeconds + firstService.durationSeconds / 2);
    const complete = snapshotAt(timeline.totalDurationSeconds);

    expect(travelling.current?.kind).toBe("travel");
    expect(getWarehouseWorkerCountingGesture(travelling)).toBeNull();
    expect(getWarehouseWorkerCountingGesture(complete)).toBeNull();
    expect(getWarehouseWorkerCountingGesture(counting)).toEqual(
      createWarehouseCountingGesture(firstService.durationSeconds / 2),
    );
  });
});

describe("service progress ring", () => {
  test("quantizes existing snapshot progress into segments", () => {
    expect(createWarehouseServiceProgressRing(0).filledSegments).toBe(0);
    expect(createWarehouseServiceProgressRing(0.5).filledSegments).toBe(
      SERVICE_PROGRESS_SEGMENTS / 2,
    );
    expect(createWarehouseServiceProgressRing(0.99).filledSegments).toBe(
      SERVICE_PROGRESS_SEGMENTS - 1,
    );
    expect(createWarehouseServiceProgressRing(1).filledSegments).toBe(SERVICE_PROGRESS_SEGMENTS);
  });

  test("always describes a full ring with in-order finite angles", () => {
    const ring = createWarehouseServiceProgressRing(0.5);

    expect(ring.segments).toHaveLength(SERVICE_PROGRESS_SEGMENTS);
    expect(ring.segments.map(({ index }) => index)).toEqual(
      ring.segments.map((_segment, index) => index),
    );
    expect(ring.segments.every(({ startAngleRadians }) => Number.isFinite(startAngleRadians)))
      .toBe(true);
    expect(ring.segments.filter(({ filled }) => filled)).toHaveLength(ring.filledSegments);
    expect(ring.segmentAngleRadians * ring.totalSegments).toBeCloseTo(Math.PI * 2);
  });

  test("clamps out-of-range or invalid progress instead of emitting NaN geometry", () => {
    expect(createWarehouseServiceProgressRing(-1).filledSegments).toBe(0);
    expect(createWarehouseServiceProgressRing(4).filledSegments).toBe(SERVICE_PROGRESS_SEGMENTS);
    expect(createWarehouseServiceProgressRing(Number.NaN).filledSegments).toBe(0);
  });
});

describe("active service visual", () => {
  test("exists only during service and reuses snapshot service truth verbatim", () => {
    const midpoint = firstService.startTimeSeconds + firstService.durationSeconds / 2;
    const snapshot = snapshotAt(midpoint);
    if (snapshot.current?.kind !== "service") throw new Error("Expected a service cursor");
    const visual = createWarehouseActiveServiceVisual(snapshot, transform, coordinates);

    expect(createWarehouseActiveServiceVisual(snapshotAt(1), transform, coordinates)).toBeNull();
    expect(visual?.locationId).toBe(snapshot.current.locationId);
    expect(visual?.serviceClass).toBe(snapshot.current.serviceClass);
    expect(visual?.progress).toBe(snapshot.current.progress);
    expect(visual?.elapsedSeconds).toBe(snapshot.current.elapsedSeconds);
    expect(visual?.durationSeconds).toBe(snapshot.current.durationSeconds);
    expect(visual?.remainingSeconds).toBe(snapshot.current.remainingSeconds);
    expect(visual?.ring.filledSegments).toBe(SERVICE_PROGRESS_SEGMENTS / 2);
    expect(visual?.pulse).toBeGreaterThanOrEqual(0);
    expect(visual?.pulse).toBeLessThanOrEqual(1);
  });

  test("projects the active location once into finite world space", () => {
    const snapshot = snapshotAt(firstService.startTimeSeconds + 1);
    const visual = createWarehouseActiveServiceVisual(snapshot, transform, coordinates);

    expect(visual?.position.y).toBe(0);
    expect([visual?.position.x, visual?.position.z].every(Number.isFinite)).toBe(true);
    expect(createWarehouseActiveServiceVisual(snapshot, transform, coordinates)).toEqual(visual);
  });

  test("fails safe when the active location has no display coordinate", () => {
    const snapshot = snapshotAt(firstService.startTimeSeconds + 1);
    expect(createWarehouseActiveServiceVisual(snapshot, transform, new Map())).toBeNull();
  });

  test("tracks 0%, mid, and near-complete service without recomputing progress", () => {
    const start = snapshotAt(firstService.startTimeSeconds);
    const half = snapshotAt(firstService.startTimeSeconds + firstService.durationSeconds / 2);
    const nearEnd = snapshotAt(firstService.endTimeSeconds - 0.01);

    expect(createWarehouseActiveServiceVisual(start, transform, coordinates)?.ring.filledSegments)
      .toBe(0);
    expect(createWarehouseActiveServiceVisual(half, transform, coordinates)?.ring.filledSegments)
      .toBe(SERVICE_PROGRESS_SEGMENTS / 2);
    expect(createWarehouseActiveServiceVisual(nearEnd, transform, coordinates)?.ring.filledSegments)
      .toBe(SERVICE_PROGRESS_SEGMENTS - 1);
  });
});

describe("location visual hierarchy", () => {
  test("separates active, pending, completed, and off-route locations", () => {
    const midpoint = firstService.startTimeSeconds + firstService.durationSeconds / 2;
    const snapshot = snapshotAt(midpoint);
    const activeId = firstService.locationId;
    const pendingId = servicePhases[1].locationId;

    expect(getWarehouseLocationVisualState(activeId, snapshot, routeIds)).toBe("active");
    expect(getWarehouseLocationVisualState(pendingId, snapshot, routeIds)).toBe("pending");
    expect(getWarehouseLocationVisualState("loc-unrelated", snapshot, routeIds)).toBe("idle");
  });

  test("marks a location completed only after its service phase ends", () => {
    const midpoint = snapshotAt(
      firstService.startTimeSeconds + firstService.durationSeconds / 2,
    );
    const ended = snapshotAt(firstService.endTimeSeconds);
    const activeId = firstService.locationId;

    // Arrival and mid-count are ACTIVE, never COMPLETED.
    expect(midpoint.completedDestinationIds).not.toContain(activeId);
    expect(getWarehouseLocationVisualState(activeId, midpoint, routeIds)).toBe("active");
    expect(getWarehouseLocationVisualState(activeId, snapshotAt(firstService.startTimeSeconds), routeIds))
      .toBe("active");

    // Service end is the only thing that flips it.
    expect(ended.completedDestinationIds).toContain(activeId);
    expect(getWarehouseLocationVisualState(activeId, ended, routeIds)).toBe("completed");
  });

  test("keeps every serviced location completed once the route finishes", () => {
    const done = snapshotAt(timeline.totalDurationSeconds);

    for (const phase of servicePhases) {
      expect(getWarehouseLocationVisualState(phase.locationId, done, routeIds)).toBe("completed");
    }
  });
});

describe("service completion pulse", () => {
  test("appears only inside the visual window after a service phase ends", () => {
    const during = createWarehouseServiceCompletionVisual(
      timeline,
      snapshotAt(firstService.endTimeSeconds - 0.01),
      transform,
      coordinates,
    );
    const justAfter = createWarehouseServiceCompletionVisual(
      timeline,
      snapshotAt(firstService.endTimeSeconds + 0.01),
      transform,
      coordinates,
    );
    const wellAfter = createWarehouseServiceCompletionVisual(
      timeline,
      snapshotAt(firstService.endTimeSeconds + SERVICE_COMPLETION_PULSE_SECONDS + 0.5),
      transform,
      coordinates,
    );

    expect(during).toBeNull();
    expect(justAfter?.locationId).toBe(firstService.locationId);
    expect(justAfter?.intensity).toBeGreaterThan(0.9);
    expect(wellAfter).toBeNull();
  });

  test("fades deterministically and never lingers on a finished route", () => {
    const early = createWarehouseServiceCompletionVisual(
      timeline,
      snapshotAt(firstService.endTimeSeconds + 0.2),
      transform,
      coordinates,
    );
    const late = createWarehouseServiceCompletionVisual(
      timeline,
      snapshotAt(firstService.endTimeSeconds + SERVICE_COMPLETION_PULSE_SECONDS - 0.05),
      transform,
      coordinates,
    );

    expect(early!.intensity).toBeGreaterThan(late!.intensity);
    expect(late!.intensity).toBeGreaterThan(0);
    expect(createWarehouseServiceCompletionVisual(
      timeline,
      snapshotAt(timeline.totalDurationSeconds),
      transform,
      coordinates,
    )).toBeNull();
  });

  test("adds no physical time to the timeline it reads", () => {
    const before = JSON.stringify(timeline);
    createWarehouseServiceCompletionVisual(
      timeline,
      snapshotAt(firstService.endTimeSeconds + 0.1),
      transform,
      coordinates,
    );

    expect(JSON.stringify(timeline)).toBe(before);
    expect(timeline.totalDurationSeconds).toBe(
      timeline.walkingDurationSeconds + timeline.serviceDurationSeconds,
    );
  });
});
