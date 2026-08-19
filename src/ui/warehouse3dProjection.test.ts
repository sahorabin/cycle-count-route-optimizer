import { describe, expect, test } from "vitest";
import { largeWarehouse } from "../data/largeWarehouse";
import {
  buildWarehouse3DEnvironment,
  WAREHOUSE_3D_ENVIRONMENT,
} from "./warehouse3dEnvironment";
import { getWarehouseAssetEntry } from "./warehouse3dAssetRegistry";
import { createWarehouseCountingGesture } from "./warehouse3dServiceVisual";
import {
  createWarehouseWorkerVisual,
  SERVICE_FORWARD_REACH_LIMIT,
} from "./warehouse3dWorker";
import { buildRouteTimeline } from "../domain/routeTimeline";
import type { WarehouseGraph } from "../domain/types";
import { getSimulationSnapshotAtTime } from "../simulation/simulationSnapshot";
import { projectSimulationMarkerToSvg } from "./simulationMarker";
import {
  buildOperatorCoordinateLookup,
  createWarehouse3DTransform,
  InvalidWarehouse3DCoordinateError,
  OPERATOR_AISLE_STANDOFF,
  projectDisplayPointToWarehouse3D,
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

describe("operator standing positions", () => {
  test("stands every attachment point part-way back toward its aisle node", () => {
    const lookup = buildOperatorCoordinateLookup(largeWarehouse);
    const aisleNodes = new Map(largeWarehouse.aisleNodes.map((node) => [node.id, node]));

    for (const location of largeWarehouse.locations) {
      const node = aisleNodes.get(location.aisleNodeId)!;
      const stand = lookup.get(location.id)!;
      expect(stand.x).toBeCloseTo(node.x + (location.x - node.x) * OPERATOR_AISLE_STANDOFF);
      expect(stand.y).toBeCloseTo(node.y + (location.y - node.y) * OPERATOR_AISLE_STANDOFF);
      // Strictly between the aisle and the bin, never at either extreme.
      expect(Math.abs(stand.x - node.x)).toBeLessThan(Math.abs(location.x - node.x) + 1e-9);
    }
  });

  test("leaves aisle nodes exactly where they are", () => {
    const lookup = buildOperatorCoordinateLookup(largeWarehouse);

    for (const node of largeWarehouse.aisleNodes) {
      expect(lookup.get(node.id)).toEqual({ x: node.x, y: node.y });
    }
  });

  test("places the operator outside every rack footprint", () => {
    const transform = createWarehouse3DTransform(largeWarehouse);
    const environment = buildWarehouse3DEnvironment(largeWarehouse, transform);
    const lookup = buildOperatorCoordinateLookup(largeWarehouse);
    const racks = environment.racks.map(({ footprint }) => footprint);

    for (const location of largeWarehouse.locations) {
      const stand = projectDisplayPointToWarehouse3D(lookup.get(location.id)!, transform);
      const inside = racks.some((footprint) =>
        stand.x > footprint.minX && stand.x < footprint.maxX
        && stand.z > footprint.minZ && stand.z < footprint.maxZ);
      expect({ location: location.id, insideRack: inside })
        .toEqual({ location: location.id, insideRack: false });
    }
  });

  test("is not a vacuous check: the bins themselves do sit inside racking", () => {
    const transform = createWarehouse3DTransform(largeWarehouse);
    const environment = buildWarehouse3DEnvironment(largeWarehouse, transform);
    const racks = environment.racks.map(({ footprint }) => footprint);
    const binsInsideRacks = largeWarehouse.locations.filter((location) => {
      const point = projectDisplayPointToWarehouse3D(location, transform);
      return racks.some((footprint) =>
        point.x > footprint.minX && point.x < footprint.maxX
        && point.z > footprint.minZ && point.z < footprint.maxZ);
    });

    expect(binsInsideRacks.length).toBe(largeWarehouse.locations.length);
  });
});

describe("service pose clearance", () => {
  /** Clear distance, in world units, from the operator to the rack face. */
  function aisleClearance() {
    const transform = createWarehouse3DTransform(largeWarehouse);
    const environment = buildWarehouse3DEnvironment(largeWarehouse, transform);
    const lookup = buildOperatorCoordinateLookup(largeWarehouse);

    return Math.min(...largeWarehouse.locations.map((location) => {
      const stand = projectDisplayPointToWarehouse3D(lookup.get(location.id)!, transform);
      const bin = projectDisplayPointToWarehouse3D(location, transform);
      // The rack run the bin belongs to; its near edge is the face the
      // operator scans across.
      const run = environment.racks.find((rack) =>
        bin.x > rack.footprint.minX && bin.x < rack.footprint.maxX
        && bin.z > rack.footprint.minZ && bin.z < rack.footprint.maxZ);
      if (!run) throw new Error(`No rack run contains ${location.id}`);
      const faceX = stand.x < run.footprint.minX ? run.footprint.minX : run.footprint.maxX;
      return Math.abs(faceX - stand.x);
    }));
  }

  /** Combined bounds of the shipped operator, read from the asset itself. */
  function operatorAssetSize(): readonly [number, number, number] {
    const files = import.meta.glob("/public/assets/worker/**/*.gltf", {
      eager: true,
      query: "?raw",
      import: "default",
    }) as Record<string, string>;
    const gltf = JSON.parse(Object.values(files)[0]);
    const bounds = gltf.meshes[0].primitives.map(
      (primitive: { attributes: { POSITION: number } }) =>
        gltf.accessors[primitive.attributes.POSITION]);
    return [0, 1, 2].map((axis) =>
      Math.max(...bounds.map((a: { max: number[] }) => a.max[axis]))
      - Math.min(...bounds.map((a: { min: number[] }) => a.min[axis]))) as
        unknown as readonly [number, number, number];
  }

  test("stands the imported operator clear of the rack it is counting", () => {
    const size = operatorAssetSize();
    const entry = getWarehouseAssetEntry("operator");
    // Uniform: the model is fitted by its longest axis, which is its height.
    const scale = (entry?.envelopeSpan ?? 1.76) / Math.max(...size);
    const halfDepth = (size[2] * scale) / 2;
    const halfWidth = (size[0] * scale) / 2;

    expect(Math.max(...size)).toBe(size[1]);
    // The body's forward half-depth has to fit inside the aisle clearance, or
    // the operator would be standing in the racking.
    expect(halfDepth).toBeLessThan(aisleClearance());
    // Facing the rack puts the arm span along the aisle, never into shelving.
    expect(halfWidth).toBeLessThan(aisleClearance() * 2);
    expect([halfDepth, halfWidth].every(Number.isFinite)).toBe(true);
  });

  test("scales the imported operator uniformly to a credible human height", () => {
    const size = operatorAssetSize();
    const entry = getWarehouseAssetEntry("operator");
    const scale = (entry?.envelopeSpan ?? 1.76) / Math.max(...size);
    const rendered = size.map((value) => value * scale);

    expect(rendered[1]).toBeCloseTo(entry?.envelopeSpan ?? 1.76, 6);
    // Proportions survive: one factor on every axis, never a per-axis stretch.
    expect(rendered[0] / rendered[1]).toBeCloseTo(size[0] / size[1], 9);
    expect(rendered[2] / rendered[1]).toBeCloseTo(size[2] / size[1], 9);
    // Human against 2.3-unit racking: clearly shorter, clearly not a doll.
    expect(rendered[1]).toBeGreaterThan(WAREHOUSE_3D_ENVIRONMENT.rackHeight * 0.6);
    expect(rendered[1]).toBeLessThan(WAREHOUSE_3D_ENVIRONMENT.rackHeight);
  });

  test("keeps the whole service pose short of the rack face", () => {
    const clearance = aisleClearance();

    // Every posed part is clamped to this reach, so nothing can cross the face.
    expect(SERVICE_FORWARD_REACH_LIMIT).toBeLessThan(clearance);
    // A real margin, not a rounding-error escape.
    expect(clearance - SERVICE_FORWARD_REACH_LIMIT).toBeGreaterThan(0.03);
  });

  test("never poses a part beyond the reach limit at any point in the scan cycle", () => {
    const samples = [0, 0.4, 0.9, 1.3, 1.8, 2.2, 2.9, 3.6];

    for (const elapsed of samples) {
      const visual = createWarehouseWorkerVisual(
        "#2f6fc4",
        createWarehouseCountingGesture(elapsed),
      );
      for (const part of visual.parts) {
        expect({ elapsed, part: part.id, withinReach: part.position[2] <= SERVICE_FORWARD_REACH_LIMIT })
          .toEqual({ elapsed, part: part.id, withinReach: true });
      }
    }
  });

  test("keeps the standing figure narrower than the aisle it stands in", () => {
    const clearance = aisleClearance();
    const travelVisual = createWarehouseWorkerVisual("#2f6fc4");
    const deepest = Math.max(...travelVisual.parts.map((part) => part.position[2]
      + (part.primitive === "box" ? part.size[2] / 2 : 0.2)));

    // Body depth, not just joint centres, stays inside the walkable clearance.
    expect(deepest).toBeLessThan(clearance);
  });

  test("does not move the operational destination", () => {
    const lookup = buildOperatorCoordinateLookup(largeWarehouse);
    const before = JSON.stringify(largeWarehouse.locations);

    for (const location of largeWarehouse.locations) {
      expect(lookup.get(location.id)).not.toEqual({ x: location.x, y: location.y });
    }
    // The renderer standing point is derived, never written back.
    expect(JSON.stringify(largeWarehouse.locations)).toBe(before);
  });
});
