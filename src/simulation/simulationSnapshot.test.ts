import { describe, expect, test } from "vitest";
import type { RouteTimeline } from "../domain/types";
import {
  getSimulationSnapshotAtTime,
  InvalidSimulationTimeError,
  SIMULATION_TIME_EPSILON,
} from "./simulationSnapshot";

const standardTimeline: RouteTimeline = {
  order: ["office", "A", "B"],
  walkingSpeedMetersPerMinute: 60,
  legs: [
    {
      from: "office",
      to: "A",
      distance: 30,
      startTimeSeconds: 0,
      durationSeconds: 30,
      endTimeSeconds: 30,
      segments: [
        {
          from: "office",
          to: "N1",
          distance: 10,
          startTimeSeconds: 0,
          durationSeconds: 10,
          endTimeSeconds: 10,
        },
        {
          from: "N1",
          to: "A",
          distance: 20,
          startTimeSeconds: 10,
          durationSeconds: 20,
          endTimeSeconds: 30,
        },
      ],
    },
    {
      from: "A",
      to: "B",
      distance: 20,
      startTimeSeconds: 30,
      durationSeconds: 20,
      endTimeSeconds: 50,
      segments: [
        {
          from: "A",
          to: "N2",
          distance: 0,
          startTimeSeconds: 30,
          durationSeconds: 0,
          endTimeSeconds: 30,
        },
        {
          from: "N2",
          to: "B",
          distance: 20,
          startTimeSeconds: 30,
          durationSeconds: 20,
          endTimeSeconds: 50,
        },
      ],
    },
  ],
  totalDistance: 50,
  totalDurationSeconds: 50,
};

function oneSegmentTimeline(durationSeconds: number): RouteTimeline {
  return {
    order: ["office", "target"],
    walkingSpeedMetersPerMinute: 60,
    legs: [
      {
        from: "office",
        to: "target",
        distance: durationSeconds,
        startTimeSeconds: 0,
        durationSeconds,
        endTimeSeconds: durationSeconds,
        segments: [
          {
            from: "office",
            to: "target",
            distance: durationSeconds,
            startTimeSeconds: 0,
            durationSeconds,
            endTimeSeconds: durationSeconds,
          },
        ],
      },
    ],
    totalDistance: durationSeconds,
    totalDurationSeconds: durationSeconds,
  };
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
    expect(snapshot.current?.segmentIndex).toBe(1);
    expect(snapshot.current?.from).toBe("N1");
    expect(snapshot.current?.progress).toBe(0);
  });

  test("completes the previous destination and enters the next leg at an exact leg boundary", () => {
    const snapshot = getSimulationSnapshotAtTime(standardTimeline, 30);

    expect(snapshot.completedDestinationIds).toEqual(["A"]);
    expect(snapshot.completedLegCount).toBe(1);
    expect(snapshot.current?.legIndex).toBe(1);
    expect(snapshot.current?.segmentIndex).toBe(1);
    expect(snapshot.current?.from).toBe("N2");
    expect(snapshot.current?.progress).toBe(0);
  });

  test("never exposes a zero-duration segment as current", () => {
    const beforeBoundary = getSimulationSnapshotAtTime(standardTimeline, 29);
    const atBoundary = getSimulationSnapshotAtTime(standardTimeline, 30);

    expect(beforeBoundary.current?.from).not.toBe("A");
    expect(atBoundary.current?.from).toBe("N2");
    expect(atBoundary.current?.to).toBe("B");
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
    const timeline: RouteTimeline = {
      order: ["office", "A", "B"],
      walkingSpeedMetersPerMinute: 60,
      legs: [
        {
          from: "office",
          to: "A",
          distance: 0,
          startTimeSeconds: 0,
          durationSeconds: 0,
          endTimeSeconds: 0,
          segments: [
            {
              from: "office",
              to: "A",
              distance: 0,
              startTimeSeconds: 0,
              durationSeconds: 0,
              endTimeSeconds: 0,
            },
          ],
        },
        {
          from: "A",
          to: "B",
          distance: 10,
          startTimeSeconds: 0,
          durationSeconds: 10,
          endTimeSeconds: 10,
          segments: [
            {
              from: "A",
              to: "B",
              distance: 10,
              startTimeSeconds: 0,
              durationSeconds: 10,
              endTimeSeconds: 10,
            },
          ],
        },
      ],
      totalDistance: 10,
      totalDurationSeconds: 10,
    };

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

    expect(snapshot.current?.segmentIndex).toBe(1);
    expect(snapshot.current?.progress).toBe(0);
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
