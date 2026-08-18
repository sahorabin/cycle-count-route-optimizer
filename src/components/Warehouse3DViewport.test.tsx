// @vitest-environment jsdom
import { StrictMode, type ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { useThree } from "@react-three/fiber";
import { OrthographicCamera } from "three";
import { afterEach, describe, expect, test, vi } from "vitest";
import { sampleWarehouse } from "../data/sampleWarehouse";
import type { RouteTimeline } from "../domain/types";
import { buildRouteTimeline } from "../domain/routeTimeline";
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

import { createWarehouse3DTransform, projectNodeToWarehouse3D } from "../ui/warehouse3dProjection";
import {
  InteractiveWarehouseCamera,
  Warehouse3DViewport,
} from "./Warehouse3DViewport";
import { createWarehouseCameraChannel } from "../ui/warehouse3dCamera";
import { createWarehouseOrbitControlsOwner } from "../ui/warehouse3dControls";
import {
  buildWarehouse3DRouteVisualSegments,
  WAREHOUSE_3D_VISUALS,
} from "../ui/warehouse3dVisuals";

const timeline: RouteTimeline = buildRouteTimeline({
  order: [sampleWarehouse.start.id],
  legs: [],
  totalDistance: 0,
}, 60);

const routedTimeline: RouteTimeline = buildRouteTimeline({
  order: ["office", "loc-D"],
  totalDistance: 30,
  legs: [{
    from: "office",
    to: "loc-D",
    path: ["office", "F1", "F2", "loc-D"],
    distance: 30,
    segments: [
      { from: "office", to: "F1", distance: 8 },
      { from: "F1", to: "F2", distance: 20 },
      { from: "F2", to: "loc-D", distance: 2 },
    ],
  }],
}, 60);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  recordCanvasProps.mockClear();
});

describe("Warehouse3DViewport", () => {
  test("connects controls only to a live canvas and disposes the owner idempotently", () => {
    const camera = new OrthographicCamera();
    const detachedCanvas = document.createElement("canvas");

    expect(createWarehouseOrbitControlsOwner(camera, null)).toBeNull();
    expect(createWarehouseOrbitControlsOwner(camera, detachedCanvas)).toBeNull();

    const canvas = document.createElement("canvas");
    document.body.append(canvas);
    const addEventListener = vi.spyOn(canvas, "addEventListener");
    const removeEventListener = vi.spyOn(canvas, "removeEventListener");
    const owner = createWarehouseOrbitControlsOwner(camera, canvas);

    expect(owner).not.toBeNull();
    expect(addEventListener.mock.calls.filter(([event]) => event === "pointerdown"))
      .toHaveLength(1);
    expect(owner?.isActive()).toBe(true);

    owner?.dispose();
    owner?.dispose();

    expect(owner?.isActive()).toBe(false);
    expect(removeEventListener.mock.calls.filter(([event]) => event === "pointerdown"))
      .toHaveLength(1);
    canvas.remove();
  });

  test("balances controls ownership across StrictMode remounts and ignores stale camera updates", () => {
    const canvas = document.createElement("canvas");
    document.body.append(canvas);
    const camera = new OrthographicCamera();
    const invalidate = vi.fn();
    const channel = createWarehouseCameraChannel();
    const addEventListener = vi.spyOn(canvas, "addEventListener");
    const removeEventListener = vi.spyOn(canvas, "removeEventListener");
    vi.mocked(useThree).mockReturnValue({
      camera,
      gl: { domElement: canvas },
      size: { width: 800, height: 600 },
      invalidate,
    } as never);

    const view = render(
      <StrictMode>
        <InteractiveWarehouseCamera
          preset="overview"
          resetRequest={0}
          channel={channel}
          authority
          instanceId="strict-mode-camera"
          workerPoint={{ x: 0, y: 0, z: 0 }}
          onDetailLevelChange={vi.fn()}
        />
      </StrictMode>,
    );

    expect(addEventListener.mock.calls.filter(([event]) => event === "pointerdown"))
      .toHaveLength(2);
    expect(removeEventListener.mock.calls.filter(([event]) => event === "pointerdown"))
      .toHaveLength(1);

    view.unmount();
    const invalidationsAfterUnmount = invalidate.mock.calls.length;
    channel.publish({
      preset: "top",
      position: [0, 18, 0.01],
      target: [0, 0, 0],
      zoom: 10,
    }, "replacement-camera");

    expect(removeEventListener.mock.calls.filter(([event]) => event === "pointerdown"))
      .toHaveLength(2);
    expect(invalidate).toHaveBeenCalledTimes(invalidationsAfterUnmount);
    canvas.remove();
  });

  test("builds one world-space visual cylinder descriptor per existing route segment in order", () => {
    const transform = createWarehouse3DTransform(sampleWarehouse);
    const before = JSON.stringify(routedTimeline);
    const segments = buildWarehouse3DRouteVisualSegments(
      sampleWarehouse,
      routedTimeline,
      transform,
    );

    expect(segments.map(({ fromId, toId }) => [fromId, toId])).toEqual([
      ["office", "F1"],
      ["F1", "F2"],
      ["F2", "loc-D"],
    ]);
    expect(segments).toHaveLength(routedTimeline.legs[0].segments.length);
    expect(segments[0].from).toEqual({
      ...projectNodeToWarehouse3D(sampleWarehouse, "office", transform),
      y: WAREHOUSE_3D_VISUALS.route.y,
    });
    expect(segments.at(-1)?.to).toEqual({
      ...projectNodeToWarehouse3D(sampleWarehouse, "loc-D", transform),
      y: WAREHOUSE_3D_VISUALS.route.y,
    });
    expect(segments.every((segment) => segment.visualLength > 0)).toBe(true);
    expect(JSON.stringify(routedTimeline)).toBe(before);
    expect(routedTimeline.totalDistance).toBe(30);
  });

  test("uses shared rendering constants that prioritize route, worker, and destinations over racks", () => {
    expect(WAREHOUSE_3D_VISUALS.route.radius).toBeGreaterThan(0);
    expect(WAREHOUSE_3D_VISUALS.route.y).toBeGreaterThan(0);
    expect(WAREHOUSE_3D_VISUALS.route.depthTest).toBe(false);
    expect(WAREHOUSE_3D_VISUALS.route.depthWrite).toBe(false);
    expect(WAREHOUSE_3D_VISUALS.worker.ringOuterRadius).toBeGreaterThan(
      WAREHOUSE_3D_VISUALS.worker.bodyBottomRadius,
    );
    expect(WAREHOUSE_3D_VISUALS.worker.ringOuterRadius).toBeGreaterThan(
      WAREHOUSE_3D_VISUALS.destination.ringOuterRadius,
    );
    expect(WAREHOUSE_3D_VISUALS.destination.beaconY).toBeGreaterThan(
      WAREHOUSE_3D_VISUALS.rack.height,
    );
    expect(WAREHOUSE_3D_VISUALS.rack.color).toBe("#96a3ad");
  });

  test("uses an accessible interactive orthographic demand Canvas with a capped DPR", () => {
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
    expect(canvas.closest('[data-warehouse-3d="worker"]')?.getAttribute("data-camera-preset"))
      .toBe("overview");
    expect(canvas.closest('[data-warehouse-3d="worker"]')?.getAttribute("data-camera-authority"))
      .toBe("true");
    expect(recordCanvasProps).toHaveBeenCalledTimes(1);
  });

  test("accepts renderer-only shared camera ownership without changing simulation inputs", () => {
    vi.stubGlobal("WebGLRenderingContext", class WebGLRenderingContext {});
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      getExtension: () => ({ loseContext: vi.fn() }),
    } as unknown as WebGLRenderingContext);
    const before = JSON.stringify({ timeline, snapshot: getSimulationSnapshotAtTime(timeline, 0) });
    render(
      <Warehouse3DViewport
        graph={sampleWarehouse}
        timeline={timeline}
        snapshot={getSimulationSnapshotAtTime(timeline, 0)}
        mode="recommended"
        cameraPreset="aisle"
        cameraResetRequest={3}
        cameraAuthority={false}
        accessibleLabel="Recommended route interactive 3D warehouse"
        fallback={<p>SVG fallback</p>}
      />,
    );
    const wrapper = screen.getByRole("img", {
      name: "Recommended route interactive 3D warehouse",
    }).closest('[data-warehouse-3d="recommended"]');
    expect(wrapper?.getAttribute("data-camera-preset")).toBe("aisle");
    expect(wrapper?.getAttribute("data-camera-authority")).toBe("false");
    expect(JSON.stringify({ timeline, snapshot: getSimulationSnapshotAtTime(timeline, 0) }))
      .toBe(before);
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
