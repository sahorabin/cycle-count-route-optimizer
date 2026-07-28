import type { WarehouseGraph } from "../domain/types";

/**
 * A small 3-aisle warehouse. Aisles run front (y=0) to back (y=100); there
 * is a cross-aisle connecting the fronts but, deliberately, no cross-aisle
 * connecting the backs (a wall) -- so travel between the backs of two
 * aisles must detour via the front. This makes aisle-constrained distance
 * differ sharply from straight-line distance, which is the whole point of
 * this app.
 *
 * Aisle 2 has a mid-aisle node (M2) splitting it unevenly, so a location
 * partway down aisle 2 can be reached without walking to either end.
 */
export const sampleWarehouse: WarehouseGraph = {
  aisleNodes: [
    { id: "F1", x: 0, y: 0 },
    { id: "F2", x: 20, y: 0 },
    { id: "F3", x: 40, y: 0 },
    { id: "M2", x: 20, y: 45 },
    { id: "B1", x: 0, y: 100 },
    { id: "B2", x: 20, y: 100 },
    { id: "B3", x: 40, y: 100 },
  ],
  edges: [
    { from: "F1", to: "F2", length: 20 },
    { from: "F2", to: "F3", length: 20 },
    { from: "F1", to: "B1", length: 100 },
    { from: "F2", to: "M2", length: 45 },
    { from: "M2", to: "B2", length: 55 },
    { from: "F3", to: "B3", length: 100 },
  ],
  start: {
    id: "office",
    x: -15,
    y: -10,
    label: "Office",
    aisleNodeId: "F1",
    accessDistance: 8,
  },
  locations: [
    {
      id: "loc-A",
      x: 0,
      y: 105,
      label: "Bin A1-Back",
      aisleNodeId: "B1",
      accessDistance: 3,
    },
    {
      id: "loc-B",
      x: 25,
      y: 45,
      label: "Bin A2-Mid",
      aisleNodeId: "M2",
      accessDistance: 4,
    },
    {
      id: "loc-C",
      x: 40,
      y: 105,
      label: "Bin A3-Back",
      aisleNodeId: "B3",
      accessDistance: 3,
    },
    {
      id: "loc-D",
      x: 45,
      y: -2,
      label: "Bin A3-Front",
      aisleNodeId: "F3",
      accessDistance: 2,
    },
  ],
};
