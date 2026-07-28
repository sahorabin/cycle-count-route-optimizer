import { useMemo } from "react";
import { expandRoutePath } from "../ui/routePath";
import { buildCoordinateLookup, NN_OFFSET, OPT_OFFSET, pointsAttribute, type Point } from "../ui/svgPoints";
import type { NodeId, RouteComputation, WarehouseGraph } from "../domain/types";

interface WarehouseMapProps {
  graph: WarehouseGraph;
  selected: ReadonlySet<NodeId>;
  visitIds: NodeId[];
  pathMatrix: NodeId[][][];
  nearestNeighbor: RouteComputation | null;
  optimized: RouteComputation | null;
}

const PADDING = 15;
// Kept as a plain SVG presentation attribute (not CSS-only) so the optimized
// route's dash pattern is directly inspectable in tests without loading a
// stylesheet; App.css's rule for the same class carries the same value.
const OPT_DASHARRAY = "3 2.2";

function computeViewBox(coords: Point[]): string {
  const xs = coords.map((p) => p.x);
  const ys = coords.map((p) => p.y);
  const minX = Math.min(...xs) - PADDING;
  const minY = Math.min(...ys) - PADDING;
  const width = Math.max(...xs) - minX + PADDING;
  const height = Math.max(...ys) - minY + PADDING;
  return `${minX} ${minY} ${width} ${height}`;
}

/**
 * SVG coordinates on every node are display-only (see domain/types.ts).
 * This component only ever positions markers/lines from those x/y values
 * for drawing -- every distance shown elsewhere comes from the aisle-based
 * distanceMatrix, never from anything computed here.
 */
export function WarehouseMap({
  graph,
  selected,
  visitIds,
  pathMatrix,
  nearestNeighbor,
  optimized,
}: WarehouseMapProps) {
  const coords = useMemo(() => buildCoordinateLookup(graph), [graph]);
  const viewBox = useMemo(() => computeViewBox([...coords.values()]), [coords]);

  const nnPath = useMemo(
    () => (nearestNeighbor ? expandRoutePath(nearestNeighbor.order, visitIds, pathMatrix) : []),
    [nearestNeighbor, visitIds, pathMatrix],
  );
  const optPath = useMemo(
    () => (optimized ? expandRoutePath(optimized.order, visitIds, pathMatrix) : []),
    [optimized, visitIds, pathMatrix],
  );

  return (
    <div className="warehouse-map">
      <svg
        className="warehouse-map__svg"
        viewBox={viewBox}
        role="img"
        aria-labelledby="warehouse-map-title"
      >
        <title id="warehouse-map-title">
          Warehouse map: office, aisles, cycle-count locations, and both routes
        </title>

        <g className="warehouse-map__aisles">
          {graph.edges.map((edge) => {
            const from = coords.get(edge.from);
            const to = coords.get(edge.to);
            if (!from || !to) return null;
            return (
              <line
                key={`${edge.from}-${edge.to}`}
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                className="warehouse-map__aisle-edge"
              />
            );
          })}
        </g>

        <g className="warehouse-map__aisle-nodes">
          {graph.aisleNodes.map((node) => (
            <circle
              key={node.id}
              cx={node.x}
              cy={node.y}
              r={1.2}
              className="warehouse-map__aisle-node"
            />
          ))}
        </g>

        {nnPath.length > 1 && (
          <polyline
            data-route="nearest-neighbor"
            points={pointsAttribute(nnPath, coords, NN_OFFSET)}
            className="warehouse-map__route warehouse-map__route--nn"
          />
        )}
        {optPath.length > 1 && (
          <polyline
            data-route="two-opt"
            points={pointsAttribute(optPath, coords, OPT_OFFSET)}
            className="warehouse-map__route warehouse-map__route--opt"
            strokeDasharray={OPT_DASHARRAY}
          />
        )}

        {nearestNeighbor?.order.map((id, index) => {
          const p = coords.get(id);
          if (!p || index === 0) return null;
          return (
            <g
              key={`nn-stop-${index}-${id}`}
              transform={`translate(${p.x + NN_OFFSET.x} ${p.y + NN_OFFSET.y})`}
              className="warehouse-map__stop warehouse-map__stop--nn"
            >
              <circle r={2.6} />
              <text dy="0.35em">{index}</text>
            </g>
          );
        })}
        {optimized?.order.map((id, index) => {
          const p = coords.get(id);
          if (!p || index === 0) return null;
          return (
            <g
              key={`opt-stop-${index}-${id}`}
              transform={`translate(${p.x + OPT_OFFSET.x} ${p.y + OPT_OFFSET.y})`}
              className="warehouse-map__stop warehouse-map__stop--opt"
            >
              <rect x={-2.6} y={-2.6} width={5.2} height={5.2} />
              <text dy="0.35em">{index}</text>
            </g>
          );
        })}

        <g className="warehouse-map__locations">
          {graph.locations.map((location) => {
            const isSelected = selected.has(location.id);
            return (
              <g
                key={location.id}
                transform={`translate(${location.x} ${location.y})`}
                className={
                  isSelected
                    ? "warehouse-map__location warehouse-map__location--selected"
                    : "warehouse-map__location warehouse-map__location--unselected"
                }
                data-selected={isSelected}
              >
                <circle r={3.2} />
                <text className="warehouse-map__location-label" y={-5}>
                  {location.label}
                </text>
              </g>
            );
          })}
        </g>

        <g
          className="warehouse-map__office"
          transform={`translate(${graph.start.x} ${graph.start.y})`}
        >
          <rect x={-3.2} y={-3.2} width={6.4} height={6.4} />
          <text className="warehouse-map__office-label" y={-6}>
            {graph.start.label}
          </text>
        </g>
      </svg>

      <ul className="warehouse-map__legend" aria-label="Map legend">
        <li className="warehouse-map__legend-item">
          <span className="warehouse-map__swatch warehouse-map__swatch--office" aria-hidden="true" />
          Office / start
        </li>
        <li className="warehouse-map__legend-item">
          <span className="warehouse-map__swatch warehouse-map__swatch--aisle" aria-hidden="true" />
          Walkable aisle
        </li>
        <li className="warehouse-map__legend-item">
          <span
            className="warehouse-map__swatch warehouse-map__swatch--selected"
            aria-hidden="true"
          />
          Selected target
        </li>
        <li className="warehouse-map__legend-item">
          <span
            className="warehouse-map__swatch warehouse-map__swatch--unselected"
            aria-hidden="true"
          />
          Unselected target
        </li>
        <li className="warehouse-map__legend-item">
          <span className="warehouse-map__swatch warehouse-map__swatch--nn-line" aria-hidden="true" />
          Nearest Neighbor route (solid, circle stops)
        </li>
        <li className="warehouse-map__legend-item">
          <span
            className="warehouse-map__swatch warehouse-map__swatch--opt-line"
            aria-hidden="true"
          />
          2-opt optimized route (dashed, square stops)
        </li>
      </ul>
    </div>
  );
}
