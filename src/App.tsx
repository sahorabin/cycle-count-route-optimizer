import { useMemo, useState } from "react";
import { sampleWarehouse } from "./data/sampleWarehouse";
import { buildValidatedDistanceMatrix } from "./domain/distanceMatrix";
import { nearestNeighborRoute } from "./domain/nearestNeighbor";
import { twoOptRoute } from "./domain/twoOpt";
import type { NodeId, WarehouseGraph } from "./domain/types";
import { TargetSelector } from "./components/TargetSelector";
import { WarehouseMap } from "./components/WarehouseMap";
import { RouteSummary } from "./components/RouteSummary";
import "./App.css";

function App() {
  const allLocationIds = useMemo(() => sampleWarehouse.locations.map((l) => l.id), []);
  const [selected, setSelected] = useState<Set<NodeId>>(() => new Set(allLocationIds));

  // Deterministic, explicit selection order: the warehouse's own catalog
  // order, filtered down to whatever is currently selected. Never derived
  // from click/insertion/DOM order, since the domain's tie-breaking rules
  // depend on this exact ordering (see nearestNeighbor.ts).
  const targetIds = useMemo(
    () => sampleWarehouse.locations.filter((location) => selected.has(location.id)).map((l) => l.id),
    [selected],
  );

  const computation = useMemo(() => {
    try {
      const nearestNeighbor = nearestNeighborRoute(sampleWarehouse, targetIds);
      const optimized = twoOptRoute(sampleWarehouse, targetIds, nearestNeighbor);
      const routeGraph: WarehouseGraph = {
        ...sampleWarehouse,
        locations: sampleWarehouse.locations.filter((location) => targetIds.includes(location.id)),
      };
      const { visitIds, pathMatrix } = buildValidatedDistanceMatrix(routeGraph);
      return { nearestNeighbor, optimized, visitIds, pathMatrix, error: null as string | null };
    } catch (err) {
      return {
        nearestNeighbor: null,
        optimized: null,
        visitIds: [] as NodeId[],
        pathMatrix: [] as NodeId[][][],
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }, [targetIds]);

  function toggleTarget(id: NodeId) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  return (
    <div className="app">
      <header className="app__header">
        <h1>Cycle Count Route Optimizer</h1>
        <p className="app__subtitle">
          Choose which bins to count this run, then compare a Nearest Neighbor walk against a
          2-opt-optimized route through the sample warehouse.
        </p>
      </header>

      <main className="app__main">
        <TargetSelector
          locations={sampleWarehouse.locations}
          selected={selected}
          onToggle={toggleTarget}
          onSelectAll={() => setSelected(new Set(allLocationIds))}
          onClearAll={() => setSelected(new Set())}
        />

        <WarehouseMap
          graph={sampleWarehouse}
          selected={selected}
          visitIds={computation.visitIds}
          pathMatrix={computation.pathMatrix}
          nearestNeighbor={computation.nearestNeighbor}
          optimized={computation.optimized}
        />

        {computation.error && (
          <p className="app__error" role="alert">
            Could not compute a route: {computation.error}
          </p>
        )}

        {!computation.error && targetIds.length === 0 && (
          <p className="app__empty-state">
            Select at least one cycle-count location to see a route comparison.
          </p>
        )}

        {!computation.error &&
          targetIds.length > 0 &&
          computation.nearestNeighbor &&
          computation.optimized && (
            <RouteSummary
              graph={sampleWarehouse}
              nearestNeighbor={computation.nearestNeighbor}
              optimized={computation.optimized}
            />
          )}
      </main>
    </div>
  );
}

export default App;
