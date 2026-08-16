// @vitest-environment jsdom
import { StrictMode, type PropsWithChildren } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { useSimulationPlayback } from "./useSimulationPlayback";

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
    const { result } = renderHook(() => useSimulationPlayback(100));

    expect(result.current.clock).toEqual({ timeSeconds: 0, playbackRate: 1, isPlaying: false });
    expect(frames.pendingCount()).toBe(0);
  });

  test("play advances from frame deltas and pause stops advancement", () => {
    const frames = installAnimationFrameHarness();
    const { result } = renderHook(() => useSimulationPlayback(100));

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
    const { result } = renderHook(() => useSimulationPlayback(100));

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
    const { result } = renderHook(() => useSimulationPlayback(100));

    act(() => {
      result.current.setRate(10);
      result.current.seek(40);
      result.current.play();
    });
    act(() => result.current.reset());

    expect(result.current.clock).toEqual({ timeSeconds: 0, playbackRate: 10, isPlaying: false });
  });

  test("seek moves the shared clock backward and forward deterministically", () => {
    installAnimationFrameHarness();
    const { result } = renderHook(() => useSimulationPlayback(100));

    act(() => result.current.seek(80));
    expect(result.current.clock.timeSeconds).toBe(80);

    act(() => result.current.seek(20));
    expect(result.current.clock.timeSeconds).toBe(20);
  });

  test("10x changes wall-clock progression without changing the supplied physical duration", () => {
    const frames = installAnimationFrameHarness();
    const physicalDuration = 100;
    const { result } = renderHook(() => useSimulationPlayback(physicalDuration));

    act(() => {
      result.current.setRate(10);
      result.current.play();
    });
    frames.run(1_000);
    frames.run(2_000);

    expect(result.current.clock.timeSeconds).toBe(10);
    expect(physicalDuration).toBe(100);
  });

  test("completion clamps and pauses the shared clock", () => {
    const frames = installAnimationFrameHarness();
    const { result } = renderHook(() => useSimulationPlayback(1));

    act(() => result.current.play());
    frames.run(1_000);
    frames.run(3_000);

    expect(result.current.clock).toEqual({ timeSeconds: 1, playbackRate: 1, isPlaying: false });
    expect(frames.pendingCount()).toBe(0);
  });

  test("changing a physical input key resets to zero and pauses while preserving playback rate", () => {
    installAnimationFrameHarness();
    const { result, rerender } = renderHook(
      ({ inputKey }) => useSimulationPlayback(200, inputKey),
      { initialProps: { inputKey: "first" } },
    );

    act(() => {
      result.current.setRate(5);
      result.current.seek(60);
      result.current.play();
    });
    rerender({ inputKey: "second" });

    expect(result.current.clock).toEqual({ timeSeconds: 0, playbackRate: 5, isPlaying: false });
  });

  test("StrictMode effect replay still owns only one animation-frame loop", () => {
    const frames = installAnimationFrameHarness();
    const wrapper = ({ children }: PropsWithChildren) => <StrictMode>{children}</StrictMode>;
    const { result } = renderHook(() => useSimulationPlayback(100), { wrapper });

    act(() => result.current.play());
    expect(frames.pendingCount()).toBe(1);
    frames.run(1_000);
    expect(frames.pendingCount()).toBe(1);
  });
});
