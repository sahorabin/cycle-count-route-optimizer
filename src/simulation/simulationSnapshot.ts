import type { RouteTimeline } from "../domain/types";
import type { SimulationActivityCursor, SimulationSnapshot } from "./types";

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
 * mutating incremental state. Positive-duration phases use [start, end);
 * zero-duration travel/service is completed at its boundary and never current.
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
  const completedDestinationIds = timeline.phases.flatMap((phase) => (
    phase.kind === "service" && atOrAfter(effectiveTime, phase.endTimeSeconds)
      ? [phase.locationId]
      : []
  ));

  let current: SimulationActivityCursor | null = null;
  let distanceTraveled = 0;

  for (const phase of timeline.phases) {
    const isZeroDuration = phase.durationSeconds <= SIMULATION_TIME_EPSILON;
    const phaseComplete = atOrAfter(effectiveTime, phase.endTimeSeconds);

    if (phase.kind === "travel") {
      if (isComplete || phaseComplete) {
        distanceTraveled += phase.distance;
        continue;
      }

      const hasStarted = atOrAfter(effectiveTime, phase.startTimeSeconds);
      if (!isZeroDuration && hasStarted && current === null) {
        const progress = clampUnitInterval(
          (effectiveTime - phase.startTimeSeconds) / phase.durationSeconds,
        );
        const distanceTraveledOnSegment = phase.distance * progress;
        current = {
          kind: "travel",
          legIndex: phase.legIndex,
          segmentIndex: phase.segmentIndex,
          from: phase.from,
          to: phase.to,
          progress,
          distanceTraveledOnSegment,
          distanceRemainingOnSegment: Math.max(0, phase.distance - distanceTraveledOnSegment),
        };
        distanceTraveled += distanceTraveledOnSegment;
      }
      continue;
    }

    const hasStarted = atOrAfter(effectiveTime, phase.startTimeSeconds);
    if (!isComplete && !isZeroDuration && !phaseComplete && hasStarted && current === null) {
      const elapsedSeconds = Math.min(
        phase.durationSeconds,
        Math.max(0, effectiveTime - phase.startTimeSeconds),
      );
      current = {
        kind: "service",
        legIndex: phase.legIndex,
        locationId: phase.locationId,
        serviceClass: phase.serviceClass,
        progress: clampUnitInterval(elapsedSeconds / phase.durationSeconds),
        elapsedSeconds,
        durationSeconds: phase.durationSeconds,
        remainingSeconds: Math.max(0, phase.durationSeconds - elapsedSeconds),
      };
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
