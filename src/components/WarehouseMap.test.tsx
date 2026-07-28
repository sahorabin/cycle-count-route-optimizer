// @vitest-environment jsdom
import { describe, expect, test } from "vitest";
import { render } from "@testing-library/react";
import { WarehouseMap } from "./WarehouseMap";
import { buildValidatedDistanceMatrix } from "../domain/distanceMatrix";
import { nearestNeighborRoute } from "../domain/nearestNeighbor";
import { twoOptRoute } from "../domain/twoOpt";
import { sampleWarehouse } from "../data/sampleWarehouse";
import type { WarehouseGraph } from "../domain/types";
import { expandRoutePath } from "../ui/routePath";
import { buildCoordinateLookup, NN_OFFSET, OPT_OFFSET, pointsAttribute } from "../ui/svgPoints";

function routeGraphFor(targetIds: string[]): WarehouseGraph {
  return {
    ...sampleWarehouse,
    locations: sampleWarehouse.locations.filter((l) => targetIds.includes(l.id)),
  };
}

function computeRoutes(targetIds: string[]) {
  const { visitIds, pathMatrix } = buildValidatedDistanceMatrix(routeGraphFor(targetIds));
  const nn = nearestNeighborRoute(sampleWarehouse, targetIds);
  const twoOpt = twoOptRoute(sampleWarehouse, targetIds, nn);
  return { visitIds, pathMatrix, nn, twoOpt };
}

function setup(targetIds: string[], selected: Set<string>) {
  const { visitIds, pathMatrix, nn, twoOpt } = computeRoutes(targetIds);

  return render(
    <WarehouseMap
      graph={sampleWarehouse}
      selected={selected}
      visitIds={visitIds}
      pathMatrix={pathMatrix}
      nearestNeighbor={nn}
      optimized={twoOpt}
    />,
  );
}

describe("WarehouseMap", () => {
  test("the two routes are independently selectable by a stable attribute and carry distinct visual encodings", () => {
    const { container } = setup(
      ["loc-A", "loc-B", "loc-C", "loc-D"],
      new Set(["loc-A", "loc-B", "loc-C", "loc-D"]),
    );

    // Stable semantic selector: each route's line is independently addressable
    // by a plain data attribute, not by a generated/hashed class name.
    const nnLine = container.querySelector('[data-route="nearest-neighbor"]');
    const optLine = container.querySelector('[data-route="two-opt"]');
    expect(nnLine).not.toBeNull();
    expect(optLine).not.toBeNull();
    expect(nnLine).not.toBe(optLine);
    expect(nnLine!.tagName).toBe("polyline");
    expect(optLine!.tagName).toBe("polyline");

    // Distinct stroke presentation: each route carries its own author-defined
    // (not generated/hashed) style class, so they never resolve to the same rule.
    expect(nnLine!.getAttribute("class")).not.toBe(optLine!.getAttribute("class"));

    // Optimized route's dash pattern is a real SVG presentation attribute, so it's
    // directly inspectable here without needing to load or compute App.css.
    expect(optLine!.getAttribute("stroke-dasharray")).toBe("3 2.2");
    expect(nnLine!.getAttribute("stroke-dasharray")).toBeNull();

    // Distinguishable by shape, not only by color: NN stops are circles, 2-opt stops are rects.
    const nnStopShapes = container.querySelectorAll(".warehouse-map__stop--nn circle");
    const optStopShapes = container.querySelectorAll(".warehouse-map__stop--opt rect");
    expect(nnStopShapes.length).toBeGreaterThan(0);
    expect(optStopShapes.length).toBeGreaterThan(0);
    // And never cross-contaminated: an NN stop is never a rect, an opt stop never a circle.
    expect(container.querySelectorAll(".warehouse-map__stop--nn rect").length).toBe(0);
    expect(container.querySelectorAll(".warehouse-map__stop--opt circle").length).toBe(0);
  });

  test("the rendered Nearest Neighbor polyline exactly matches the production-derived aisle path and never returns to the office", () => {
    const targetIds = ["loc-D", "loc-C"];
    const { visitIds, pathMatrix, nn } = computeRoutes(targetIds);
    const { container } = setup(targetIds, new Set(targetIds));

    // Derive the expected node sequence via the same production helper the
    // component uses, from the route's own order -- not re-implemented here.
    const expectedPath = expandRoutePath(nn.order, visitIds, pathMatrix);
    const coords = buildCoordinateLookup(sampleWarehouse);
    const expectedPoints = pointsAttribute(expectedPath, coords, NN_OFFSET);

    const nnLine = container.querySelector('[data-route="nearest-neighbor"]')!;
    expect(nnLine.getAttribute("points")).toBe(expectedPoints);

    // The office appears exactly once in the expanded open path, at the very start.
    expect(expectedPath[0]).toBe(sampleWarehouse.start.id);
    expect(expectedPath.filter((id) => id === sampleWarehouse.start.id)).toHaveLength(1);

    // The rendered line's last point is the final target's own display position --
    // not a phantom segment back to the office's.
    const finalTargetId = nn.order[nn.order.length - 1];
    const finalTargetPoint = coords.get(finalTargetId)!;
    const officePoint = coords.get(sampleWarehouse.start.id)!;
    const renderedPoints = nnLine.getAttribute("points")!.split(" ");
    const lastRenderedPoint = renderedPoints[renderedPoints.length - 1];

    expect(lastRenderedPoint).toBe(
      `${finalTargetPoint.x + NN_OFFSET.x},${finalTargetPoint.y + NN_OFFSET.y}`,
    );
    expect(lastRenderedPoint).not.toBe(`${officePoint.x + NN_OFFSET.x},${officePoint.y + NN_OFFSET.y}`);
  });

  test("the rendered 2-opt polyline exactly matches the production-derived aisle path and never returns to the office", () => {
    const targetIds = ["loc-D", "loc-C"];
    const { visitIds, pathMatrix, twoOpt } = computeRoutes(targetIds);
    const { container } = setup(targetIds, new Set(targetIds));

    const expectedPath = expandRoutePath(twoOpt.order, visitIds, pathMatrix);
    const coords = buildCoordinateLookup(sampleWarehouse);
    const expectedPoints = pointsAttribute(expectedPath, coords, OPT_OFFSET);

    const optLine = container.querySelector('[data-route="two-opt"]')!;
    expect(optLine.getAttribute("points")).toBe(expectedPoints);

    expect(expectedPath[0]).toBe(sampleWarehouse.start.id);
    expect(expectedPath.filter((id) => id === sampleWarehouse.start.id)).toHaveLength(1);

    const finalTargetId = twoOpt.order[twoOpt.order.length - 1];
    const finalTargetPoint = coords.get(finalTargetId)!;
    const officePoint = coords.get(sampleWarehouse.start.id)!;
    const renderedPoints = optLine.getAttribute("points")!.split(" ");
    const lastRenderedPoint = renderedPoints[renderedPoints.length - 1];

    expect(lastRenderedPoint).toBe(
      `${finalTargetPoint.x + OPT_OFFSET.x},${finalTargetPoint.y + OPT_OFFSET.y}`,
    );
    expect(lastRenderedPoint).not.toBe(
      `${officePoint.x + OPT_OFFSET.x},${officePoint.y + OPT_OFFSET.y}`,
    );
  });

  test("marks selected and unselected locations distinctly", () => {
    const { container } = setup(["loc-A"], new Set(["loc-A"]));

    const selectedNode = container.querySelector('[data-selected="true"]');
    const unselectedNodes = container.querySelectorAll('[data-selected="false"]');
    expect(selectedNode).not.toBeNull();
    expect(unselectedNodes.length).toBe(sampleWarehouse.locations.length - 1);
  });

  test("renders no route line for a single-node (zero-target) route, without crashing", () => {
    const { container } = setup([], new Set());

    expect(container.querySelector('[data-route="nearest-neighbor"]')).toBeNull();
    expect(container.querySelector('[data-route="two-opt"]')).toBeNull();
    // The office marker should still be present.
    expect(container.textContent).toContain(sampleWarehouse.start.label);
  });
});
