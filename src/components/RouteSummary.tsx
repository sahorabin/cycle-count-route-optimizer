import { compareRoutes } from "../ui/routeComparison";
import type { NodeId, RouteComputation, WarehouseGraph } from "../domain/types";

interface RouteSummaryProps {
  graph: WarehouseGraph;
  nearestNeighbor: RouteComputation;
  optimized: RouteComputation;
}

function formatDistance(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

function buildLabelLookup(graph: WarehouseGraph): Map<NodeId, string> {
  const lookup = new Map<NodeId, string>();
  lookup.set(graph.start.id, `${graph.start.label} (start)`);
  for (const location of graph.locations) lookup.set(location.id, location.label);
  return lookup;
}

function RouteStopList({ order, labels }: { order: NodeId[]; labels: Map<NodeId, string> }) {
  return (
    <ol className="route-summary__stops">
      {order.map((id, index) => (
        <li key={`${index}-${id}`}>{labels.get(id) ?? id}</li>
      ))}
    </ol>
  );
}

/** Displays both computed routes side by side, plus the comparison between them. */
export function RouteSummary({ graph, nearestNeighbor, optimized }: RouteSummaryProps) {
  const labels = buildLabelLookup(graph);
  const { distanceSaved, improvementPct } = compareRoutes(nearestNeighbor, optimized);

  return (
    <section className="route-summary" aria-label="Route comparison">
      <h2>Route comparison</h2>
      <div className="route-summary__columns">
        <article className="route-summary__route" data-route="nearest-neighbor">
          <h3>Nearest Neighbor</h3>
          <RouteStopList order={nearestNeighbor.order} labels={labels} />
          <p className="route-summary__total">
            Total distance: <strong>{formatDistance(nearestNeighbor.totalDistance)}</strong>{" "}
            distance units
          </p>
        </article>

        <article className="route-summary__route" data-route="two-opt">
          <h3>2-opt Optimized</h3>
          <RouteStopList order={optimized.order} labels={labels} />
          <p className="route-summary__total">
            Total distance: <strong>{formatDistance(optimized.totalDistance)}</strong> distance
            units
          </p>
        </article>
      </div>

      <div className="route-summary__improvement">
        <p>
          Distance saved: <strong>{formatDistance(distanceSaved)}</strong> distance units
        </p>
        <p>
          Improvement: <strong>{formatPercent(improvementPct)}</strong>
        </p>
      </div>
    </section>
  );
}
