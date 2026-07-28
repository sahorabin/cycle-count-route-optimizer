import { useMemo } from "react";
import { nearestNeighborRoute } from "../domain/nearestNeighbor";
import { twoOptRoute } from "../domain/twoOpt";
import type { NodeId, WarehouseGraph } from "../domain/types";
import { useTranslation } from "../i18n/useTranslation";
import { RouteSummary } from "./RouteSummary";

/**
 * Demoted, collapsed-by-default view of the raw Nearest Neighbor vs
 * 2-opt-refined algorithm output -- kept for technical transparency, but
 * never the primary UI comparison (that's ComparisonHero: Manual vs
 * System Recommended). Always computed over the exact same targetIds as
 * the manual route, so this can never show a different location set.
 */
export function TechnicalDetails({ graph, targetIds }: { graph: WarehouseGraph; targetIds: NodeId[] }) {
  const { t } = useTranslation();

  const routes = useMemo(() => {
    if (targetIds.length === 0) return null;
    try {
      const nn = nearestNeighborRoute(graph, targetIds);
      const optimized = twoOptRoute(graph, targetIds, nn);
      return { nn, optimized };
    } catch {
      return null;
    }
  }, [graph, targetIds]);

  return (
    <details className="technical-details">
      <summary>{t("technical.title")}</summary>
      {routes && <RouteSummary graph={graph} nearestNeighbor={routes.nn} optimized={routes.optimized} />}
    </details>
  );
}
