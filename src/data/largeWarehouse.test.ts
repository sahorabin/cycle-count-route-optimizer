import { describe, expect, test } from "vitest";
import { buildLocations, largeWarehouse, ZONE_IDS } from "./largeWarehouse";
import { validateGraph } from "../domain/validateGraph";

describe("largeWarehouse", () => {
  test("has exactly 100 cycle-count locations", () => {
    expect(largeWarehouse.locations).toHaveLength(100);
  });

  test("every location id is unique", () => {
    const ids = largeWarehouse.locations.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("every aisle node id is unique and distinct from location/start ids", () => {
    const aisleIds = largeWarehouse.aisleNodes.map((n) => n.id);
    expect(new Set(aisleIds).size).toBe(aisleIds.length);
    const allIds = [
      ...aisleIds,
      largeWarehouse.start.id,
      ...largeWarehouse.locations.map((l) => l.id),
    ];
    expect(new Set(allIds).size).toBe(allIds.length);
  });

  test("the whole graph passes structural validation (reachability, positive lengths, valid refs)", () => {
    const result = validateGraph(largeWarehouse);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  test("every location has a zone and an aisle assigned, drawn from ZONE_IDS", () => {
    expect(ZONE_IDS).toHaveLength(10);
    for (const location of largeWarehouse.locations) {
      expect(location.zone).toBeDefined();
      expect(ZONE_IDS).toContain(location.zone);
      expect(location.aisle).toBeDefined();
    }
  });

  test("each zone has exactly 10 locations", () => {
    for (const zone of ZONE_IDS) {
      const count = largeWarehouse.locations.filter((l) => l.zone === zone).length;
      expect(count).toBe(10);
    }
  });

  test("generation is deterministic: calling the builder again produces an identical result", () => {
    expect(buildLocations()).toEqual(largeWarehouse.locations);
  });
});
