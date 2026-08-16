// @vitest-environment jsdom
import { describe, expect, test, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import App from "./App";

beforeEach(() => {
  window.localStorage.clear();
});

function selectLocation(label: string) {
  fireEvent.click(screen.getByRole("checkbox", { name: new RegExp(label) }));
}

function clickOnMap(label: string) {
  fireEvent.click(screen.getByRole("button", { name: label }));
}

describe("App (Phase 5 dashboard)", () => {
  test("frames the product purpose and synthetic demo data in both languages", () => {
    render(<App />);
    expect(
      screen.getByText("동일한 창고 조건에서 작업자 계획 경로와 시스템 추천 경로를 비교해 이동 거리와 작업 시간 절감 효과를 확인합니다."),
    ).toBeTruthy();
    expect(screen.getByText("데모 창고 · 합성 운영 데이터")).toBeTruthy();

    fireEvent.click(screen.getByRole("radio", { name: "English" }));
    expect(
      screen.getByText(
        "Compare a worker-planned cycle count route with the system recommendation under identical warehouse conditions to see the potential reduction in walking distance and work time.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Demo warehouse · Synthetic operational data")).toBeTruthy();
  });

  test("defaults to Korean and shows all 100 locations available for selection", () => {
    render(<App />);
    expect(screen.getByText("100개 중 0개 선택됨")).toBeTruthy();
  });

  test("switching to English updates the selector count text", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("radio", { name: "English" }));
    expect(screen.getByText("0 of 100 selected")).toBeTruthy();
  });

  test("shows a step-1 instruction to select locations, not the route-comparison heading, at the initial state", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("radio", { name: "English" }));
    expect(screen.getByText("Select today's count locations")).toBeTruthy();
    expect(screen.queryByText("Route comparison")).toBeNull();
  });

  test("clicking an available (unselected) location on the map does nothing -- only selected locations are clickable", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("radio", { name: "English" }));
    // Not selected yet: no accessible "button" role for this location.
    expect(screen.queryByRole("button", { name: "Zone A - Bin 01" })).toBeNull();
  });

  test("selecting locations, building a route, and generating a comparison shows Worker vs System Recommended", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("radio", { name: "English" }));

    selectLocation("Zone A - Bin 01");
    selectLocation("Zone A - Bin 03");

    clickOnMap("Zone A - Bin 01");
    clickOnMap("Zone A - Bin 03");

    fireEvent.click(screen.getByRole("button", { name: "Generate recommended route" }));

    expect(screen.getAllByText("Worker route").length).toBeGreaterThan(0);
    expect(screen.getAllByText("System recommended route").length).toBeGreaterThan(0);
    expect(document.querySelector(".comparison-hero__summary")).not.toBeNull();

    // Two adjacent stops have only one possible visit order, so the
    // recommended route can never beat the worker's -- this is the
    // zero-savings correctness case: no "saved"/improvement claim allowed.
    expect(document.querySelector(".comparison-hero__summary")!.textContent).toBe(
      "Both routes cover the same distance",
    );
    expect(document.querySelector(".comparison-hero__summary")!.textContent).not.toMatch(/saved/);
    expect(
      screen.getByRole("heading", { name: "Worker vs recommended route replay" }),
    ).toBeTruthy();
    expect(document.querySelectorAll(".route-simulation-comparison svg")).toHaveLength(2);
  });

  test("moves focus and scrolls to a valid generated result without autoplay", () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });

    render(<App />);
    fireEvent.click(screen.getByRole("radio", { name: "English" }));
    selectLocation("Zone A - Bin 01");
    selectLocation("Zone A - Bin 02");
    clickOnMap("Zone A - Bin 01");
    clickOnMap("Zone A - Bin 02");
    fireEvent.click(screen.getByRole("button", { name: "Generate recommended route" }));

    const result = document.querySelector(".comparison-hero") as HTMLElement;
    expect(result.getAttribute("tabindex")).toBe("-1");
    expect(document.activeElement).toBe(result);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "start" });
    expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();

    Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
  });

  test("keeps invalid generation disabled and does not move focus", () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    render(<App />);
    fireEvent.click(screen.getByRole("radio", { name: "English" }));

    const generate = screen.getByRole("button", { name: "Generate recommended route" });
    expect((generate as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(generate);
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(document.querySelector(".comparison-hero__summary")).toBeNull();

    Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
  });

  test("walking-speed and selected-location changes reset replay while preserving rate", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("radio", { name: "English" }));
    selectLocation("Zone A - Bin 01");
    selectLocation("Zone B - Bin 03");
    clickOnMap("Zone A - Bin 01");
    clickOnMap("Zone B - Bin 03");
    fireEvent.click(screen.getByRole("button", { name: "Generate recommended route" }));

    const seek = screen.getByLabelText("Replay position") as HTMLInputElement;
    const originalDuration = Number(seek.max);
    fireEvent.click(screen.getByRole("button", { name: "10×" }));
    fireEvent.change(seek, { target: { value: originalDuration / 2 } });
    fireEvent.change(screen.getByLabelText("Walking speed (metres/minute)"), {
      target: { value: "30" },
    });

    expect(seek.value).toBe("0");
    expect(Number(seek.max)).toBeCloseTo(originalDuration * 2);
    expect(screen.getByRole("button", { name: "10×" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();

    fireEvent.change(seek, { target: { value: Number(seek.max) / 2 } });
    selectLocation("Zone C - Bin 05");
    expect(seek.value).toBe("0");
    expect(screen.getByRole("button", { name: "10×" }).getAttribute("aria-pressed")).toBe("true");
  });

  test("editing the route after generating a comparison hides it again until re-generated", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("radio", { name: "English" }));

    selectLocation("Zone A - Bin 01");
    selectLocation("Zone A - Bin 02");
    clickOnMap("Zone A - Bin 01");
    clickOnMap("Zone A - Bin 02");
    fireEvent.click(screen.getByRole("button", { name: "Generate recommended route" }));
    expect(screen.getAllByText("Worker route").length).toBeGreaterThan(0);

    fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[0]);

    // Back below 2 stops -- step 2's "build the visit order" instruction, not
    // the comparison hero at all, and definitely not stale comparison output.
    expect(screen.getByText("Build the worker visit order")).toBeTruthy();
    expect(document.querySelector(".comparison-hero__summary")).toBeNull();
  });

  test("deselecting a location that is already in the route removes it from the route too", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("radio", { name: "English" }));

    selectLocation("Zone A - Bin 01");
    clickOnMap("Zone A - Bin 01");
    expect(document.querySelector('[data-location-id="loc-A01"]')!.getAttribute("data-state")).toBe(
      "route",
    );

    selectLocation("Zone A - Bin 01"); // uncheck
    expect(document.querySelector('[data-location-id="loc-A01"]')!.getAttribute("data-state")).toBe(
      "available",
    );
  });

  test("the system recommended route always covers the exact same targets as the manual route", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("radio", { name: "English" }));

    selectLocation("Zone A - Bin 01");
    selectLocation("Zone C - Bin 05");
    selectLocation("Zone B - Bin 09");
    clickOnMap("Zone A - Bin 01");
    clickOnMap("Zone C - Bin 05");
    clickOnMap("Zone B - Bin 09");

    const technicalSummary = screen.getByText("Technical details (Nearest Neighbor vs Optimized Heuristic)");
    fireEvent.click(technicalSummary);
    const stopLists = document.querySelectorAll(".route-summary__stops");
    expect(stopLists.length).toBe(2);
    for (const list of stopLists) {
      expect(list.textContent).toContain("Zone A - Bin 01");
      expect(list.textContent).toContain("Zone C - Bin 05");
      expect(list.textContent).toContain("Zone B - Bin 09");
    }
  });

  test("shows a workflow step indicator that advances as the worker progresses", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("radio", { name: "English" }));

    const steps = () => screen.getAllByRole("listitem").filter((el) => el.className.includes("workflow-steps__item"));
    expect(steps()[0].getAttribute("aria-current")).toBe("step");

    selectLocation("Zone A - Bin 01");
    expect(steps()[1].getAttribute("aria-current")).toBe("step");

    selectLocation("Zone A - Bin 02");
    clickOnMap("Zone A - Bin 01");
    clickOnMap("Zone A - Bin 02");
    expect(steps()[2].getAttribute("aria-current")).toBe("step");
  });

  test("today's progress panel is present and starts at the default target", () => {
    render(<App />);
    expect(screen.getByText("오늘의 진행 상황")).toBeTruthy();
  });

  test("marking a selected location complete updates the map marker state", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("radio", { name: "English" }));
    selectLocation("Zone A - Bin 01");
    fireEvent.click(screen.getByRole("button", { name: "Mark selected complete" }));

    expect(
      document.querySelector('[data-location-id="loc-A01"]')!.getAttribute("data-state"),
    ).toBe("completed");
  });

  test("persists language choice across remounts via localStorage", () => {
    const { unmount } = render(<App />);
    fireEvent.click(screen.getByRole("radio", { name: "English" }));
    unmount();
    render(<App />);
    expect(screen.getByText("0 of 100 selected")).toBeTruthy();
  });

  test("ignores a completed-location id from localStorage that no longer exists in the fixture", () => {
    window.localStorage.setItem(
      "cycle-count-route-optimizer:v1",
      JSON.stringify({
        targetCount: 10,
        completedIds: ["loc-Z99", "loc-A01"],
        language: "en",
        walkingSpeed: 60,
      }),
    );
    render(<App />);
    expect(
      document.querySelector('[data-location-id="loc-A01"]')!.getAttribute("data-state"),
    ).toBe("completed");
    const progressPanel = screen.getByText("Today's progress").closest("section")!;
    expect(progressPanel.querySelector(".progress-panel__stats dd")!.textContent).toBe("1");
  });

  test("persists selected locations, the worker route order, and a generated comparison across remounts via localStorage", () => {
    const { unmount } = render(<App />);
    fireEvent.click(screen.getByRole("radio", { name: "English" }));

    selectLocation("Zone A - Bin 01");
    selectLocation("Zone B - Bin 03");
    clickOnMap("Zone A - Bin 01");
    clickOnMap("Zone B - Bin 03");
    fireEvent.click(screen.getByRole("button", { name: "Generate recommended route" }));
    expect(screen.getAllByText("Worker route").length).toBeGreaterThan(0);

    unmount();
    render(<App />);

    // Selection survived the reload.
    expect(screen.getByText("2 of 100 selected")).toBeTruthy();

    // Worker route (order, not just membership) survived: both stops still
    // show as "route" state, and the manual route editor lists them in the
    // original visit order.
    expect(document.querySelector('[data-location-id="loc-A01"]')!.getAttribute("data-state")).toBe(
      "route",
    );
    expect(document.querySelector('[data-location-id="loc-B03"]')!.getAttribute("data-state")).toBe(
      "route",
    );
    // First label is the fixed "Office" start; the two restored stops
    // follow in their original visit order (A01 before B03).
    const stopLabels = document.querySelectorAll(".manual-route-editor__label");
    expect(Array.from(stopLabels).map((el) => el.textContent)).toEqual([
      "Office (fixed start)",
      "Zone A - Bin 01",
      "Zone B - Bin 03",
    ]);

    // The previously generated comparison is still shown, not silently
    // dropped back to the pre-generation step.
    expect(screen.getAllByText("Worker route").length).toBeGreaterThan(0);
    expect(screen.getAllByText("System recommended route").length).toBeGreaterThan(0);
    expect(document.querySelector(".comparison-hero__summary")).not.toBeNull();
  });

  test("a restored comparison is still invalidated by a real post-reload route edit", () => {
    const { unmount } = render(<App />);
    fireEvent.click(screen.getByRole("radio", { name: "English" }));
    selectLocation("Zone A - Bin 01");
    selectLocation("Zone B - Bin 03");
    clickOnMap("Zone A - Bin 01");
    clickOnMap("Zone B - Bin 03");
    fireEvent.click(screen.getByRole("button", { name: "Generate recommended route" }));

    unmount();
    render(<App />);
    expect(document.querySelector(".comparison-hero__summary")).not.toBeNull();

    fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[0]);
    expect(document.querySelector(".comparison-hero__summary")).toBeNull();
  });

  test("drops a selected-location id from localStorage that no longer exists in the fixture, and any manual-route stop that depended on it", () => {
    window.localStorage.setItem(
      "cycle-count-route-optimizer:v1",
      JSON.stringify({
        targetCount: 10,
        completedIds: [],
        language: "en",
        walkingSpeed: 60,
        selectedIds: ["loc-Z99", "loc-A01"],
        manualRouteStopIds: ["loc-Z99", "loc-A01"],
        comparisonRequested: true,
      }),
    );
    render(<App />);
    expect(screen.getByText("1 of 100 selected")).toBeTruthy();
    expect(document.querySelector('[data-location-id="loc-A01"]')!.getAttribute("data-state")).toBe(
      "route",
    );
  });

  test("drops a manual-route stop id from localStorage that is not part of the restored selection, instead of silently routing through an unselected location", () => {
    window.localStorage.setItem(
      "cycle-count-route-optimizer:v1",
      JSON.stringify({
        targetCount: 10,
        completedIds: [],
        language: "en",
        walkingSpeed: 60,
        selectedIds: ["loc-A01"],
        manualRouteStopIds: ["loc-A01", "loc-B03"], // loc-B03 was never (re-)selected
        comparisonRequested: false,
      }),
    );
    render(<App />);
    expect(document.querySelector('[data-location-id="loc-A01"]')!.getAttribute("data-state")).toBe(
      "route",
    );
    expect(document.querySelector('[data-location-id="loc-B03"]')!.getAttribute("data-state")).toBe(
      "available",
    );
  });
});
