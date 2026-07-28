export interface DurationParts {
  minutes: number;
  seconds: number;
}

/** Splits a fractional-minute duration into whole minutes + seconds, rounded to the nearest second. */
export function splitDuration(totalMinutes: number): DurationParts {
  const totalSeconds = Math.round(Math.max(0, totalMinutes) * 60);
  return {
    minutes: Math.floor(totalSeconds / 60),
    seconds: totalSeconds % 60,
  };
}
