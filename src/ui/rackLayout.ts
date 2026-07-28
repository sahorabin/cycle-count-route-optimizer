import type { AisleNode } from "../domain/types";

export interface RackRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const RACK_WIDTH = 12;
const RACK_END_PADDING = 4;

/**
 * Clusters aisle nodes into "racks" purely for drawing a floor-plan-like
 * warehouse map -- groups nodes whose x positions are close together
 * (within toleranceX), regardless of naming convention, so this works for
 * any WarehouseGraph shape without assuming id prefixes. Never used for
 * routing: distance still comes exclusively from the aisle graph/Dijkstra.
 */
export function groupAisleNodesIntoRacks(aisleNodes: AisleNode[], toleranceX = 10): AisleNode[][] {
  const sorted = [...aisleNodes].sort((a, b) => a.x - b.x);
  const groups: AisleNode[][] = [];

  for (const node of sorted) {
    const currentGroup = groups[groups.length - 1];
    if (currentGroup && node.x - currentGroup[currentGroup.length - 1].x <= toleranceX) {
      currentGroup.push(node);
    } else {
      groups.push([node]);
    }
  }

  return groups;
}

/** The rectangle representing one rack's footprint, centered on its group's mean x. */
export function computeRackRect(group: AisleNode[]): RackRect {
  const xs = group.map((n) => n.x);
  const ys = group.map((n) => n.y);
  const centerX = xs.reduce((sum, x) => sum + x, 0) / xs.length;
  const minY = Math.min(...ys) - RACK_END_PADDING;
  const maxY = Math.max(...ys) + RACK_END_PADDING;

  return {
    x: centerX - RACK_WIDTH / 2,
    y: minY,
    width: RACK_WIDTH,
    height: maxY - minY,
  };
}

/** Convenience: every rack rectangle for a graph's aisle nodes. */
export function computeRackRects(aisleNodes: AisleNode[], toleranceX = 10): RackRect[] {
  return groupAisleNodesIntoRacks(aisleNodes, toleranceX).map(computeRackRect);
}
