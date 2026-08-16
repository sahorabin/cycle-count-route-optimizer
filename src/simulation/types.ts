import type { NodeId } from "../domain/types";

/** Renderer-independent cursor within the active positive-duration segment. */
export interface SimulationSegmentCursor {
  readonly legIndex: number;
  readonly segmentIndex: number;
  readonly from: NodeId;
  readonly to: NodeId;
  readonly progress: number;
  readonly distanceTraveledOnSegment: number;
  readonly distanceRemainingOnSegment: number;
}

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
  readonly current: SimulationSegmentCursor | null;
}

/** Pure wall-clock playback control; independent of physical walking speed. */
export interface PlaybackClockState {
  readonly timeSeconds: number;
  readonly playbackRate: number;
  readonly isPlaying: boolean;
}
