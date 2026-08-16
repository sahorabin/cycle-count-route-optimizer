import type { PlaybackClockState } from "./types";

export class InvalidPlaybackClockInputError extends Error {
  constructor(message: string) {
    super(`Invalid playback-clock input: ${message}`);
    this.name = "InvalidPlaybackClockInputError";
  }
}

function assertValidPlaybackRate(playbackRate: number): void {
  if (!Number.isFinite(playbackRate) || playbackRate <= 0) {
    throw new InvalidPlaybackClockInputError("playback rate must be finite and greater than zero");
  }
}

function assertValidDuration(durationSeconds: number): void {
  if (!Number.isFinite(durationSeconds) || durationSeconds < 0) {
    throw new InvalidPlaybackClockInputError("duration must be finite and non-negative");
  }
}

export function createPlaybackClock(playbackRate = 1): PlaybackClockState {
  assertValidPlaybackRate(playbackRate);
  return { timeSeconds: 0, playbackRate, isPlaying: false };
}

export function playPlaybackClock(
  state: PlaybackClockState,
  durationSeconds: number,
): PlaybackClockState {
  assertValidDuration(durationSeconds);
  if (state.timeSeconds >= durationSeconds) return { ...state, isPlaying: false };
  return { ...state, isPlaying: true };
}

export function pausePlaybackClock(state: PlaybackClockState): PlaybackClockState {
  return { ...state, isPlaying: false };
}

/** Seek clamps finite control input to [0, duration], unlike direct snapshot lookup. */
export function seekPlaybackClock(
  state: PlaybackClockState,
  targetTimeSeconds: number,
  durationSeconds: number,
): PlaybackClockState {
  assertValidDuration(durationSeconds);
  if (!Number.isFinite(targetTimeSeconds)) {
    throw new InvalidPlaybackClockInputError("seek target must be finite");
  }
  const timeSeconds = Math.min(durationSeconds, Math.max(0, targetTimeSeconds));
  return {
    ...state,
    timeSeconds,
    isPlaying: timeSeconds >= durationSeconds ? false : state.isPlaying,
  };
}

/** Reset stops at zero but preserves the user's selected playback rate. */
export function resetPlaybackClock(state: PlaybackClockState): PlaybackClockState {
  return { timeSeconds: 0, playbackRate: state.playbackRate, isPlaying: false };
}

export function setPlaybackRate(
  state: PlaybackClockState,
  playbackRate: number,
): PlaybackClockState {
  assertValidPlaybackRate(playbackRate);
  return { ...state, playbackRate };
}

export function advancePlaybackClock(
  state: PlaybackClockState,
  realDeltaSeconds: number,
  durationSeconds: number,
): PlaybackClockState {
  assertValidDuration(durationSeconds);
  if (!Number.isFinite(realDeltaSeconds) || realDeltaSeconds < 0) {
    throw new InvalidPlaybackClockInputError("real elapsed time must be finite and non-negative");
  }
  if (!state.isPlaying) return { ...state };

  const nextTime = state.timeSeconds + realDeltaSeconds * state.playbackRate;
  if (nextTime >= durationSeconds) {
    return { ...state, timeSeconds: durationSeconds, isPlaying: false };
  }
  return { ...state, timeSeconds: nextTime };
}
