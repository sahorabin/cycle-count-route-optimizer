// @vitest-environment jsdom
import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { RouteSummary } from "./RouteSummary";
import { sampleWarehouse } from "../data/sampleWarehouse";

describe("RouteSummary", () => {
  test("shows exact total distances, distance saved, and improvement percentage", () => {
    render(
      <RouteSummary
        graph={sampleWarehouse}
        nearestNeighbor={{ order: ["office", "loc-D", "loc-B", "loc-A", "loc-C"], totalDistance: 539 }}
        optimized={{ order: ["office", "loc-A", "loc-B", "loc-D", "loc-C"], totalDistance: 459 }}
      />,
    );

    expect(screen.getByText(/539/)).toBeTruthy();
    expect(screen.getByText(/459/)).toBeTruthy();
    expect(screen.getByText(/80/)).toBeTruthy(); // distance saved: 539 - 459
    expect(screen.getByText(/14\.8%/)).toBeTruthy(); // 80 / 539 * 100
  });

  test("never displays the optimized distance as greater than the baseline in a same-route case", () => {
    render(
      <RouteSummary
        graph={sampleWarehouse}
        nearestNeighbor={{ order: ["office"], totalDistance: 0 }}
        optimized={{ order: ["office"], totalDistance: 0 }}
      />,
    );

    expect(screen.getByText("0.0%")).toBeTruthy();
  });

  test("shows human-readable stop labels, not raw ids, and the office marked as the start", () => {
    render(
      <RouteSummary
        graph={sampleWarehouse}
        nearestNeighbor={{ order: ["office", "loc-B"], totalDistance: 77 }}
        optimized={{ order: ["office", "loc-B"], totalDistance: 77 }}
      />,
    );

    expect(screen.getAllByText(/Office \(start\)/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Bin A2-Mid").length).toBeGreaterThan(0);
  });
});
