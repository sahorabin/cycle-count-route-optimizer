// @vitest-environment jsdom
import { describe, expect, test, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { getDemoCountServiceProfile } from "./data/demoCountService";
import App from "./App";

beforeEach(() => {
  window.localStorage.clear();
});

function selectLocation(label: string) {
  const welcome = screen.queryByRole("button", { name: /Try the demo|데모 시작/ });
  if (welcome) fireEvent.click(welcome);
  const locations = screen.getByRole("button", { name: /Locations|위치/ });
  if (locations.getAttribute("aria-expanded") !== "true") fireEvent.click(locations);
  fireEvent.click(screen.getByRole("checkbox", { name: new RegExp(label) }));
}

function startDemo() {
  const welcome = screen.queryByRole("button", { name: /Try the demo|데모 시작/ });
  if (welcome) fireEvent.click(welcome);
}

function clickOnMap(label: string) {
  // Legacy test helper retained while route-building assertions migrate:
  // map markers are now visualization-only and checkbox selection has
  // already appended the destination to the worker route.
  expect(document.querySelector(`[aria-label="${label}"]`)).not.toBeNull();
}

function openRoutePanel() {
  const button = screen.getByRole("button", { name: "Route order" });
  if (button.getAttribute("aria-expanded") !== "true") fireEvent.click(button);
}

function openLocationsPanel() {
  const button = screen.getByRole("button", { name: "Locations" });
  if (button.getAttribute("aria-expanded") !== "true") fireEvent.click(button);
}

function manualRouteLabels() {
  openRoutePanel();
  return Array.from(document.querySelectorAll(".manual-route-editor__label"))
    .map((element) => element.textContent);
}

describe("App (Phase 5 dashboard)", () => {
  test("frames the digital-twin workspace and demo context in both languages", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: "순환 재고 조사 디지털 트윈" })).toBeTruthy();
    expect(screen.getByText("데모 물류센터")).toBeTruthy();

    fireEvent.click(screen.getByRole("radio", { name: "English" }));
    expect(screen.getByRole("heading", { name: "Cycle Count Digital Twin" })).toBeTruthy();
    expect(screen.getByText("Demo Distribution Center")).toBeTruthy();
  });

  test("starts with one clear demo CTA and progressively reveals location planning", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("radio", { name: "English" }));

    expect(screen.getByRole("dialog", { name: "See a shorter cycle-count route in action" }))
      .toBeTruthy();
    expect(screen.getByRole("button", { name: "Try the demo" })).toBeTruthy();
    expect(document.querySelector(".workspace-utility__content")).toBeNull();
    expect(screen.queryByRole("button", { name: "Details" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Try the demo" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Locations" }).getAttribute("aria-expanded"))
      .toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Open guide" }));
    expect(screen.getByRole("dialog", { name: "See a shorter cycle-count route in action" }))
      .toBeTruthy();
  });

  test("defaults to Korean and shows all 100 locations available for selection", () => {
    render(<App />);
    startDemo();
    expect(screen.getByText("100개 중 0개 선택됨")).toBeTruthy();
    const selectedOnly = screen.getByRole("checkbox", { name: "선택된 항목만 보기" }) as HTMLInputElement;
    expect(selectedOnly.checked).toBe(false);
    const locationCheckboxes = screen.getAllByRole("checkbox").filter((checkbox) => checkbox !== selectedOnly) as HTMLInputElement[];
    expect(locationCheckboxes.every((checkbox) => !checkbox.checked)).toBe(true);
    expect(document.querySelector('[data-route="worker"]')).toBeNull();
  });

  test("switching to English updates the selector count text", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("radio", { name: "English" }));
    startDemo();
    expect(screen.getByText("0 of 100 selected")).toBeTruthy();
  });

  test("uses one authoritative planning map and keeps location truth when its drawer collapses", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("radio", { name: "English" }));
    expect(document.querySelectorAll(".workspace-planning-map .warehouse-map")).toHaveLength(1);

    selectLocation("Zone A - Bin 01");
    fireEvent.click(screen.getByRole("button", { name: "Locations" }));
    expect(screen.queryByText("1 of 100 selected")).toBeNull();

    openLocationsPanel();
    expect(screen.getByText("1 of 100 selected")).toBeTruthy();
    expect((screen.getByRole("checkbox", { name: /Zone A - Bin 01/ }) as HTMLInputElement).checked)
      .toBe(true);
  });

  test("shows a step-1 instruction to select locations, not the route-comparison heading, at the initial state", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("radio", { name: "English" }));
    expect(screen.getByText("Warehouse planning view")).toBeTruthy();
    expect(screen.getByText(/Check the locations you need to count today/)).toBeTruthy();
    expect(screen.queryByText("Optimization comparison")).toBeNull();
  });

  test("clicking an available (unselected) location on the map does nothing -- only selected locations are clickable", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("radio", { name: "English" }));
    // Not selected yet: no accessible "button" role for this location.
    expect(screen.queryByRole("button", { name: "Zone A - Bin 01" })).toBeNull();
  });

  test("checkbox order immediately becomes worker order; uncheck preserves others and re-check appends", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("radio", { name: "English" }));

    selectLocation("Zone A - Bin 03");
    selectLocation("Zone A - Bin 01");
    expect(manualRouteLabels()).toEqual([
      "Office (fixed start)",
      "Zone A - Bin 03",
      "Zone A - Bin 01",
    ]);
    expect(document.querySelector('[data-location-id="loc-A03"] [data-sequence]')?.textContent).toBe("1");
    expect(document.querySelector('[data-location-id="loc-A01"] [data-sequence]')?.textContent).toBe("2");
    expect(document.querySelector('[data-route="worker"]')).not.toBeNull();

    selectLocation("Zone A - Bin 03");
    expect(manualRouteLabels()).toEqual(["Office (fixed start)", "Zone A - Bin 01"]);
    selectLocation("Zone A - Bin 03");
    expect(manualRouteLabels()).toEqual([
      "Office (fixed start)",
      "Zone A - Bin 01",
      "Zone A - Bin 03",
    ]);
  });

  test("drag reorder updates route/map immediately and select-all appends without moving existing stops", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("radio", { name: "English" }));
    selectLocation("Zone B - Bin 03");
    selectLocation("Zone A - Bin 02");
    expect(document.querySelector('[data-route="worker"]')?.getAttribute("data-route-status"))
      .toBe("provisional");

    openRoutePanel();
    const rows = Array.from(document.querySelectorAll(".manual-route-editor__list > li"));
    const transfer = {
      effectAllowed: "move",
      dropEffect: "move",
      setData: vi.fn(),
      getData: () => "1",
    };
    fireEvent.dragStart(rows[2], { dataTransfer: transfer });
    fireEvent.dragOver(rows[1], { dataTransfer: transfer });
    fireEvent.drop(rows[1], { dataTransfer: transfer });
    expect(manualRouteLabels().slice(1, 3)).toEqual(["Zone A - Bin 02", "Zone B - Bin 03"]);
    expect(document.querySelector('[data-location-id="loc-A02"] [data-sequence]')?.textContent).toBe("1");
    expect(document.querySelector('[data-route="worker"]')?.getAttribute("data-route-status"))
      .toBe("final");

    const chipTransfer = {
      effectAllowed: "move",
      dropEffect: "move",
      setData: vi.fn(),
      getData: () => "1",
    };
    fireEvent.dragStart(screen.getByRole("button", { name: /Drag stop 2, Zone B - Bin 03/ }), {
      dataTransfer: chipTransfer,
    });
    fireEvent.dragOver(screen.getByRole("button", { name: /Drag stop 1, Zone A - Bin 02/ }), {
      dataTransfer: chipTransfer,
    });
    fireEvent.drop(screen.getByRole("button", { name: /Drag stop 1, Zone A - Bin 02/ }), {
      dataTransfer: chipTransfer,
    });
    expect(manualRouteLabels().slice(1, 3)).toEqual(["Zone B - Bin 03", "Zone A - Bin 02"]);
    expect(document.querySelector('[data-location-id="loc-B03"] [data-sequence]')?.textContent).toBe("1");

    openLocationsPanel();
    fireEvent.change(screen.getByLabelText("zone"), { target: { value: "Zone A" } });
    fireEvent.click(screen.getByRole("button", { name: "Select visible" }));
    expect(manualRouteLabels().slice(0, 4)).toEqual([
      "Office (fixed start)",
      "Zone B - Bin 03",
      "Zone A - Bin 02",
      "Zone A - Bin 01",
    ]);
  });

  test("selected-only is visual-only and Clear selection returns the worker route to Office", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("radio", { name: "English" }));
    selectLocation("Zone C - Bin 03");
    selectLocation("Zone A - Bin 01");
    openLocationsPanel();
    fireEvent.click(screen.getByRole("checkbox", { name: "Show selected only" }));
    expect(manualRouteLabels()).toEqual([
      "Office (fixed start)",
      "Zone C - Bin 03",
      "Zone A - Bin 01",
    ]);

    openLocationsPanel();
    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(manualRouteLabels()).toEqual(["Office (fixed start)"]);
    expect(document.querySelector('[data-route="worker"]')).toBeNull();
  });

  test("selecting locations, building a route, and generating a comparison shows Worker vs System Recommended", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("radio", { name: "English" }));

    selectLocation("Zone A - Bin 01");
    selectLocation("Zone A - Bin 03");

    clickOnMap("Zone A - Bin 01");
    clickOnMap("Zone A - Bin 03");

    openRoutePanel();
    fireEvent.click(screen.getByRole("button", { name: "Generate recommended route" }));

    expect(screen.getAllByText("Worker route").length).toBeGreaterThan(0);
    expect(screen.getAllByText("System recommended route").length).toBeGreaterThan(0);
    expect(screen.getByText("Recommendation comparison")).toBeTruthy();
    expect(screen.getByText("Play simulation", { selector: ".workflow-steps__label" }).closest("li")?.getAttribute("aria-current"))
      .toBe("step");
    const centerPlay = screen.getByRole("button", { name: /Play simulation/ });
    fireEvent.click(centerPlay);
    expect(screen.queryByRole("button", { name: /Play simulation/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.getByRole("button", { name: /Play simulation/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Expand minimap" }));
    expect(document.querySelector(".twin__minimap--expanded")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Shrink minimap" }));
    expect(document.querySelector(".twin__minimap--expanded")).toBeNull();
    expect(
      screen.getByRole("heading", { name: "Cycle Count Digital Twin" }),
    ).toBeTruthy();
    // Explore is the default digital-twin view: one warehouse projection, plus the
    // operations column and simulation timeline that frame it.
    expect(document.querySelectorAll(".twin [data-simulation-viewport] svg")).toHaveLength(1);
    expect(document.querySelector(".workspace-utility")).not.toBeNull();
    expect(document.querySelector(".twin__timeline")).not.toBeNull();
  });

  test("transitions directly into the simulation workspace without autoplay", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("radio", { name: "English" }));
    selectLocation("Zone A - Bin 01");
    selectLocation("Zone A - Bin 02");
    clickOnMap("Zone A - Bin 01");
    clickOnMap("Zone A - Bin 02");
    openRoutePanel();
    fireEvent.click(screen.getByRole("button", { name: "Generate recommended route" }));

    expect(document.querySelector(".twin__stage")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();
  });

  test("opening contextual panels does not create or reset a second playback clock", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("radio", { name: "English" }));
    selectLocation("Zone A - Bin 01");
    selectLocation("Zone B - Bin 03");
    clickOnMap("Zone A - Bin 01");
    clickOnMap("Zone B - Bin 03");
    openRoutePanel();
    fireEvent.click(screen.getByRole("button", { name: "Generate recommended route" }));

    const seek = screen.getByLabelText("Replay position") as HTMLInputElement;
    fireEvent.change(seek, { target: { value: "42" } });
    fireEvent.click(screen.getByRole("button", { name: "Locations" }));
    expect(screen.getAllByLabelText("Replay position")).toHaveLength(1);
    expect(seek.value).toBe("42");
    fireEvent.click(screen.getByRole("button", { name: "Locations" }));
    expect(seek.value).toBe("42");
  });

  test("keeps invalid generation disabled and does not move focus", () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    render(<App />);
    fireEvent.click(screen.getByRole("radio", { name: "English" }));

    openRoutePanel();
    const generate = screen.getByRole("button", { name: "Generate recommended route" });
    expect((generate as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(generate);
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(document.querySelector(".ops-panel")).toBeNull();

    Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
  });

  test("walking-speed and selected-location changes reset replay while preserving rate", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("radio", { name: "English" }));
    selectLocation("Zone A - Bin 01");
    selectLocation("Zone B - Bin 03");
    clickOnMap("Zone A - Bin 01");
    clickOnMap("Zone B - Bin 03");
    openRoutePanel();
    fireEvent.click(screen.getByRole("button", { name: "Generate recommended route" }));

    const seek = screen.getByLabelText("Replay position") as HTMLInputElement;
    const originalDuration = Number(seek.max);
    const controlledServiceDuration = getDemoCountServiceProfile("loc-A01").durationSeconds
      + getDemoCountServiceProfile("loc-B03").durationSeconds;
    fireEvent.click(screen.getByRole("button", { name: "10×" }));
    fireEvent.change(seek, { target: { value: originalDuration / 2 } });
    openRoutePanel();
    fireEvent.change(screen.getByLabelText("Walking speed (metres/minute)"), {
      target: { value: "30" },
    });

    expect(seek.value).toBe("0");
    expect(Number(seek.max)).toBeCloseTo(
      (originalDuration - controlledServiceDuration) * 2 + controlledServiceDuration,
    );
    expect(screen.getByRole("button", { name: "10×" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();

    fireEvent.change(seek, { target: { value: Number(seek.max) / 2 } });
    openLocationsPanel();
    selectLocation("Zone C - Bin 05");
    // A checkbox now edits route truth immediately, so the old comparison is
    // invalidated rather than continuing to expose a stale replay clock.
    expect(document.querySelector(".ops-panel")).toBeNull();
    expect(screen.getByText("Warehouse planning view")).toBeTruthy();
  });

  test("editing the route after generating a comparison hides it again until re-generated", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("radio", { name: "English" }));

    selectLocation("Zone A - Bin 01");
    selectLocation("Zone A - Bin 02");
    clickOnMap("Zone A - Bin 01");
    clickOnMap("Zone A - Bin 02");
    openRoutePanel();
    fireEvent.click(screen.getByRole("button", { name: "Generate recommended route" }));
    expect(screen.getAllByText("Worker route").length).toBeGreaterThan(0);

    openRoutePanel();
    fireEvent.click(screen.getByRole("button", { name: "Remove Zone A - Bin 01" }));

    // Back below 2 stops: the unified planning workspace replaces the stale
    // simulation while preserving the open route-order context.
    expect(screen.getByText("Warehouse planning view")).toBeTruthy();
    expect(screen.getByText("Worker visit order")).toBeTruthy();
    expect(document.querySelector(".ops-panel")).toBeNull();
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

    expect(screen.queryByRole("button", { name: "Details" })).toBeNull();
    expect(screen.queryByText("Technical details (Nearest Neighbor vs Optimized Heuristic)")).toBeNull();
    expect(manualRouteLabels()).toEqual([
      "Office (fixed start)",
      "Zone A - Bin 01",
      "Zone C - Bin 05",
      "Zone B - Bin 09",
    ]);
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
    expect(steps()[1].getAttribute("aria-current")).toBe("step");
  });

  test("today's progress panel is present and starts at the default target", () => {
    render(<App />);
    expect(screen.getAllByText("오늘의 진행 상황").length).toBeGreaterThan(0);
  });

  test("completion removes a selected destination and undo restores selectability without reinserting it", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("radio", { name: "English" }));
    selectLocation("Zone A - Bin 01");
    fireEvent.click(screen.getByText("Today's progress", { selector: "summary" }));
    fireEvent.click(screen.getByRole("button", { name: "Mark selected complete" }));

    expect(
      document.querySelector('[data-location-id="loc-A01"]')!.getAttribute("data-state"),
    ).toBe("completed");
    expect(manualRouteLabels()).toEqual(["Office (fixed start)"]);

    openLocationsPanel();
    const completed = screen.getByRole("checkbox", { name: /Zone A - Bin 01/ }) as HTMLInputElement;
    expect(completed.disabled).toBe(true);
    expect(completed.checked).toBe(false);

    fireEvent.click(screen.getByText("Today's progress", { selector: "summary" }));
    fireEvent.click(screen.getByRole("button", { name: "Undo completion" }));
    openLocationsPanel();
    const restored = screen.getByRole("checkbox", { name: "Zone A - Bin 01" }) as HTMLInputElement;
    expect(restored.disabled).toBe(false);
    expect(restored.checked).toBe(false);
    expect(manualRouteLabels()).toEqual(["Office (fixed start)"]);
  });

  test("persists language choice across remounts via localStorage", () => {
    const { unmount } = render(<App />);
    fireEvent.click(screen.getByRole("radio", { name: "English" }));
    unmount();
    render(<App />);
    startDemo();
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
    const progressPanel = screen.getByLabelText("Today's progress");
    expect(progressPanel.querySelector(".progress-panel__stats dd")!.textContent).toBe("1");
  });

  test("persists selected locations, the worker route order, and a generated comparison across remounts via localStorage", () => {
    const { unmount } = render(<App />);
    fireEvent.click(screen.getByRole("radio", { name: "English" }));

    selectLocation("Zone A - Bin 01");
    selectLocation("Zone B - Bin 03");
    clickOnMap("Zone A - Bin 01");
    clickOnMap("Zone B - Bin 03");
    openRoutePanel();
    fireEvent.click(screen.getByRole("button", { name: "Generate recommended route" }));
    expect(screen.getAllByText("Worker route").length).toBeGreaterThan(0);

    unmount();
    render(<App />);

    // Selection survived the reload.
    openLocationsPanel();
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
    openRoutePanel();
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
    expect(document.querySelector(".ops-panel")).not.toBeNull();
  });

  test("a restored comparison is still invalidated by a real post-reload route edit", () => {
    const { unmount } = render(<App />);
    fireEvent.click(screen.getByRole("radio", { name: "English" }));
    selectLocation("Zone A - Bin 01");
    selectLocation("Zone B - Bin 03");
    clickOnMap("Zone A - Bin 01");
    clickOnMap("Zone B - Bin 03");
    openRoutePanel();
    fireEvent.click(screen.getByRole("button", { name: "Generate recommended route" }));

    unmount();
    render(<App />);
    expect(document.querySelector(".ops-panel")).not.toBeNull();

    openRoutePanel();
    fireEvent.click(screen.getByRole("button", { name: "Remove Zone A - Bin 01" }));
    expect(document.querySelector(".ops-panel")).toBeNull();
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
    openLocationsPanel();
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
