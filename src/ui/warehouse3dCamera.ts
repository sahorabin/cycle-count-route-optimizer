import { WAREHOUSE_WORLD_SPAN, type WorldPoint } from "./warehouse3dProjection";

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

/**
 * Framing box for the orthographic camera: the canonical world span plus a
 * small margin so the warehouse never touches the viewport edge. Deriving it
 * from WAREHOUSE_WORLD_SPAN keeps camera framing and the world transform on one
 * source of truth instead of two independently drifting span constants.
 */
export const WAREHOUSE_CAMERA_FRAME_MARGIN = 1.11;
export const WAREHOUSE_CAMERA_FRAME_SPAN = WAREHOUSE_WORLD_SPAN * WAREHOUSE_CAMERA_FRAME_MARGIN;

/** Aspect-aware base zoom that fits the whole framing box into a viewport. */
export function getWarehouseCameraBaseZoom(
  viewportWidth: number,
  viewportHeight: number,
): number {
  if (!Number.isFinite(viewportWidth) || !Number.isFinite(viewportHeight)) return 1;
  return Math.max(1, Math.min(
    viewportWidth / (WAREHOUSE_CAMERA_FRAME_SPAN * 1.35),
    viewportHeight / WAREHOUSE_CAMERA_FRAME_SPAN,
  ));
}

/**
 * Camera gestures are continuous, but renderer level-of-detail must not be:
 * quantizing the zoom ratio means an orbit or pinch produces a handful of
 * distinct renderer states instead of one React update per frame.
 */
export const WAREHOUSE_ZOOM_BUCKET_STEP = 0.25;

export function getWarehouseZoomBucket(zoom: number, baseZoom: number): number {
  requirePositiveBaseZoom(baseZoom);
  const ratio = Number.isFinite(zoom) ? zoom / baseZoom : 1;
  const clamped = Math.min(
    WAREHOUSE_CAMERA_LIMITS.maxZoomRatio,
    Math.max(WAREHOUSE_CAMERA_LIMITS.minZoomRatio, ratio),
  );
  return Math.round(clamped / WAREHOUSE_ZOOM_BUCKET_STEP) * WAREHOUSE_ZOOM_BUCKET_STEP;
}

export function getWarehouseDetailLevelForZoomRatio(
  zoomRatio: number,
): WarehouseLocationDetailLevel {
  return Number.isFinite(zoomRatio) && zoomRatio >= WAREHOUSE_CAMERA_LIMITS.closeDetailZoomRatio
    ? "close"
    : "overview";
}

/**
 * The automatic service shot: a medium operational framing that holds the
 * worker, the active location, and the surrounding rack and aisle in frame.
 *
 * Deliberately not a portrait. The elevation sits lower than the contextual
 * presets so rack faces are seen from an observer's height rather than looked
 * down on, and the zoom stays wide enough that the operator reads as a person
 * working inside a warehouse rather than a character filling the screen.
 */
export const WAREHOUSE_STORY_SHOT = {
  offset: [9.5, 6.6, 9.5] as const,
  zoomRatio: 2.2,
} as const;

function lerp(from: number, to: number, blend: number): number {
  return from + (to - from) * blend;
}

/**
 * Blends a contextual preset view toward the service shot. `blend` is supplied
 * by the caller from existing physical service time, so this stays a pure
 * function with no interpolation state of its own.
 */
export function createWarehouseStoryCameraView(
  baseView: WarehouseCameraView,
  focusPoint: WorldPoint,
  blend: number,
  baseZoom: number,
): WarehouseCameraView {
  requirePositiveBaseZoom(baseZoom);
  const amount = Number.isFinite(blend) ? Math.min(1, Math.max(0, blend)) : 0;
  const target = [focusPoint.x, 0, focusPoint.z] as const;
  const shotPosition = [
    target[0] + WAREHOUSE_STORY_SHOT.offset[0],
    target[1] + WAREHOUSE_STORY_SHOT.offset[1],
    target[2] + WAREHOUSE_STORY_SHOT.offset[2],
  ] as const;

  return {
    preset: baseView.preset,
    target: [
      lerp(baseView.target[0], target[0], amount),
      lerp(baseView.target[1], target[1], amount),
      lerp(baseView.target[2], target[2], amount),
    ],
    position: [
      lerp(baseView.position[0], shotPosition[0], amount),
      lerp(baseView.position[1], shotPosition[1], amount),
      lerp(baseView.position[2], shotPosition[2], amount),
    ],
    zoom: clampWarehouseCameraZoom(
      lerp(baseView.zoom, baseZoom * WAREHOUSE_STORY_SHOT.zoomRatio, amount),
      baseZoom,
    ),
  };
}

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
  /**
   * A locomotion-reading shot, not a map view.
   *
   * Two things decide this framing. Rack runs are long in Z and thin in X, so
   * the aisles run along Z: a camera offset mainly in Z looks *down* the
   * corridor and has clear sight of the operator, while the old 45-degree
   * diagonal looked across the rows and put 2.3-unit racking in front of the
   * body. And elevation has to stay near 28 degrees -- steeper foreshortens a
   * stride into nothing, shallower buries the legs behind the nearest run.
   *
   * The small X offset keeps it a three-quarter view rather than a flat rear
   * shot, so both legs and both arms stay readable and the direction of travel
   * is obvious. The zoom still shows the aisle and neighbouring racks; this is
   * a context shot, not a portrait.
   */
  worker: {
    offset: [3, 5.5, 10] as const,
    zoomRatio: 2.4,
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
  /**
   * Which way the operator is walking. Worker focus swings its offset behind
   * that heading so it always looks along the aisle the operator is actually
   * in, instead of across the rows where 2.3-unit racking stands in front of
   * the body. Renderer-only: it reads the same yaw the figure is drawn with.
   */
  facingYaw?: number,
): WarehouseCameraView {
  requirePositiveBaseZoom(baseZoom);
  const config = PRESET_CONFIG[preset];
  const target = preset === "worker" && workerPoint
    ? [workerPoint.x, 0, workerPoint.z] as const
    : [0, 0, 0] as const;

  const [offsetX, offsetY, offsetZ] = config.offset;
  const yaw = preset === "worker" && Number.isFinite(facingYaw) ? facingYaw as number : 0;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const offset = [
    offsetX * cos + offsetZ * sin,
    offsetY,
    offsetZ * cos - offsetX * sin,
  ] as const;

  return {
    preset,
    target,
    position: [
      target[0] + offset[0],
      target[1] + offset[1],
      target[2] + offset[2],
    ],
    zoom: clampWarehouseCameraZoom(baseZoom * config.zoomRatio, baseZoom),
  };
}

export function getWarehouseLocationDetailLevel(
  zoom: number,
  baseZoom: number,
): WarehouseLocationDetailLevel {
  requirePositiveBaseZoom(baseZoom);
  return getWarehouseDetailLevelForZoomRatio(zoom / baseZoom);
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
