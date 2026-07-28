import type { NodeId, WarehouseGraph } from "../domain/types";

export interface Point {
  x: number;
  y: number;
}

// Small, purely cosmetic pixel offsets so the two route lines stay visually
// distinguishable even where they travel identical aisle segments. Never fed
// back into any distance calculation -- see WarehouseMap.tsx.
export const NN_OFFSET: Point = { x: -1.5, y: -1.5 };
export const OPT_OFFSET: Point = { x: 1.5, y: 1.5 };

export function buildCoordinateLookup(graph: WarehouseGraph): Map<NodeId, Point> {
  const lookup = new Map<NodeId, Point>();
  for (const node of graph.aisleNodes) lookup.set(node.id, { x: node.x, y: node.y });
  lookup.set(graph.start.id, { x: graph.start.x, y: graph.start.y });
  for (const location of graph.locations) lookup.set(location.id, { x: location.x, y: location.y });
  return lookup;
}

export function pointsAttribute(path: NodeId[], coords: Map<NodeId, Point>, offset: Point): string {
  return path
    .map((id) => coords.get(id))
    .filter((p): p is Point => p !== undefined)
    .map((p) => `${p.x + offset.x},${p.y + offset.y}`)
    .join(" ");
}
