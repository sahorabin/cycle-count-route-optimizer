import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { RouteTimeline } from "../domain/types";
import {
  advancePlaybackClock,
  createPlaybackClock,
  pausePlaybackClock,
  playPlaybackClock,
  resetPlaybackClock,
  seekPlaybackClock,
  setPlaybackRate,
} from "../simulation/playbackClock";
import { getSimulationSnapshotAtTime } from "../simulation/simulationSnapshot";
import type { PlaybackClockState, SimulationSnapshot } from "../simulation/types";

export interface SimulationPlaybackController {
  clock: PlaybackClockState;
  snapshot: SimulationSnapshot;
  play: () => void;
  pause: () => void;
  reset: () => void;
  seek: (timeSeconds: number) => void;
  setRate: (playbackRate: number) => void;
}

export function useSimulationPlayback(
  timeline: RouteTimeline,
  simulationInputKey = "",
): SimulationPlaybackController {
  const [clock, setClock] = useState<PlaybackClockState>(() => createPlaybackClock());
  const previousAnimationTimestamp = useRef<number | null>(null);

  useLayoutEffect(() => {
    previousAnimationTimestamp.current = null;
    setClock((current) => resetPlaybackClock(current));
  }, [simulationInputKey, timeline]);

  useEffect(() => {
    if (!clock.isPlaying) {
      previousAnimationTimestamp.current = null;
      return undefined;
    }

    let frameId = 0;
    let cancelled = false;

    const animate = (timestamp: number) => {
      if (cancelled) return;

      const previousTimestamp = previousAnimationTimestamp.current;
      previousAnimationTimestamp.current = timestamp;

      if (previousTimestamp !== null) {
        const realDeltaSeconds = Math.max(0, (timestamp - previousTimestamp) / 1_000);
        setClock((current) =>
          advancePlaybackClock(current, realDeltaSeconds, timeline.totalDurationSeconds),
        );
      }

      frameId = window.requestAnimationFrame(animate);
    };

    frameId = window.requestAnimationFrame(animate);

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frameId);
      previousAnimationTimestamp.current = null;
    };
  }, [clock.isPlaying, timeline.totalDurationSeconds]);

  const snapshot = useMemo(
    () => getSimulationSnapshotAtTime(timeline, clock.timeSeconds),
    [clock.timeSeconds, timeline],
  );

  const play = useCallback(() => {
    setClock((current) => playPlaybackClock(current, timeline.totalDurationSeconds));
  }, [timeline.totalDurationSeconds]);

  const pause = useCallback(() => {
    setClock((current) => pausePlaybackClock(current));
  }, []);

  const reset = useCallback(() => {
    setClock((current) => resetPlaybackClock(current));
  }, []);

  const seek = useCallback(
    (timeSeconds: number) => {
      setClock((current) => seekPlaybackClock(current, timeSeconds, timeline.totalDurationSeconds));
    },
    [timeline.totalDurationSeconds],
  );

  const setRate = useCallback((playbackRate: number) => {
    setClock((current) => setPlaybackRate(current, playbackRate));
  }, []);

  return { clock, snapshot, play, pause, reset, seek, setRate };
}
