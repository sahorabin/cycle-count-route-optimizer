import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { expandRoutePath } from "../ui/routePath";
import { buildCoordinateLookup, NN_OFFSET, OPT_OFFSET, pointsAttribute, type Point } from "../ui/svgPoints";
import { computeRackRects } from "../ui/rackLayout";
import type { CycleCountLocation, NodeId, RouteComputation, WarehouseGraph } from "../domain/types";
import { useTranslation } from "../i18n/useTranslation";

export type RouteVisibility = "worker" | "recommended" | "both";

interface WarehouseMapProps {
  graph: WarehouseGraph;
  selected: ReadonlySet<NodeId>;
  visitIds: NodeId[];
  pathMatrix: NodeId[][][];
  workerRoute: RouteComputation | null;
  recommendedRoute: RouteComputation | null;
  routeVisibility: RouteVisibility;
  manualStopIds: NodeId[];
  completedIds: ReadonlySet<NodeId>;
  searchMatchIds: ReadonlySet<NodeId>;
  simulationMarker?: Point | null;
  onLocationClick: (id: NodeId) => void;
}

const PADDING = 15;
// Kept as a plain SVG presentation attribute (not CSS-only) so the recommended
// route's dash pattern is directly inspectable in tests without loading a
// stylesheet; App.css's rule for the same class carries the same value.
const RECOMMENDED_DASHARRAY = "3 2.2";

function computeViewBox(coords: Point[]): string {
  const xs = coords.map((p) => p.x);
  const ys = coords.map((p) => p.y);
  const minX = Math.min(...xs) - PADDING;
  const minY = Math.min(...ys) - PADDING;
  const width = Math.max(...xs) - minX + PADDING;
  const height = Math.max(...ys) - minY + PADDING;
  return `${minX} ${minY} ${width} ${height}`;
}

type LocationState = "completed" | "route" | "selected" | "available";

function locationState(
  id: NodeId,
  selected: ReadonlySet<NodeId>,
  manualStopIds: NodeId[],
  completedIds: ReadonlySet<NodeId>,
): LocationState {
  if (completedIds.has(id)) return "completed";
  if (manualStopIds.includes(id)) return "route";
  if (selected.has(id)) return "selected";
  return "available";
}

/**
 * One location marker. Hooks (label-reveal-on-hover state) cannot run
 * inside the parent's .map() callback, so each marker is its own
 * component. Only "selected" markers are click/keyboard interactive --
 * clicking assigns the next visit-order sequence number. "available"
 * markers are informational only: choosing today's targets happens in the
 * TargetSelector, never by clicking the map, so the two concepts (select
 * vs. order) never get confused with each other.
 */
function LocationMarker({
  location,
  state,
  sequence,
  isSearchMatch,
  onClick,
}: {
  location: CycleCountLocation;
  state: LocationState;
  sequence: number | null;
  isSearchMatch: boolean;
  onClick: () => void;
}) {
  const [revealed, setRevealed] = useState(false);
  const showLabel = revealed || state !== "available" || isSearchMatch;
  const isClickable = state === "selected";
  // Full labels ("Zone A - Bin 01") are wider than the ~8-unit gap between
  // neighboring markers and would overlap when both are shown at once; the
  // short id-derived code stays legible at that spacing. The full label
  // remains available via aria-label and the native <title> tooltip.
  const shortLabel = location.id.replace(/^loc-/, "");

  const interactiveProps = isClickable
    ? {
        tabIndex: 0,
        role: "button" as const,
        onClick,
        onKeyDown: (e: KeyboardEvent) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick();
          }
        },
      }
    : { tabIndex: -1 };

  return (
    <g
      transform={`translate(${location.x} ${location.y})`}
      className={`warehouse-map__location warehouse-map__location--${state}${
        isSearchMatch ? " warehouse-map__location--match" : ""
      }`}
      data-location-id={location.id}
      data-state={state}
      data-selected={state !== "available"}
      aria-label={location.label}
      onMouseEnter={() => setRevealed(true)}
      onMouseLeave={() => setRevealed(false)}
      onFocus={() => setRevealed(true)}
      onBlur={() => setRevealed(false)}
      {...interactiveProps}
    >
      <title>{location.label}</title>
      <circle r={3.2} />
      {state === "completed" && (
        <path
          className="warehouse-map__check"
          d="M-1.5 0.1 L-0.4 1.3 L1.6 -1.3"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {sequence !== null && (
        <text data-sequence="" className="warehouse-map__sequence" dy="0.35em">
          {sequence}
        </text>
      )}
      {showLabel && (
        <text className="warehouse-map__location-label" y={-5}>
          {shortLabel}
        </text>
      )}
    </g>
  );
}

/**
 * SVG coordinates on every node are display-only (see domain/types.ts).
 * Rack rectangles (rackLayout.ts) are likewise a pure drawing aid derived
 * from aisle-node positions -- neither ever feeds back into routing.
 * Every distance shown elsewhere comes from the aisle-based
 * distanceMatrix, never from anything computed here.
 */
export function WarehouseMap({
  graph,
  selected,
  visitIds,
  pathMatrix,
  workerRoute,
  recommendedRoute,
  routeVisibility,
  manualStopIds,
  completedIds,
  searchMatchIds,
  simulationMarker = null,
  onLocationClick,
}: WarehouseMapProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const coords = useMemo(() => buildCoordinateLookup(graph), [graph]);
  const viewBox = useMemo(() => computeViewBox([...coords.values()]), [coords]);
  const rackRects = useMemo(() => computeRackRects(graph.aisleNodes), [graph.aisleNodes]);
  // The viewBox is already fit tightly to the warehouse's real extent
  // (computeViewBox above); matching the container's aspect ratio to it is
  // what keeps the rendered map from being letterboxed inside a taller,
  // mismatched CSS box.
  const [, , vbWidth, vbHeight] = viewBox.split(" ").map(Number);

  // On narrow viewports the map defaults to a zoomed-in, horizontally
  // scrollable view (see .warehouse-map__svg--zoomed in App.css) so markers
  // stay legible instead of shrinking the whole floor plan to fit 375px.
  // "View full warehouse" switches to the same fit-to-container rendering
  // used on desktop. On desktop this state has no visual effect.
  const [zoomedOut, setZoomedOut] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const focusIds = manualStopIds.length > 0 ? manualStopIds : [...selected];
  const focusKey = focusIds.join(",");

  // Re-centers the scrollable mobile viewport on the currently selected or
  // routed locations whenever that set changes. A no-op on desktop (and in
  // "view full warehouse" mode) because the viewport isn't scrollable there.
  useEffect(() => {
    const viewport = viewportRef.current;
    const svg = svgRef.current;
    if (!viewport || !svg || !focusKey) return;
    if (viewport.scrollWidth <= viewport.clientWidth + 1) return;
    const xs = focusKey
      .split(",")
      .map((id) => coords.get(id)?.x)
      .filter((x): x is number => x !== undefined);
    if (xs.length === 0) return;
    const avgX = xs.reduce((a, b) => a + b, 0) / xs.length;
    const scale = svg.getBoundingClientRect().width / vbWidth;
    const targetPx = (avgX - Number(viewBox.split(" ")[0])) * scale;
    viewport.scrollLeft = Math.max(0, targetPx - viewport.clientWidth / 2);
  }, [focusKey, coords, viewBox, vbWidth]);

  const showWorker = routeVisibility !== "recommended";
  const showRecommended = routeVisibility !== "worker";

  const workerPath = useMemo(
    () => (workerRoute && showWorker ? expandRoutePath(workerRoute.order, visitIds, pathMatrix) : []),
    [workerRoute, showWorker, visitIds, pathMatrix],
  );
  const recommendedPath = useMemo(
    () =>
      recommendedRoute && showRecommended
        ? expandRoutePath(recommendedRoute.order, visitIds, pathMatrix)
        : [],
    [recommendedRoute, showRecommended, visitIds, pathMatrix],
  );

  return (
    <div className="warehouse-map">
      <button
        type="button"
        className="warehouse-map__zoom-toggle"
        onClick={() => setZoomedOut((v) => !v)}
      >
        {zoomedOut ? t("map.zoomIn") : t("map.viewFull")}
      </button>
      {!zoomedOut && <p className="warehouse-map__mobile-hint">{t("map.mobileHint")}</p>}

      <div className="warehouse-map__viewport" ref={viewportRef}>
        <svg
          ref={svgRef}
          className={`warehouse-map__svg${zoomedOut ? " warehouse-map__svg--fit" : " warehouse-map__svg--zoomed"}`}
          viewBox={viewBox}
          style={{ aspectRatio: `${vbWidth} / ${vbHeight}` }}
          role="img"
          aria-labelledby={titleId}
        >
        <title id={titleId}>{t("map.accessibleTitle")}</title>

        <g className="warehouse-map__racks">
          {rackRects.map((rect, index) => (
            <rect
              key={`rack-${index}`}
              x={rect.x}
              y={rect.y}
              width={rect.width}
              height={rect.height}
              rx={1.2}
              className="warehouse-map__rack"
            />
          ))}
        </g>

        {workerPath.length > 1 && (
          <polyline
            data-route="worker"
            points={pointsAttribute(workerPath, coords, NN_OFFSET)}
            className="warehouse-map__route warehouse-map__route--worker"
          />
        )}
        {recommendedPath.length > 1 && (
          <polyline
            data-route="recommended"
            points={pointsAttribute(recommendedPath, coords, OPT_OFFSET)}
            className="warehouse-map__route warehouse-map__route--recommended"
            strokeDasharray={RECOMMENDED_DASHARRAY}
          />
        )}

        {showWorker &&
          workerRoute?.order.map((id, index) => {
            const p = coords.get(id);
            if (!p || index === 0) return null;
            return (
              <g
                key={`worker-stop-${index}-${id}`}
                transform={`translate(${p.x + NN_OFFSET.x} ${p.y + NN_OFFSET.y})`}
                className="warehouse-map__stop warehouse-map__stop--worker"
              >
                <circle r={2.6} />
                <text dy="0.35em">{index}</text>
              </g>
            );
          })}
        {showRecommended &&
          recommendedRoute?.order.map((id, index) => {
            const p = coords.get(id);
            if (!p || index === 0) return null;
            return (
              <g
                key={`recommended-stop-${index}-${id}`}
                transform={`translate(${p.x + OPT_OFFSET.x} ${p.y + OPT_OFFSET.y})`}
                className="warehouse-map__stop warehouse-map__stop--recommended"
              >
                <rect x={-2.6} y={-2.6} width={5.2} height={5.2} />
                <text dy="0.35em">{index}</text>
              </g>
            );
          })}

        <g className="warehouse-map__locations">
          {graph.locations.map((location) => {
            const sequenceIndex = manualStopIds.indexOf(location.id);
            return (
              <LocationMarker
                key={location.id}
                location={location}
                state={locationState(location.id, selected, manualStopIds, completedIds)}
                sequence={sequenceIndex === -1 ? null : sequenceIndex + 1}
                isSearchMatch={searchMatchIds.has(location.id)}
                onClick={() => onLocationClick(location.id)}
              />
            );
          })}
        </g>

        <g
          className="warehouse-map__office"
          transform={`translate(${graph.start.x} ${graph.start.y})`}
        >
          <rect x={-3.6} y={-3.6} width={7.2} height={7.2} />
          <text className="warehouse-map__office-label" y={-6}>
            {graph.start.label}
          </text>
        </g>

        {simulationMarker ? (
          <g
            className="simulation-marker"
            data-testid="simulation-marker"
            aria-hidden="true"
            transform={`translate(${simulationMarker.x} ${simulationMarker.y})`}
          >
            <circle className="simulation-marker__halo" r="13" />
            <circle className="simulation-marker__dot" r="7" />
          </g>
        ) : null}
        </svg>
      </div>

      <ul className="warehouse-map__legend" aria-label={t("map.legendLabel")}>
        <li className="warehouse-map__legend-item">
          <span className="warehouse-map__swatch warehouse-map__swatch--office" aria-hidden="true" />
          {t("map.legend.office")}
        </li>
        <li className="warehouse-map__legend-item">
          <span className="warehouse-map__swatch warehouse-map__swatch--pending" aria-hidden="true" />
          {t("map.legend.pending")}
        </li>
        <li className="warehouse-map__legend-item">
          <span
            className="warehouse-map__swatch warehouse-map__swatch--selected"
            aria-hidden="true"
          />
          {t("map.legend.selected")}
        </li>
        <li className="warehouse-map__legend-item">
          <span
            className="warehouse-map__swatch warehouse-map__swatch--manual-stop"
            aria-hidden="true"
          />
          {t("map.legend.manualStop")}
        </li>
        <li className="warehouse-map__legend-item">
          <span
            className="warehouse-map__swatch warehouse-map__swatch--completed"
            aria-hidden="true"
          />
          {t("map.legend.completed")}
        </li>
      </ul>

      {/* Kept separate from the location-state legend above -- this one
          explains the two route overlays, not marker states. Only shown
          once a route line actually exists (step 3, once 2+ stops are
          routed), rather than always occupying space. */}
      {(workerPath.length > 1 || recommendedPath.length > 1) && (
        <div className="warehouse-map__route-legend">
          <ul className="warehouse-map__legend" aria-label={t("map.routeLegendLabel")}>
            {workerPath.length > 1 && (
              <li className="warehouse-map__legend-item">
                <span
                  className="warehouse-map__swatch warehouse-map__swatch--worker-line"
                  aria-hidden="true"
                />
                {t("map.routeLegend.worker")}
              </li>
            )}
            {recommendedPath.length > 1 && (
              <li className="warehouse-map__legend-item">
                <span
                  className="warehouse-map__swatch warehouse-map__swatch--recommended-line"
                  aria-hidden="true"
                />
                {t("map.routeLegend.recommended")}
              </li>
            )}
          </ul>
          <p className="warehouse-map__route-legend-hint">{t("map.routeLegend.sequenceHint")}</p>
        </div>
      )}
    </div>
  );
}
