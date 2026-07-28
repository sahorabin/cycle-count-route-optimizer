import type { AisleEdge, AisleNode, CycleCountLocation, WarehouseGraph } from "../domain/types";

/**
 * 10 aisles (zones A-J), each with a front node, a mid node, and a back
 * node -- same "no back cross-aisle" shape as the small sample warehouse,
 * deliberately forcing aisle-constrained distance to diverge from
 * straight-line distance. All 10 front nodes form one corridor so every
 * aisle is reachable from the office. Purely deterministic: no
 * Math.random or other runtime randomness anywhere in this file.
 */
const ZONE_LETTERS = "ABCDEFGHIJ".split("");
export const ZONE_IDS = ZONE_LETTERS.map((letter) => `Zone ${letter}`);

export function buildAisleNodes(): AisleNode[] {
  const nodes: AisleNode[] = [];
  ZONE_LETTERS.forEach((letter, i) => {
    const x = i * 20;
    nodes.push({ id: `F${letter}`, x, y: 0 });
    nodes.push({ id: `M${letter}`, x: x + 5, y: 45 });
    nodes.push({ id: `B${letter}`, x, y: 100 });
  });
  return nodes;
}

export function buildEdges(): AisleEdge[] {
  const edges: AisleEdge[] = [];
  ZONE_LETTERS.forEach((letter) => {
    edges.push({ from: `F${letter}`, to: `M${letter}`, length: 45 });
    edges.push({ from: `M${letter}`, to: `B${letter}`, length: 55 });
  });
  for (let i = 0; i < ZONE_LETTERS.length - 1; i++) {
    edges.push({ from: `F${ZONE_LETTERS[i]}`, to: `F${ZONE_LETTERS[i + 1]}`, length: 20 });
  }
  return edges;
}

const ATTACH_NODE_BY_POSITION: Array<"F" | "M" | "B"> = ["F", "F", "F", "M", "M", "M", "B", "B", "B", "B"];

export function buildLocations(): CycleCountLocation[] {
  const locations: CycleCountLocation[] = [];
  ZONE_LETTERS.forEach((letter, aisleIndex) => {
    for (let position = 1; position <= 10; position++) {
      const attach = ATTACH_NODE_BY_POSITION[position - 1];
      const aisleNodeId = `${attach}${letter}`;
      const baseX = aisleIndex * 20;
      const side = position % 2 === 0 ? 1 : -1;
      const baseY = attach === "F" ? -3 : attach === "M" ? 45 : 105;
      locations.push({
        id: `loc-${letter}${String(position).padStart(2, "0")}`,
        label: `Zone ${letter} - Bin ${String(position).padStart(2, "0")}`,
        x: baseX + side * 4,
        y: baseY + (position % 5) * 2,
        aisleNodeId,
        accessDistance: 2 + (position % 5),
        zone: `Zone ${letter}`,
        aisle: `Aisle ${letter}`,
      });
    }
  });
  return locations;
}

export const largeWarehouse: WarehouseGraph = {
  aisleNodes: buildAisleNodes(),
  edges: buildEdges(),
  start: {
    id: "office",
    x: -15,
    y: -10,
    label: "Office",
    aisleNodeId: "FA",
    accessDistance: 8,
  },
  locations: buildLocations(),
};
