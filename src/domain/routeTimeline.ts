import type {
  RouteTimeline,
  RouteTimelineLeg,
  RouteTimelineSegment,
  RouteTraversal,
} from "./types";
import { calculateWalkingDurationMinutes } from "./walkingDuration";

/** Absolute tolerance for accumulated distance and second-based timeline arithmetic. */
export const ROUTE_TIMELINE_EPSILON = 1e-9;

export class InvalidRouteTimelineError extends Error {
  constructor(message: string) {
    super(`Invalid route timeline: ${message}`);
    this.name = "InvalidRouteTimelineError";
  }
}

function approximatelyEqual(a: number, b: number): boolean {
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= ROUTE_TIMELINE_EPSILON;
}

function durationSeconds(distanceMeters: number, walkingSpeedMetersPerMinute: number): number {
  const seconds = calculateWalkingDurationMinutes(distanceMeters, walkingSpeedMetersPerMinute) * 60;
  if (!Number.isFinite(seconds)) {
    throw new InvalidRouteTimelineError("calculated duration in seconds must be finite");
  }
  return seconds;
}

/**
 * Projects a finished spatial traversal onto a continuous walking-only time
 * axis. It preserves all supplied order, legs, segments, and distances and
 * performs no routing or geometry work.
 */
export function buildRouteTimeline(
  traversal: RouteTraversal,
  walkingSpeedMetersPerMinute: number,
): RouteTimeline {
  // Validate both shared inputs even for a zero-leg traversal.
  const expectedTotalDurationSeconds = durationSeconds(
    traversal.totalDistance,
    walkingSpeedMetersPerMinute,
  );

  if (traversal.legs.length !== Math.max(0, traversal.order.length - 1)) {
    throw new InvalidRouteTimelineError("leg count does not match traversal order");
  }

  const legs: RouteTimelineLeg[] = [];
  let timelineCursor = 0;
  let accumulatedDistance = 0;

  for (let legIndex = 0; legIndex < traversal.legs.length; legIndex++) {
    const leg = traversal.legs[legIndex];
    const expectedFrom = traversal.order[legIndex];
    const expectedTo = traversal.order[legIndex + 1];
    if (leg.from !== expectedFrom || leg.to !== expectedTo) {
      throw new InvalidRouteTimelineError(
        `leg ${legIndex} endpoints do not match traversal order "${expectedFrom}" → "${expectedTo}"`,
      );
    }
    if (leg.segments.length === 0) {
      throw new InvalidRouteTimelineError(`leg "${leg.from}" → "${leg.to}" has no segments`);
    }

    const legStartTimeSeconds = timelineCursor;
    let legDistance = 0;
    let previousNode = leg.from;
    const segments: RouteTimelineSegment[] = [];

    for (const segment of leg.segments) {
      if (segment.from !== previousNode) {
        throw new InvalidRouteTimelineError(
          `segment chain is discontinuous at "${previousNode}" → "${segment.from}"`,
        );
      }

      const startTimeSeconds = timelineCursor;
      const segmentDurationSeconds = durationSeconds(segment.distance, walkingSpeedMetersPerMinute);
      const endTimeSeconds = startTimeSeconds + segmentDurationSeconds;
      segments.push({
        from: segment.from,
        to: segment.to,
        distance: segment.distance,
        startTimeSeconds,
        durationSeconds: segmentDurationSeconds,
        endTimeSeconds,
      });
      timelineCursor = endTimeSeconds;
      legDistance += segment.distance;
      previousNode = segment.to;
    }

    if (previousNode !== leg.to) {
      throw new InvalidRouteTimelineError(
        `segment chain ends at "${previousNode}" instead of leg destination "${leg.to}"`,
      );
    }
    if (!approximatelyEqual(legDistance, leg.distance)) {
      throw new InvalidRouteTimelineError(
        `segment distance ${legDistance} disagrees with leg distance ${leg.distance} for "${leg.from}" → "${leg.to}"`,
      );
    }

    const legEndTimeSeconds = timelineCursor;
    legs.push({
      from: leg.from,
      to: leg.to,
      distance: leg.distance,
      startTimeSeconds: legStartTimeSeconds,
      durationSeconds: legEndTimeSeconds - legStartTimeSeconds,
      endTimeSeconds: legEndTimeSeconds,
      segments,
    });
    accumulatedDistance += leg.distance;
  }

  if (!approximatelyEqual(accumulatedDistance, traversal.totalDistance)) {
    throw new InvalidRouteTimelineError(
      `leg distance ${accumulatedDistance} disagrees with traversal distance ${traversal.totalDistance}`,
    );
  }
  if (!approximatelyEqual(timelineCursor, expectedTotalDurationSeconds)) {
    throw new InvalidRouteTimelineError(
      `timeline duration ${timelineCursor} disagrees with distance-based duration ${expectedTotalDurationSeconds}`,
    );
  }

  return {
    order: [...traversal.order],
    walkingSpeedMetersPerMinute,
    legs,
    totalDistance: traversal.totalDistance,
    totalDurationSeconds: timelineCursor,
  };
}
