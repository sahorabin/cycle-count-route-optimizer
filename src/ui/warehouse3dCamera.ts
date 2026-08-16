import type { WorldPoint } from "./warehouse3dProjection";

export type WarehouseCameraPreset = "overview" | "top" | "aisle" | "worker";
export type WarehouseLocationDetailLevel = "overview" | "close";

export interface WarehouseCameraView {
  readonly preset: WarehouseCameraPreset;
  readonly position: readonly [number, number, number];
  readonly target: readonly [number, number, number];
  readonly zoom: number;
}

export const WAREHOUSE_CAMERA_LIMITS = {
  minPolarAngle: 0.18,
  maxPolarAngle: Math.PI / 2 - 0.08,
  minZoomRatio: 0.55,
  maxZoomRatio: 3.25,
  targetExtent: 13,
  closeDetailZoomRatio: 1.35,
} as const;

const PRESET_CONFIG = {
  overview: {
    offset: [15, 19, 15] as const,
    zoomRatio: 1,
  },
  top: {
    offset: [0.5, 29, 2.5] as const,
    zoomRatio: 1.05,
  },
  aisle: {
    offset: [22, 7.5, 2] as const,
    zoomRatio: 1.2,
  },
  worker: {
    offset: [9, 9, 9] as const,
    zoomRatio: 1.65,
  },
} satisfies Record<WarehouseCameraPreset, {
  readonly offset: readonly [number, number, number];
  readonly zoomRatio: number;
}>;

function requirePositiveBaseZoom(baseZoom: number): void {
  if (!Number.isFinite(baseZoom) || baseZoom <= 0) {
    throw new Error("Warehouse camera base zoom must be finite and greater than zero.");
  }
}

export function clampWarehouseCameraZoom(zoom: number, baseZoom: number): number {
  requirePositiveBaseZoom(baseZoom);
  const minimum = baseZoom * WAREHOUSE_CAMERA_LIMITS.minZoomRatio;
  const maximum = baseZoom * WAREHOUSE_CAMERA_LIMITS.maxZoomRatio;
  if (!Number.isFinite(zoom)) return baseZoom;
  return Math.min(maximum, Math.max(minimum, zoom));
}

/** Deterministic renderer-only view. No route distance or timing enters this calculation. */
export function createWarehouseCameraPresetView(
  preset: WarehouseCameraPreset,
  baseZoom: number,
  workerPoint?: WorldPoint,
): WarehouseCameraView {
  requirePositiveBaseZoom(baseZoom);
  const config = PRESET_CONFIG[preset];
  const target = preset === "worker" && workerPoint
    ? [workerPoint.x, 0, workerPoint.z] as const
    : [0, 0, 0] as const;

  return {
    preset,
    target,
    position: [
      target[0] + config.offset[0],
      target[1] + config.offset[1],
      target[2] + config.offset[2],
    ],
    zoom: clampWarehouseCameraZoom(baseZoom * config.zoomRatio, baseZoom),
  };
}

export function getWarehouseLocationDetailLevel(
  zoom: number,
  baseZoom: number,
): WarehouseLocationDetailLevel {
  requirePositiveBaseZoom(baseZoom);
  return zoom / baseZoom >= WAREHOUSE_CAMERA_LIMITS.closeDetailZoomRatio
    ? "close"
    : "overview";
}

export function shouldRenderWarehouseLocation(
  selected: boolean,
  detailLevel: WarehouseLocationDetailLevel,
): boolean {
  return selected || detailLevel === "close";
}

export interface WarehouseCameraChannel {
  readonly getView: () => WarehouseCameraView | null;
  readonly publish: (view: WarehouseCameraView, sourceId: string) => void;
  readonly subscribe: (
    listener: (view: WarehouseCameraView, sourceId: string) => void,
  ) => () => void;
}

function copyCameraView(view: WarehouseCameraView): WarehouseCameraView {
  return {
    preset: view.preset,
    position: [...view.position],
    target: [...view.target],
    zoom: view.zoom,
  };
}

/** Mutable renderer channel that synchronizes canvases without React tree updates per gesture. */
export function createWarehouseCameraChannel(): WarehouseCameraChannel {
  let current: WarehouseCameraView | null = null;
  const listeners = new Set<(view: WarehouseCameraView, sourceId: string) => void>();

  return {
    getView: () => current ? copyCameraView(current) : null,
    publish(view, sourceId) {
      current = copyCameraView(view);
      for (const listener of listeners) listener(copyCameraView(current), sourceId);
    },
    subscribe(listener) {
      listeners.add(listener);
      if (current) listener(copyCameraView(current), "initial");
      return () => listeners.delete(listener);
    },
  };
}
