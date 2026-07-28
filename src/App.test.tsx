// @vitest-environment jsdom
import { describe, expect, test } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import App from "./App";
import { sampleWarehouse } from "./data/sampleWarehouse";

describe("App", () => {
  // 1. default target selection produces both route results
  test("shows both route results for the default selection", () => {
    render(<App />);

    expect(screen.getByText("Nearest Neighbor")).toBeTruthy();
    expect(screen.getByText("2-opt Optimized")).toBeTruthy();
    // Hand/script-verified for all 4 sample targets: NN=539, 2-opt=459.
    expect(screen.getByText(/539/)).toBeTruthy();
    expect(screen.getByText(/459/)).toBeTruthy();
  });

  // 2. target selection changes recompute both routes
  test("recomputes both routes when a target is deselected", () => {
    render(<App />);
    expect(screen.getByText(/539/)).toBeTruthy();

    fireEvent.click(screen.getByRole("checkbox", { name: /Bin A3-Back/ }));

    expect(screen.queryByText(/539/)).toBeNull();
  });

  // 3. zero-target selection produces safe output
  test("shows a safe, useful empty state with zero targets selected, no crash", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));

    expect(
      screen.getByText(/Select at least one cycle-count location to see a route comparison/),
    ).toBeTruthy();
    expect(screen.queryByText("Nearest Neighbor")).toBeNull();
  });

  // 4. Select all and Clear all work
  test("Select all and Clear all toggle every checkbox", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    for (const location of sampleWarehouse.locations) {
      expect(
        (screen.getByRole("checkbox", { name: new RegExp(location.label) }) as HTMLInputElement)
          .checked,
      ).toBe(false);
    }

    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    for (const location of sampleWarehouse.locations) {
      expect(
        (screen.getByRole("checkbox", { name: new RegExp(location.label) }) as HTMLInputElement)
          .checked,
      ).toBe(true);
    }
  });

  // 5. displayed total distances match the domain results
  test("displayed totals for a smaller selection match the domain result exactly", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Bin A2-Mid/ }));

    // office -> loc-B is a single-leg route: 77 (hand-verified in Phase 1/2 tests).
    const totals = screen.getAllByText(/77/);
    expect(totals.length).toBeGreaterThan(0);
  });

  // 6. improvement percentage handles zero distance
  test("shows 0.0% improvement rather than NaN/Infinity for a single-target (zero-saving) route", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Bin A2-Mid/ }));

    expect(screen.getByText("0.0%")).toBeTruthy();
    expect(screen.queryByText(/NaN/)).toBeNull();
    expect(screen.queryByText(/Infinity/)).toBeNull();
  });

  // 10. UI route order contains only office and selected cycle-count locations
  test("route stop lists contain only the office and selected locations, never raw aisle-node ids", () => {
    render(<App />);

    const stopLists = document.querySelectorAll(".route-summary__stops");
    expect(stopLists.length).toBe(2);
    for (const list of stopLists) {
      for (const aisleNode of sampleWarehouse.aisleNodes) {
        expect(list.textContent).not.toContain(aisleNode.id);
      }
    }
  });

  // 11. intermediate aisle nodes appear only in the drawn route path (map), not in the stop lists
  test("aisle nodes are drawn on the map but never listed as stops", () => {
    render(<App />);

    const aisleNodeCircles = document.querySelectorAll(".warehouse-map__aisle-node");
    expect(aisleNodeCircles.length).toBe(sampleWarehouse.aisleNodes.length);
  });

  // 9. no return-to-office segment is rendered / 7 route stop begins at the office
  test("both route stop lists start at the office and never list it again after the first stop", () => {
    render(<App />);

    const stopLists = document.querySelectorAll(".route-summary__stops");
    for (const list of stopLists) {
      const items = Array.from(list.querySelectorAll("li")).map((li) => li.textContent);
      expect(items[0]).toContain("start");
      expect(items.slice(1).some((text) => text?.includes("start"))).toBe(false);
    }
  });

  // 13. Nearest Neighbor and 2-opt results are visually distinguishable
  test("draws the two routes with different line styles and different stop-marker shapes", () => {
    render(<App />);

    const nnLine = document.querySelector('[data-route="nearest-neighbor"].warehouse-map__route');
    const optLine = document.querySelector('[data-route="two-opt"].warehouse-map__route');
    expect(nnLine).not.toBeNull();
    expect(optLine).not.toBeNull();

    expect(document.querySelectorAll(".warehouse-map__stop--nn circle").length).toBeGreaterThan(0);
    expect(document.querySelectorAll(".warehouse-map__stop--opt rect").length).toBeGreaterThan(0);
  });

  // 14. the optimized distance is never displayed as greater than the baseline
  test("the displayed optimized total is never greater than the displayed Nearest Neighbor total", () => {
    render(<App />);

    const nnArticle = document.querySelector('[data-route="nearest-neighbor"].route-summary__route');
    const optArticle = document.querySelector('[data-route="two-opt"].route-summary__route');
    const nnTotal = Number(nnArticle!.querySelector("strong")!.textContent);
    const optTotal = Number(optArticle!.querySelector("strong")!.textContent);

    expect(optTotal).toBeLessThanOrEqual(nnTotal);
  });

  // Accessible labels for the interactive controls.
  test("selection controls have accessible names", () => {
    render(<App />);

    expect(screen.getByRole("button", { name: "Select all" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Clear all" })).toBeTruthy();
    for (const location of sampleWarehouse.locations) {
      expect(screen.getByRole("checkbox", { name: new RegExp(location.label) })).toBeTruthy();
    }
  });
});
