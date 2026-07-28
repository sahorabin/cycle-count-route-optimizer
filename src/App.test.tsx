// @vitest-environment jsdom
import { describe, expect, test, beforeEach } from "vitest";
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
    selectLocation("Zone A - Bin 02");

    clickOnMap("Zone A - Bin 01");
    clickOnMap("Zone A - Bin 02");

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
});
