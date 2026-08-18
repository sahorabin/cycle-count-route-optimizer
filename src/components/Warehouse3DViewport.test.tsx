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
  WAREHOUSE_3D_MATERIALS,
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

/** HSL saturation of a #rrggbb string, used to police the industrial palette. */
function hexSaturation(hex: string): number {
  const [red, green, blue] = [1, 3, 5].map((offset) =>
    Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  if (max === min) return 0;
  const lightness = (max + min) / 2;
  return lightness > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min);
}

function collectHexColors(value: unknown): string[] {
  if (typeof value === "string") return /^#[0-9a-f]{6}$/i.test(value) ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(collectHexColors);
  if (value && typeof value === "object") return Object.values(value).flatMap(collectHexColors);
  return [];
}

describe("warehouse 3D art direction", () => {
  test("keeps the whole scene palette within a muted industrial range", () => {
    const colors = collectHexColors(WAREHOUSE_3D_MATERIALS);

    expect(colors.length).toBeGreaterThan(15);
    for (const color of colors) {
      expect({ color, saturation: hexSaturation(color) < 0.65 })
        .toEqual({ color, saturation: true });
    }
    // Guard against a vacuous threshold: the bright tints this replaced fail it.
    expect(hexSaturation("#f59e0b")).toBeGreaterThan(0.65);
    expect(hexSaturation("#2563eb")).toBeGreaterThan(0.65);
  });

  test("separates floor, structure, and stored goods by value", () => {
    const luminance = (hex: string) => [1, 3, 5]
      .map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16))
      .reduce((total, channel) => total + channel, 0) / 3;

    // Racking must read darker than the floor it stands on, and goods warmer/darker still.
    expect(luminance(WAREHOUSE_3D_MATERIALS.rackUpright.color))
      .toBeLessThan(luminance(WAREHOUSE_3D_MATERIALS.floor.color));
    expect(luminance(WAREHOUSE_3D_MATERIALS.rackUpright.color))
      .toBeLessThan(luminance(WAREHOUSE_3D_MATERIALS.rackShelf.color));
    expect(luminance(WAREHOUSE_3D_MATERIALS.pallet.color))
      .toBeLessThan(luminance(WAREHOUSE_3D_MATERIALS.floor.color));
    expect(WAREHOUSE_3D_MATERIALS.rackUpright.metalness)
      .toBeGreaterThan(WAREHOUSE_3D_MATERIALS.rackShelf.roughness - 1);
  });

  test("lights the scene with a key and a weaker opposite fill", () => {
    const { keyIntensity, fillIntensity, hemisphereIntensity } = WAREHOUSE_3D_MATERIALS.lighting;

    expect(fillIntensity).toBeGreaterThan(0);
    expect(fillIntensity).toBeLessThan(keyIntensity);
    expect(hemisphereIntensity).toBeLessThan(1);
    expect(WAREHOUSE_3D_MATERIALS.lighting.fillPosition[0])
      .toBeLessThan(WAREHOUSE_3D_MATERIALS.lighting.keyPosition[0]);
  });

  test("draws the route as a surveyed line, not a painted stripe", () => {
    const route = WAREHOUSE_3D_VISUALS.route;

    // The pre-S7E stripe was radius 0.1 at full opacity.
    expect(route.radius).toBeLessThan(0.06);
    expect(route.opacity).toBeLessThan(1);
    expect(route.activeRadius).toBeGreaterThan(route.radius);
    expect(route.activeOpacity).toBeGreaterThan(route.opacity);
    expect(route.activeOpacity).toBeLessThanOrEqual(1);
    // Still legible over the floor rather than hidden by it.
    expect(route.y).toBeGreaterThan(0);
    expect(route.depthTest).toBe(false);
  });

  test("tags each route segment with its leg so the walked one can lead", () => {
    const transform = createWarehouse3DTransform(sampleWarehouse);
    const segments = buildWarehouse3DRouteVisualSegments(
      sampleWarehouse,
      routedTimeline,
      transform,
    );

    expect(segments.every(({ legIndex }) => legIndex === 0)).toBe(true);
    expect(segments.map(({ legIndex }) => legIndex))
      .toHaveLength(routedTimeline.legs[0].segments.length);
  });

  test("keeps operator and destination markers compact", () => {
    const { worker, destination } = WAREHOUSE_3D_VISUALS;

    // Pre-S7E: worker ring 0.60, disc 0.40, beacon 0.20.
    expect(worker.ringOuterRadius).toBeLessThan(0.4);
    expect(worker.discRadius).toBeLessThan(0.3);
    expect(worker.discRadius).toBeGreaterThanOrEqual(worker.ringInnerRadius);
    expect(destination.beaconRadius).toBeLessThan(0.12);
    // The ground ring still has to out-read the body it sits under.
    expect(worker.ringOuterRadius).toBeGreaterThan(worker.bodyBottomRadius);
  });
});

describe("warehouse 3D readability", () => {
  const luminance = (hex: string) => [1, 3, 5]
    .map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16))
    .reduce((total, channel) => total + channel, 0) / 3;

  test("never lets repeated rack geometry cast shadows", () => {
    const casters = WAREHOUSE_3D_MATERIALS.shadowCasters;

    for (const structural of ["rackUpright", "rackBeam", "rackShelf", "rackGuard", "aisleSign"] as const) {
      expect({ part: structural, casts: casters[structural] })
        .toEqual({ part: structural, casts: false });
    }
    expect(casters.pallet).toBe(false);
    expect(casters.carton).toBe(false);
    // The operator is the one object whose floor contact carries meaning.
    expect(casters.worker).toBe(true);
  });

  test("keeps the grounding pass restrained and mobile-aware", () => {
    const { shadow } = WAREHOUSE_3D_MATERIALS;

    expect(shadow.opacity).toBeGreaterThan(0);
    expect(shadow.opacity).toBeLessThan(0.5);
    expect(shadow.mapSize).toBeLessThanOrEqual(1024);
    expect(shadow.minimumCanvasWidth).toBeGreaterThan(0);
  });

  test("separates the scene by luminance instead of sinking it toward black", () => {
    const background = luminance(WAREHOUSE_3D_MATERIALS.background);
    const floor = luminance(WAREHOUSE_3D_MATERIALS.floor.color);
    const rack = luminance(WAREHOUSE_3D_MATERIALS.rackUpright.color);
    const carton = luminance(WAREHOUSE_3D_MATERIALS.carton.color);

    // Dark industrial, not black.
    expect(background).toBeGreaterThan(16);
    // Each layer is a visible step, not a hairline difference.
    expect(floor - background).toBeGreaterThan(40);
    expect(rack - background).toBeGreaterThan(20);
    expect(floor - rack).toBeGreaterThan(10);
    expect(carton).toBeGreaterThan(rack);
  });

  test("lights the scene without leaning on a single harsh key", () => {
    const { lighting } = WAREHOUSE_3D_MATERIALS;

    expect(lighting.hemisphereIntensity).toBeGreaterThan(0.7);
    expect(lighting.fillIntensity / lighting.keyIntensity).toBeGreaterThan(0.3);
    expect(luminance(lighting.sky)).toBeGreaterThan(luminance(lighting.ground));
  });

  test("keeps the three route states ordered and all of them visible", () => {
    const route = WAREHOUSE_3D_VISUALS.route;

    expect(route.opacity).toBeLessThan(route.traversedOpacity);
    expect(route.traversedOpacity).toBeLessThan(route.activeOpacity);
    expect(route.radius).toBeLessThan(route.traversedRadius);
    expect(route.traversedRadius).toBeLessThan(route.activeRadius);
    // A planned leg must survive against dark racking rather than vanish.
    expect(route.opacity).toBeGreaterThan(0.35);
    // Still a survey line, never a pipe.
    expect(route.activeRadius).toBeLessThan(0.07);
  });

  test("gives the active count the strongest operational accent", () => {
    const accent = luminance(WAREHOUSE_3D_MATERIALS.activeAccent);

    expect(accent).toBeGreaterThan(luminance(WAREHOUSE_3D_MATERIALS.rackUpright.color));
    expect(accent).toBeGreaterThan(luminance(WAREHOUSE_3D_MATERIALS.floor.color));
    expect(accent).toBeGreaterThan(luminance(WAREHOUSE_3D_MATERIALS.completedLocation));
  });

  test("emits only finite environment constants", () => {
    const numbers = collectNumbers(WAREHOUSE_3D_MATERIALS);

    expect(numbers.length).toBeGreaterThan(10);
    expect(numbers.every(Number.isFinite)).toBe(true);
  });
});

function collectNumbers(value: unknown): number[] {
  if (typeof value === "number") return [value];
  if (Array.isArray(value)) return value.flatMap(collectNumbers);
  if (value && typeof value === "object") return Object.values(value).flatMap(collectNumbers);
  return [];
}
