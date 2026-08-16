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
