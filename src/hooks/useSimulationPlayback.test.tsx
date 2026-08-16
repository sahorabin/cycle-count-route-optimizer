// @vitest-environment jsdom
import { StrictMode, type PropsWithChildren } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { RouteTimeline } from "../domain/types";
import { useSimulationPlayback } from "./useSimulationPlayback";

function timeline(totalDistance = 100, totalDurationSeconds = 100): RouteTimeline {
  return {
    order: ["start", "destination"],
    walkingSpeedMetersPerMinute: (totalDistance / totalDurationSeconds) * 60,
    totalDistance,
    totalDurationSeconds,
    legs: [
      {
        from: "start",
        to: "destination",
        distance: totalDistance,
        startTimeSeconds: 0,
        durationSeconds: totalDurationSeconds,
        endTimeSeconds: totalDurationSeconds,
        segments: [
          {
            from: "start",
            to: "destination",
            distance: totalDistance,
            startTimeSeconds: 0,
            durationSeconds: totalDurationSeconds,
            endTimeSeconds: totalDurationSeconds,
          },
        ],
      },
    ],
  };
}

function installAnimationFrameHarness() {
  let nextId = 1;
  const callbacks = new Map<number, FrameRequestCallback>();
  vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
    const id = nextId++;
    callbacks.set(id, callback);
    return id;
  }));
  vi.stubGlobal("cancelAnimationFrame", vi.fn((id: number) => callbacks.delete(id)));

  return {
    run(timestamp: number) {
      const entry = callbacks.entries().next().value as [number, FrameRequestCallback] | undefined;
      if (!entry) throw new Error("No animation frame is scheduled");
      callbacks.delete(entry[0]);
      act(() => entry[1](timestamp));
    },
    pendingCount: () => callbacks.size,
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useSimulationPlayback", () => {
  test("starts paused at time zero without scheduling a frame", () => {
    const frames = installAnimationFrameHarness();
    const stableTimeline = timeline();
    const { result } = renderHook(() => useSimulationPlayback(stableTimeline));

    expect(result.current.clock).toEqual({ timeSeconds: 0, playbackRate: 1, isPlaying: false });
    expect(result.current.snapshot.timeSeconds).toBe(0);
    expect(frames.pendingCount()).toBe(0);
  });

  test("play advances from frame deltas and pause stops advancement", () => {
    const frames = installAnimationFrameHarness();
    const stableTimeline = timeline();
    const { result } = renderHook(() => useSimulationPlayback(stableTimeline));

    act(() => result.current.play());
    frames.run(1_000);
    frames.run(2_500);
    expect(result.current.clock.timeSeconds).toBe(1.5);

    act(() => result.current.pause());
    expect(result.current.clock.isPlaying).toBe(false);
    expect(frames.pendingCount()).toBe(0);
  });

  test("resume discards paused wall-clock time instead of applying a giant delta", () => {
    const frames = installAnimationFrameHarness();
    const stableTimeline = timeline();
    const { result } = renderHook(() => useSimulationPlayback(stableTimeline));

    act(() => result.current.play());
    frames.run(1_000);
    frames.run(2_000);
    act(() => result.current.pause());
    expect(result.current.clock.timeSeconds).toBe(1);

    act(() => result.current.play());
    frames.run(100_000);
    expect(result.current.clock.timeSeconds).toBe(1);
    frames.run(101_000);
    expect(result.current.clock.timeSeconds).toBe(2);
  });

  test("reset pauses at zero and preserves the selected playback rate", () => {
    installAnimationFrameHarness();
    const stableTimeline = timeline();
    const { result } = renderHook(() => useSimulationPlayback(stableTimeline));

    act(() => {
      result.current.setRate(10);
      result.current.seek(40);
      result.current.play();
    });
    act(() => result.current.reset());

    expect(result.current.clock).toEqual({ timeSeconds: 0, playbackRate: 10, isPlaying: false });
  });

  test("seek derives backward and forward snapshots from the requested clock time", () => {
    installAnimationFrameHarness();
    const stableTimeline = timeline();
    const { result } = renderHook(() => useSimulationPlayback(stableTimeline));

    act(() => result.current.seek(80));
    expect(result.current.snapshot.current?.progress).toBe(0.8);
    expect(result.current.snapshot.distanceTraveled).toBe(80);

    act(() => result.current.seek(20));
    expect(result.current.snapshot.current?.progress).toBe(0.2);
    expect(result.current.snapshot.distanceTraveled).toBe(20);
  });

  test("10x changes wall-clock progression without changing physical timeline totals", () => {
    const frames = installAnimationFrameHarness();
    const stableTimeline = timeline(100, 100);
    const { result } = renderHook(() => useSimulationPlayback(stableTimeline));

    act(() => {
      result.current.setRate(10);
      result.current.play();
    });
    frames.run(1_000);
    frames.run(2_000);

    expect(result.current.clock.timeSeconds).toBe(10);
    expect(result.current.snapshot.totalDurationSeconds).toBe(100);
    expect(result.current.snapshot.totalDistance).toBe(100);
  });

  test("completion clamps, pauses, and leaves the deterministic snapshot complete", () => {
    const frames = installAnimationFrameHarness();
    const stableTimeline = timeline(1, 1);
    const { result } = renderHook(() => useSimulationPlayback(stableTimeline));

    act(() => result.current.play());
    frames.run(1_000);
    frames.run(3_000);

    expect(result.current.clock).toEqual({ timeSeconds: 1, playbackRate: 1, isPlaying: false });
    expect(result.current.snapshot.isComplete).toBe(true);
    expect(result.current.snapshot.current).toBeNull();
    expect(frames.pendingCount()).toBe(0);
  });

  test("changing the timeline resets to zero and pauses while preserving playback rate", () => {
    installAnimationFrameHarness();
    const first = timeline(100, 100);
    const second = timeline(200, 200);
    const { result, rerender } = renderHook(
      ({ activeTimeline }) => useSimulationPlayback(activeTimeline),
      { initialProps: { activeTimeline: first } },
    );

    act(() => {
      result.current.setRate(5);
      result.current.seek(60);
      result.current.play();
    });
    rerender({ activeTimeline: second });

    expect(result.current.clock).toEqual({ timeSeconds: 0, playbackRate: 5, isPlaying: false });
    expect(result.current.snapshot.totalDurationSeconds).toBe(200);
  });

  test("StrictMode effect replay still owns only one animation-frame loop", () => {
    const frames = installAnimationFrameHarness();
    const stableTimeline = timeline();
    const wrapper = ({ children }: PropsWithChildren) => <StrictMode>{children}</StrictMode>;
    const { result } = renderHook(() => useSimulationPlayback(stableTimeline), { wrapper });

    act(() => result.current.play());
    expect(frames.pendingCount()).toBe(1);
    frames.run(1_000);
    expect(frames.pendingCount()).toBe(1);
  });
});
