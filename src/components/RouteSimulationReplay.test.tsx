// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { sampleWarehouse } from "../data/sampleWarehouse";
import { buildValidatedDistanceMatrix } from "../domain/distanceMatrix";
import { nearestNeighborRoute } from "../domain/nearestNeighbor";
import { buildRouteTimeline } from "../domain/routeTimeline";
import { buildRouteTraversal } from "../domain/routeTraversal";
import { twoOptRoute } from "../domain/twoOpt";
import type { NodeId, RouteComputation, WarehouseGraph } from "../domain/types";
import { LanguageProvider } from "../i18n/LanguageContext";
import { NN_OFFSET, OPT_OFFSET } from "../ui/svgPoints";
import { RouteSimulationReplay } from "./RouteSimulationReplay";

function setupReplay() {
  const targetIds = ["loc-A", "loc-B", "loc-C", "loc-D"];
  const routeGraph: WarehouseGraph = {
    ...sampleWarehouse,
    locations: sampleWarehouse.locations.filter((location) => targetIds.includes(location.id)),
  };
  const matrix = buildValidatedDistanceMatrix(routeGraph);
  const workerOrder: NodeId[] = ["office", "loc-C", "loc-A", "loc-B", "loc-D"];
  const indexById = new Map(matrix.visitIds.map((id, index) => [id, index]));
  const worker: RouteComputation = {
    order: workerOrder,
    totalDistance: workerOrder.slice(0, -1).reduce((total, from, index) => {
      const to = workerOrder[index + 1];
      return total + matrix.distanceMatrix[indexById.get(from)!][indexById.get(to)!];
    }, 0),
  };
  const nearest = nearestNeighborRoute(routeGraph, targetIds);
  const recommended = twoOptRoute(routeGraph, targetIds, nearest);
  const workerTimeline = buildRouteTimeline(buildRouteTraversal(routeGraph, worker, matrix), 60);
  const recommendedTimeline = buildRouteTimeline(
    buildRouteTraversal(routeGraph, recommended, matrix),
    60,
  );

  const rendered = render(
    <LanguageProvider initialLanguage="en">
      <RouteSimulationReplay
        graph={sampleWarehouse}
        visitIds={matrix.visitIds}
        pathMatrix={matrix.pathMatrix}
        simulationInputKey={targetIds.join("|")}
        worker={{ route: worker, timeline: workerTimeline }}
        recommended={{ route: recommended, timeline: recommendedTimeline }}
      />
    </LanguageProvider>,
  );

  return { ...rendered, worker, recommended, workerTimeline, recommendedTimeline };
}

describe("RouteSimulationReplay", () => {
  test("starts paused at zero with one worker-route SVG viewport and no autoplay", () => {
    const { container, workerTimeline } = setupReplay();
    const seek = screen.getByLabelText("Replay position") as HTMLInputElement;

    expect(screen.getByRole("heading", { name: "Route replay" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();
    expect(seek.value).toBe("0");
    expect(Number(seek.max)).toBe(workerTimeline.totalDurationSeconds);
    expect(container.querySelectorAll("svg")).toHaveLength(1);
    expect(container.querySelector('[data-route="worker"]')).not.toBeNull();
    expect(container.querySelector('[data-route="recommended"]')).toBeNull();
    expect(container.querySelector('[data-testid="simulation-marker"]')?.getAttribute("transform")).toBe(
      `translate(${sampleWarehouse.start.x + NN_OFFSET.x} ${sampleWarehouse.start.y + NN_OFFSET.y})`,
    );
  });

  test("seeking forward and backward deterministically moves the same marker", () => {
    const { container, workerTimeline } = setupReplay();
    const seek = screen.getByLabelText("Replay position") as HTMLInputElement;
    const marker = () =>
      container.querySelector('[data-testid="simulation-marker"]')?.getAttribute("transform");
    const startPosition = marker();

    fireEvent.change(seek, { target: { value: workerTimeline.totalDurationSeconds * 0.8 } });
    const forwardPosition = marker();
    expect(forwardPosition).not.toBe(startPosition);

    fireEvent.change(seek, { target: { value: workerTimeline.totalDurationSeconds * 0.2 } });
    const backwardPosition = marker();
    expect(backwardPosition).not.toBe(forwardPosition);
    expect(Number(seek.value)).toBeCloseTo(workerTimeline.totalDurationSeconds * 0.2);
  });

  test("route mode switch resets and pauses, preserves rate, and swaps the one route implementation", () => {
    const { container, workerTimeline, recommendedTimeline } = setupReplay();
    const seek = screen.getByLabelText("Replay position") as HTMLInputElement;

    fireEvent.click(screen.getByRole("button", { name: "10×" }));
    fireEvent.change(seek, { target: { value: workerTimeline.totalDurationSeconds / 2 } });
    fireEvent.click(screen.getByLabelText("System recommended route"));

    expect(seek.value).toBe("0");
    expect(Number(seek.max)).toBe(recommendedTimeline.totalDurationSeconds);
    expect(screen.getByRole("button", { name: "10×" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();
    expect(container.querySelectorAll("svg")).toHaveLength(1);
    expect(container.querySelector('[data-route="worker"]')).toBeNull();
    expect(container.querySelector('[data-route="recommended"]')).not.toBeNull();
  });

  test("completion keeps the marker on the active route's final destination", () => {
    const { container, recommended, recommendedTimeline } = setupReplay();
    fireEvent.click(screen.getByLabelText("System recommended route"));
    const seek = screen.getByLabelText("Replay position") as HTMLInputElement;
    fireEvent.change(seek, { target: { value: recommendedTimeline.totalDurationSeconds } });

    const finalLocation = sampleWarehouse.locations.find(
      (location) => location.id === recommended.order.at(-1),
    )!;
    expect(container.querySelector('[data-testid="simulation-marker"]')?.getAttribute("transform")).toBe(
      `translate(${finalLocation.x + OPT_OFFSET.x} ${finalLocation.y + OPT_OFFSET.y})`,
    );
    expect((screen.getByRole("button", { name: "Play" }) as HTMLButtonElement).disabled).toBe(true);
  });

  test("shows snapshot/timeline ratios and all required playback-rate presets", () => {
    setupReplay();

    expect(screen.getByText(/0:00 \/ \d+:/)).toBeTruthy();
    expect(screen.getByText(/0 m \/ [\d,.]+ m/)).toBeTruthy();
    expect(screen.getByText("0 / 4")).toBeTruthy();
    for (const label of ["0.5×", "1×", "2×", "5×", "10×"]) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }
  });
});
