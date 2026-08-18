import type { CountServiceClass, NodeId, RouteTimeline } from "../domain/types";
import type { SimulationSnapshot } from "../simulation/types";
import type { Point } from "./svgPoints";
import {
  projectDisplayPointToWarehouse3D,
  type Warehouse3DTransform,
  type WorldPoint,
} from "./warehouse3dProjection";

/**
 * Renderer-only bridge from S7C service truth to counting visuals.
 *
 * Nothing here computes routing, distance, or physical duration. Every value
 * is a pure function of an existing `SimulationSnapshot` / `RouteTimeline`,
 * so the visuals inherit pause, seek, reset, and playback-rate behaviour from
 * the one shared playback clock instead of owning any time of their own.
 */

/** Scan cycles per physical service second. One cycle is ~2.2s of counting work. */
export const COUNTING_GESTURE_HZ = 0.45;

/** Pulses per physical second for the active-location highlight. Deliberately slow. */
export const SERVICE_PULSE_HZ = 0.5;

export const SERVICE_PROGRESS_SEGMENTS = 16;

/** How long, in physical seconds, the "count complete" pulse stays visible. */
export const SERVICE_COMPLETION_PULSE_SECONDS = 1.4;

const TAU = Math.PI * 2;

/** Non-finite or negative renderer inputs collapse to zero rather than producing NaN geometry. */
function safeSeconds(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function clampUnitInterval(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Bounded, stateless counting-gesture parameters in radians / unit intervals. */
export interface WarehouseCountingGesture {
  readonly cycle: number;
  readonly scanReach: number;
  readonly armLift: number;
  readonly supportSwing: number;
  readonly torsoTwist: number;
  readonly headDip: number;
}

/**
 * Derives the whole counting gesture from service elapsed time alone. There is
 * no accumulator and no wall clock, so the same elapsed time always produces
 * the same pose, and seeking lands on the correct pose immediately.
 */
export function createWarehouseCountingGesture(elapsedSeconds: number): WarehouseCountingGesture {
  const cycle = (safeSeconds(elapsedSeconds) * COUNTING_GESTURE_HZ) % 1;
  const phase = cycle * TAU;
  // Smooth 0 → 1 → 0 reach so the scanner eases in and out instead of snapping.
  const scanReach = (1 - Math.cos(phase)) / 2;

  return {
    cycle,
    scanReach,
    armLift: 1.05 + 0.32 * scanReach,
    supportSwing: 0.28 + 0.12 * Math.sin(phase),
    torsoTwist: 0.08 * Math.sin(phase),
    headDip: 0.45 + 0.55 * scanReach,
  };
}

/**
 * The single decision point for counting choreography: a gesture while the
 * shared snapshot says this route is servicing, `null` while it travels or
 * after it completes.
 */
export function getWarehouseWorkerCountingGesture(
  snapshot: SimulationSnapshot,
): WarehouseCountingGesture | null {
  return snapshot.current?.kind === "service"
    ? createWarehouseCountingGesture(snapshot.current.elapsedSeconds)
    : null;
}

export type WarehouseLocationVisualState = "active" | "completed" | "pending" | "idle";

/**
 * Renderer interpretation of existing snapshot truth. Completion comes only
 * from `completedDestinationIds`, which S7C advances at service end -- never
 * on arrival -- so this never has to restate a timeline boundary rule.
 */
export function getWarehouseLocationVisualState(
  locationId: NodeId,
  snapshot: SimulationSnapshot,
  routeLocationIds: ReadonlySet<NodeId>,
): WarehouseLocationVisualState {
  if (snapshot.current?.kind === "service" && snapshot.current.locationId === locationId) {
    return "active";
  }
  if (snapshot.completedDestinationIds.includes(locationId)) return "completed";
  return routeLocationIds.has(locationId) ? "pending" : "idle";
}

export interface WarehouseServiceProgressSegment {
  readonly index: number;
  /** Start angle of this segment's arc, in radians. */
  readonly startAngleRadians: number;
  readonly filled: boolean;
}

export interface WarehouseServiceProgressRing {
  readonly totalSegments: number;
  readonly filledSegments: number;
  readonly segmentAngleRadians: number;
  readonly segments: readonly WarehouseServiceProgressSegment[];
}

/**
 * Quantizes existing snapshot progress into ring segments. Progress is never
 * recomputed from elapsed/duration here -- the snapshot already supplies it.
 */
export function createWarehouseServiceProgressRing(
  progress: number,
  totalSegments: number = SERVICE_PROGRESS_SEGMENTS,
): WarehouseServiceProgressRing {
  const segmentAngleRadians = TAU / totalSegments;
  const filledSegments = Math.min(
    totalSegments,
    Math.floor(clampUnitInterval(progress) * totalSegments),
  );

  return {
    totalSegments,
    filledSegments,
    segmentAngleRadians,
    segments: Array.from({ length: totalSegments }, (_unused, index) => ({
      index,
      startAngleRadians: index * segmentAngleRadians,
      filled: index < filledSegments,
    })),
  };
}

export interface WarehouseActiveServiceVisual {
  readonly locationId: NodeId;
  readonly serviceClass: CountServiceClass | null;
  readonly progress: number;
  readonly elapsedSeconds: number;
  readonly durationSeconds: number;
  readonly remainingSeconds: number;
  readonly position: WorldPoint;
  readonly gesture: WarehouseCountingGesture;
  readonly ring: WarehouseServiceProgressRing;
  /** 0..1 highlight breathing value; renderer-only. */
  readonly pulse: number;
}

/**
 * Projects the active service location exactly once, from a caller-supplied
 * coordinate lookup, so decorative service primitives never each rebuild a
 * warehouse-sized coordinate Map. Returns null when this route is not
 * currently servicing, or when the location has no usable display point.
 */
export function createWarehouseActiveServiceVisual(
  snapshot: SimulationSnapshot,
  transform: Warehouse3DTransform,
  coordinates: ReadonlyMap<NodeId, Point>,
): WarehouseActiveServiceVisual | null {
  const current = snapshot.current;
  if (current?.kind !== "service") return null;

  const point = coordinates.get(current.locationId);
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;

  const elapsedSeconds = safeSeconds(current.elapsedSeconds);

  return {
    locationId: current.locationId,
    serviceClass: current.serviceClass,
    progress: clampUnitInterval(current.progress),
    elapsedSeconds: current.elapsedSeconds,
    durationSeconds: current.durationSeconds,
    remainingSeconds: current.remainingSeconds,
    position: projectDisplayPointToWarehouse3D(point, transform),
    gesture: createWarehouseCountingGesture(current.elapsedSeconds),
    ring: createWarehouseServiceProgressRing(current.progress),
    pulse: (1 - Math.cos(elapsedSeconds * SERVICE_PULSE_HZ * TAU)) / 2,
  };
}

export interface WarehouseServiceCompletionVisual {
  readonly locationId: NodeId;
  readonly position: WorldPoint;
  /** 1 at the instant service ended, fading to 0 across the visual window. */
  readonly intensity: number;
}

/**
 * A short "count complete" pulse derived from how far the shared clock has
 * moved past a service phase's existing `endTimeSeconds`. It adds no physical
 * time, delays nothing, and needs no timer: seeking into the window shows it,
 * seeking out of it hides it.
 */
export function createWarehouseServiceCompletionVisual(
  timeline: RouteTimeline,
  snapshot: SimulationSnapshot,
  transform: Warehouse3DTransform,
  coordinates: ReadonlyMap<NodeId, Point>,
): WarehouseServiceCompletionVisual | null {
  // A finished route holds its final time forever, which would freeze the
  // pulse on permanently. The persistent completed state carries it instead.
  if (snapshot.isComplete) return null;

  let latest: { locationId: NodeId; elapsedSinceEnd: number } | null = null;
  for (const phase of timeline.phases) {
    if (phase.kind !== "service" || phase.durationSeconds <= 0) continue;
    const elapsedSinceEnd = snapshot.timeSeconds - phase.endTimeSeconds;
    if (elapsedSinceEnd < 0 || elapsedSinceEnd >= SERVICE_COMPLETION_PULSE_SECONDS) continue;
    if (!latest || elapsedSinceEnd < latest.elapsedSinceEnd) {
      latest = { locationId: phase.locationId, elapsedSinceEnd };
    }
  }
  if (!latest) return null;

  const point = coordinates.get(latest.locationId);
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;

  return {
    locationId: latest.locationId,
    position: projectDisplayPointToWarehouse3D(point, transform),
    intensity: clampUnitInterval(1 - latest.elapsedSinceEnd / SERVICE_COMPLETION_PULSE_SECONDS),
  };
}
