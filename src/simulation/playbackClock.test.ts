import { describe, expect, test } from "vitest";
import {
  advancePlaybackClock,
  createPlaybackClock,
  InvalidPlaybackClockInputError,
  pausePlaybackClock,
  playPlaybackClock,
  resetPlaybackClock,
  seekPlaybackClock,
  setPlaybackRate,
} from "./playbackClock";

describe("playbackClock", () => {
  test("starts paused at zero with a 1x default rate", () => {
    expect(createPlaybackClock()).toEqual({
      timeSeconds: 0,
      playbackRate: 1,
      isPlaying: false,
    });
  });

  test("accepts any finite positive initial playback rate", () => {
    expect(createPlaybackClock(0.5).playbackRate).toBe(0.5);
    expect(createPlaybackClock(10).playbackRate).toBe(10);
  });

  test("play starts before completion and repeated play is safe", () => {
    const playing = playPlaybackClock(createPlaybackClock(), 100);

    expect(playing.isPlaying).toBe(true);
    expect(playPlaybackClock(playing, 100)).toEqual(playing);
  });

  test("play at completion remains stopped and never implicitly restarts", () => {
    const completed = seekPlaybackClock(createPlaybackClock(), 100, 100);

    expect(playPlaybackClock(completed, 100)).toEqual({
      timeSeconds: 100,
      playbackRate: 1,
      isPlaying: false,
    });
  });

  test("pause preserves time and rate and repeated pause is safe", () => {
    const state = { timeSeconds: 25, playbackRate: 5, isPlaying: true };
    const paused = pausePlaybackClock(state);

    expect(paused).toEqual({ timeSeconds: 25, playbackRate: 5, isPlaying: false });
    expect(pausePlaybackClock(paused)).toEqual(paused);
  });

  test("seek moves forward or backward and preserves non-terminal play state", () => {
    const playing = { timeSeconds: 5, playbackRate: 2, isPlaying: true };
    const forward = seekPlaybackClock(playing, 20, 100);
    const backward = seekPlaybackClock(forward, 3, 100);

    expect(forward).toEqual({ timeSeconds: 20, playbackRate: 2, isPlaying: true });
    expect(backward).toEqual({ timeSeconds: 3, playbackRate: 2, isPlaying: true });
    expect(seekPlaybackClock({ ...playing, isPlaying: false }, 20, 100).isPlaying).toBe(false);
  });

  test("seek clamps before zero and beyond the end, pausing at completion", () => {
    const playing = { timeSeconds: 5, playbackRate: 2, isPlaying: true };

    expect(seekPlaybackClock(playing, -20, 100)).toEqual({
      timeSeconds: 0,
      playbackRate: 2,
      isPlaying: true,
    });
    expect(seekPlaybackClock(playing, 150, 100)).toEqual({
      timeSeconds: 100,
      playbackRate: 2,
      isPlaying: false,
    });
  });

  test.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "rejects non-finite seek target %s",
    (target) => {
      expect(() => seekPlaybackClock(createPlaybackClock(), target, 100)).toThrow(
        InvalidPlaybackClockInputError,
      );
    },
  );

  test("reset stops at zero and preserves the selected playback rate", () => {
    const state = { timeSeconds: 80, playbackRate: 10, isPlaying: true };

    expect(resetPlaybackClock(state)).toEqual({
      timeSeconds: 0,
      playbackRate: 10,
      isPlaying: false,
    });
  });

  test("setPlaybackRate changes only the rate at the instant it is applied", () => {
    const state = { timeSeconds: 25, playbackRate: 1, isPlaying: true };

    expect(setPlaybackRate(state, 5)).toEqual({
      timeSeconds: 25,
      playbackRate: 5,
      isPlaying: true,
    });
  });

  test.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "rejects invalid playback rate %s",
    (rate) => {
      expect(() => createPlaybackClock(rate)).toThrow(InvalidPlaybackClockInputError);
      expect(() => setPlaybackRate(createPlaybackClock(), rate)).toThrow(
        InvalidPlaybackClockInputError,
      );
    },
  );

  test("advance while paused preserves simulation time", () => {
    const paused = { timeSeconds: 20, playbackRate: 10, isPlaying: false };

    expect(advancePlaybackClock(paused, 50, 600)).toEqual(paused);
  });

  test.each([
    { rate: 1, realDelta: 5, expected: 5 },
    { rate: 2, realDelta: 5, expected: 10 },
    { rate: 10, realDelta: 5, expected: 50 },
  ])("advances real time at $rate x to $expected simulation seconds", ({ rate, realDelta, expected }) => {
    const playing = playPlaybackClock(createPlaybackClock(rate), 600);

    expect(advancePlaybackClock(playing, realDelta, 600).timeSeconds).toBe(expected);
  });

  test("zero real delta is a deterministic no-op while retaining play state", () => {
    const playing = playPlaybackClock(createPlaybackClock(2), 100);

    expect(advancePlaybackClock(playing, 0, 100)).toEqual(playing);
  });

  test.each([-1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "rejects invalid real elapsed time %s",
    (delta) => {
      expect(() => advancePlaybackClock(createPlaybackClock(), delta, 100)).toThrow(
        InvalidPlaybackClockInputError,
      );
    },
  );

  test("end overshoot clamps exactly to duration and auto-pauses", () => {
    const playing = { timeSeconds: 90, playbackRate: 2, isPlaying: true };

    expect(advancePlaybackClock(playing, 10, 100)).toEqual({
      timeSeconds: 100,
      playbackRate: 2,
      isPlaying: false,
    });
  });

  test.each([-1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "rejects invalid generic playback duration %s",
    (duration) => {
      expect(() => playPlaybackClock(createPlaybackClock(), duration)).toThrow(
        InvalidPlaybackClockInputError,
      );
      expect(() => seekPlaybackClock(createPlaybackClock(), 0, duration)).toThrow(
        InvalidPlaybackClockInputError,
      );
      expect(() => advancePlaybackClock(createPlaybackClock(), 0, duration)).toThrow(
        InvalidPlaybackClockInputError,
      );
    },
  );

  test("10x playback changes wall-clock advancement, not physical duration", () => {
    const timeline = Object.freeze({ totalDurationSeconds: 600, totalDistance: 600 });
    const playing = playPlaybackClock(createPlaybackClock(10), timeline.totalDurationSeconds);

    const completed = advancePlaybackClock(playing, 60, timeline.totalDurationSeconds);

    expect(completed.timeSeconds).toBe(600);
    expect(completed.isPlaying).toBe(false);
    expect(timeline).toEqual({ totalDurationSeconds: 600, totalDistance: 600 });
  });
});
