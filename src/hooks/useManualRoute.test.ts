// @vitest-environment jsdom
import { describe, expect, test } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useManualRoute } from "./useManualRoute";

describe("useManualRoute", () => {
  test("starts empty", () => {
    const { result } = renderHook(() => useManualRoute());
    expect(result.current.stopIds).toEqual([]);
  });

  test("addStop appends in click order and ignores duplicates", () => {
    const { result } = renderHook(() => useManualRoute());
    act(() => result.current.addStop("loc-A01"));
    act(() => result.current.addStop("loc-B02"));
    act(() => result.current.addStop("loc-A01")); // duplicate, ignored
    expect(result.current.stopIds).toEqual(["loc-A01", "loc-B02"]);
  });

  test("removeStop removes exactly one id, preserving the rest of the order", () => {
    const { result } = renderHook(() => useManualRoute());
    act(() => {
      result.current.addStop("a");
      result.current.addStop("b");
      result.current.addStop("c");
    });
    act(() => result.current.removeStop("b"));
    expect(result.current.stopIds).toEqual(["a", "c"]);
  });

  test("removeStops removes completed destinations while preserving every remaining position", () => {
    const { result } = renderHook(() => useManualRoute(["a", "b", "c", "d"]));
    act(() => result.current.removeStops(new Set(["b"])));
    expect(result.current.stopIds).toEqual(["a", "c", "d"]);
  });

  test("moveUp/moveDown swap adjacent stops and are no-ops at the boundaries", () => {
    const { result } = renderHook(() => useManualRoute());
    act(() => {
      result.current.addStop("a");
      result.current.addStop("b");
      result.current.addStop("c");
    });
    act(() => result.current.moveUp(1));
    expect(result.current.stopIds).toEqual(["b", "a", "c"]);
    act(() => result.current.moveUp(0)); // already first, no-op
    expect(result.current.stopIds).toEqual(["b", "a", "c"]);
    act(() => result.current.moveDown(2)); // already last, no-op
    expect(result.current.stopIds).toEqual(["b", "a", "c"]);
  });

  test("moveStop supports direct drag reorder without changing membership", () => {
    const { result } = renderHook(() => useManualRoute(["a", "b", "c"]));
    act(() => result.current.moveStop(0, 2));
    expect(result.current.stopIds).toEqual(["b", "c", "a"]);
  });

  test("clear empties the route", () => {
    const { result } = renderHook(() => useManualRoute());
    act(() => result.current.addStop("a"));
    act(() => result.current.clear());
    expect(result.current.stopIds).toEqual([]);
  });
});
