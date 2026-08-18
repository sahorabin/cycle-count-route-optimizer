import { describe, expect, test } from "vitest";
import {
  buildDemoCountServiceProfiles,
  DEMO_COUNT_SERVICE_SECONDS,
  getDemoCountServiceProfile,
} from "./demoCountService";

describe("synthetic demo count service profiles", () => {
  test("assigns stable synthetic classes and durations from location identity", () => {
    expect(getDemoCountServiceProfile("loc-A01")).toEqual({
      locationId: "loc-A01",
      serviceClass: "simple",
      durationSeconds: 20,
      source: "synthetic-demo",
    });
    expect(getDemoCountServiceProfile("loc-A02").durationSeconds).toBe(35);
    expect(getDemoCountServiceProfile("loc-A03").durationSeconds).toBe(60);
    expect(getDemoCountServiceProfile("loc-A01"))
      .toEqual(getDemoCountServiceProfile("loc-A01"));
  });

  test("is independent of route order and never mutates source IDs", () => {
    const ids = ["loc-J10", "loc-A01", "loc-B10"];
    const before = [...ids];
    const forward = buildDemoCountServiceProfiles(ids);
    const reverse = buildDemoCountServiceProfiles([...ids].reverse());

    for (const id of ids) expect(forward.get(id)).toEqual(reverse.get(id));
    expect(ids).toEqual(before);
  });

  test("uses only finite non-negative disclosed constants", () => {
    expect(DEMO_COUNT_SERVICE_SECONDS).toEqual({ simple: 20, standard: 35, complex: 60 });
    expect(Object.values(DEMO_COUNT_SERVICE_SECONDS).every(
      (duration) => Number.isFinite(duration) && duration >= 0,
    )).toBe(true);
  });
});
