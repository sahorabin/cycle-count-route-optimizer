import { describe, expect, test } from "vitest";
import { buildRouteTimeline } from "../domain/routeTimeline";
import type { WarehouseGraph } from "../domain/types";
import { getSimulationSnapshotAtTime } from "../simulation/simulationSnapshot";
import { projectSimulationMarkerToSvg } from "./simulationMarker";
import {
  createWarehouse3DTransform,
  InvalidWarehouse3DCoordinateError,
  projectNodeToWarehouse3D,
  projectSimulationMarkerTo3D,
} from "./warehouse3dProjection";

const graph: WarehouseGraph = {
  aisleNodes: [
    { id: "a", x: 0, y: 0 },
    { id: "b", x: 20, y: 10 },
  ],
  edges: [{ from: "a", to: "b", length: 30 }],
  start: { id: "office", x: -10, y: 0, label: "Office", aisleNodeId: "a", accessDistance: 2 },
  locations: [
    { id: "loc", x: 10, y: 20, label: "Location", aisleNodeId: "b", accessDistance: 3 },
  ],
};

const timeline = buildRouteTimeline({
  order: ["office", "loc"],
  totalDistance: 10,
  legs: [{
    from: "office",
    to: "loc",
    path: ["office", "loc"],
    distance: 10,
    segments: [{
      from: "office",
      to: "loc",
      distance: 10,
    }],
  }],
}, 60);

describe("warehouse 3D projection", () => {
  test("creates the same deterministic centered transform for the same graph", () => {
    const first = createWarehouse3DTransform(graph);
    const second = createWarehouse3DTransform(graph);
    expect(first).toEqual(second);
    expect(first).toEqual({
      minX: -10,
      maxX: 20,
      minY: 0,
      maxY: 20,
      centerX: 5,
      centerY: 10,
      visualScale: 0.6,
    });
    const min = projectNodeToWarehouse3D(graph, "office", first);
    const max = projectNodeToWarehouse3D(graph, "b", first);
    expect((min.x + max.x) / 2).toBe(0);
  });

  test("maps display x to world X, display y to world Z, and keeps world Y visual-only", () => {
    const transform = createWarehouse3DTransform(graph);
    const point = projectNodeToWarehouse3D(graph, "loc", transform);
    expect(point).toEqual({ x: 3, y: 0, z: 6 });
    expect(point.y).not.toBe(graph.locations[0].y);
  });

  test.each([
    [0, -9, -6],
    [5, -3, 0],
    [9.999, 2.9988, 5.9988],
  ])("projects active marker interpolation at t=%s", (time, expectedX, expectedZ) => {
    const transform = createWarehouse3DTransform(graph);
    const snapshot = getSimulationSnapshotAtTime(timeline, time);
    const point = projectSimulationMarkerTo3D(graph, timeline, snapshot, transform);
    expect(point.x).toBeCloseTo(expectedX);
    expect(point.y).toBe(0);
    expect(point.z).toBeCloseTo(expectedZ);
  });

  test("keeps a completed marker at the final destination", () => {
    const transform = createWarehouse3DTransform(graph);
    const snapshot = getSimulationSnapshotAtTime(timeline, 20);
    expect(projectSimulationMarkerTo3D(graph, timeline, snapshot, transform)).toEqual(
      projectNodeToWarehouse3D(graph, "loc", transform),
    );
  });

  test("uses completion semantics for a zero-duration route", () => {
    const zeroDuration = buildRouteTimeline({
      order: ["office", "loc"],
      totalDistance: 0,
      legs: [{
        from: "office",
        to: "loc",
        path: ["office", "loc"],
        distance: 0,
        segments: [{
          from: "office",
          to: "loc",
          distance: 0,
        }],
      }],
    }, 60);
    const snapshot = getSimulationSnapshotAtTime(zeroDuration, 0);
    expect(projectSimulationMarkerTo3D(
      graph,
      zeroDuration,
      snapshot,
      createWarehouse3DTransform(graph),
    )).toEqual(projectNodeToWarehouse3D(graph, "loc", createWarehouse3DTransform(graph)));
  });

  test("renders a start-only route at the office", () => {
    const startOnly = buildRouteTimeline({
      order: ["office"],
      legs: [],
      totalDistance: 0,
    }, 60);
    const transform = createWarehouse3DTransform(graph);
    expect(projectSimulationMarkerTo3D(
      graph,
      startOnly,
      getSimulationSnapshotAtTime(startOnly, 0),
      transform,
    )).toEqual(projectNodeToWarehouse3D(graph, "office", transform));
  });

  test("fails explicitly for a missing node coordinate", () => {
    const snapshot = {
      ...getSimulationSnapshotAtTime(timeline, 0),
      current: {
        ...getSimulationSnapshotAtTime(timeline, 0).current!,
        from: "missing",
      },
    };
    expect(() => projectSimulationMarkerTo3D(
      graph,
      timeline,
      snapshot,
      createWarehouse3DTransform(graph),
    )).toThrow(InvalidWarehouse3DCoordinateError);
  });

  test("fails explicitly when warehouse rendering coordinates are invalid", () => {
    const invalid = {
      ...graph,
      aisleNodes: [{ ...graph.aisleNodes[0], x: Number.NaN }, graph.aisleNodes[1]],
    };
    expect(() => createWarehouse3DTransform(invalid)).toThrow(InvalidWarehouse3DCoordinateError);
  });

  test("does not mutate graph, timeline, or snapshot inputs", () => {
    const snapshot = getSimulationSnapshotAtTime(timeline, 5);
    const before = JSON.stringify({ graph, timeline, snapshot });
    const transform = createWarehouse3DTransform(graph);
    projectNodeToWarehouse3D(graph, "a", transform);
    projectSimulationMarkerTo3D(graph, timeline, snapshot, transform);
    expect(JSON.stringify({ graph, timeline, snapshot })).toBe(before);
  });

  test("SVG and 3D projections consume the same renderer-independent cursor", () => {
    const snapshot = getSimulationSnapshotAtTime(timeline, 5);
    expect(snapshot.current).toMatchObject({ from: "office", to: "loc", progress: 0.5 });
    const svg = projectSimulationMarkerToSvg(graph, timeline, snapshot);
    const transform = createWarehouse3DTransform(graph);
    const world = projectSimulationMarkerTo3D(graph, timeline, snapshot, transform);
    expect(world.x).toBeCloseTo((svg.x - transform.centerX) * transform.visualScale);
    expect(world.z).toBeCloseTo((svg.y - transform.centerY) * transform.visualScale);
    expect(snapshot.isComplete).toBe(false);
  });

  test("SVG and 3D hold the same destination during service", () => {
    const servicedTimeline = buildRouteTimeline(
      {
        order: ["office", "loc"],
        totalDistance: 10,
        legs: [{
          from: "office",
          to: "loc",
          path: ["office", "loc"],
          distance: 10,
          segments: [{ from: "office", to: "loc", distance: 10 }],
        }],
      },
      60,
      new Map([["loc", {
        locationId: "loc",
        serviceClass: "standard" as const,
        durationSeconds: 20,
        source: "synthetic-demo" as const,
      }]]),
    );
    const snapshot = getSimulationSnapshotAtTime(servicedTimeline, 15);
    const transform = createWarehouse3DTransform(graph);

    expect(snapshot.current).toMatchObject({ kind: "service", locationId: "loc", progress: 0.25 });
    expect(projectSimulationMarkerToSvg(graph, servicedTimeline, snapshot)).toEqual({ x: 10, y: 20 });
    expect(projectSimulationMarkerTo3D(graph, servicedTimeline, snapshot, transform))
      .toEqual(projectNodeToWarehouse3D(graph, "loc", transform));
  });

  test("projects active and completed route markers from one shared comparison time", () => {
    const workerTimeline = timeline;
    const recommendedTimeline = buildRouteTimeline({
      order: ["office", "loc"],
      totalDistance: 6,
      legs: [{
        from: "office",
        to: "loc",
        path: ["office", "loc"],
        distance: 6,
        segments: [{ from: "office", to: "loc", distance: 6 }],
      }],
    }, 60);
    const sharedTime = 8;
    const workerSnapshot = getSimulationSnapshotAtTime(workerTimeline, sharedTime);
    const recommendedSnapshot = getSimulationSnapshotAtTime(recommendedTimeline, sharedTime);
    const transform = createWarehouse3DTransform(graph);

    expect(workerSnapshot.isComplete).toBe(false);
    expect(recommendedSnapshot.isComplete).toBe(true);
    expect(projectSimulationMarkerTo3D(
      graph,
      recommendedTimeline,
      recommendedSnapshot,
      transform,
    )).toEqual(projectNodeToWarehouse3D(graph, "loc", transform));
    expect(projectSimulationMarkerTo3D(
      graph,
      workerTimeline,
      workerSnapshot,
      transform,
    )).not.toEqual(projectNodeToWarehouse3D(graph, "loc", transform));
  });
});
