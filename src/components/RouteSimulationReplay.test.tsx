// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { sampleWarehouse } from "../data/sampleWarehouse";
import { buildDemoCountServiceProfiles } from "../data/demoCountService";
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
    walkingDurationSeconds: totalDurationSeconds,
    serviceDurationSeconds: 0,
    totalDurationSeconds,
    phases: [
      {
        kind: "travel",
        legIndex: 0,
        segmentIndex: 0,
        from: "start",
        to: "destination",
        distance: totalDurationSeconds,
        startTimeSeconds: 0,
        durationSeconds: totalDurationSeconds,
        endTimeSeconds: totalDurationSeconds,
      },
      {
        kind: "service",
        legIndex: 0,
        locationId: "destination",
        serviceClass: null,
        source: null,
        startTimeSeconds: totalDurationSeconds,
        durationSeconds: 0,
        endTimeSeconds: totalDurationSeconds,
      },
    ],
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
  const serviceProfiles = buildDemoCountServiceProfiles(targetIds);
  const workerTimeline = buildRouteTimeline(
    buildRouteTraversal(routeGraph, worker, matrix),
    60,
    serviceProfiles,
  );
  const recommendedTimeline = buildRouteTimeline(
    buildRouteTraversal(routeGraph, recommended, matrix),
    60,
    serviceProfiles,
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
    expect(screen.getAllByRole("button", { name: /^Reset$/ })).toHaveLength(1);
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
    expect(screen.getByRole("group", { name: "View" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Compare" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("group", { name: "Camera" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Overview" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Reset camera" })).toBeTruthy();
  });

  test("switches Compare and Explore routes without creating new playback truth", () => {
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

    fireEvent.click(screen.getByRole("button", { name: "Explore" }));
    expect(container.querySelectorAll('[data-simulation-viewport]')).toHaveLength(1);
    expect(container.querySelector('[data-simulation-viewport="worker"]')).toBeTruthy();
    expect(screen.getByRole("group", { name: "Route to inspect" })).toBeTruthy();
    expect(seek.value).toBe(String(sharedTime));
    expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "5×" }).getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: /^System recommended route$/ }));
    expect(container.querySelectorAll('[data-simulation-viewport]')).toHaveLength(1);
    expect(container.querySelector('[data-simulation-viewport="recommended"]')).toBeTruthy();
    expect(seek.value).toBe(String(sharedTime));
    expect(frames.pendingCount()).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: "Compare" }));
    expect(container.querySelectorAll('[data-simulation-viewport]')).toHaveLength(2);
    expect(seek.value).toBe(String(sharedTime));
    expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();
    expect(frames.pendingCount()).toBe(1);
  });

  test("hides 3D-only controls in 2D and restores Explore without resetting playback state", () => {
    const { container } = setupComparison();
    const seek = screen.getByLabelText("Replay position") as HTMLInputElement;
    fireEvent.change(seek, { target: { value: 30 } });
    fireEvent.click(screen.getByRole("button", { name: "10×" }));
    fireEvent.click(screen.getByRole("button", { name: "Explore" }));
    expect(container.querySelectorAll('[data-simulation-viewport]')).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "2D" }));
    expect(screen.queryByRole("group", { name: "View" })).toBeNull();
    expect(screen.queryByRole("group", { name: "Camera" })).toBeNull();
    expect(container.querySelectorAll('[data-simulation-viewport]')).toHaveLength(2);
    expect(seek.value).toBe("30");
    expect(screen.getByRole("button", { name: "10×" }).getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "3D" }));
    expect(screen.getByRole("button", { name: "Explore" }).getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelectorAll('[data-simulation-viewport]')).toHaveLength(1);
    expect(seek.value).toBe("30");
  });

  test("survives rapid renderer and layout remount sequences without resetting shared state", () => {
    const { container } = setupComparison();
    const seek = screen.getByLabelText("Replay position") as HTMLInputElement;
    fireEvent.change(seek, { target: { value: 25 } });
    fireEvent.click(screen.getByRole("button", { name: "5×" }));

    for (let index = 0; index < 10; index += 1) {
      fireEvent.click(screen.getByRole("button", { name: "2D" }));
      fireEvent.click(screen.getByRole("button", { name: "3D" }));
    }
    for (let index = 0; index < 4; index += 1) {
      fireEvent.click(screen.getByRole("button", { name: "Explore" }));
      fireEvent.click(screen.getByRole("button", { name: "Compare" }));
      fireEvent.click(screen.getByRole("button", { name: "2D" }));
      fireEvent.click(screen.getByRole("button", { name: "3D" }));
    }

    expect(screen.getByRole("button", { name: "3D" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Compare" }).getAttribute("aria-pressed"))
      .toBe("true");
    expect(container.querySelectorAll('[data-simulation-viewport]')).toHaveLength(2);
    expect(seek.value).toBe("25");
    expect(screen.getByRole("button", { name: "5×" }).getAttribute("aria-pressed")).toBe("true");
  });

  test("preserves active service truth across 3D and 2D renderer remounts", () => {
    const { container, workerTimeline } = setupComparison();
    const service = workerTimeline.phases.find(
      (phase) => phase.kind === "service" && phase.durationSeconds > 0,
    );
    if (!service || service.kind !== "service") throw new Error("Expected service phase");
    const serviceMidpoint = service.startTimeSeconds + service.durationSeconds / 2;
    const seek = screen.getByLabelText("Replay position") as HTMLInputElement;
    fireEvent.change(seek, { target: { value: serviceMidpoint } });
    fireEvent.click(screen.getByRole("button", { name: "5×" }));

    const workerActivity = () => container.querySelector(
      '[data-simulation-viewport="worker"] [data-simulation-activity]',
    );
    expect(workerActivity()?.getAttribute("data-simulation-activity")).toBe("service");
    expect(workerActivity()?.getAttribute("data-service-location")).toBe(service.locationId);
    expect(Number(workerActivity()?.getAttribute("data-service-progress"))).toBeCloseTo(0.5);

    fireEvent.click(screen.getByRole("button", { name: "2D" }));
    fireEvent.click(screen.getByRole("button", { name: "3D" }));

    expect(Number(seek.value)).toBe(serviceMidpoint);
    expect(workerActivity()?.getAttribute("data-simulation-activity")).toBe("service");
    expect(workerActivity()?.getAttribute("data-service-location")).toBe(service.locationId);
    expect(Number(workerActivity()?.getAttribute("data-service-progress"))).toBeCloseTo(0.5);
    expect(screen.getByRole("button", { name: "5×" }).getAttribute("aria-pressed")).toBe("true");
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
    expect(screen.getAllByText("Travel")).toHaveLength(2);
    expect(screen.getAllByText("Counting")).toHaveLength(2);
    expect(screen.getAllByText("Total")).toHaveLength(2);
    expect(screen.getAllByText("Counting times use deterministic synthetic demo assumptions."))
      .toHaveLength(2);
    expect(screen.getAllByText("0 / 4")).toHaveLength(2);
    expect(workerTimeline.serviceDurationSeconds).toBe(recommendedTimeline.serviceDurationSeconds);
    const physicalTotals = [
      workerTimeline.totalDurationSeconds,
      recommendedTimeline.totalDurationSeconds,
    ];

    fireEvent.click(screen.getByRole("button", { name: "10×" }));
    expect(workerTimeline.walkingSpeedMetersPerMinute).toBe(60);
    expect(recommendedTimeline.walkingSpeedMetersPerMinute).toBe(60);
    expect([
      workerTimeline.totalDurationSeconds,
      recommendedTimeline.totalDurationSeconds,
    ]).toEqual(physicalTotals);
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
    expect(screen.getByRole("group", { name: "보기 방식" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "카메라" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "카메라 초기화" })).toBeTruthy();
    expect(screen.getAllByText("이동")).toHaveLength(2);
    expect(screen.getAllByText("재고 조사")).toHaveLength(2);
    expect(screen.getAllByText("총 운영 시간")).toHaveLength(2);
    expect(screen.getAllByText("재고 조사 시간은 결정론적 합성 데모 가정을 사용합니다."))
      .toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "탐색" }));
    expect(screen.getByRole("group", { name: "탐색할 경로" })).toBeTruthy();
  });
});

describe("counting HUD", () => {
  function serviceMidpointOf(timeline: RouteTimeline) {
    const service = timeline.phases.find(
      (phase) => phase.kind === "service" && phase.durationSeconds > 0,
    );
    if (!service || service.kind !== "service") throw new Error("Expected service phase");
    return { service, midpoint: service.startTimeSeconds + service.durationSeconds / 2 };
  }

  test("stays restrained while travelling and never claims counting early", () => {
    const { container } = setupComparison();
    const hud = container.querySelector(
      '[data-simulation-viewport="worker"] [data-simulation-activity]',
    );

    expect(hud?.getAttribute("data-simulation-activity")).toBe("travel");
    expect(hud?.textContent).toContain("Travelling");
    expect(hud?.getAttribute("data-service-location")).toBeNull();
    expect(screen.queryAllByRole("progressbar", { name: "Counting progress" })).toHaveLength(0);
    expect(screen.getAllByText("0 / 4")).toHaveLength(2);
  });

  test("shows location, service class, progress, elapsed, and remaining while counting", () => {
    const { container, workerTimeline } = setupComparison();
    const { service, midpoint } = serviceMidpointOf(workerTimeline);
    fireEvent.change(screen.getByLabelText("Replay position"), { target: { value: midpoint } });

    const hud = container.querySelector(
      '[data-simulation-viewport="worker"] [data-simulation-activity]',
    );
    const location = sampleWarehouse.locations.find(({ id }) => id === service.locationId);
    const progressBar = [...container.querySelectorAll(
      '[data-simulation-viewport="worker"] progress',
    )][0] as HTMLProgressElement;

    expect(hud?.getAttribute("data-simulation-activity")).toBe("service");
    expect(hud?.textContent).toContain("Counting");
    expect(hud?.textContent).toContain(location!.label);
    expect(hud?.textContent).toContain("Current location");
    expect(hud?.textContent).toContain("Remaining");
    expect(hud?.textContent).toContain("50%");
    expect(hud?.textContent).toContain(`0:${String(Math.round(service.durationSeconds)).padStart(2, "0")}`);
    expect(progressBar.value).toBeCloseTo(0.5);
    expect(progressBar.max).toBe(1);
    expect(progressBar.getAttribute("aria-label")).toBe("Counting progress");
    // Service progress is not route progress: the location is not completed yet.
    expect(screen.getAllByText("0 / 4").length).toBeGreaterThan(0);
  });

  test("counting visuals follow forward and backward seeks with no stale state", () => {
    const { container, workerTimeline } = setupComparison();
    const { service } = serviceMidpointOf(workerTimeline);
    const seek = screen.getByLabelText("Replay position") as HTMLInputElement;
    const progressAttribute = () => Number(container.querySelector(
      '[data-simulation-viewport="worker"] [data-simulation-activity]',
    )?.getAttribute("data-service-progress"));

    fireEvent.change(seek, { target: { value: service.startTimeSeconds + service.durationSeconds * 0.75 } });
    expect(progressAttribute()).toBeCloseTo(0.75);

    fireEvent.change(seek, { target: { value: service.startTimeSeconds + service.durationSeconds * 0.25 } });
    expect(progressAttribute()).toBeCloseTo(0.25);

    fireEvent.change(seek, { target: { value: service.startTimeSeconds } });
    expect(progressAttribute()).toBe(0);

    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(container.querySelector(
      '[data-simulation-viewport="worker"] [data-simulation-activity]',
    )?.getAttribute("data-simulation-activity")).toBe("travel");
  });

  test("survives renderer and view-mode switching mid-count without losing counting truth", () => {
    const { container, workerTimeline } = setupComparison();
    const { service, midpoint } = serviceMidpointOf(workerTimeline);
    const seek = screen.getByLabelText("Replay position") as HTMLInputElement;
    fireEvent.change(seek, { target: { value: midpoint } });
    fireEvent.click(screen.getByRole("button", { name: "2\u00d7" }));

    const workerHud = () => container.querySelector(
      '[data-simulation-viewport="worker"] [data-simulation-activity]',
    );
    const expectCounting = () => {
      expect(workerHud()?.getAttribute("data-simulation-activity")).toBe("service");
      expect(workerHud()?.getAttribute("data-service-location")).toBe(service.locationId);
      expect(Number(workerHud()?.getAttribute("data-service-progress"))).toBeCloseTo(0.5);
      expect(Number(seek.value)).toBe(midpoint);
      expect(screen.getByRole("button", { name: "2\u00d7" }).getAttribute("aria-pressed"))
        .toBe("true");
    };

    expectCounting();
    fireEvent.click(screen.getByRole("button", { name: "2D" }));
    expectCounting();
    fireEvent.click(screen.getByRole("button", { name: "3D" }));
    expectCounting();
    fireEvent.click(screen.getByRole("button", { name: "Explore" }));
    expect(Number(workerHud()?.getAttribute("data-service-progress"))).toBeCloseTo(0.5);
    fireEvent.click(screen.getByRole("button", { name: "Compare" }));
    expectCounting();
  });

  test("uses one counting visual language for both routes at the same shared time", () => {
    const { container, workerTimeline, recommendedTimeline } = setupComparison();
    const { midpoint } = serviceMidpointOf(workerTimeline);
    fireEvent.change(screen.getByLabelText("Replay position"), { target: { value: midpoint } });

    const activities = [...container.querySelectorAll("[data-simulation-activity]")]
      .map((hud) => hud.getAttribute("data-simulation-activity"));

    // Identical workload, one clock -- but each route is wherever its own sequence puts it.
    expect(activities).toHaveLength(2);
    expect(activities.every((activity) => activity === "service" || activity === "travel"))
      .toBe(true);
    expect(workerTimeline.serviceDurationSeconds)
      .toBe(recommendedTimeline.serviceDurationSeconds);
  });

  test("renders the counting HUD in Korean", () => {
    const { container, workerTimeline } = setupComparison("ko");
    const { midpoint } = serviceMidpointOf(workerTimeline);
    fireEvent.change(screen.getByLabelText("\uc7ac\uc0dd \uc704\uce58"), { target: { value: midpoint } });

    const hud = container.querySelector(
      '[data-simulation-viewport="worker"] [data-simulation-activity]',
    );

    expect(hud?.textContent).toContain("\uc7ac\uace0 \uc870\uc0ac \uc911");
    expect(hud?.textContent).toContain("\ud604\uc7ac \uc704\uce58");
    expect(hud?.textContent).toContain("\ub0a8\uc740 \uc2dc\uac04");
    expect(screen.getAllByRole("progressbar", { name: "\uc7ac\uace0 \uc870\uc0ac \uc9c4\ud589\ub960" }).length)
      .toBeGreaterThan(0);
  });
});
