import { describe, expect, test } from "vitest";
import { sampleWarehouse } from "../data/sampleWarehouse";
import { compareManualToRecommended } from "../ui/manualComparison";
import { buildValidatedDistanceMatrix } from "./distanceMatrix";
import { nearestNeighborRoute } from "./nearestNeighbor";
import {
  buildRouteTimeline,
  InvalidRouteTimelineError,
  ROUTE_TIMELINE_EPSILON,
} from "./routeTimeline";
import { buildRouteTraversal } from "./routeTraversal";
import { twoOptRoute } from "./twoOpt";
import type {
  NodeId,
  RouteComputation,
  RouteTraversal,
  RouteTraversalLeg,
  WarehouseGraph,
} from "./types";

function oneLegTraversal(distances: number[] = [15, 45]): RouteTraversal {
  const nodeIds = ["office", ...distances.slice(0, -1).map((_, index) => `N${index + 1}`), "target"];
  const segments = distances.map((distance, index) => ({
    from: nodeIds[index],
    to: nodeIds[index + 1],
    distance,
  }));
  const totalDistance = distances.reduce((sum, distance) => sum + distance, 0);
  return {
    order: ["office", "target"],
    legs: [
      {
        from: "office",
        to: "target",
        path: nodeIds,
        distance: totalDistance,
        segments,
      },
    ],
    totalDistance,
  };
}

const multiLegTraversal: RouteTraversal = {
  order: ["office", "A", "B"],
  legs: [
    {
      from: "office",
      to: "A",
      path: ["office", "F1", "A"],
      distance: 30,
      segments: [
        { from: "office", to: "F1", distance: 10 },
        { from: "F1", to: "A", distance: 20 },
      ],
    },
    {
      from: "A",
      to: "B",
      path: ["A", "F1", "F2", "B"],
      distance: 60,
      segments: [
        { from: "A", to: "F1", distance: 20 },
        { from: "F1", to: "F2", distance: 25 },
        { from: "F2", to: "B", distance: 15 },
      ],
    },
  ],
  totalDistance: 90,
};

function routeGraphFor(targetIds: NodeId[]): WarehouseGraph {
  return {
    ...sampleWarehouse,
    locations: sampleWarehouse.locations.filter((location) => targetIds.includes(location.id)),
  };
}

function realTraversal(graph: WarehouseGraph, route: RouteComputation): RouteTraversal {
  return buildRouteTraversal(graph, route, buildValidatedDistanceMatrix(graph));
}

function allSegments(timeline: ReturnType<typeof buildRouteTimeline>) {
  return timeline.legs.flatMap((leg) => leg.segments);
}

describe("buildRouteTimeline", () => {
  test("builds a one-leg timeline with exact segment timing at 60 metres per minute", () => {
    const timeline = buildRouteTimeline(oneLegTraversal(), 60);

    expect(timeline.order).toEqual(["office", "target"]);
    expect(timeline.legs).toHaveLength(1);
    expect(timeline.legs[0].segments).toEqual([
      {
        from: "office",
        to: "N1",
        distance: 15,
        startTimeSeconds: 0,
        durationSeconds: 15,
        endTimeSeconds: 15,
      },
      {
        from: "N1",
        to: "target",
        distance: 45,
        startTimeSeconds: 15,
        durationSeconds: 45,
        endTimeSeconds: 60,
      },
    ]);
    expect(timeline.totalDurationSeconds).toBe(60);
  });

  test("preserves multi-leg order, segment order, distances, and counts", () => {
    const timeline = buildRouteTimeline(multiLegTraversal, 60);

    expect(timeline.order).toEqual(multiLegTraversal.order);
    expect(timeline.legs.map(({ from, to }) => [from, to])).toEqual([
      ["office", "A"],
      ["A", "B"],
    ]);
    expect(timeline.legs.map((leg) => leg.segments.length)).toEqual([2, 3]);
    expect(allSegments(timeline).map(({ from, to, distance }) => ({ from, to, distance }))).toEqual(
      multiLegTraversal.legs.flatMap((leg) => leg.segments),
    );
    expect(timeline.totalDistance).toBe(90);
  });

  test("supports fractional seconds without rounding internal values", () => {
    const timeline = buildRouteTimeline(oneLegTraversal([1]), 7);

    expect(timeline.totalDurationSeconds).toBeCloseTo(60 / 7, 12);
    expect(timeline.legs[0].segments[0].durationSeconds).toBeCloseTo(60 / 7, 12);
  });

  test("changes physical duration proportionally for different valid walking speeds", () => {
    expect(buildRouteTimeline(oneLegTraversal(), 120).totalDurationSeconds).toBe(30);
    expect(buildRouteTimeline(oneLegTraversal(), 30).totalDurationSeconds).toBe(120);
  });

  test("supports a zero-distance segment and leg with no gap or fake duration", () => {
    const timeline = buildRouteTimeline(oneLegTraversal([0]), 60);
    const segment = timeline.legs[0].segments[0];

    expect(segment.startTimeSeconds).toBe(0);
    expect(segment.durationSeconds).toBe(0);
    expect(segment.endTimeSeconds).toBe(0);
    expect(timeline.legs[0].durationSeconds).toBe(0);
    expect(timeline.totalDurationSeconds).toBe(0);
  });

  test("supports the fixed-start zero-destination traversal", () => {
    const traversal: RouteTraversal = { order: ["office"], legs: [], totalDistance: 0 };

    expect(buildRouteTimeline(traversal, 60)).toEqual({
      order: ["office"],
      walkingSpeedMetersPerMinute: 60,
      legs: [],
      totalDistance: 0,
      totalDurationSeconds: 0,
    });
  });

  test("creates one continuous time axis across every segment and leg", () => {
    const timeline = buildRouteTimeline(multiLegTraversal, 60);
    const segments = allSegments(timeline);

    expect(segments[0].startTimeSeconds).toBe(0);
    for (let index = 0; index < segments.length; index++) {
      const segment = segments[index];
      expect(
        Math.abs(segment.endTimeSeconds - (segment.startTimeSeconds + segment.durationSeconds)),
      ).toBeLessThanOrEqual(ROUTE_TIMELINE_EPSILON);
      if (index > 0) {
        expect(Math.abs(segment.startTimeSeconds - segments[index - 1].endTimeSeconds)).toBeLessThanOrEqual(
          ROUTE_TIMELINE_EPSILON,
        );
      }
    }
    expect(timeline.legs[1].startTimeSeconds).toBe(timeline.legs[0].endTimeSeconds);
    expect(segments.at(-1)?.endTimeSeconds).toBe(timeline.totalDurationSeconds);
  });

  test("enforces segment, leg, total-distance, and total-duration invariants", () => {
    const speed = 75;
    const timeline = buildRouteTimeline(multiLegTraversal, speed);
    const segmentDistance = allSegments(timeline).reduce((sum, segment) => sum + segment.distance, 0);

    for (const leg of timeline.legs) {
      const segmentDuration = leg.segments.reduce((sum, segment) => sum + segment.durationSeconds, 0);
      expect(Math.abs(segmentDuration - leg.durationSeconds)).toBeLessThanOrEqual(ROUTE_TIMELINE_EPSILON);
    }
    expect(Math.abs(segmentDistance - timeline.totalDistance)).toBeLessThanOrEqual(
      ROUTE_TIMELINE_EPSILON,
    );
    expect(timeline.totalDistance).toBe(multiLegTraversal.totalDistance);
    expect(timeline.totalDurationSeconds).toBeCloseTo((90 / speed) * 60, 12);
  });

  test("copies output collections and does not mutate its traversal input", () => {
    const original = structuredClone(multiLegTraversal);
    const timeline = buildRouteTimeline(multiLegTraversal, 60);

    expect(multiLegTraversal).toEqual(original);
    expect(timeline.order).not.toBe(multiLegTraversal.order);
    expect(timeline.legs).not.toBe(multiLegTraversal.legs);
    expect(timeline.legs[0].segments).not.toBe(multiLegTraversal.legs[0].segments);
  });

  test.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "rejects invalid walking speed %s",
    (speed) => {
      expect(() => buildRouteTimeline(oneLegTraversal(), speed)).toThrow(
        "walking speed must be finite and greater than zero",
      );
    },
  );

  test("rejects a leg whose endpoints do not match traversal order", () => {
    const invalid: RouteTraversal = {
      ...oneLegTraversal(),
      legs: [{ ...oneLegTraversal().legs[0], to: "wrong-target" }],
    };

    expect(() => buildRouteTimeline(invalid, 60)).toThrow(InvalidRouteTimelineError);
  });

  test("rejects a discontinuous segment chain", () => {
    const base = oneLegTraversal();
    const invalidLeg: RouteTraversalLeg = {
      ...base.legs[0],
      segments: [{ from: "wrong-node", to: "target", distance: 60 }],
    };

    expect(() => buildRouteTimeline({ ...base, legs: [invalidLeg] }, 60)).toThrow(
      "segment chain is discontinuous",
    );
  });

  test("rejects segment, leg, and traversal distance disagreement", () => {
    const base = oneLegTraversal();
    const invalidLeg: RouteTraversalLeg = { ...base.legs[0], distance: 61 };
    expect(() => buildRouteTimeline({ ...base, legs: [invalidLeg] }, 60)).toThrow(
      "segment distance 60 disagrees with leg distance 61",
    );

    expect(() => buildRouteTimeline({ ...base, totalDistance: 61 }, 60)).toThrow(
      "leg distance 60 disagrees with traversal distance 61",
    );
  });

  test("agrees with the existing comparison KPI for the same distances and speed", () => {
    const manualRoute = { order: ["office", "manual"], totalDistance: 120 };
    const recommendedRoute = { order: ["office", "recommended"], totalDistance: 90 };
    const comparison = compareManualToRecommended(manualRoute, recommendedRoute, 60);

    const manualTimeline = buildRouteTimeline(oneLegTraversal([120]), 60);
    const recommendedTimeline = buildRouteTimeline(oneLegTraversal([90]), 60);

    expect(comparison.manualDurationMinutes * 60).toBeCloseTo(
      manualTimeline.totalDurationSeconds,
      12,
    );
    expect(comparison.recommendedDurationMinutes * 60).toBeCloseTo(
      recommendedTimeline.totalDurationSeconds,
      12,
    );
  });

  test("uses the same builder for worker and recommended traversals and preserves distance ordering", () => {
    const targetIds = ["loc-A", "loc-B", "loc-C", "loc-D"];
    const graph = routeGraphFor(targetIds);
    const workerOrder = ["office", "loc-C", "loc-D", "loc-A", "loc-B"];
    const workerRoute: RouteComputation = { order: workerOrder, totalDistance: 573 };
    const recommendedRoute = twoOptRoute(graph, targetIds, nearestNeighborRoute(graph, targetIds));

    const workerTimeline = buildRouteTimeline(realTraversal(graph, workerRoute), 60);
    const recommendedTimeline = buildRouteTimeline(realTraversal(graph, recommendedRoute), 60);

    expect(workerTimeline.totalDistance).toBeGreaterThan(recommendedTimeline.totalDistance);
    expect(workerTimeline.totalDurationSeconds).toBeGreaterThan(
      recommendedTimeline.totalDurationSeconds,
    );
  });

  test("equal-distance traversals have equal total duration at the same speed", () => {
    const first = buildRouteTimeline(oneLegTraversal([20, 40]), 75);
    const second = buildRouteTimeline(oneLegTraversal([60]), 75);

    expect(first.totalDistance).toBe(second.totalDistance);
    expect(first.totalDurationSeconds).toBeCloseTo(second.totalDurationSeconds, 12);
  });
});
