// @vitest-environment jsdom
import { describe, expect, test, vi } from "vitest";
import { render } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { WarehouseMap, type RouteVisibility } from "./WarehouseMap";
import { buildValidatedDistanceMatrix } from "../domain/distanceMatrix";
import { nearestNeighborRoute } from "../domain/nearestNeighbor";
import { twoOptRoute } from "../domain/twoOpt";
import { sampleWarehouse } from "../data/sampleWarehouse";
import { largeWarehouse } from "../data/largeWarehouse";
import type { NodeId, WarehouseGraph } from "../domain/types";
import { expandRoutePath } from "../ui/routePath";
import { buildCoordinateLookup, NN_OFFSET, OPT_OFFSET, pointsAttribute } from "../ui/svgPoints";
import { LanguageProvider } from "../i18n/LanguageContext";

function routeGraphFor(targetIds: string[]): WarehouseGraph {
  return {
    ...sampleWarehouse,
    locations: sampleWarehouse.locations.filter((l) => targetIds.includes(l.id)),
  };
}

function computeRoutes(targetIds: string[]) {
  const { visitIds, pathMatrix } = buildValidatedDistanceMatrix(routeGraphFor(targetIds));
  const worker = nearestNeighborRoute(sampleWarehouse, targetIds);
  const recommended = twoOptRoute(sampleWarehouse, targetIds, worker);
  return { visitIds, pathMatrix, worker, recommended };
}

interface SetupOverrides {
  language?: "ko" | "en";
  manualStopIds?: NodeId[];
  completedIds?: Set<NodeId>;
  searchMatchIds?: Set<NodeId>;
  routeVisibility?: RouteVisibility;
  onLocationClick?: (id: NodeId) => void;
  simulationMarker?: { x: number; y: number } | null;
}

function setup(targetIds: string[], selected: Set<string>, overrides: SetupOverrides = {}) {
  const { visitIds, pathMatrix, worker, recommended } = computeRoutes(targetIds);

  return render(
    <LanguageProvider initialLanguage={overrides.language ?? "en"}>
      <WarehouseMap
        graph={sampleWarehouse}
        selected={selected}
        visitIds={visitIds}
        pathMatrix={pathMatrix}
        workerRoute={worker}
        recommendedRoute={recommended}
        routeVisibility={overrides.routeVisibility ?? "both"}
        manualStopIds={overrides.manualStopIds ?? []}
        completedIds={overrides.completedIds ?? new Set()}
        searchMatchIds={overrides.searchMatchIds ?? new Set()}
        simulationMarker={overrides.simulationMarker}
        onLocationClick={overrides.onLocationClick ?? (() => {})}
      />
    </LanguageProvider>,
  );
}

describe("WarehouseMap", () => {
  test("localizes the SVG title and both legend accessible names", () => {
    const english = setup(["loc-A", "loc-B"], new Set(["loc-A", "loc-B"]));
    expect(english.getByRole("img", { name: /Warehouse floor plan showing/ })).toBeTruthy();
    expect(english.getByRole("list", { name: "Map legend" })).toBeTruthy();
    expect(english.getByRole("list", { name: "Route line legend" })).toBeTruthy();
    english.unmount();

    const korean = setup(["loc-A", "loc-B"], new Set(["loc-A", "loc-B"]), { language: "ko" });
    expect(korean.getByRole("img", { name: /창고 평면도/ })).toBeTruthy();
    expect(korean.getByRole("list", { name: "지도 범례" })).toBeTruthy();
    expect(korean.getByRole("list", { name: "경로 선 범례" })).toBeTruthy();
  });

  test("renders an optional simulation marker at the supplied display coordinate", () => {
    const { container } = setup([], new Set(), { simulationMarker: { x: 12.5, y: 34.75 } });
    const marker = container.querySelector('[data-testid="simulation-marker"]');

    expect(marker?.getAttribute("transform")).toBe("translate(12.5 34.75)");
    expect(marker?.getAttribute("aria-hidden")).toBe("true");
  });

  test("does not render a simulation marker when none is supplied", () => {
    const { container } = setup([], new Set());
    expect(container.querySelector('[data-testid="simulation-marker"]')).toBeNull();
  });

  test("the two routes are independently selectable by a stable attribute and carry distinct visual encodings", () => {
    const { container } = setup(
      ["loc-A", "loc-B", "loc-C", "loc-D"],
      new Set(["loc-A", "loc-B", "loc-C", "loc-D"]),
    );

    const workerLine = container.querySelector('[data-route="worker"]');
    const recommendedLine = container.querySelector('[data-route="recommended"]');
    expect(workerLine).not.toBeNull();
    expect(recommendedLine).not.toBeNull();
    expect(workerLine).not.toBe(recommendedLine);
    expect(workerLine!.tagName).toBe("polyline");
    expect(recommendedLine!.tagName).toBe("polyline");

    expect(workerLine!.getAttribute("class")).not.toBe(recommendedLine!.getAttribute("class"));

    expect(recommendedLine!.getAttribute("stroke-dasharray")).toBe("3 2.2");
    expect(workerLine!.getAttribute("stroke-dasharray")).toBeNull();

    // Distinguishable by shape, not only by color: worker stops are circles, recommended stops are rects.
    const workerStopShapes = container.querySelectorAll(".warehouse-map__stop--worker circle");
    const recommendedStopShapes = container.querySelectorAll(".warehouse-map__stop--recommended rect");
    expect(workerStopShapes.length).toBeGreaterThan(0);
    expect(recommendedStopShapes.length).toBeGreaterThan(0);
    expect(container.querySelectorAll(".warehouse-map__stop--worker rect").length).toBe(0);
    expect(container.querySelectorAll(".warehouse-map__stop--recommended circle").length).toBe(0);
  });

  test("the rendered worker-route polyline exactly matches the production-derived aisle path and never returns to the office", () => {
    const targetIds = ["loc-D", "loc-C"];
    const { visitIds, pathMatrix, worker } = computeRoutes(targetIds);
    const { container } = setup(targetIds, new Set(targetIds));

    const expectedPath = expandRoutePath(worker.order, visitIds, pathMatrix);
    const coords = buildCoordinateLookup(sampleWarehouse);
    const expectedPoints = pointsAttribute(expectedPath, coords, NN_OFFSET);

    const workerLine = container.querySelector('[data-route="worker"]')!;
    expect(workerLine.getAttribute("points")).toBe(expectedPoints);

    expect(expectedPath[0]).toBe(sampleWarehouse.start.id);
    expect(expectedPath.filter((id) => id === sampleWarehouse.start.id)).toHaveLength(1);

    const finalTargetId = worker.order[worker.order.length - 1];
    const finalTargetPoint = coords.get(finalTargetId)!;
    const officePoint = coords.get(sampleWarehouse.start.id)!;
    const renderedPoints = workerLine.getAttribute("points")!.split(" ");
    const lastRenderedPoint = renderedPoints[renderedPoints.length - 1];

    expect(lastRenderedPoint).toBe(
      `${finalTargetPoint.x + NN_OFFSET.x},${finalTargetPoint.y + NN_OFFSET.y}`,
    );
    expect(lastRenderedPoint).not.toBe(`${officePoint.x + NN_OFFSET.x},${officePoint.y + NN_OFFSET.y}`);
  });

  test("the rendered recommended-route polyline exactly matches the production-derived aisle path and never returns to the office", () => {
    const targetIds = ["loc-D", "loc-C"];
    const { visitIds, pathMatrix, recommended } = computeRoutes(targetIds);
    const { container } = setup(targetIds, new Set(targetIds));

    const expectedPath = expandRoutePath(recommended.order, visitIds, pathMatrix);
    const coords = buildCoordinateLookup(sampleWarehouse);
    const expectedPoints = pointsAttribute(expectedPath, coords, OPT_OFFSET);

    const recommendedLine = container.querySelector('[data-route="recommended"]')!;
    expect(recommendedLine.getAttribute("points")).toBe(expectedPoints);

    expect(expectedPath[0]).toBe(sampleWarehouse.start.id);
    expect(expectedPath.filter((id) => id === sampleWarehouse.start.id)).toHaveLength(1);

    const finalTargetId = recommended.order[recommended.order.length - 1];
    const finalTargetPoint = coords.get(finalTargetId)!;
    const officePoint = coords.get(sampleWarehouse.start.id)!;
    const renderedPoints = recommendedLine.getAttribute("points")!.split(" ");
    const lastRenderedPoint = renderedPoints[renderedPoints.length - 1];

    expect(lastRenderedPoint).toBe(
      `${finalTargetPoint.x + OPT_OFFSET.x},${finalTargetPoint.y + OPT_OFFSET.y}`,
    );
    expect(lastRenderedPoint).not.toBe(
      `${officePoint.x + OPT_OFFSET.x},${officePoint.y + OPT_OFFSET.y}`,
    );
  });

  test("hiding the worker route via routeVisibility removes its polyline and stop markers but keeps the recommended route", () => {
    const { container } = setup(["loc-A", "loc-B"], new Set(["loc-A", "loc-B"]), {
      routeVisibility: "recommended",
    });
    expect(container.querySelector('[data-route="worker"]')).toBeNull();
    expect(container.querySelectorAll(".warehouse-map__stop--worker").length).toBe(0);
    expect(container.querySelector('[data-route="recommended"]')).not.toBeNull();
  });

  test("marks selected and available locations distinctly", () => {
    const { container } = setup(["loc-A"], new Set(["loc-A"]));

    const selectedNode = container.querySelector('[data-selected="true"]');
    const availableNodes = container.querySelectorAll('[data-selected="false"]');
    expect(selectedNode).not.toBeNull();
    expect(availableNodes.length).toBe(sampleWarehouse.locations.length - 1);
  });

  test("renders no route line for a single-node (zero-target) route, without crashing", () => {
    const { container } = setup([], new Set());

    expect(container.querySelector('[data-route="worker"]')).toBeNull();
    expect(container.querySelector('[data-route="recommended"]')).toBeNull();
    expect(container.textContent).toContain(sampleWarehouse.start.label);
  });

  test("map markers remain visualization-only even when a legacy click callback is supplied", () => {
    const onLocationClick = vi.fn();
    const { container } = setup(["loc-A"], new Set(["loc-A"]), { onLocationClick });
    fireEvent.click(container.querySelector('[data-location-id="loc-A"]')!);
    expect(onLocationClick).not.toHaveBeenCalled();
    expect(container.querySelector('[data-location-id="loc-A"]')!.getAttribute("role")).toBeNull();
  });

  test("clicking an available (unselected) location does nothing -- selecting happens only in the target selector", () => {
    const onLocationClick = vi.fn();
    const { container } = setup([], new Set(), { onLocationClick });
    fireEvent.click(container.querySelector('[data-location-id="loc-A"]')!);
    expect(onLocationClick).not.toHaveBeenCalled();
  });

  test("an available location's label is hidden until hovered or focused", () => {
    const { container } = setup([], new Set());
    const group = container.querySelector('[data-location-id="loc-A"]')!;
    expect(group.querySelector(".warehouse-map__location-label")).toBeNull();

    fireEvent.mouseEnter(group);
    expect(group.querySelector(".warehouse-map__location-label")).not.toBeNull();

    fireEvent.mouseLeave(group);
    expect(group.querySelector(".warehouse-map__location-label")).toBeNull();
  });

  test("a search-matched location's label is shown even when available and unhovered", () => {
    const { container } = setup([], new Set(), { searchMatchIds: new Set(["loc-A"]) });
    const group = container.querySelector('[data-location-id="loc-A"]')!;
    expect(group.querySelector(".warehouse-map__location-label")).not.toBeNull();
  });

  test("completed locations carry a distinct data-state and render a checkmark, not the worker/recommended shapes", () => {
    const { container } = setup(["loc-A"], new Set(["loc-A"]), {
      completedIds: new Set(["loc-A"]),
    });
    const completedMarker = container.querySelector('[data-location-id="loc-A"]')!;
    expect(completedMarker.getAttribute("data-state")).toBe("completed");
    expect(completedMarker.querySelector(".warehouse-map__check")).not.toBeNull();
    expect(container.querySelector('[data-location-id="loc-B"]')!.getAttribute("data-state")).toBe(
      "available",
    );
  });

  test("a location in the manual route reports state 'route' and carries its sequence number", () => {
    const { container } = setup([], new Set(), { manualStopIds: ["loc-B", "loc-A"] });
    expect(container.querySelector('[data-location-id="loc-B"]')!.getAttribute("data-state")).toBe(
      "route",
    );
    expect(container.querySelector('[data-location-id="loc-B"] [data-sequence]')!.textContent).toBe(
      "1",
    );
    expect(container.querySelector('[data-location-id="loc-A"] [data-sequence]')!.textContent).toBe(
      "2",
    );
    expect(
      container.querySelector('[data-location-id="loc-B"] .warehouse-map__location-label'),
    ).not.toBeNull();
  });

  test("renders a rack rectangle for each aisle, behind the location markers", () => {
    const { container } = setup([], new Set());
    const racks = container.querySelectorAll(".warehouse-map__rack");
    expect(racks.length).toBeGreaterThan(0);
  });

  test("renders the large warehouse's shared spatial hierarchy", () => {
    const { container } = render(
      <LanguageProvider initialLanguage="en">
        <WarehouseMap
          graph={largeWarehouse}
          selected={new Set()}
          visitIds={[largeWarehouse.start.id]}
          pathMatrix={[[[largeWarehouse.start.id]]]}
          workerRoute={null}
          recommendedRoute={null}
          routeVisibility="both"
          manualStopIds={[]}
          completedIds={new Set()}
          searchMatchIds={new Set()}
          onLocationClick={() => {}}
        />
      </LanguageProvider>,
    );

    expect(container.querySelectorAll('[data-aisle-category="local"]')).toHaveLength(30);
    expect(container.querySelectorAll('[data-aisle-category="internal-cross"]')).toHaveLength(4);
    expect(container.querySelectorAll('[data-aisle-category="block-separation"]')).toHaveLength(1);
  });

  test("does not render the raw aisle-node routing graph -- only racks, office, bins, and route lines", () => {
    const { container } = setup([], new Set());
    expect(container.querySelectorAll(".warehouse-map__aisle-edge").length).toBe(0);
    expect(container.querySelector(".warehouse-map__aisles")).toBeNull();
  });

  test("provides a scrollable viewport wrapper and a view-full-warehouse toggle for narrow screens", () => {
    const { container } = setup([], new Set());
    expect(container.querySelector(".warehouse-map__viewport")).not.toBeNull();
    const toggle = container.querySelector(".warehouse-map__zoom-toggle")!;
    expect(toggle.textContent).toBe("View full warehouse");
    fireEvent.click(toggle);
    expect(toggle.textContent).toBe("Zoom to selection");
  });

  test("the svg's aspect ratio is derived from its own viewBox, not a fixed portrait/landscape guess", () => {
    const { container } = setup([], new Set());
    const svg = container.querySelector(".warehouse-map__svg") as HTMLElement;
    const viewBox = svg.getAttribute("viewBox")!.split(" ").map(Number);
    expect(svg.style.aspectRatio).toBe(`${viewBox[2]} / ${viewBox[3]}`);
  });

  test("shows a route-line legend, separate from the location-state legend, once routes are drawn", () => {
    const { container } = setup(["loc-A", "loc-B"], new Set(["loc-A", "loc-B"]));
    const routeLegend = container.querySelector(".warehouse-map__route-legend")!;
    expect(routeLegend).not.toBeNull();
    expect(routeLegend.textContent).toContain("Worker Route (solid line)");
    expect(routeLegend.textContent).toContain("Recommended Route (dashed line)");
    expect(routeLegend.textContent).toContain("Numbers show the visit order.");
    // Kept out of the location-state legend entirely.
    const locationLegend = container.querySelector('[aria-label="Map legend"]')!;
    expect(locationLegend.textContent).not.toContain("Worker Route");
  });

  test("hides the route-line legend when no route is drawn yet", () => {
    const { container } = setup([], new Set());
    expect(container.querySelector(".warehouse-map__route-legend")).toBeNull();
  });

  test("only lists the currently visible route in the legend when one route is hidden via routeVisibility", () => {
    const { container } = setup(["loc-A", "loc-B"], new Set(["loc-A", "loc-B"]), {
      routeVisibility: "worker",
    });
    const routeLegend = container.querySelector(".warehouse-map__route-legend")!;
    expect(routeLegend.textContent).toContain("Worker Route (solid line)");
    expect(routeLegend.textContent).not.toContain("Recommended Route");
  });

  test("shows a secondary swipe-to-pan hint for the mobile map viewport", () => {
    const { container } = setup([], new Set());
    const hint = container.querySelector(".warehouse-map__mobile-hint")!;
    expect(hint.textContent).toBe("Swipe horizontally to view other zones.");
  });

  test("hides the swipe hint once the worker has switched to the full-warehouse view", () => {
    const { container } = setup([], new Set());
    fireEvent.click(container.querySelector(".warehouse-map__zoom-toggle")!);
    expect(container.querySelector(".warehouse-map__mobile-hint")).toBeNull();
  });
});
