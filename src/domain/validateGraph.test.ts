import { describe, expect, test } from "vitest";
import { validateGraph } from "./validateGraph";
import { sampleWarehouse } from "../data/sampleWarehouse";
import type { WarehouseGraph } from "./types";

function makeValidGraph(): WarehouseGraph {
  return {
    aisleNodes: [
      { id: "F1", x: 0, y: 0 },
      { id: "B1", x: 0, y: 10 },
    ],
    edges: [{ from: "F1", to: "B1", length: 10 }],
    start: {
      id: "office",
      x: -5,
      y: 0,
      label: "Office",
      aisleNodeId: "F1",
      accessDistance: 5,
    },
    locations: [
      {
        id: "loc-A",
        x: 0,
        y: 12,
        label: "Bin A",
        aisleNodeId: "B1",
        accessDistance: 2,
      },
    ],
  };
}

describe("validateGraph", () => {
  test("accepts the real sample warehouse", () => {
    const result = validateGraph(sampleWarehouse);
    expect(result).toEqual({ valid: true, errors: [] });
  });

  test("accepts a minimal well-formed graph", () => {
    const result = validateGraph(makeValidGraph());
    expect(result).toEqual({ valid: true, errors: [] });
  });

  test("rejects duplicate aisle node ids", () => {
    const graph = makeValidGraph();
    graph.aisleNodes.push({ id: "F1", x: 99, y: 99 });

    const result = validateGraph(graph);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual({
      type: "duplicate-node-id",
      nodeId: "F1",
    });
  });

  test("rejects an edge referencing a missing node", () => {
    const graph = makeValidGraph();
    graph.edges.push({ from: "F1", to: "GHOST", length: 5 });

    const result = validateGraph(graph);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual({
      type: "missing-edge-node",
      edgeFrom: "F1",
      edgeTo: "GHOST",
      missing: "GHOST",
    });
  });

  test("rejects a zero-length edge", () => {
    const graph = makeValidGraph();
    graph.edges[0].length = 0;

    const result = validateGraph(graph);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual({
      type: "non-positive-edge-length",
      edgeFrom: "F1",
      edgeTo: "B1",
      length: 0,
    });
  });

  test("rejects a negative-length edge", () => {
    const graph = makeValidGraph();
    graph.edges[0].length = -10;

    const result = validateGraph(graph);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual({
      type: "non-positive-edge-length",
      edgeFrom: "F1",
      edgeTo: "B1",
      length: -10,
    });
  });

  test("rejects a location whose aisle node does not exist", () => {
    const graph = makeValidGraph();
    graph.locations[0].aisleNodeId = "GHOST";

    const result = validateGraph(graph);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual({
      type: "missing-aisle-node-reference",
      attachmentId: "loc-A",
      aisleNodeId: "GHOST",
    });
  });

  test("rejects a start point whose aisle node does not exist", () => {
    const graph = makeValidGraph();
    graph.start.aisleNodeId = "GHOST";

    const result = validateGraph(graph);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual({
      type: "missing-aisle-node-reference",
      attachmentId: "office",
      aisleNodeId: "GHOST",
    });
  });

  test("rejects a non-positive access distance", () => {
    const graph = makeValidGraph();
    graph.locations[0].accessDistance = 0;

    const result = validateGraph(graph);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual({
      type: "non-positive-access-distance",
      attachmentId: "loc-A",
      accessDistance: 0,
    });
  });

  test("accepts two different cycle-count locations that share the same aisle node and access distance", () => {
    // Two legitimately distinct bins (e.g. opposite racks) can sit the same
    // spur distance off the same aisle node. That is not a graph error --
    // whether the *same location id* was picked twice is a target-selection
    // concern (see targetSelection.test.ts), not a graph-shape concern.
    const graph = makeValidGraph();
    graph.locations.push({
      id: "loc-A2",
      x: 1,
      y: 12,
      label: "Bin A2 (opposite rack)",
      aisleNodeId: "B1",
      accessDistance: 2,
    });

    const result = validateGraph(graph);

    expect(result).toEqual({ valid: true, errors: [] });
  });

  test("rejects a location that is unreachable from the start", () => {
    const graph = makeValidGraph();
    // A second aisle node/edge pair with no connection back to F1/B1.
    graph.aisleNodes.push({ id: "ISO", x: 500, y: 500 });
    graph.locations.push({
      id: "loc-isolated",
      x: 500,
      y: 505,
      label: "Isolated Bin",
      aisleNodeId: "ISO",
      accessDistance: 2,
    });

    const result = validateGraph(graph);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual({
      type: "unreachable-target",
      nodeId: "loc-isolated",
    });
  });

  test("reports multiple errors at once rather than stopping at the first", () => {
    const graph = makeValidGraph();
    graph.edges[0].length = 0;
    graph.locations[0].accessDistance = -1;

    const result = validateGraph(graph);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual({
      type: "non-positive-edge-length",
      edgeFrom: "F1",
      edgeTo: "B1",
      length: 0,
    });
    expect(result.errors).toContainEqual({
      type: "non-positive-access-distance",
      attachmentId: "loc-A",
      accessDistance: -1,
    });
    expect(result.errors).toHaveLength(2);
  });
});
