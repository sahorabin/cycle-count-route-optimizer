import type {
  AisleEdge,
  AisleNode,
  CycleCountLocation,
  WarehouseGraph,
  WarehouseSpatialLayout,
} from "../domain/types";

/**
 * 10 local aisles (zones A-J) arranged as two five-aisle rack blocks.
 * Front/rear corridors plus two internal cross-aisles keep the spatial
 * hierarchy walkable while preserving aisle-constrained routing. Purely deterministic: no
 * Math.random or other runtime randomness anywhere in this file.
 */
const ZONE_LETTERS = "ABCDEFGHIJ".split("");
export const ZONE_IDS = ZONE_LETTERS.map((letter) => `Zone ${letter}`);

export const LARGE_WAREHOUSE_SPATIAL_LAYOUT: WarehouseSpatialLayout = {
  rackWidth: 16,
  localAisleSpacing: 10,
  rackSegments: [
    { startY: 0, endY: 28 },
    { startY: 44, endY: 72 },
    { startY: 88, endY: 116 },
  ],
  internalCrossAisleSpacing: 16,
  aislesPerBlock: 5,
  blockSeparation: 24,
};

const X_BY_AISLE = [0, 24, 48, 72, 96, 136, 160, 184, 208, 232] as const;
const WALKABLE_ROWS = [
  ["F", -8],
  ["R1", 14],
  ["X1", 36],
  ["R2", 58],
  ["X2", 80],
  ["R3", 102],
  ["B", 124],
] as const;

export function buildAisleNodes(): AisleNode[] {
  const nodes: AisleNode[] = [];
  ZONE_LETTERS.forEach((letter, i) => {
    const x = X_BY_AISLE[i];
    WALKABLE_ROWS.forEach(([prefix, y]) => nodes.push({ id: `${prefix}${letter}`, x, y }));
  });
  return nodes;
}

export function buildEdges(): AisleEdge[] {
  const edges: AisleEdge[] = [];
  ZONE_LETTERS.forEach((letter) => {
    for (let rowIndex = 0; rowIndex < WALKABLE_ROWS.length - 1; rowIndex += 1) {
      edges.push({
        from: `${WALKABLE_ROWS[rowIndex][0]}${letter}`,
        to: `${WALKABLE_ROWS[rowIndex + 1][0]}${letter}`,
        length: WALKABLE_ROWS[rowIndex + 1][1] - WALKABLE_ROWS[rowIndex][1],
      });
    }
  });
  for (const [prefix] of [WALKABLE_ROWS[0], WALKABLE_ROWS[2], WALKABLE_ROWS[4], WALKABLE_ROWS[6]]) {
    for (let i = 0; i < ZONE_LETTERS.length - 1; i++) {
      edges.push({
        from: `${prefix}${ZONE_LETTERS[i]}`,
        to: `${prefix}${ZONE_LETTERS[i + 1]}`,
        length: X_BY_AISLE[i + 1] - X_BY_AISLE[i],
      });
    }
  }
  return edges;
}

const ATTACH_NODE_BY_POSITION = ["R1", "R1", "R1", "R2", "R2", "R2", "R3", "R3", "R3", "R3"] as const;
const Y_BY_RACK_ROW = { R1: 14, R2: 58, R3: 102 } as const;

export function buildLocations(): CycleCountLocation[] {
  const locations: CycleCountLocation[] = [];
  ZONE_LETTERS.forEach((letter, aisleIndex) => {
    for (let position = 1; position <= 10; position++) {
      const attach = ATTACH_NODE_BY_POSITION[position - 1];
      const aisleNodeId = `${attach}${letter}`;
      const baseX = X_BY_AISLE[aisleIndex];
      const side = position % 2 === 0 ? 1 : -1;
      const baseY = Y_BY_RACK_ROW[attach];
      const yOffset = ((position - 1) % 3 - 1) * 6;
      locations.push({
        id: `loc-${letter}${String(position).padStart(2, "0")}`,
        label: `Zone ${letter} - Bin ${String(position).padStart(2, "0")}`,
        x: baseX + side * 6,
        y: baseY + yOffset,
        aisleNodeId,
        accessDistance: Math.hypot(6, yOffset),
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
    accessDistance: Math.hypot(15, 2),
  },
  locations: buildLocations(),
  spatialLayout: LARGE_WAREHOUSE_SPATIAL_LAYOUT,
};
