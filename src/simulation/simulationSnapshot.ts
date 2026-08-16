import type { RouteTimeline } from "../domain/types";
import type { SimulationSegmentCursor, SimulationSnapshot } from "./types";

/** Absolute time tolerance used only to absorb floating-point boundary noise. */
export const SIMULATION_TIME_EPSILON = 1e-9;

export class InvalidSimulationTimeError extends Error {
  constructor(message: string) {
    super(`Invalid simulation time: ${message}`);
    this.name = "InvalidSimulationTimeError";
  }
}

function atOrAfter(timeSeconds: number, boundarySeconds: number): boolean {
  return timeSeconds >= boundarySeconds - SIMULATION_TIME_EPSILON;
}

function clampUnitInterval(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Returns the complete simulation truth at one time without retaining or
 * mutating incremental state. Positive-duration segments use [start, end);
 * zero-duration segments are completed at their boundary and never current.
 */
export function getSimulationSnapshotAtTime(
  timeline: RouteTimeline,
  requestedTimeSeconds: number,
): SimulationSnapshot {
  if (!Number.isFinite(requestedTimeSeconds) || requestedTimeSeconds < 0) {
    throw new InvalidSimulationTimeError("requested time must be finite and non-negative");
  }

  const effectiveTime = Math.min(requestedTimeSeconds, timeline.totalDurationSeconds);
  const isComplete = atOrAfter(effectiveTime, timeline.totalDurationSeconds);
  const completedDestinationIds = timeline.legs
    .filter((leg) => atOrAfter(effectiveTime, leg.endTimeSeconds))
    .map((leg) => leg.to);

  let current: SimulationSegmentCursor | null = null;
  let distanceTraveled = 0;

  for (let legIndex = 0; legIndex < timeline.legs.length; legIndex++) {
    const leg = timeline.legs[legIndex];
    for (let segmentIndex = 0; segmentIndex < leg.segments.length; segmentIndex++) {
      const segment = leg.segments[segmentIndex];
      const isZeroDuration = segment.durationSeconds <= SIMULATION_TIME_EPSILON;
      const segmentComplete = atOrAfter(effectiveTime, segment.endTimeSeconds);

      if (isComplete || segmentComplete) {
        distanceTraveled += segment.distance;
        continue;
      }

      const hasStarted = atOrAfter(effectiveTime, segment.startTimeSeconds);
      if (!isZeroDuration && hasStarted && current === null) {
        const progress = clampUnitInterval(
          (effectiveTime - segment.startTimeSeconds) / segment.durationSeconds,
        );
        const distanceTraveledOnSegment = segment.distance * progress;
        current = {
          legIndex,
          segmentIndex,
          from: segment.from,
          to: segment.to,
          progress,
          distanceTraveledOnSegment,
          distanceRemainingOnSegment: Math.max(0, segment.distance - distanceTraveledOnSegment),
        };
        distanceTraveled += distanceTraveledOnSegment;
      }
    }
  }

  if (isComplete) distanceTraveled = timeline.totalDistance;
  distanceTraveled = Math.min(timeline.totalDistance, Math.max(0, distanceTraveled));
  const distanceRemaining = Math.max(0, timeline.totalDistance - distanceTraveled);

  return {
    timeSeconds: effectiveTime,
    isComplete,
    totalDurationSeconds: timeline.totalDurationSeconds,
    totalDistance: timeline.totalDistance,
    distanceTraveled,
    distanceRemaining,
    completedLegCount: completedDestinationIds.length,
    completedDestinationIds,
    current: isComplete ? null : current,
  };
}
