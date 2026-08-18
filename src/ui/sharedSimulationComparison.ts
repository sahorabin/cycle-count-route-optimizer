import type { RouteTimeline } from "../domain/types";
import { getSimulationSnapshotAtTime } from "../simulation/simulationSnapshot";
import type { SimulationSnapshot } from "../simulation/types";

export interface SharedComparisonSnapshots {
  worker: SimulationSnapshot;
  recommended: SimulationSnapshot;
}

export function getSharedComparisonDuration(
  workerTimeline: RouteTimeline,
  recommendedTimeline: RouteTimeline,
): number {
  return Math.max(
    workerTimeline.totalDurationSeconds,
    recommendedTimeline.totalDurationSeconds,
  );
}

export function getSharedComparisonSnapshots(
  workerTimeline: RouteTimeline,
  recommendedTimeline: RouteTimeline,
  sharedTimeSeconds: number,
): SharedComparisonSnapshots {
  return {
    worker: getSimulationSnapshotAtTime(workerTimeline, sharedTimeSeconds),
    recommended: getSimulationSnapshotAtTime(recommendedTimeline, sharedTimeSeconds),
  };
}

export interface SharedComparisonSavings {
  readonly walkingSecondsSaved: number;
  readonly operatingSecondsSaved: number;
}

/**
 * Reads the saving straight off the two finished timelines. Like the distance
 * comparison, values are clamped at zero rather than ever shown negative: a
 * recommendation that is not faster is reported as no saving, never a loss.
 */
export function getSharedComparisonSavings(
  workerTimeline: RouteTimeline,
  recommendedTimeline: RouteTimeline,
): SharedComparisonSavings {
  return {
    walkingSecondsSaved: Math.max(
      0,
      workerTimeline.walkingDurationSeconds - recommendedTimeline.walkingDurationSeconds,
    ),
    operatingSecondsSaved: Math.max(
      0,
      workerTimeline.totalDurationSeconds - recommendedTimeline.totalDurationSeconds,
    ),
  };
}
