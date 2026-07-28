import { describe, expect, test } from "vitest";
import { computeRackRect, computeRackRects, groupAisleNodesIntoRacks } from "./rackLayout";
import { largeWarehouse } from "../data/largeWarehouse";
import { sampleWarehouse } from "../data/sampleWarehouse";

describe("groupAisleNodesIntoRacks", () => {
  test("groups the 100-location fixture's aisle nodes into exactly 10 racks", () => {
    const groups = groupAisleNodesIntoRacks(largeWarehouse.aisleNodes);
    expect(groups).toHaveLength(10);
    // Each rack in this fixture has a front, mid, and back node.
    for (const group of groups) {
      expect(group).toHaveLength(3);
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
  test("produces one rect per rack, all with positive width/height", () => {
    const rects = computeRackRects(largeWarehouse.aisleNodes);
    expect(rects).toHaveLength(10);
    for (const rect of rects) {
      expect(rect.width).toBeGreaterThan(0);
      expect(rect.height).toBeGreaterThan(0);
    }
  });
});
