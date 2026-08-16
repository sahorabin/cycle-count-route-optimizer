// @vitest-environment jsdom
import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { sampleWarehouse } from "../data/sampleWarehouse";
import type { RouteTimeline } from "../domain/types";
import { getSimulationSnapshotAtTime } from "../simulation/simulationSnapshot";

const { recordCanvasProps } = vi.hoisted(() => ({ recordCanvasProps: vi.fn() }));

vi.mock("@react-three/fiber", () => ({
  Canvas: (props: {
    children?: ReactNode;
    role?: string;
    "aria-label"?: string;
    frameloop?: string;
    orthographic?: boolean;
    dpr?: number | [number, number];
    fallback?: ReactNode;
    gl?: { powerPreference?: string };
  }) => {
    recordCanvasProps(props);
    return (
      <div
        role={props.role}
        aria-label={props["aria-label"]}
        data-testid="mock-r3f-canvas"
        data-frameloop={props.frameloop}
        data-orthographic={String(props.orthographic)}
        data-dpr={JSON.stringify(props.dpr)}
        data-power-preference={props.gl?.powerPreference}
      />
    );
  },
  useThree: vi.fn(),
}));

import { Warehouse3DViewport } from "./Warehouse3DViewport";

const timeline: RouteTimeline = {
  order: [sampleWarehouse.start.id],
  walkingSpeedMetersPerMinute: 60,
  legs: [],
  totalDistance: 0,
  totalDurationSeconds: 0,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  recordCanvasProps.mockClear();
});

describe("Warehouse3DViewport", () => {
  test("uses an accessible fixed orthographic demand Canvas with a capped DPR", () => {
    vi.stubGlobal("WebGLRenderingContext", class WebGLRenderingContext {});
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      getExtension: () => ({ loseContext: vi.fn() }),
    } as unknown as WebGLRenderingContext);
    render(
      <Warehouse3DViewport
        graph={sampleWarehouse}
        timeline={timeline}
        snapshot={getSimulationSnapshotAtTime(timeline, 0)}
        mode="worker"
        accessibleLabel="Worker route 3D warehouse simulation"
        fallback={<p>SVG fallback</p>}
      />,
    );

    const canvas = screen.getByRole("img", { name: "Worker route 3D warehouse simulation" });
    expect(canvas.getAttribute("data-frameloop")).toBe("demand");
    expect(canvas.getAttribute("data-orthographic")).toBe("true");
    expect(canvas.getAttribute("data-dpr")).toBe("[1,1.5]");
    expect(canvas.getAttribute("data-power-preference")).toBe("low-power");
    expect(recordCanvasProps).toHaveBeenCalledTimes(1);
  });

  test("renders the supplied SVG fallback when a WebGL context cannot initialize", () => {
    vi.stubGlobal("WebGLRenderingContext", class WebGLRenderingContext {});
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    render(
      <Warehouse3DViewport
        graph={sampleWarehouse}
        timeline={timeline}
        snapshot={getSimulationSnapshotAtTime(timeline, 0)}
        mode="recommended"
        accessibleLabel="Recommended route 3D warehouse simulation"
        fallback={<p>SVG fallback</p>}
      />,
    );
    expect(screen.getByText("SVG fallback")).toBeTruthy();
    expect(screen.queryByTestId("mock-r3f-canvas")).toBeNull();
  });
});
