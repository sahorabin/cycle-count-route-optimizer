import type { WarehouseGraph } from "../domain/types";
import { computeRackRects, type RackRect } from "./rackLayout";
import {
  projectDisplayPointToWarehouse3D,
  type Warehouse3DTransform,
} from "./warehouse3dProjection";
import type {
  WarehouseCameraPreset,
  WarehouseLocationDetailLevel,
} from "./warehouse3dCamera";

export type WarehouseEnvironmentBoxKind =
  | "rack-upright"
  | "rack-beam"
  | "rack-shelf"
  | "pallet"
  | "carton"
  | "aisle-zone"
  | "aisle-marking"
  | "boundary-marking"
  | "wall"
  | "column"
  | "overhead-fixture";

export interface WarehouseEnvironmentBoxVisual {
  readonly id: string;
  readonly kind: WarehouseEnvironmentBoxKind;
  readonly center: readonly [number, number, number];
  readonly size: readonly [number, number, number];
}

export interface WarehouseRackFootprint {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

export interface WarehouseRackVisual {
  readonly id: string;
  readonly footprint: WarehouseRackFootprint;
  readonly overviewMembers: readonly WarehouseEnvironmentBoxVisual[];
  readonly closeMembers: readonly WarehouseEnvironmentBoxVisual[];
  readonly shelfLevels: readonly number[];
}

export interface WarehousePropVisual extends WarehouseEnvironmentBoxVisual {
  readonly kind: "pallet" | "carton";
  readonly minimumDetail: WarehouseLocationDetailLevel;
  readonly rackId: string;
}

export interface WarehouseAisleVisual {
  /** Neutral renderer id; it does not claim an operational aisle identifier. */
  readonly id: string;
  readonly zone: WarehouseEnvironmentBoxVisual;
  readonly markings: readonly WarehouseEnvironmentBoxVisual[];
}

export interface WarehouseBoundaryVisual {
  readonly floor: WarehouseEnvironmentBoxVisual;
  readonly perimeterMarkings: readonly WarehouseEnvironmentBoxVisual[];
  readonly walls: readonly WarehouseEnvironmentBoxVisual[];
  readonly columns: readonly WarehouseEnvironmentBoxVisual[];
  readonly overheadFixtures: readonly WarehouseEnvironmentBoxVisual[];
}

export interface Warehouse3DEnvironment {
  readonly racks: readonly WarehouseRackVisual[];
  readonly props: readonly WarehousePropVisual[];
  readonly aisles: readonly WarehouseAisleVisual[];
  readonly boundary: WarehouseBoundaryVisual;
}

export interface WarehouseEnvironmentRenderSet {
  readonly rackMembers: readonly WarehouseEnvironmentBoxVisual[];
  readonly storageProps: readonly WarehousePropVisual[];
}

/** Renderer-only decorative dimensions; none represent measured warehouse engineering data. */
export const WAREHOUSE_3D_ENVIRONMENT = {
  rackHeight: 1.24,
  shelfLevels: [0.32, 0.66, 1] as const,
  floorPadding: 1,
  wallHeight: 2.45,
  overheadHeight: 2.85,
  minimumBayCount: 3,
  maximumBayCount: 6,
  targetBayDepth: 1.65,
} as const;

interface WorldRect {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

function box(
  id: string,
  kind: WarehouseEnvironmentBoxKind,
  center: readonly [number, number, number],
  size: readonly [number, number, number],
): WarehouseEnvironmentBoxVisual {
  return { id, kind, center, size };
}

function toWorldRect(rect: RackRect, transform: Warehouse3DTransform): WorldRect {
  const first = projectDisplayPointToWarehouse3D({ x: rect.x, y: rect.y }, transform);
  const second = projectDisplayPointToWarehouse3D(
    { x: rect.x + rect.width, y: rect.y + rect.height },
    transform,
  );
  return {
    minX: Math.min(first.x, second.x),
    maxX: Math.max(first.x, second.x),
    minZ: Math.min(first.z, second.z),
    maxZ: Math.max(first.z, second.z),
  };
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function buildRackVisual(
  id: string,
  footprint: WarehouseRackFootprint,
): { rack: WarehouseRackVisual; props: WarehousePropVisual[] } {
  const width = footprint.maxX - footprint.minX;
  const depth = footprint.maxZ - footprint.minZ;
  const centerX = (footprint.minX + footprint.maxX) / 2;
  const centerZ = (footprint.minZ + footprint.maxZ) / 2;
  const postSize = Math.min(0.07, width * 0.22, depth * 0.04);
  const beamHeight = 0.055;
  const shelfThickness = 0.025;
  const leftX = footprint.minX + postSize / 2;
  const rightX = footprint.maxX - postSize / 2;
  const rackHeight = WAREHOUSE_3D_ENVIRONMENT.rackHeight;
  const shelfLevels = [...WAREHOUSE_3D_ENVIRONMENT.shelfLevels];
  const bayCount = Math.max(
    WAREHOUSE_3D_ENVIRONMENT.minimumBayCount,
    Math.min(
      WAREHOUSE_3D_ENVIRONMENT.maximumBayCount,
      Math.round(depth / WAREHOUSE_3D_ENVIRONMENT.targetBayDepth),
    ),
  );
  const bayDepth = depth / bayCount;
  const boundaryZs = Array.from(
    { length: bayCount + 1 },
    (_, index) => footprint.minZ + index * bayDepth,
  );

  const overviewMembers: WarehouseEnvironmentBoxVisual[] = [];
  for (const x of [leftX, rightX]) {
    for (const z of [footprint.minZ + postSize / 2, footprint.maxZ - postSize / 2]) {
      overviewMembers.push(box(
        `${id}-corner-${overviewMembers.length}`,
        "rack-upright",
        [x, rackHeight / 2, z],
        [postSize, rackHeight, postSize],
      ));
    }
    overviewMembers.push(box(
      `${id}-top-rail-${x === leftX ? "left" : "right"}`,
      "rack-beam",
      [x, rackHeight - beamHeight / 2, centerZ],
      [postSize, beamHeight, depth],
    ));
  }

  const closeMembers: WarehouseEnvironmentBoxVisual[] = [];
  for (const z of boundaryZs.slice(1, -1)) {
    for (const x of [leftX, rightX]) {
      closeMembers.push(box(
        `${id}-upright-${closeMembers.length}`,
        "rack-upright",
        [x, rackHeight / 2, z],
        [postSize, rackHeight, postSize],
      ));
    }
  }

  for (let bayIndex = 0; bayIndex < bayCount; bayIndex += 1) {
    const bayCenterZ = footprint.minZ + (bayIndex + 0.5) * bayDepth;
    for (const level of shelfLevels) {
      for (const x of [leftX, rightX]) {
        closeMembers.push(box(
          `${id}-beam-${bayIndex}-${level}-${x === leftX ? "left" : "right"}`,
          "rack-beam",
          [x, level, bayCenterZ],
          [postSize, beamHeight, Math.max(postSize, bayDepth - postSize)],
        ));
      }
      closeMembers.push(box(
        `${id}-shelf-${bayIndex}-${level}`,
        "rack-shelf",
        [centerX, level - shelfThickness / 2, bayCenterZ],
        [Math.max(postSize, width - postSize * 2), shelfThickness, Math.max(postSize, bayDepth - postSize)],
      ));
    }
  }

  const props: WarehousePropVisual[] = [];
  for (let bayIndex = 0; bayIndex < bayCount; bayIndex += 1) {
    const bayCenterZ = footprint.minZ + (bayIndex + 0.5) * bayDepth;
    shelfLevels.slice(0, -1).forEach((level, levelIndex) => {
      const seed = stableHash(`${id}:${bayIndex}:${levelIndex}`);
      if (seed % 7 > 1) return;
      const palletHeight = 0.045;
      const palletWidth = Math.max(postSize, width * 0.68);
      const palletDepth = Math.max(postSize, bayDepth * 0.68);
      const minimumDetail: WarehouseLocationDetailLevel = seed % 17 === 0
        ? "overview"
        : "close";
      props.push({
        ...box(
          `${id}-pallet-${bayIndex}-${levelIndex}`,
          "pallet",
          [centerX, level + palletHeight / 2, bayCenterZ],
          [palletWidth, palletHeight, palletDepth],
        ),
        kind: "pallet",
        minimumDetail,
        rackId: id,
      });

      const cartonHeight = 0.12 + (seed % 3) * 0.035;
      const zOffset = ((seed >>> 4) % 3 - 1) * bayDepth * 0.08;
      props.push({
        ...box(
          `${id}-carton-${bayIndex}-${levelIndex}`,
          "carton",
          [centerX, level + palletHeight + cartonHeight / 2, bayCenterZ + zOffset],
          [width * 0.55, cartonHeight, bayDepth * 0.42],
        ),
        kind: "carton",
        minimumDetail: "close",
        rackId: id,
      });
    });
  }

  return {
    rack: { id, footprint, overviewMembers, closeMembers, shelfLevels },
    props,
  };
}

function buildAisleVisual(
  id: string,
  rect: RackRect,
  transform: Warehouse3DTransform,
): WarehouseAisleVisual {
  const rackWidth = rect.width / 4;
  const gapStartX = rect.x + rackWidth;
  const gapWidth = rect.width / 2;
  const worldRect = toWorldRect({
    x: gapStartX,
    y: rect.y,
    width: gapWidth,
    height: rect.height,
  }, transform);
  const centerX = (worldRect.minX + worldRect.maxX) / 2;
  const centerZ = (worldRect.minZ + worldRect.maxZ) / 2;
  const width = worldRect.maxX - worldRect.minX;
  const depth = worldRect.maxZ - worldRect.minZ;
  const markingWidth = Math.min(0.045, width * 0.08);
  const markings = [worldRect.minX, worldRect.maxX].map((x, index) => box(
    `${id}-edge-${index}`,
    "aisle-marking",
    [x, -0.008, centerZ],
    [markingWidth, 0.012, depth],
  ));

  const dashCount = Math.max(3, Math.min(6, Math.round(depth / 1.7)));
  const dashDepth = depth / (dashCount * 2);
  for (let index = 0; index < dashCount; index += 1) {
    markings.push(box(
      `${id}-center-${index}`,
      "aisle-marking",
      [centerX, -0.006, worldRect.minZ + (index * 2 + 1) * dashDepth],
      [markingWidth * 0.7, 0.014, dashDepth],
    ));
  }

  return {
    id,
    zone: box(
      `${id}-zone`,
      "aisle-zone",
      [centerX, -0.055, centerZ],
      [width, 0.018, depth],
    ),
    markings,
  };
}

function buildBoundary(transform: Warehouse3DTransform): WarehouseBoundaryVisual {
  const padding = WAREHOUSE_3D_ENVIRONMENT.floorPadding;
  const minX = (transform.minX - transform.centerX) * transform.visualScale - padding;
  const maxX = (transform.maxX - transform.centerX) * transform.visualScale + padding;
  const minZ = (transform.minY - transform.centerY) * transform.visualScale - padding;
  const maxZ = (transform.maxY - transform.centerY) * transform.visualScale + padding;
  const width = maxX - minX;
  const depth = maxZ - minZ;
  const centerX = (minX + maxX) / 2;
  const centerZ = (minZ + maxZ) / 2;
  const lineWidth = 0.075;
  const wallThickness = 0.12;

  const perimeterMarkings = [
    box("perimeter-front", "boundary-marking", [centerX, -0.002, minZ], [width, 0.018, lineWidth]),
    box("perimeter-rear", "boundary-marking", [centerX, -0.002, maxZ], [width, 0.018, lineWidth]),
    box("perimeter-left", "boundary-marking", [minX, -0.002, centerZ], [lineWidth, 0.018, depth]),
    box("perimeter-right", "boundary-marking", [maxX, -0.002, centerZ], [lineWidth, 0.018, depth]),
  ];

  const walls = [
    box(
      "rear-wall",
      "wall",
      [centerX, WAREHOUSE_3D_ENVIRONMENT.wallHeight / 2, maxZ + wallThickness / 2],
      [width, WAREHOUSE_3D_ENVIRONMENT.wallHeight, wallThickness],
    ),
    box("left-low-wall", "wall", [minX - wallThickness / 2, 0.32, centerZ], [wallThickness, 0.64, depth]),
    box("right-low-wall", "wall", [maxX + wallThickness / 2, 0.32, centerZ], [wallThickness, 0.64, depth]),
  ];

  const columns: WarehouseEnvironmentBoxVisual[] = [];
  const columnSize = 0.16;
  const columnXs = [minX + 0.3, centerX, maxX - 0.3];
  for (const x of columnXs) {
    columns.push(box(
      `rear-column-${columns.length}`,
      "column",
      [x, WAREHOUSE_3D_ENVIRONMENT.wallHeight / 2, maxZ - columnSize / 2],
      [columnSize, WAREHOUSE_3D_ENVIRONMENT.wallHeight, columnSize],
    ));
  }
  for (const [x, z] of [[minX + 0.3, minZ + 0.3], [maxX - 0.3, minZ + 0.3]]) {
    columns.push(box(
      `front-column-${columns.length}`,
      "column",
      [x, WAREHOUSE_3D_ENVIRONMENT.wallHeight / 2, z],
      [columnSize, WAREHOUSE_3D_ENVIRONMENT.wallHeight, columnSize],
    ));
  }

  const overheadFixtures = [-0.28, 0.28].map((ratio, index) => box(
    `overhead-fixture-${index}`,
    "overhead-fixture",
    [centerX + width * ratio, WAREHOUSE_3D_ENVIRONMENT.overheadHeight, centerZ],
    [0.055, 0.035, depth * 0.72],
  ));

  return {
    floor: box("warehouse-floor", "boundary-marking", [centerX, -0.1, centerZ], [width, 0.12, depth]),
    perimeterMarkings,
    walls,
    columns,
    overheadFixtures,
  };
}

/**
 * Builds stable renderer-only geometry descriptors from existing visual rack footprints.
 * Route, time, snapshot, distance, and KPI data deliberately cannot enter this API.
 */
export function buildWarehouse3DEnvironment(
  graph: WarehouseGraph,
  transform: Warehouse3DTransform,
): Warehouse3DEnvironment {
  const sourceRects = computeRackRects(graph.aisleNodes);
  const racks: WarehouseRackVisual[] = [];
  const props: WarehousePropVisual[] = [];

  sourceRects.forEach((rect, aisleIndex) => {
    const aisleGap = rect.width / 2;
    const rackWidth = (rect.width - aisleGap) / 2;
    const rowRects = [
      { x: rect.x, y: rect.y, width: rackWidth, height: rect.height },
      { x: rect.x + rect.width - rackWidth, y: rect.y, width: rackWidth, height: rect.height },
    ];
    rowRects.forEach((rowRect, rowIndex) => {
      const rackId = `rack-${aisleIndex}-${rowIndex}`;
      const built = buildRackVisual(rackId, toWorldRect(rowRect, transform));
      racks.push(built.rack);
      props.push(...built.props);
    });
  });

  return {
    racks,
    props,
    aisles: sourceRects.map((rect, index) => buildAisleVisual(`lane-${index}`, rect, transform)),
    boundary: buildBoundary(transform),
  };
}

export function getWarehouseEnvironmentRenderSet(
  environment: Warehouse3DEnvironment,
  detailLevel: WarehouseLocationDetailLevel,
): WarehouseEnvironmentRenderSet {
  return {
    rackMembers: environment.racks.flatMap((rack) => detailLevel === "close"
      ? [...rack.overviewMembers, ...rack.closeMembers]
      : rack.overviewMembers),
    storageProps: environment.props.filter((prop) =>
      detailLevel === "close" || prop.minimumDetail === "overview"),
  };
}

/** Aisle and worker presets intentionally reveal close environment detail without changing camera UX. */
export function getWarehouseEnvironmentDetailLevel(
  cameraDetailLevel: WarehouseLocationDetailLevel,
  preset: WarehouseCameraPreset,
): WarehouseLocationDetailLevel {
  return preset === "aisle" || preset === "worker" ? "close" : cameraDetailLevel;
}
