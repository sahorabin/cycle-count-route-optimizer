import { describe, expect, test } from "vitest";
import { calculateRouteDistance } from "./routeDistance";
import { buildDistanceMatrix } from "./distanceMatrix";
import { sampleWarehouse } from "../data/sampleWarehouse";

// calculateRouteDistance is a pure summation with no opinion on whether
// `order` is well-formed. Rejection of malformed orders (office not first,
// duplicate/missing/unknown ids, aisle nodes) is validateRouteOrder's job
// and is tested in routeOrder.test.ts.
describe("calculateRouteDistance", () => {
  test("a route of just the start point has zero distance", () => {
    const { visitIds, distanceMatrix } = buildDistanceMatrix(sampleWarehouse);

    expect(calculateRouteDistance(["office"], visitIds, distanceMatrix)).toBe(0);
  });

  test("a two-stop route equals the single matrix entry between them", () => {
    const { visitIds, distanceMatrix } = buildDistanceMatrix(sampleWarehouse);

    expect(calculateRouteDistance(["office", "loc-A"], visitIds, distanceMatrix)).toBe(111);
  });

  test("sums each consecutive leg for a multi-stop route", () => {
    const { visitIds, distanceMatrix } = buildDistanceMatrix(sampleWarehouse);

    // office -> loc-D: 50 (hand-computed in distanceMatrix.test.ts)
    // loc-D -> loc-B: 2 (spur) + 65 (F3-F2-M2) + 4 (spur) = 71
    // total: 121
    const total = calculateRouteDistance(["office", "loc-D", "loc-B"], visitIds, distanceMatrix);

    expect(total).toBe(121);
  });

  test("matches a hand-calculated total for one valid full visiting order", () => {
    const { visitIds, distanceMatrix } = buildDistanceMatrix(sampleWarehouse);

    // office->loc-D: 50, loc-D->loc-B: 71, loc-B->loc-A: 172, loc-A->loc-C: 246
    // (each leg hand-verified against Dijkstra distances in distanceMatrix.test.ts)
    const total = calculateRouteDistance(
      ["office", "loc-D", "loc-B", "loc-A", "loc-C"],
      visitIds,
      distanceMatrix,
    );

    expect(total).toBe(539);
  });

  test("matches a hand-calculated total for a different valid full visiting order", () => {
    const { visitIds, distanceMatrix } = buildDistanceMatrix(sampleWarehouse);

    // office->loc-A: 111, loc-A->loc-D: 145, loc-D->loc-C: 105, loc-C->loc-B: 172
    const total = calculateRouteDistance(
      ["office", "loc-A", "loc-D", "loc-C", "loc-B"],
      visitIds,
      distanceMatrix,
    );

    expect(total).toBe(533);
  });
});
