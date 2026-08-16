import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  advancePlaybackClock,
  createPlaybackClock,
  pausePlaybackClock,
  playPlaybackClock,
  resetPlaybackClock,
  seekPlaybackClock,
  setPlaybackRate,
} from "../simulation/playbackClock";
import type { PlaybackClockState } from "../simulation/types";

export interface SimulationPlaybackController {
  clock: PlaybackClockState;
  play: () => void;
  pause: () => void;
  reset: () => void;
  seek: (timeSeconds: number) => void;
  setRate: (playbackRate: number) => void;
}

export function useSimulationPlayback(
  durationSeconds: number,
  simulationInputKey = "",
): SimulationPlaybackController {
  const [clock, setClock] = useState<PlaybackClockState>(() => createPlaybackClock());
  const previousAnimationTimestamp = useRef<number | null>(null);

  useLayoutEffect(() => {
    previousAnimationTimestamp.current = null;
    setClock((current) => resetPlaybackClock(current));
  }, [durationSeconds, simulationInputKey]);

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
          advancePlaybackClock(current, realDeltaSeconds, durationSeconds),
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
  }, [clock.isPlaying, durationSeconds]);

  const play = useCallback(() => {
    setClock((current) => playPlaybackClock(current, durationSeconds));
  }, [durationSeconds]);

  const pause = useCallback(() => {
    setClock((current) => pausePlaybackClock(current));
  }, []);

  const reset = useCallback(() => {
    setClock((current) => resetPlaybackClock(current));
  }, []);

  const seek = useCallback(
    (timeSeconds: number) => {
      setClock((current) => seekPlaybackClock(current, timeSeconds, durationSeconds));
    },
    [durationSeconds],
  );

  const setRate = useCallback((playbackRate: number) => {
    setClock((current) => setPlaybackRate(current, playbackRate));
  }, []);

  return { clock, play, pause, reset, seek, setRate };
}
