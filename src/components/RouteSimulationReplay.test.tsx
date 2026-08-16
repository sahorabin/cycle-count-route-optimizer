// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { sampleWarehouse } from "../data/sampleWarehouse";
import { buildValidatedDistanceMatrix } from "../domain/distanceMatrix";
import { nearestNeighborRoute } from "../domain/nearestNeighbor";
import { buildRouteTimeline } from "../domain/routeTimeline";
import { buildRouteTraversal } from "../domain/routeTraversal";
import { twoOptRoute } from "../domain/twoOpt";
import type { NodeId, RouteComputation, RouteTimeline, WarehouseGraph } from "../domain/types";
import { LanguageProvider } from "../i18n/LanguageContext";
import { OPT_OFFSET } from "../ui/svgPoints";
import {
  getSharedComparisonDuration,
  getSharedComparisonSnapshots,
} from "../ui/sharedSimulationComparison";
import {
  RouteSimulationComparison,
} from "./RouteSimulationComparison";

function linearTimeline(totalDurationSeconds: number): RouteTimeline {
  return {
    order: ["start", "destination"],
    walkingSpeedMetersPerMinute: 60,
    totalDistance: totalDurationSeconds,
    totalDurationSeconds,
    legs: [
      {
        from: "start",
        to: "destination",
        distance: totalDurationSeconds,
        startTimeSeconds: 0,
        durationSeconds: totalDurationSeconds,
        endTimeSeconds: totalDurationSeconds,
        segments: [
          {
            from: "start",
            to: "destination",
            distance: totalDurationSeconds,
            startTimeSeconds: 0,
            durationSeconds: totalDurationSeconds,
            endTimeSeconds: totalDurationSeconds,
          },
        ],
      },
    ],
  };
}

function setupComparison(language: "ko" | "en" = "en") {
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
    <LanguageProvider initialLanguage={language}>
      <RouteSimulationComparison
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

function installAnimationFrameHarness() {
  let nextId = 1;
  const callbacks = new Map<number, FrameRequestCallback>();
  vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
    const id = nextId++;
    callbacks.set(id, callback);
    return id;
  }));
  vi.stubGlobal("cancelAnimationFrame", vi.fn((id: number) => callbacks.delete(id)));

  return {
    run(timestamp: number) {
      const entry = callbacks.entries().next().value as [number, FrameRequestCallback] | undefined;
      if (!entry) throw new Error("No animation frame is scheduled");
      callbacks.delete(entry[0]);
      act(() => entry[1](timestamp));
    },
    pendingCount: () => callbacks.size,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("shared comparison state", () => {
  test("uses the longer physical timeline as the shared duration", () => {
    expect(getSharedComparisonDuration(linearTimeline(100), linearTimeline(60))).toBe(100);
    expect(getSharedComparisonDuration(linearTimeline(60), linearTimeline(100))).toBe(100);
  });

  test("projects both timelines from the same shared time while each keeps its own state", () => {
    const snapshots = getSharedComparisonSnapshots(linearTimeline(100), linearTimeline(60), 40);
    expect(snapshots.worker.timeSeconds).toBe(40);
    expect(snapshots.recommended.timeSeconds).toBe(40);
    expect(snapshots.worker.current?.progress).toBe(0.4);
    expect(snapshots.recommended.current?.progress).toBeCloseTo(2 / 3);
  });

  test("clamps the shorter route while the longer route continues", () => {
    const snapshots = getSharedComparisonSnapshots(linearTimeline(100), linearTimeline(60), 80);
    expect(snapshots.worker.timeSeconds).toBe(80);
    expect(snapshots.worker.isComplete).toBe(false);
    expect(snapshots.recommended.timeSeconds).toBe(60);
    expect(snapshots.recommended.isComplete).toBe(true);
    expect(snapshots.recommended.current).toBeNull();
  });

  test("both routes are complete at the shared maximum", () => {
    const snapshots = getSharedComparisonSnapshots(linearTimeline(100), linearTimeline(60), 100);
    expect(snapshots.worker.isComplete).toBe(true);
    expect(snapshots.recommended.isComplete).toBe(true);
  });
});

describe("RouteSimulationComparison", () => {
  test("starts paused with two reusable viewports, two markers, and one control set", () => {
    const { container, workerTimeline, recommendedTimeline } = setupComparison();
    const seek = screen.getByLabelText("Replay position") as HTMLInputElement;

    expect(screen.getByRole("heading", { name: "Worker vs recommended route replay" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Play" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Reset" })).toHaveLength(1);
    expect(seek.value).toBe("0");
    expect(seek.min).toBe("0");
    expect(seek.step).toBe("1");
    expect(seek.getAttribute("aria-valuetext")).toMatch(/^0:00 of /);
    expect(Number(seek.max)).toBe(Math.max(
      workerTimeline.totalDurationSeconds,
      recommendedTimeline.totalDurationSeconds,
    ));
    expect(container.querySelectorAll('[data-simulation-viewport]')).toHaveLength(2);
    expect(container.querySelectorAll(".route-simulation-viewport")).toHaveLength(2);
    expect(container.querySelectorAll("svg")).toHaveLength(2);
    expect(container.querySelectorAll('[data-testid="simulation-marker"]')).toHaveLength(2);
    expect(screen.getAllByText("Ready")).toHaveLength(2);
    expect(screen.queryByText("Route to replay")).toBeNull();
    expect(container.querySelectorAll('input[type="radio"]')).toHaveLength(0);
    expect(screen.getByRole("button", { name: "3D" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "2D" }).getAttribute("aria-pressed")).toBe("false");
  });

  test("switches both renderers without resetting shared time, playback state, rate, or snapshots", () => {
    const frames = installAnimationFrameHarness();
    const { container, workerTimeline, recommendedTimeline } = setupComparison();
    const seek = screen.getByLabelText("Replay position") as HTMLInputElement;
    const sharedTime = Math.min(
      40,
      Math.max(workerTimeline.totalDurationSeconds, recommendedTimeline.totalDurationSeconds) / 2,
    );

    fireEvent.change(seek, { target: { value: sharedTime } });
    fireEvent.click(screen.getByRole("button", { name: "5×" }));
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(frames.pendingCount()).toBe(1);
    const statusBefore = [...container.querySelectorAll(".route-simulation-viewport__status")]
      .map((status) => status.textContent);
    const markersBefore = [...container.querySelectorAll('[data-testid="simulation-marker"]')]
      .map((marker) => marker.getAttribute("transform"));

    fireEvent.click(screen.getByRole("button", { name: "2D" }));
    expect(seek.value).toBe(String(sharedTime));
    expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "5×" }).getAttribute("aria-pressed")).toBe("true");
    expect([...container.querySelectorAll(".route-simulation-viewport__status")]
      .map((status) => status.textContent)).toEqual(statusBefore);
    expect([...container.querySelectorAll('[data-testid="simulation-marker"]')]
      .map((marker) => marker.getAttribute("transform"))).toEqual(markersBefore);

    fireEvent.click(screen.getByRole("button", { name: "3D" }));
    expect(seek.value).toBe(String(sharedTime));
    expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();
    expect(frames.pendingCount()).toBe(1);
  });

  test("makes the controlled comparison conditions explicit", () => {
    setupComparison();
    expect(
      screen.getByText("Same warehouse · Same locations · Same start · Same walking speed · Same clock"),
    ).toBeTruthy();
    expect(screen.getByText("Only the route sequence differs.")).toBeTruthy();
  });

  test("shared seek moves both markers forward and backward from one time source", () => {
    const { container, workerTimeline, recommendedTimeline } = setupComparison();
    const seek = screen.getByLabelText("Replay position") as HTMLInputElement;
    const markerTransforms = () =>
      [...container.querySelectorAll('[data-testid="simulation-marker"]')].map((marker) =>
        marker.getAttribute("transform"),
      );
    const start = markerTransforms();
    const sharedDuration = Math.max(
      workerTimeline.totalDurationSeconds,
      recommendedTimeline.totalDurationSeconds,
    );

    fireEvent.change(seek, { target: { value: sharedDuration * 0.5 } });
    const forward = markerTransforms();
    expect(forward[0]).not.toBe(start[0]);
    expect(forward[1]).not.toBe(start[1]);

    fireEvent.change(seek, { target: { value: sharedDuration * 0.1 } });
    const backward = markerTransforms();
    expect(backward[0]).not.toBe(forward[0]);
    expect(backward[1]).not.toBe(forward[1]);
  });

  test("exposes native one-second Arrow and Home/End range semantics with localized value text", () => {
    const { workerTimeline, recommendedTimeline, unmount } = setupComparison();
    const seek = screen.getByLabelText("Replay position") as HTMLInputElement;
    const duration = Math.max(
      workerTimeline.totalDurationSeconds,
      recommendedTimeline.totalDurationSeconds,
    );
    expect(seek.min).toBe("0");
    expect(seek.max).toBe(String(duration));
    expect(seek.step).toBe("1");
    fireEvent.keyDown(seek, { key: "ArrowRight" });
    expect(seek.value).toBe("1");
    expect(seek.getAttribute("aria-valuetext")).toMatch(/^0:01 of /);
    fireEvent.keyDown(seek, { key: "ArrowLeft" });
    expect(seek.value).toBe("0");
    fireEvent.keyDown(seek, { key: "End" });
    expect(Number(seek.value)).toBe(duration);
    fireEvent.keyDown(seek, { key: "Home" });
    expect(seek.value).toBe("0");
    unmount();

    setupComparison("ko");
    const koreanSeek = screen.getByLabelText("재생 위치") as HTMLInputElement;
    expect(koreanSeek.getAttribute("aria-valuetext")).toMatch(/^전체 .* 중 0:00$/);
  });

  test("shorter recommended route completes and keeps its final marker while worker continues", () => {
    const { container, recommended, workerTimeline, recommendedTimeline } = setupComparison();
    expect(workerTimeline.totalDurationSeconds).toBeGreaterThan(
      recommendedTimeline.totalDurationSeconds,
    );
    const seek = screen.getByLabelText("Replay position") as HTMLInputElement;
    const sharedTime = (workerTimeline.totalDurationSeconds + recommendedTimeline.totalDurationSeconds) / 2;
    fireEvent.change(seek, { target: { value: sharedTime } });

    const workerViewport = container.querySelector('[data-simulation-viewport="worker"]')!;
    const recommendedViewport = container.querySelector('[data-simulation-viewport="recommended"]')!;
    expect(workerViewport.textContent).toContain("In progress");
    expect(recommendedViewport.textContent).toContain("Completed");

    const finalLocation = sampleWarehouse.locations.find(
      (location) => location.id === recommended.order.at(-1),
    )!;
    expect(
      recommendedViewport.querySelector('[data-testid="simulation-marker"]')?.getAttribute("transform"),
    ).toBe(`translate(${finalLocation.x + OPT_OFFSET.x} ${finalLocation.y + OPT_OFFSET.y})`);
  });

  test("reset returns both routes to ready at zero and preserves playback rate", () => {
    const { container, workerTimeline, recommendedTimeline } = setupComparison();
    const seek = screen.getByLabelText("Replay position") as HTMLInputElement;
    const sharedDuration = Math.max(
      workerTimeline.totalDurationSeconds,
      recommendedTimeline.totalDurationSeconds,
    );

    fireEvent.click(screen.getByRole("button", { name: "10×" }));
    fireEvent.change(seek, { target: { value: sharedDuration / 2 } });
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));

    expect(seek.value).toBe("0");
    expect(screen.getAllByText("Ready")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "10×" }).getAttribute("aria-pressed")).toBe("true");
    const markers = container.querySelectorAll('[data-testid="simulation-marker"]');
    expect(markers[0].getAttribute("transform")).toContain("-16.5 -11.5");
    expect(markers[1].getAttribute("transform")).toContain("-13.5 -8.5");
  });

  test("one RAF loop advances the shared clock after the short route completes", () => {
    const frames = installAnimationFrameHarness();
    const { container, workerTimeline, recommendedTimeline } = setupComparison();
    const seek = screen.getByLabelText("Replay position") as HTMLInputElement;

    fireEvent.click(screen.getByRole("button", { name: "10×" }));
    fireEvent.change(seek, { target: { value: recommendedTimeline.totalDurationSeconds - 1 } });
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(frames.pendingCount()).toBe(1);
    frames.run(1_000);
    frames.run(1_200);

    expect(Number(seek.value)).toBeGreaterThan(recommendedTimeline.totalDurationSeconds);
    expect(Number(seek.value)).toBeLessThan(workerTimeline.totalDurationSeconds);
    expect(container.querySelector('[data-simulation-viewport="recommended"]')?.textContent).toContain(
      "Completed",
    );
    expect(container.querySelector('[data-simulation-viewport="worker"]')?.textContent).toContain(
      "In progress",
    );
    expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();
    expect(frames.pendingCount()).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(frames.pendingCount()).toBe(0);
  });

  test("shows route-specific duration and KPI truth without changing it at 10x", () => {
    const { workerTimeline, recommendedTimeline } = setupComparison();
    expect(screen.getAllByText("Route duration")).toHaveLength(2);
    expect(screen.getAllByText("0 / 4")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "10×" }));
    expect(workerTimeline.walkingSpeedMetersPerMinute).toBe(60);
    expect(recommendedTimeline.walkingSpeedMetersPerMinute).toBe(60);
    for (const label of ["0.5×", "1×", "2×", "5×", "10×"]) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }
  });

  test("renders the comparison explanation and statuses in Korean", () => {
    setupComparison("ko");
    expect(screen.getByText("방문 경로 순서만 다릅니다.")).toBeTruthy();
    expect(screen.getAllByText("준비")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "재생" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "창고 보기" })).toBeTruthy();
  });
});
