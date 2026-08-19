import { describe, expect, test } from "vitest";
import { sampleWarehouse } from "../data/sampleWarehouse";
import { buildRouteTimeline } from "../domain/routeTimeline";
import { getSimulationSnapshotAtTime } from "./simulationSnapshot";
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

describe("playback rate is replay speed, not walking speed", () => {
  const timeline = buildRouteTimeline({
    order: [sampleWarehouse.start.id, "loc-D"],
    totalDistance: 30,
    legs: [{
      from: sampleWarehouse.start.id,
      to: "loc-D",
      path: [sampleWarehouse.start.id, "F1", "F2", "loc-D"],
      distance: 30,
      segments: [
        { from: sampleWarehouse.start.id, to: "F1", distance: 10 },
        { from: "F1", to: "F2", distance: 12 },
        { from: "F2", to: "loc-D", distance: 8 },
      ],
    }],
  }, 60);

  const RATES = [0.5, 1, 2, 5, 10];
  /** One second of wall clock, the same for every rate. */
  const WALL_CLOCK_SECONDS = 1;

  const afterOneSecond = (rate: number) => advancePlaybackClock(
    { timeSeconds: 0, playbackRate: rate, isPlaying: true },
    WALL_CLOCK_SECONDS,
    timeline.totalDurationSeconds,
  );

  test("advances simulation time in proportion to the rate", () => {
    for (const rate of RATES) {
      expect({ rate, advanced: afterOneSecond(rate).timeSeconds })
        .toEqual({ rate, advanced: WALL_CLOCK_SECONDS * rate });
    }
    // Twice the rate really is twice the progress, not a re-scaled route.
    expect(afterOneSecond(10).timeSeconds / afterOneSecond(1).timeSeconds).toBe(10);
    expect(afterOneSecond(0.5).timeSeconds / afterOneSecond(1).timeSeconds).toBe(0.5);
  });

  test("advances travelled distance in proportion to the rate", () => {
    const travelled = RATES.map((rate) =>
      getSimulationSnapshotAtTime(timeline, afterOneSecond(rate).timeSeconds).distanceTraveled);

    // Strictly increasing with rate, because more simulated time has elapsed.
    for (let i = 1; i < travelled.length; i += 1) {
      expect({ rate: RATES[i], more: travelled[i] > travelled[i - 1] })
        .toEqual({ rate: RATES[i], more: true });
    }
    // The worker still walks at one physical speed: distance tracks simulated
    // time exactly, whatever wall-clock rate produced that time.
    const speedMetersPerSecond = 60 / 60;
    for (const [index, rate] of RATES.entries()) {
      expect(travelled[index]).toBeCloseTo(WALL_CLOCK_SECONDS * rate * speedMetersPerSecond, 9);
    }
  });

  test("never changes the route's own totals, whatever the rate", () => {
    for (const rate of RATES) {
      const clock = afterOneSecond(rate);
      const snapshot = getSimulationSnapshotAtTime(timeline, clock.timeSeconds);

      // The two figures a viewer reads as "the route": identical at every rate.
      expect({ rate, total: snapshot.totalDistance }).toEqual({ rate, total: 30 });
      expect({ rate, duration: timeline.totalDurationSeconds })
        .toEqual({ rate, duration: timeline.totalDurationSeconds });
      expect(snapshot.distanceTraveled + snapshot.distanceRemaining).toBeCloseTo(30, 9);
    }
    // Physical walking duration is a property of the route, not of playback.
    expect(timeline.walkingDurationSeconds).toBe(30);
  });

  test("lands on the same state whichever rate got it there", () => {
    // Ten seconds of simulation reached at 1x and at 10x is the same moment.
    const slow = advancePlaybackClock(
      { timeSeconds: 0, playbackRate: 1, isPlaying: true }, 10, timeline.totalDurationSeconds);
    const fast = advancePlaybackClock(
      { timeSeconds: 0, playbackRate: 10, isPlaying: true }, 1, timeline.totalDurationSeconds);

    expect(fast.timeSeconds).toBeCloseTo(slow.timeSeconds, 9);
    expect(getSimulationSnapshotAtTime(timeline, fast.timeSeconds))
      .toEqual(getSimulationSnapshotAtTime(timeline, slow.timeSeconds));
  });

  test("changing rate mid-replay never rewrites what already happened", () => {
    const playing = advancePlaybackClock(
      { timeSeconds: 0, playbackRate: 1, isPlaying: true }, 4, timeline.totalDurationSeconds);
    const sped = setPlaybackRate(playing, 10);

    expect(sped.timeSeconds).toBe(playing.timeSeconds);
    expect(getSimulationSnapshotAtTime(timeline, sped.timeSeconds).distanceTraveled)
      .toBe(getSimulationSnapshotAtTime(timeline, playing.timeSeconds).distanceTraveled);
  });
});
