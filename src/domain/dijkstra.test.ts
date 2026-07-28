import { describe, expect, test } from "vitest";
import { dijkstra, reconstructPath } from "./dijkstra";
import { sampleWarehouse } from "../data/sampleWarehouse";
import type { AisleEdge, AisleNode } from "./types";

describe("dijkstra", () => {
  test("distance to the source itself is zero", () => {
    const nodes: AisleNode[] = [{ id: "A", x: 0, y: 0 }];
    const result = dijkstra(nodes, [], "A");

    expect(result.distances.get("A")).toBe(0);
    expect(reconstructPath(result, "A", "A")).toEqual(["A"]);
  });

  test("picks the shorter of two alternate paths, not just the first one found", () => {
    // Diamond: A-B-D costs 2, A-C-D costs 6. Shortest must be 2.
    const nodes: AisleNode[] = [
      { id: "A", x: 0, y: 0 },
      { id: "B", x: 1, y: 0 },
      { id: "C", x: 0, y: 1 },
      { id: "D", x: 1, y: 1 },
    ];
    const edges: AisleEdge[] = [
      { from: "A", to: "B", length: 1 },
      { from: "B", to: "D", length: 1 },
      { from: "A", to: "C", length: 5 },
      { from: "C", to: "D", length: 1 },
    ];

    const result = dijkstra(nodes, edges, "A");

    expect(result.distances.get("D")).toBe(2);
    expect(reconstructPath(result, "A", "D")).toEqual(["A", "B", "D"]);
  });

  test("returns Infinity and no path for a node in a disconnected component", () => {
    const nodes: AisleNode[] = [
      { id: "A", x: 0, y: 0 },
      { id: "B", x: 1, y: 0 },
      { id: "ISLAND", x: 100, y: 100 },
    ];
    const edges: AisleEdge[] = [{ from: "A", to: "B", length: 1 }];

    const result = dijkstra(nodes, edges, "A");

    expect(result.distances.get("ISLAND")).toBe(Infinity);
    expect(reconstructPath(result, "A", "ISLAND")).toBeNull();
  });

  test("finds a shortest path that must pass through an intermediate aisle node", () => {
    // In the sample warehouse there is no back cross-aisle, so F1 -> B3
    // must detour via the front cross-aisle through F2 and F3.
    const result = dijkstra(sampleWarehouse.aisleNodes, sampleWarehouse.edges, "F1");

    expect(result.distances.get("B3")).toBe(140); // 20 + 20 + 100
    expect(reconstructPath(result, "F1", "B3")).toEqual(["F1", "F2", "F3", "B3"]);
  });

  test("matches a hand-computed distance for a mid-aisle node", () => {
    const result = dijkstra(sampleWarehouse.aisleNodes, sampleWarehouse.edges, "F1");

    // F1 -> F2 (20) -> M2 (45) = 65
    expect(result.distances.get("M2")).toBe(65);
    expect(reconstructPath(result, "F1", "M2")).toEqual(["F1", "F2", "M2"]);
  });
});
