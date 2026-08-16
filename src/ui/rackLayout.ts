import type { AisleNode, WarehouseSpatialLayout } from "../domain/types";

export interface RackRect {
  x: number;
  y: number;
  width: number;
  height: number;
  rackColumnIndex?: number;
  segmentIndex?: number;
  blockIndex?: number;
}

export type WarehouseAisleCategory = "local" | "internal-cross" | "block-separation";

export interface WarehouseAisleRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly category: WarehouseAisleCategory;
  readonly orientation: "vertical" | "horizontal";
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
export function computeRackRects(
  aisleNodes: AisleNode[],
  toleranceX = 10,
  spatialLayout?: WarehouseSpatialLayout,
): RackRect[] {
  const groups = groupAisleNodesIntoRacks(aisleNodes, toleranceX);
  if (!spatialLayout) return groups.map(computeRackRect);

  return groups.flatMap((group, rackColumnIndex) => {
    const centerX = group.reduce((sum, node) => sum + node.x, 0) / group.length;
    return spatialLayout.rackSegments.map((segment, segmentIndex) => ({
      x: centerX - spatialLayout.rackWidth / 2,
      y: segment.startY,
      width: spatialLayout.rackWidth,
      height: segment.endY - segment.startY,
      rackColumnIndex,
      segmentIndex,
      blockIndex: Math.floor(rackColumnIndex / spatialLayout.aislesPerBlock),
    }));
  });
}

/** Shared semantic aisle bands consumed by both SVG and 3D renderers. */
export function computeWarehouseAisleRects(
  aisleNodes: AisleNode[],
  spatialLayout?: WarehouseSpatialLayout,
  toleranceX = 10,
): WarehouseAisleRect[] {
  const groups = groupAisleNodesIntoRacks(aisleNodes, toleranceX);
  if (!spatialLayout) {
    return groups.map((group) => {
      const rack = computeRackRect(group);
      return {
        x: rack.x + rack.width / 4,
        y: rack.y,
        width: rack.width / 2,
        height: rack.height,
        category: "local" as const,
        orientation: "vertical" as const,
      };
    });
  }

  const centers = groups.map((group) => group.reduce((sum, node) => sum + node.x, 0) / group.length);
  const minRackY = Math.min(...spatialLayout.rackSegments.map((segment) => segment.startY));
  const maxRackY = Math.max(...spatialLayout.rackSegments.map((segment) => segment.endY));
  const local = centers.flatMap((centerX) => spatialLayout.rackSegments.map((segment) => ({
    x: centerX - spatialLayout.localAisleSpacing / 2,
    y: segment.startY,
    width: spatialLayout.localAisleSpacing,
    height: segment.endY - segment.startY,
    category: "local" as const,
    orientation: "vertical" as const,
  })));

  const blockCount = Math.ceil(centers.length / spatialLayout.aislesPerBlock);
  const internalCross = Array.from({ length: blockCount }).flatMap((_, blockIndex) => {
    const blockCenters = centers.slice(
      blockIndex * spatialLayout.aislesPerBlock,
      (blockIndex + 1) * spatialLayout.aislesPerBlock,
    );
    if (blockCenters.length === 0) return [];
    const minX = Math.min(...blockCenters) - spatialLayout.rackWidth / 2;
    const maxX = Math.max(...blockCenters) + spatialLayout.rackWidth / 2;
    return spatialLayout.rackSegments.slice(0, -1).map((segment, segmentIndex) => {
      const next = spatialLayout.rackSegments[segmentIndex + 1];
      const centerY = (segment.endY + next.startY) / 2;
      return {
        x: minX,
        y: centerY - spatialLayout.internalCrossAisleSpacing / 2,
        width: maxX - minX,
        height: spatialLayout.internalCrossAisleSpacing,
        category: "internal-cross" as const,
        orientation: "horizontal" as const,
      };
    });
  });

  const blockSeparations = Array.from({ length: Math.max(0, blockCount - 1) }, (_, blockIndex) => {
    const leftCenter = centers[(blockIndex + 1) * spatialLayout.aislesPerBlock - 1];
    const rightCenter = centers[(blockIndex + 1) * spatialLayout.aislesPerBlock];
    const centerX = (leftCenter + rightCenter) / 2;
    return {
      x: centerX - spatialLayout.blockSeparation / 2,
      y: minRackY,
      width: spatialLayout.blockSeparation,
      height: maxRackY - minRackY,
      category: "block-separation" as const,
      orientation: "vertical" as const,
    };
  });

  return [...local, ...internalCross, ...blockSeparations];
}
