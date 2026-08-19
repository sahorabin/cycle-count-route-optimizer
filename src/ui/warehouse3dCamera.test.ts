import { describe, expect, test, vi } from "vitest";
import { WAREHOUSE_WORLD_SPAN } from "./warehouse3dProjection";
import {
  clampWarehouseCameraZoom,
  createWarehouseCameraChannel,
  createWarehouseCameraPresetView,
  createWarehouseStoryCameraView,
  getWarehouseCameraBaseZoom,
  getWarehouseDetailLevelForZoomRatio,
  getWarehouseLocationDetailLevel,
  getWarehouseZoomBucket,
  shouldRenderWarehouseLocation,
  WAREHOUSE_CAMERA_FRAME_MARGIN,
  WAREHOUSE_CAMERA_FRAME_SPAN,
  WAREHOUSE_CAMERA_LIMITS,
  WAREHOUSE_STORY_SHOT,
  WAREHOUSE_ZOOM_BUCKET_STEP,
} from "./warehouse3dCamera";

describe("warehouse 3D camera model", () => {
  test("defines deterministic reset views for every preset", () => {
    for (const preset of ["overview", "top", "aisle", "worker"] as const) {
      const worker = { x: 3, y: 0, z: -4 };
      expect(createWarehouseCameraPresetView(preset, 12, worker)).toEqual(
        createWarehouseCameraPresetView(preset, 12, worker),
      );
    }
  });

  test("keeps zoom within conservative renderer limits", () => {
    const baseZoom = 10;
    expect(clampWarehouseCameraZoom(0, baseZoom)).toBe(
      baseZoom * WAREHOUSE_CAMERA_LIMITS.minZoomRatio,
    );
    expect(clampWarehouseCameraZoom(1_000, baseZoom)).toBe(
      baseZoom * WAREHOUSE_CAMERA_LIMITS.maxZoomRatio,
    );
    expect(clampWarehouseCameraZoom(Number.NaN, baseZoom)).toBe(baseZoom);
  });

  test("worker focus targets the projected worker while retaining surrounding context", () => {
    const worker = { x: 4, y: 0, z: -6 };
    const view = createWarehouseCameraPresetView("worker", 10, worker);
    expect(view.target).toEqual([4, 0, -6]);
    expect(view.position).toEqual([7, 5.5, 4]);
    expect(view.zoom).toBe(24);
  });

  test("keeps worker focus low enough to read a walking stride", () => {
    const worker = { x: 0, y: 0, z: 0 };
    const view = createWarehouseCameraPresetView("worker", 10, worker);
    const [x, y, z] = view.position;
    const elevation = Math.atan2(y, Math.hypot(x, z)) * (180 / Math.PI);

    // Looking down from steeply above foreshortens a stride into nothing, which
    // is what made the operator read as sliding; straight-on hides the aisle.
    expect(elevation).toBeGreaterThan(15);
    expect(elevation).toBeLessThan(32);
    // Three-quarter, not a straight rear or side shot: both legs stay readable.
    expect(Math.abs(x)).toBeGreaterThan(1);
    expect(Math.abs(z)).toBeGreaterThan(1);
    // Aisles run along Z, so the shot looks down the corridor rather than
    // across the rows, where racking would stand in front of the operator.
    expect(Math.abs(z)).toBeGreaterThan(Math.abs(x) * 2);
    // Still a context shot, not a portrait: the warehouse stays in frame.
    expect(view.zoom).toBeLessThan(10 * 2.5);
  });

  test("synchronizes either comparison camera through one renderer channel", () => {
    const channel = createWarehouseCameraChannel();
    const workerReceiver = vi.fn();
    const recommendedReceiver = vi.fn();
    channel.subscribe(workerReceiver);
    channel.subscribe(recommendedReceiver);
    const workerView = createWarehouseCameraPresetView("aisle", 12);
    channel.publish(workerView, "worker");
    expect(recommendedReceiver).toHaveBeenLastCalledWith(workerView, "worker");
    const recommendedView = createWarehouseCameraPresetView("top", 12);
    channel.publish(recommendedView, "recommended");
    expect(workerReceiver).toHaveBeenLastCalledWith(recommendedView, "recommended");
    expect(channel.getView()).toEqual(recommendedView);
  });

  test("removes an unmounted subscriber before a replacement camera subscribes", () => {
    const channel = createWarehouseCameraChannel();
    const disposedReceiver = vi.fn();
    const unsubscribe = channel.subscribe(disposedReceiver);
    const initialView = createWarehouseCameraPresetView("overview", 12);
    channel.publish(initialView, "initial-camera");

    unsubscribe();
    unsubscribe();
    const replacementReceiver = vi.fn();
    const unsubscribeReplacement = channel.subscribe(replacementReceiver);
    const replacementView = createWarehouseCameraPresetView("aisle", 12);
    channel.publish(replacementView, "replacement-camera");

    expect(disposedReceiver).toHaveBeenCalledTimes(1);
    expect(replacementReceiver).toHaveBeenNthCalledWith(1, initialView, "initial");
    expect(replacementReceiver).toHaveBeenNthCalledWith(
      2,
      replacementView,
      "replacement-camera",
    );
    unsubscribeReplacement();
  });

  test("reduces overview density but never hides selected destinations", () => {
    expect(getWarehouseLocationDetailLevel(10, 10)).toBe("overview");
    expect(getWarehouseLocationDetailLevel(14, 10)).toBe("close");
    expect(shouldRenderWarehouseLocation(false, "overview")).toBe(false);
    expect(shouldRenderWarehouseLocation(true, "overview")).toBe(true);
    expect(shouldRenderWarehouseLocation(false, "close")).toBe(true);
  });
});

describe("warehouse 3D framing constants", () => {
  test("derives camera framing from the one canonical world span", () => {
    expect(WAREHOUSE_CAMERA_FRAME_SPAN).toBe(WAREHOUSE_WORLD_SPAN * WAREHOUSE_CAMERA_FRAME_MARGIN);
    expect(WAREHOUSE_CAMERA_FRAME_MARGIN).toBeGreaterThan(1);
    // The framing box keeps a margin around the projected warehouse.
    expect(WAREHOUSE_CAMERA_FRAME_SPAN).toBeGreaterThan(WAREHOUSE_WORLD_SPAN);
  });

  test("fits the framing box into any viewport with a positive finite zoom", () => {
    const wide = getWarehouseCameraBaseZoom(1280, 900);
    const narrow = getWarehouseCameraBaseZoom(375, 812);

    expect(wide).toBeGreaterThan(narrow);
    for (const zoom of [wide, narrow, getWarehouseCameraBaseZoom(0, 0)]) {
      expect(Number.isFinite(zoom)).toBe(true);
      expect(zoom).toBeGreaterThan(0);
    }
    expect(getWarehouseCameraBaseZoom(Number.NaN, 900)).toBe(1);
  });

  test("keeps every preset valid under the shared framing", () => {
    const baseZoom = getWarehouseCameraBaseZoom(1280, 900);

    for (const preset of ["overview", "top", "aisle", "worker"] as const) {
      const view = createWarehouseCameraPresetView(preset, baseZoom, { x: 1, y: 0, z: -2 });
      expect(view.zoom).toBe(clampWarehouseCameraZoom(view.zoom, baseZoom));
      expect([...view.position, ...view.target].every(Number.isFinite)).toBe(true);
    }
  });
});

describe("zoom bucketing", () => {
  test("quantizes continuous zoom into a small set of renderer states", () => {
    const baseZoom = 10;
    const buckets = new Set(
      Array.from({ length: 200 }, (_unused, index) => getWarehouseZoomBucket(
        baseZoom * (0.4 + index * 0.02),
        baseZoom,
      )),
    );

    expect(buckets.size).toBeLessThanOrEqual(16);
    for (const bucket of buckets) {
      expect(Math.round(bucket / WAREHOUSE_ZOOM_BUCKET_STEP) * WAREHOUSE_ZOOM_BUCKET_STEP)
        .toBeCloseTo(bucket);
      expect(bucket).toBeGreaterThanOrEqual(WAREHOUSE_CAMERA_LIMITS.minZoomRatio - 0.25);
      expect(bucket).toBeLessThanOrEqual(WAREHOUSE_CAMERA_LIMITS.maxZoomRatio + 0.25);
    }
    expect(getWarehouseZoomBucket(Number.NaN, baseZoom)).toBe(1);
  });

  test("shares one detail-level rule with the zoom-based helper", () => {
    const baseZoom = 8;

    for (const ratio of [0.6, 1, 1.34, 1.35, 2, 3]) {
      expect(getWarehouseDetailLevelForZoomRatio(ratio))
        .toBe(getWarehouseLocationDetailLevel(baseZoom * ratio, baseZoom));
    }
    expect(getWarehouseDetailLevelForZoomRatio(Number.NaN)).toBe("overview");
  });
});

describe("story camera view", () => {
  const baseZoom = 12;
  const baseView = createWarehouseCameraPresetView("overview", baseZoom);
  const focus = { x: 4, y: 0, z: -3 };

  test("is exactly the contextual view at zero blend", () => {
    expect(createWarehouseStoryCameraView(baseView, focus, 0, baseZoom)).toEqual(baseView);
  });

  test("frames the active location as a medium operational shot at full blend", () => {
    const shot = createWarehouseStoryCameraView(baseView, focus, 1, baseZoom);

    expect(shot.target).toEqual([focus.x, 0, focus.z]);
    expect(shot.position).toEqual([
      focus.x + WAREHOUSE_STORY_SHOT.offset[0],
      WAREHOUSE_STORY_SHOT.offset[1],
      focus.z + WAREHOUSE_STORY_SHOT.offset[2],
    ]);
    expect(shot.zoom).toBeGreaterThan(baseView.zoom);
    expect(shot.zoom).toBe(clampWarehouseCameraZoom(shot.zoom, baseZoom));
    // Medium shot, not a portrait: the view still spans several world units.
    expect(WAREHOUSE_CAMERA_FRAME_SPAN / (shot.zoom / baseZoom)).toBeGreaterThan(5);
    expect(shot.preset).toBe(baseView.preset);
  });

  test("observes the work from near eye level rather than looking down on it", () => {
    const elevation = (offset: readonly [number, number, number]) =>
      Math.atan2(offset[1], Math.hypot(offset[0], offset[2]));
    const overview = createWarehouseCameraPresetView("overview", baseZoom);
    const overviewOffset = [
      overview.position[0] - overview.target[0],
      overview.position[1] - overview.target[1],
      overview.position[2] - overview.target[2],
    ] as const;

    expect(elevation(WAREHOUSE_STORY_SHOT.offset)).toBeLessThan(elevation(overviewOffset));
    // Still above the floor plane, and inside the orbit limits.
    expect(elevation(WAREHOUSE_STORY_SHOT.offset)).toBeGreaterThan(0.2);
    expect(Math.PI / 2 - elevation(WAREHOUSE_STORY_SHOT.offset))
      .toBeLessThan(WAREHOUSE_CAMERA_LIMITS.maxPolarAngle);
    expect(Math.PI / 2 - elevation(WAREHOUSE_STORY_SHOT.offset))
      .toBeGreaterThan(WAREHOUSE_CAMERA_LIMITS.minPolarAngle);
  });

  test("interpolates monotonically and clamps invalid blends", () => {
    const quarter = createWarehouseStoryCameraView(baseView, focus, 0.25, baseZoom);
    const half = createWarehouseStoryCameraView(baseView, focus, 0.5, baseZoom);

    expect(quarter.zoom).toBeLessThan(half.zoom);
    expect(half.target[0]).toBeCloseTo(baseView.target[0] + (focus.x - baseView.target[0]) * 0.5);
    expect(createWarehouseStoryCameraView(baseView, focus, -3, baseZoom)).toEqual(baseView);
    expect(createWarehouseStoryCameraView(baseView, focus, 9, baseZoom))
      .toEqual(createWarehouseStoryCameraView(baseView, focus, 1, baseZoom));
    expect(createWarehouseStoryCameraView(baseView, focus, Number.NaN, baseZoom)).toEqual(baseView);
  });
});
