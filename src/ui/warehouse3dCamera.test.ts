import { describe, expect, test, vi } from "vitest";
import {
  clampWarehouseCameraZoom,
  createWarehouseCameraChannel,
  createWarehouseCameraPresetView,
  getWarehouseLocationDetailLevel,
  shouldRenderWarehouseLocation,
  WAREHOUSE_CAMERA_LIMITS,
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
    expect(view.position).toEqual([13, 9, 3]);
    expect(view.zoom).toBe(16.5);
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
