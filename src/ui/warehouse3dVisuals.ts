import type { RouteTimeline, WarehouseGraph } from "../domain/types";
import {
  projectNodeToWarehouse3D,
  type Warehouse3DTransform,
  type WorldPoint,
} from "./warehouse3dProjection";

/** Rendering-only hierarchy constants shared identically by both route scenes. */
export const WAREHOUSE_3D_VISUALS = {
  rack: {
    color: "#96a3ad",
    height: 1.24,
    roughness: 0.95,
  },
  route: {
    radius: 0.1,
    y: 0.16,
    radialSegments: 8,
    depthTest: false,
    depthWrite: false,
  },
  destination: {
    ringInnerRadius: 0.2,
    ringOuterRadius: 0.34,
    stemRadius: 0.035,
    stemHeight: 1.08,
    beaconRadius: 0.2,
    beaconY: 1.34,
  },
  worker: {
    discRadius: 0.4,
    ringInnerRadius: 0.36,
    ringOuterRadius: 0.6,
    bodyTopRadius: 0.22,
    bodyBottomRadius: 0.28,
    bodyHeight: 0.78,
    bodyY: 0.54,
    headRadius: 0.25,
    headY: 1.18,
  },
} as const;

export interface Warehouse3DRouteVisualSegment {
  readonly fromId: string;
  readonly toId: string;
  readonly from: WorldPoint;
  readonly to: WorldPoint;
  readonly midpoint: WorldPoint;
  /** Cylinder length in renderer world units; never used as operational distance. */
  readonly visualLength: number;
}

/**
 * Projects the existing timeline segment sequence into renderer-only cylinder
 * descriptors. It neither finds a route nor feeds visual lengths back into
 * distance, timing, KPI, or simulation state.
 */
export function buildWarehouse3DRouteVisualSegments(
  graph: WarehouseGraph,
  timeline: RouteTimeline,
  transform: Warehouse3DTransform,
): Warehouse3DRouteVisualSegment[] {
  return timeline.legs.flatMap((leg) =>
    leg.segments.map((segment) => {
      const projectedFrom = projectNodeToWarehouse3D(graph, segment.from, transform);
      const projectedTo = projectNodeToWarehouse3D(graph, segment.to, transform);
      const from = { ...projectedFrom, y: WAREHOUSE_3D_VISUALS.route.y };
      const to = { ...projectedTo, y: WAREHOUSE_3D_VISUALS.route.y };
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const dz = to.z - from.z;

      return {
        fromId: segment.from,
        toId: segment.to,
        from,
        to,
        midpoint: {
          x: (from.x + to.x) / 2,
          y: (from.y + to.y) / 2,
          z: (from.z + to.z) / 2,
        },
        visualLength: Math.hypot(dx, dy, dz),
      };
    }),
  );
}
