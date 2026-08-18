import { describe, expect, test } from "vitest";
import { sampleWarehouse } from "../data/sampleWarehouse";
import { buildValidatedDistanceMatrix } from "../domain/distanceMatrix";
import { nearestNeighborRoute } from "../domain/nearestNeighbor";
import { buildRouteTimeline } from "../domain/routeTimeline";
import { buildRouteTraversal } from "../domain/routeTraversal";
import { twoOptRoute } from "../domain/twoOpt";
import type { RouteTimeline, WarehouseGraph } from "../domain/types";
import { getSimulationSnapshotAtTime } from "../simulation/simulationSnapshot";
import type { SimulationSnapshot as Snapshot } from "../simulation/types";
import {
  MissingSimulationCoordinateError,
  projectSimulationMarkerToSvg,
} from "./simulationMarker";

const graph: WarehouseGraph = {
  aisleNodes: [
    { id: "from", x: 10, y: 20 },
    { id: "to", x: 30, y: 40 },
  ],
  edges: [{ from: "from", to: "to", length: 999 }],
  start: {
    id: "start",
    x: 4,
    y: 6,
    label: "Office",
    aisleNodeId: "from",
    accessDistance: 11,
  },
  locations: [
    {
      id: "destination",
      x: 50,
      y: 60,
      label: "Destination",
      aisleNodeId: "to",
      accessDistance: 13,
    },
  ],
};

const activeTimeline: RouteTimeline = {
  order: ["from", "to"],
  walkingSpeedMetersPerMinute: 60,
  totalDistance: 999,
  walkingDurationSeconds: 999,
  serviceDurationSeconds: 0,
  totalDurationSeconds: 999,
  legs: [],
  phases: [],
};

function snapshot(progress: number): Snapshot {
  return {
    timeSeconds: progress * 999,
    isComplete: false,
    totalDurationSeconds: 999,
    totalDistance: 999,
    distanceTraveled: progress * 999,
    distanceRemaining: (1 - progress) * 999,
    completedLegCount: 0,
    completedDestinationIds: [],
    current: {
      kind: "travel",
      legIndex: 0,
      segmentIndex: 0,
      from: "from",
      to: "to",
      progress,
      distanceTraveledOnSegment: progress * 999,
      distanceRemainingOnSegment: (1 - progress) * 999,
    },
  };
}

function completedSnapshot(totalDistance = 0): Snapshot {
  return {
    timeSeconds: 0,
    isComplete: true,
    totalDurationSeconds: 0,
    totalDistance,
    distanceTraveled: totalDistance,
    distanceRemaining: 0,
    completedLegCount: 0,
    completedDestinationIds: [],
    current: null,
  };
}

describe("projectSimulationMarkerToSvg", () => {
  test("interpolates an active segment directly from (10,20) to (30,40)", () => {
    expect(projectSimulationMarkerToSvg(graph, activeTimeline, snapshot(0.5))).toEqual({
      x: 20,
      y: 30,
    });
  });

  test("progress zero places the marker exactly at the current segment's from node", () => {
    expect(projectSimulationMarkerToSvg(graph, activeTimeline, snapshot(0))).toEqual({
      x: 10,
      y: 20,
    });
  });

  test("near-completion interpolation does not alter snapshot distance or time truth", () => {
    const state = snapshot(0.999);
    const originalMetrics = {
      timeSeconds: state.timeSeconds,
      distanceTraveled: state.distanceTraveled,
      distanceRemaining: state.distanceRemaining,
    };

    const point = projectSimulationMarkerToSvg(graph, activeTimeline, state);
    expect(point.x).toBeCloseTo(29.98);
    expect(point.y).toBeCloseTo(39.98);
    expect({
      timeSeconds: state.timeSeconds,
      distanceTraveled: state.distanceTraveled,
      distanceRemaining: state.distanceRemaining,
    }).toEqual(originalMetrics);
  });

  test("holds a service activity exactly at its destination", () => {
    const serviceSnapshot: Snapshot = {
      ...snapshot(1),
      current: {
        kind: "service",
        legIndex: 0,
        locationId: "destination",
        serviceClass: "standard",
        progress: 0.5,
        elapsedSeconds: 17.5,
        durationSeconds: 35,
        remainingSeconds: 17.5,
      },
    };
    const timeline = { ...activeTimeline, order: ["start", "destination"] };

    expect(projectSimulationMarkerToSvg(graph, timeline, serviceSnapshot)).toEqual({
      x: 50,
      y: 60,
    });
  });

  test("a completed route leaves the marker at the final route node", () => {
    const timeline = { ...activeTimeline, order: ["start", "destination"] };
    expect(projectSimulationMarkerToSvg(graph, timeline, completedSnapshot(24))).toEqual({
      x: 50,
      y: 60,
    });
  });

  test("a valid zero-duration route renders at its final route node", () => {
    const timeline: RouteTimeline = {
      order: ["start", "destination"],
      walkingSpeedMetersPerMinute: 60,
      legs: [],
      phases: [],
      totalDistance: 0,
      walkingDurationSeconds: 0,
      serviceDurationSeconds: 0,
      totalDurationSeconds: 0,
    };
    expect(projectSimulationMarkerToSvg(graph, timeline, completedSnapshot())).toEqual({
      x: 50,
      y: 60,
    });
  });

  test("a start-only route renders at the office", () => {
    const timeline: RouteTimeline = {
      order: ["start"],
      walkingSpeedMetersPerMinute: 60,
      legs: [],
      phases: [],
      totalDistance: 0,
      walkingDurationSeconds: 0,
      serviceDurationSeconds: 0,
      totalDurationSeconds: 0,
    };
    expect(projectSimulationMarkerToSvg(graph, timeline, completedSnapshot())).toEqual({
      x: 4,
      y: 6,
    });
  });

  test("a required missing or invalid display coordinate fails explicitly", () => {
    const baseState = snapshot(0.5);
    const missingState = {
      ...baseState,
      current: { ...baseState.current!, to: "missing" },
    };
    expect(() => projectSimulationMarkerToSvg(graph, activeTimeline, missingState)).toThrow(
      MissingSimulationCoordinateError,
    );

    const invalidGraph = {
      ...graph,
      aisleNodes: graph.aisleNodes.map((node) =>
        node.id === "to" ? { ...node, x: Number.NaN } : node,
      ),
    };
    expect(() => projectSimulationMarkerToSvg(invalidGraph, activeTimeline, snapshot(0.5))).toThrow(
      MissingSimulationCoordinateError,
    );
  });

  test("worker and recommended routes share the full route-to-SVG pipeline", () => {
    const targetIds = ["loc-A", "loc-B", "loc-C", "loc-D"];
    const routeGraph = {
      ...sampleWarehouse,
      locations: sampleWarehouse.locations.filter((location) => targetIds.includes(location.id)),
    };
    const matrix = buildValidatedDistanceMatrix(routeGraph);
    const worker = nearestNeighborRoute(routeGraph, targetIds);
    const recommended = twoOptRoute(routeGraph, targetIds, worker);

    for (const route of [worker, recommended]) {
      const traversal = buildRouteTraversal(routeGraph, route, matrix);
      const timeline = buildRouteTimeline(traversal, 60);
      const finalSnapshot = getSimulationSnapshotAtTime(timeline, timeline.totalDurationSeconds);
      const finalLocation = sampleWarehouse.locations.find(
        (location) => location.id === route.order.at(-1),
      )!;

      expect(projectSimulationMarkerToSvg(sampleWarehouse, timeline, finalSnapshot)).toEqual({
        x: finalLocation.x,
        y: finalLocation.y,
      });
    }
  });
});
