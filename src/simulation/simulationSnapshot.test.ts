import { describe, expect, test } from "vitest";
import { buildRouteTimeline } from "../domain/routeTimeline";
import type { CountServiceProfile, NodeId, RouteTraversal } from "../domain/types";
import {
  getSimulationSnapshotAtTime,
  InvalidSimulationTimeError,
  SIMULATION_TIME_EPSILON,
} from "./simulationSnapshot";

const standardTraversal: RouteTraversal = {
  order: ["office", "A", "B"],
  legs: [
    {
      from: "office",
      to: "A",
      path: ["office", "N1", "A"],
      distance: 30,
      segments: [
        { from: "office", to: "N1", distance: 10 },
        { from: "N1", to: "A", distance: 20 },
      ],
    },
    {
      from: "A",
      to: "B",
      path: ["A", "N2", "B"],
      distance: 20,
      segments: [
        { from: "A", to: "N2", distance: 0 },
        { from: "N2", to: "B", distance: 20 },
      ],
    },
  ],
  totalDistance: 50,
};
const standardTimeline = buildRouteTimeline(standardTraversal, 60);

function serviceProfiles(
  entries: Array<[NodeId, number]>,
): ReadonlyMap<NodeId, CountServiceProfile> {
  return new Map(entries.map(([locationId, durationSeconds]) => [locationId, {
    locationId,
    serviceClass: "standard" as const,
    durationSeconds,
    source: "synthetic-demo" as const,
  }]));
}

function oneSegmentTimeline(durationSeconds: number, serviceDurationSeconds = 0) {
  return buildRouteTimeline({
    order: ["office", "target"],
    legs: [
      {
        from: "office",
        to: "target",
        path: ["office", "target"],
        distance: durationSeconds,
        segments: [{ from: "office", to: "target", distance: durationSeconds }],
      },
    ],
    totalDistance: durationSeconds,
  }, 60, serviceProfiles([["target", serviceDurationSeconds]]));
}

describe("getSimulationSnapshotAtTime", () => {
  test("projects the positive-duration start state at time zero", () => {
    const snapshot = getSimulationSnapshotAtTime(standardTimeline, 0);

    expect(snapshot.timeSeconds).toBe(0);
    expect(snapshot.isComplete).toBe(false);
    expect(snapshot.distanceTraveled).toBe(0);
    expect(snapshot.distanceRemaining).toBe(50);
    expect(snapshot.completedDestinationIds).toEqual([]);
    expect(snapshot.current).toEqual({
      kind: "travel",
      legIndex: 0,
      segmentIndex: 0,
      from: "office",
      to: "N1",
      progress: 0,
      distanceTraveledOnSegment: 0,
      distanceRemainingOnSegment: 10,
    });
  });

  test("derives active indices, progress, and partial distance at mid-segment", () => {
    const snapshot = getSimulationSnapshotAtTime(standardTimeline, 25);

    expect(snapshot.current).toEqual({
      kind: "travel",
      legIndex: 0,
      segmentIndex: 1,
      from: "N1",
      to: "A",
      progress: 0.75,
      distanceTraveledOnSegment: 15,
      distanceRemainingOnSegment: 5,
    });
    expect(snapshot.distanceTraveled).toBe(25);
    expect(snapshot.distanceRemaining).toBe(25);
    expect(snapshot.completedLegCount).toBe(0);
  });

  test("uses right-open intervals at an exact segment boundary", () => {
    const snapshot = getSimulationSnapshotAtTime(standardTimeline, 10);

    expect(snapshot.distanceTraveled).toBe(10);
    expect(snapshot.current).toMatchObject({
      kind: "travel",
      segmentIndex: 1,
      from: "N1",
      progress: 0,
    });
  });

  test("completes the previous destination and enters the next leg at an exact leg boundary", () => {
    const snapshot = getSimulationSnapshotAtTime(standardTimeline, 30);

    expect(snapshot.completedDestinationIds).toEqual(["A"]);
    expect(snapshot.completedLegCount).toBe(1);
    expect(snapshot.current).toMatchObject({
      kind: "travel",
      legIndex: 1,
      segmentIndex: 1,
      from: "N2",
      progress: 0,
    });
  });

  test("never exposes a zero-duration segment as current", () => {
    const beforeBoundary = getSimulationSnapshotAtTime(standardTimeline, 29);
    const atBoundary = getSimulationSnapshotAtTime(standardTimeline, 30);

    expect(beforeBoundary.current).toMatchObject({ kind: "travel", to: "A" });
    expect(atBoundary.current).toMatchObject({ kind: "travel", from: "N2", to: "B" });
  });

  test("returns a complete snapshot at the exact timeline end", () => {
    const snapshot = getSimulationSnapshotAtTime(standardTimeline, 50);

    expect(snapshot.isComplete).toBe(true);
    expect(snapshot.current).toBeNull();
    expect(snapshot.completedDestinationIds).toEqual(["A", "B"]);
    expect(snapshot.completedLegCount).toBe(2);
    expect(snapshot.distanceTraveled).toBe(50);
    expect(snapshot.distanceRemaining).toBe(0);
  });

  test("clamps positive overshoot to timeline completion", () => {
    const snapshot = getSimulationSnapshotAtTime(standardTimeline, 500);

    expect(snapshot.timeSeconds).toBe(50);
    expect(snapshot.isComplete).toBe(true);
    expect(snapshot.current).toBeNull();
  });

  test("completes a zero-duration leg immediately and starts the next positive leg", () => {
    const timeline = buildRouteTimeline({
      order: ["office", "A", "B"],
      legs: [
        {
          from: "office",
          to: "A",
          path: ["office", "A"],
          distance: 0,
          segments: [{ from: "office", to: "A", distance: 0 }],
        },
        {
          from: "A",
          to: "B",
          path: ["A", "B"],
          distance: 10,
          segments: [{ from: "A", to: "B", distance: 10 }],
        },
      ],
      totalDistance: 10,
    }, 60);

    const snapshot = getSimulationSnapshotAtTime(timeline, 0);

    expect(snapshot.completedDestinationIds).toEqual(["A"]);
    expect(snapshot.current?.legIndex).toBe(1);
    expect(snapshot.current?.progress).toBe(0);
  });

  test("treats an entirely zero-duration route as complete at time zero", () => {
    const timeline = oneSegmentTimeline(0);
    const snapshot = getSimulationSnapshotAtTime(timeline, 0);

    expect(snapshot.isComplete).toBe(true);
    expect(snapshot.current).toBeNull();
    expect(snapshot.completedDestinationIds).toEqual(["target"]);
    expect(snapshot.distanceTraveled).toBe(0);
    expect(snapshot.distanceRemaining).toBe(0);
  });

  test("holds the worker at an incomplete destination through service midpoint", () => {
    const timeline = buildRouteTimeline(
      standardTraversal,
      60,
      serviceProfiles([["A", 20], ["B", 40]]),
    );
    const arrival = getSimulationSnapshotAtTime(timeline, 30);
    const midpoint = getSimulationSnapshotAtTime(timeline, 40);
    const nearEnd = getSimulationSnapshotAtTime(timeline, 49);

    expect(arrival.current).toEqual({
      kind: "service",
      legIndex: 0,
      locationId: "A",
      serviceClass: "standard",
      progress: 0,
      elapsedSeconds: 0,
      durationSeconds: 20,
      remainingSeconds: 20,
    });
    expect(midpoint.current).toMatchObject({
      kind: "service",
      locationId: "A",
      progress: 0.5,
      elapsedSeconds: 10,
      remainingSeconds: 10,
    });
    expect(midpoint.completedDestinationIds).toEqual([]);
    expect(midpoint.distanceTraveled).toBe(30);
    expect(midpoint.distanceRemaining).toBe(20);
    expect(nearEnd.distanceTraveled).toBe(midpoint.distanceTraveled);
  });

  test("completes service at its exact end and starts the next travel immediately", () => {
    const timeline = buildRouteTimeline(
      standardTraversal,
      60,
      serviceProfiles([["A", 20], ["B", 40]]),
    );
    const snapshot = getSimulationSnapshotAtTime(timeline, 50);

    expect(snapshot.completedDestinationIds).toEqual(["A"]);
    expect(snapshot.current).toMatchObject({
      kind: "travel",
      legIndex: 1,
      segmentIndex: 1,
      from: "N2",
      to: "B",
      progress: 0,
    });
  });

  test("includes final service in completion and never exposes zero service as active", () => {
    const serviced = oneSegmentTimeline(10, 20);
    expect(getSimulationSnapshotAtTime(serviced, 10).current).toMatchObject({
      kind: "service",
      locationId: "target",
    });
    expect(getSimulationSnapshotAtTime(serviced, 29).isComplete).toBe(false);
    expect(getSimulationSnapshotAtTime(serviced, 30)).toMatchObject({
      isComplete: true,
      current: null,
      completedDestinationIds: ["target"],
    });

    const zeroService = oneSegmentTimeline(10, 0);
    expect(getSimulationSnapshotAtTime(zeroService, 10)).toMatchObject({
      isComplete: true,
      current: null,
      completedDestinationIds: ["target"],
    });
  });

  test.each([-1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "rejects invalid direct snapshot time %s",
    (timeSeconds) => {
      expect(() => getSimulationSnapshotAtTime(standardTimeline, timeSeconds)).toThrow(
        InvalidSimulationTimeError,
      );
    },
  );

  test("absorbs only floating-point noise at a segment boundary", () => {
    const snapshot = getSimulationSnapshotAtTime(
      standardTimeline,
      10 - SIMULATION_TIME_EPSILON / 2,
    );

    expect(snapshot.current).toMatchObject({ kind: "travel", segmentIndex: 1, progress: 0 });
  });

  test("is deterministic and never mutates the timeline", () => {
    const original = structuredClone(standardTimeline);

    const first = getSimulationSnapshotAtTime(standardTimeline, 37.5);
    getSimulationSnapshotAtTime(standardTimeline, 4);
    const second = getSimulationSnapshotAtTime(standardTimeline, 37.5);

    expect(second).toEqual(first);
    expect(standardTimeline).toEqual(original);
  });

  test("supports one shared time while a shorter timeline remains complete", () => {
    const longSnapshot = getSimulationSnapshotAtTime(oneSegmentTimeline(100), 80);
    const shortSnapshot = getSimulationSnapshotAtTime(oneSegmentTimeline(60), 80);

    expect(longSnapshot.isComplete).toBe(false);
    expect(longSnapshot.timeSeconds).toBe(80);
    expect(longSnapshot.current?.progress).toBe(0.8);
    expect(shortSnapshot.isComplete).toBe(true);
    expect(shortSnapshot.timeSeconds).toBe(60);
    expect(shortSnapshot.current).toBeNull();
  });
});
