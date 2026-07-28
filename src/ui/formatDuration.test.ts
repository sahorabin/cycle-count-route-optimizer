import { describe, expect, test } from "vitest";
import { splitDuration } from "./formatDuration";

describe("splitDuration", () => {
  test("splits 2.2 minutes into 2 minutes 12 seconds", () => {
    expect(splitDuration(2.2)).toEqual({ minutes: 2, seconds: 12 });
  });

  test("returns zero for zero duration", () => {
    expect(splitDuration(0)).toEqual({ minutes: 0, seconds: 0 });
  });

  test("rounds to the nearest second", () => {
    expect(splitDuration(1 / 60 / 2)).toEqual({ minutes: 0, seconds: 1 }); // 0.5s rounds up to 1s
  });

  test("clamps negative durations to zero rather than throwing", () => {
    expect(splitDuration(-5)).toEqual({ minutes: 0, seconds: 0 });
  });

  test("rolls seconds over into whole minutes", () => {
    expect(splitDuration(1)).toEqual({ minutes: 1, seconds: 0 });
  });
});
