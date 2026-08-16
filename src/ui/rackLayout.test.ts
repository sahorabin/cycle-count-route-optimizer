import { describe, expect, test } from "vitest";
import {
  computeRackRect,
  computeRackRects,
  computeWarehouseAisleRects,
  groupAisleNodesIntoRacks,
} from "./rackLayout";
import { LARGE_WAREHOUSE_SPATIAL_LAYOUT, largeWarehouse } from "../data/largeWarehouse";
import { sampleWarehouse } from "../data/sampleWarehouse";

describe("groupAisleNodesIntoRacks", () => {
  test("groups the 100-location fixture's aisle nodes into exactly 10 racks", () => {
    const groups = groupAisleNodesIntoRacks(largeWarehouse.aisleNodes);
    expect(groups).toHaveLength(10);
    // Each aisle has front/rear nodes, three rack-row nodes, and two cross-aisle nodes.
    for (const group of groups) {
      expect(group).toHaveLength(7);
    }
  });

  test("groups the small sample warehouse's aisle nodes into 3 racks", () => {
    const groups = groupAisleNodesIntoRacks(sampleWarehouse.aisleNodes);
    expect(groups).toHaveLength(3);
  });

  test("every aisle node appears in exactly one group", () => {
    const groups = groupAisleNodesIntoRacks(largeWarehouse.aisleNodes);
    const allIds = groups.flat().map((n) => n.id);
    expect(new Set(allIds).size).toBe(largeWarehouse.aisleNodes.length);
  });
});

describe("computeRackRect", () => {
  test("spans the group's y-range with end padding, centered on mean x", () => {
    const group = [
      { id: "F", x: 20, y: 0 },
      { id: "M", x: 25, y: 45 },
      { id: "B", x: 20, y: 100 },
    ];
    const rect = computeRackRect(group);
    expect(rect.y).toBeLessThan(0);
    expect(rect.y + rect.height).toBeGreaterThan(100);
    expect(rect.x).toBeLessThan(21.67); // mean x = (20+25+20)/3
    expect(rect.x + rect.width).toBeGreaterThan(21.67);
  });
});

describe("computeRackRects", () => {
  test("produces one rack segment per aisle column and rack run", () => {
    const rects = computeRackRects(
      largeWarehouse.aisleNodes,
      10,
      largeWarehouse.spatialLayout,
    );
    expect(rects).toHaveLength(30);
    for (const rect of rects) {
      expect(rect.width).toBeGreaterThan(0);
      expect(rect.height).toBeGreaterThan(0);
    }
  });

  test("preserves the explicit local, internal-cross, and block-separation hierarchy", () => {
    const aisles = computeWarehouseAisleRects(
      largeWarehouse.aisleNodes,
      largeWarehouse.spatialLayout,
    );
    const local = aisles.filter(({ category }) => category === "local");
    const internal = aisles.filter(({ category }) => category === "internal-cross");
    const blocks = aisles.filter(({ category }) => category === "block-separation");

    expect(local).toHaveLength(30);
    expect(internal).toHaveLength(4);
    expect(blocks).toHaveLength(1);
    expect(new Set(local.map(({ width }) => width))).toEqual(new Set([10]));
    expect(new Set(internal.map(({ height }) => height))).toEqual(new Set([16]));
    expect(new Set(blocks.map(({ width }) => width))).toEqual(new Set([24]));
    expect(LARGE_WAREHOUSE_SPATIAL_LAYOUT.localAisleSpacing)
      .toBeLessThan(LARGE_WAREHOUSE_SPATIAL_LAYOUT.internalCrossAisleSpacing);
    expect(LARGE_WAREHOUSE_SPATIAL_LAYOUT.internalCrossAisleSpacing)
      .toBeLessThan(LARGE_WAREHOUSE_SPATIAL_LAYOUT.blockSeparation);
  });

  test("is deterministic, finite, and does not mutate aisle nodes", () => {
    const before = JSON.stringify(largeWarehouse.aisleNodes);
    const first = computeWarehouseAisleRects(largeWarehouse.aisleNodes, largeWarehouse.spatialLayout);
    const second = computeWarehouseAisleRects(largeWarehouse.aisleNodes, largeWarehouse.spatialLayout);

    expect(second).toEqual(first);
    expect(JSON.stringify(largeWarehouse.aisleNodes)).toBe(before);
    expect(first.flatMap(({ x, y, width, height }) => [x, y, width, height]).every(Number.isFinite))
      .toBe(true);
  });
});
