import { describe, expect, test } from "vitest";
import {
  calculateWalkingDurationMinutes,
  InvalidWalkingDurationInputError,
} from "./walkingDuration";

describe("calculateWalkingDurationMinutes", () => {
  test("uses the existing distance-metres divided by speed-metres-per-minute rule", () => {
    expect(calculateWalkingDurationMinutes(120, 60)).toBe(2);
    expect(calculateWalkingDurationMinutes(15, 60)).toBe(0.25);
  });

  test("supports zero distance without inventing a minimum duration", () => {
    expect(calculateWalkingDurationMinutes(0, 60)).toBe(0);
  });

  test.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "rejects invalid walking speed %s",
    (speed) => {
      expect(() => calculateWalkingDurationMinutes(10, speed)).toThrow(
        InvalidWalkingDurationInputError,
      );
    },
  );

  test.each([-1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "rejects invalid distance %s",
    (distance) => {
      expect(() => calculateWalkingDurationMinutes(distance, 60)).toThrow(
        InvalidWalkingDurationInputError,
      );
    },
  );

  test("rejects finite inputs whose quotient overflows to infinity", () => {
    expect(() => calculateWalkingDurationMinutes(Number.MAX_VALUE, Number.MIN_VALUE)).toThrow(
      "calculated duration must be finite",
    );
  });
});
