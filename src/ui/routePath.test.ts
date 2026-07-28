import { describe, expect, test } from "vitest";
import { expandRoutePath } from "./routePath";
import { buildValidatedDistanceMatrix } from "../domain/distanceMatrix";
import { sampleWarehouse } from "../data/sampleWarehouse";
import type { WarehouseGraph } from "../domain/types";

function routeGraphFor(targetIds: string[]): WarehouseGraph {
  return {
    ...sampleWarehouse,
    locations: sampleWarehouse.locations.filter((l) => targetIds.includes(l.id)),
  };
}

describe("expandRoutePath", () => {
  test("handles a one-node route safely", () => {
    const { visitIds, pathMatrix } = buildValidatedDistanceMatrix(routeGraphFor([]));

    const path = expandRoutePath(["office"], visitIds, pathMatrix);

    expect(path).toEqual(["office"]);
  });

  test("expands a single leg through its intermediate aisle nodes", () => {
    const { visitIds, pathMatrix } = buildValidatedDistanceMatrix(routeGraphFor(["loc-D"]));

    const path = expandRoutePath(["office", "loc-D"], visitIds, pathMatrix);

    // office attaches F1, loc-D attaches F3; shortest aisle path is F1-F2-F3.
    expect(path).toEqual(["office", "F1", "F2", "F3", "loc-D"]);
  });

  test("concatenates consecutive legs without duplicating the shared junction", () => {
    const { visitIds, pathMatrix } = buildValidatedDistanceMatrix(routeGraphFor(["loc-D", "loc-C"]));

    const path = expandRoutePath(["office", "loc-D", "loc-C"], visitIds, pathMatrix);

    // leg 1: office -> F1 -> F2 -> F3 -> loc-D
    // leg 2: loc-D -> F3 -> B3 -> loc-C
    // "loc-D" is the shared endpoint and must appear exactly once, not twice in a row.
    expect(path).toEqual(["office", "F1", "F2", "F3", "loc-D", "F3", "B3", "loc-C"]);
    expect(path.filter((id) => id === "loc-D")).toHaveLength(1);
  });

  test("never appends a return-to-office segment", () => {
    const { visitIds, pathMatrix } = buildValidatedDistanceMatrix(routeGraphFor(["loc-A"]));

    const path = expandRoutePath(["office", "loc-A"], visitIds, pathMatrix);

    expect(path[path.length - 1]).toBe("loc-A");
    expect(path.filter((id) => id === "office")).toHaveLength(1);
  });

  test("returns an empty path for an empty order", () => {
    const { visitIds, pathMatrix } = buildValidatedDistanceMatrix(routeGraphFor([]));

    expect(expandRoutePath([], visitIds, pathMatrix)).toEqual([]);
  });
});
