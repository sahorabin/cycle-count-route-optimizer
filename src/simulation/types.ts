import type { CountServiceClass, NodeId } from "../domain/types";

/** Renderer-independent cursor within the active positive-duration segment. */
export interface SimulationSegmentCursor {
  readonly kind: "travel";
  readonly legIndex: number;
  readonly segmentIndex: number;
  readonly from: NodeId;
  readonly to: NodeId;
  readonly progress: number;
  readonly distanceTraveledOnSegment: number;
  readonly distanceRemainingOnSegment: number;
}

/** Renderer-independent cursor within active stationary count work. */
export interface SimulationServiceCursor {
  readonly kind: "service";
  readonly legIndex: number;
  readonly locationId: NodeId;
  readonly serviceClass: CountServiceClass | null;
  readonly progress: number;
  readonly elapsedSeconds: number;
  readonly durationSeconds: number;
  readonly remainingSeconds: number;
}

export type SimulationActivityCursor = SimulationSegmentCursor | SimulationServiceCursor;

/** Deterministic projection of a RouteTimeline at one effective simulation time. */
export interface SimulationSnapshot {
  readonly timeSeconds: number;
  readonly isComplete: boolean;
  readonly totalDurationSeconds: number;
  readonly totalDistance: number;
  readonly distanceTraveled: number;
  readonly distanceRemaining: number;
  readonly completedLegCount: number;
  readonly completedDestinationIds: readonly NodeId[];
  readonly current: SimulationActivityCursor | null;
}

/** Pure wall-clock playback control; independent of physical walking speed. */
export interface PlaybackClockState {
  readonly timeSeconds: number;
  readonly playbackRate: number;
  readonly isPlaying: boolean;
}
