import { describe, expect, test, vi } from "vitest";
import { DEFAULT_PERSISTED_STATE, loadPersistedState, savePersistedState } from "./persistedState";

function fakeStorage(initial: Record<string, string> = {}) {
  const store = { ...initial };
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
  };
}

describe("persistedState", () => {
  test("returns defaults when nothing is stored", () => {
    expect(loadPersistedState(fakeStorage())).toEqual(DEFAULT_PERSISTED_STATE);
  });

  test("round-trips a valid state", () => {
    const storage = fakeStorage();
    const state = {
      targetCount: 42,
      completedIds: ["loc-A01"],
      language: "en" as const,
      walkingSpeed: 75,
      selectedIds: ["loc-A01", "loc-B03"],
      manualRouteStopIds: ["loc-A01", "loc-B03"],
      comparisonRequested: true,
    };
    savePersistedState(storage, state);
    expect(loadPersistedState(storage)).toEqual(state);
  });

  test("recovers from unparsable JSON by falling back to defaults", () => {
    const storage = fakeStorage({ "cycle-count-route-optimizer:v1": "{not json" });
    expect(loadPersistedState(storage)).toEqual(DEFAULT_PERSISTED_STATE);
  });

  test("recovers field-by-field from a partially malformed object", () => {
    const storage = fakeStorage({
      "cycle-count-route-optimizer:v1": JSON.stringify({
        targetCount: 500, // out of 1-100 range -> falls back
        completedIds: "not-an-array", // wrong type -> falls back
        language: "fr", // not ko/en -> falls back
        walkingSpeed: 80, // valid -> kept
      }),
    });
    expect(loadPersistedState(storage)).toEqual({
      ...DEFAULT_PERSISTED_STATE,
      walkingSpeed: 80,
    });
  });

  test("selectedIds, manualRouteStopIds, and comparisonRequested default safely when absent (obsolete pre-existing storage)", () => {
    const storage = fakeStorage({
      "cycle-count-route-optimizer:v1": JSON.stringify({
        targetCount: 10,
        completedIds: ["loc-A01"],
        language: "en",
        walkingSpeed: 60,
        // selectedIds / manualRouteStopIds / comparisonRequested intentionally omitted,
        // simulating storage written before these fields existed.
      }),
    });
    const state = loadPersistedState(storage);
    expect(state.selectedIds).toEqual([]);
    expect(state.manualRouteStopIds).toEqual([]);
    expect(state.comparisonRequested).toBe(false);
  });

  test("malformed selectedIds, manualRouteStopIds, and comparisonRequested each fall back to their own default without discarding the rest", () => {
    const storage = fakeStorage({
      "cycle-count-route-optimizer:v1": JSON.stringify({
        targetCount: 10,
        completedIds: ["loc-A01"],
        language: "en",
        walkingSpeed: 60,
        selectedIds: "loc-A01", // wrong type (not an array) -> falls back
        manualRouteStopIds: ["loc-A01", 42], // mixed types -> falls back
        comparisonRequested: "true", // wrong type (string, not boolean) -> falls back
      }),
    });
    expect(loadPersistedState(storage)).toEqual({
      targetCount: 10,
      completedIds: ["loc-A01"],
      language: "en",
      walkingSpeed: 60,
      selectedIds: [],
      manualRouteStopIds: [],
      comparisonRequested: false,
    });
  });

  test("save failures (e.g. quota exceeded) do not throw", () => {
    const storage = { setItem: vi.fn(() => { throw new Error("quota"); }) };
    expect(() => savePersistedState(storage, DEFAULT_PERSISTED_STATE)).not.toThrow();
  });

  test("Korean is the default language only when no valid stored language exists", () => {
    const storage = fakeStorage({
      "cycle-count-route-optimizer:v1": JSON.stringify({ language: "en" }),
    });
    expect(loadPersistedState(storage).language).toBe("en");
    expect(loadPersistedState(fakeStorage()).language).toBe("ko");
  });
});
