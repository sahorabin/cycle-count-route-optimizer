import type { WarehouseGraph } from "../domain/types";
import {
  computeRackRects,
  computeWarehouseAisleRects,
  type RackRect,
  type WarehouseAisleCategory,
  type WarehouseAisleRect,
} from "./rackLayout";
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
  | "rack-base"
  | "rack-guard"
  | "rack-asset"
  | "aisle-sign"
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
  /**
   * One box per bay of this run, sized from the existing footprint. An imported
   * rack asset is normalized into these boxes; they never widen the footprint,
   * so asset use cannot change clearance the layout already guarantees.
   */
  readonly assetBays: readonly WarehouseEnvironmentBoxVisual[];
}

export interface WarehousePropVisual extends WarehouseEnvironmentBoxVisual {
  readonly kind: "pallet" | "carton";
  readonly minimumDetail: WarehouseLocationDetailLevel;
  readonly rackId: string;
}

export interface WarehouseAisleVisual {
  /** Neutral renderer id; it does not claim an operational aisle identifier. */
  readonly id: string;
  readonly category: WarehouseAisleCategory;
  readonly zone: WarehouseEnvironmentBoxVisual;
  readonly markings: readonly WarehouseEnvironmentBoxVisual[];
}

export interface WarehouseBoundaryVisual {
  readonly signage: readonly WarehouseEnvironmentBoxVisual[];
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
  /** Placement boxes for the imported rack asset; unused on the procedural path. */
  readonly rackAssetBays: readonly WarehouseEnvironmentBoxVisual[];
}

/** Renderer-only decorative dimensions; none represent measured warehouse engineering data. */
export const WAREHOUSE_3D_ENVIRONMENT = {
  /** Four-level racking that stands clearly taller than the operator. */
  rackHeight: 2.3,
  shelfLevels: [0.42, 0.9, 1.38, 1.86] as const,
  floorPadding: 1,
  wallHeight: 3.2,
  overheadHeight: 3.6,
  minimumBayCount: 3,
  maximumBayCount: 6,
  targetBayDepth: 1.65,
  guardHeight: 0.16,
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
      if (seed % 7 > 2) return;
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

  // Base plates: real racking is bolted to the slab, not floating on it.
  const plateHalf = postSize * 0.8;
  for (const [x, xInset] of [[leftX, postSize * 0.3], [rightX, -postSize * 0.3]] as const) {
    for (const [z, zInset] of [
      [footprint.minZ + postSize / 2, postSize * 0.3],
      [footprint.maxZ - postSize / 2, -postSize * 0.3],
    ] as const) {
      overviewMembers.push(box(
        `${id}-base-${overviewMembers.length}`,
        "rack-base",
        [x + xInset, 0.012, z + zInset],
        [plateHalf * 2, 0.024, plateHalf * 2],
      ));
    }
  }

  // One mid-height beam stays visible at distance so runs read as multi-level.
  const midLevel = shelfLevels[Math.floor(shelfLevels.length / 2)];
  for (const x of [leftX, rightX]) {
    overviewMembers.push(box(
      `${id}-mid-rail-${x === leftX ? "left" : "right"}`,
      "rack-beam",
      [x, midLevel, centerZ],
      [postSize, beamHeight, depth],
    ));
  }

  // Rack-end protectors: a real run is guarded where trucks turn into the aisle.
  const guardHeight = WAREHOUSE_3D_ENVIRONMENT.guardHeight;
  for (const z of [footprint.minZ + postSize, footprint.maxZ - postSize]) {
    overviewMembers.push(box(
      `${id}-guard-${z > centerZ ? "rear" : "front"}`,
      "rack-guard",
      [centerX, guardHeight / 2, z],
      [width * 0.94, guardHeight, postSize * 1.6],
    ));
  }

  const assetBays = Array.from({ length: bayCount }, (_, bayIndex) => box(
    `${id}-asset-${bayIndex}`,
    "rack-asset",
    [centerX, rackHeight / 2, footprint.minZ + (bayIndex + 0.5) * bayDepth],
    [width, rackHeight, bayDepth],
  ));

  return {
    rack: { id, footprint, overviewMembers, closeMembers, shelfLevels, assetBays },
    props,
  };
}

function buildAisleVisual(
  id: string,
  rect: WarehouseAisleRect,
  transform: Warehouse3DTransform,
): WarehouseAisleVisual {
  const worldRect = toWorldRect(rect, transform);
  const centerX = (worldRect.minX + worldRect.maxX) / 2;
  const centerZ = (worldRect.minZ + worldRect.maxZ) / 2;
  const width = worldRect.maxX - worldRect.minX;
  const depth = worldRect.maxZ - worldRect.minZ;
  const markingWidth = Math.min(0.045, Math.min(width, depth) * 0.08);
  const vertical = rect.orientation === "vertical";
  const markings = vertical
    ? [worldRect.minX, worldRect.maxX].map((x, index) => box(
        `${id}-edge-${index}`,
        "aisle-marking",
        [x, -0.008, centerZ],
        [markingWidth, 0.012, depth],
      ))
    : [worldRect.minZ, worldRect.maxZ].map((z, index) => box(
        `${id}-edge-${index}`,
        "aisle-marking",
        [centerX, -0.008, z],
        [width, 0.012, markingWidth],
      ));

  return {
    id,
    category: rect.category,
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
    signage: [],
    floor: box("warehouse-floor", "boundary-marking", [centerX, -0.1, centerZ], [width, 0.12, depth]),
    perimeterMarkings,
    walls,
    columns,
    overheadFixtures,
  };
}

/** Aisle-end sign posts and panels, one per rack column. Decorative only. */
function buildSignage(
  racks: readonly WarehouseRackVisual[],
): WarehouseEnvironmentBoxVisual[] {
  const signage: WarehouseEnvironmentBoxVisual[] = [];
  const columns = new Map<string, WarehouseRackVisual>();
  for (const rack of racks) {
    const columnKey = rack.id.split("-").slice(0, 2).join("-");
    const existing = columns.get(columnKey);
    if (!existing || rack.footprint.minZ < existing.footprint.minZ) {
      columns.set(columnKey, rack);
    }
  }

  let index = 0;
  for (const rack of columns.values()) {
    const x = (rack.footprint.minX + rack.footprint.maxX) / 2;
    const z = rack.footprint.minZ - 0.12;
    const top = WAREHOUSE_3D_ENVIRONMENT.rackHeight + 0.34;
    signage.push(box(`aisle-sign-post-${index}`, "aisle-sign", [x, top / 2, z], [0.035, top, 0.035]));
    signage.push(box(`aisle-sign-panel-${index}`, "aisle-sign", [x, top, z], [0.3, 0.16, 0.02]));
    index += 1;
  }

  return signage;
}

/** Deterministic staged pallets along the building envelope; never on a route. */
function buildFloorProps(transform: Warehouse3DTransform): WarehousePropVisual[] {
  const padding = WAREHOUSE_3D_ENVIRONMENT.floorPadding;
  const minX = (transform.minX - transform.centerX) * transform.visualScale - padding;
  const maxX = (transform.maxX - transform.centerX) * transform.visualScale + padding;
  const minZ = (transform.minY - transform.centerY) * transform.visualScale - padding;
  const props: WarehousePropVisual[] = [];

  [0.12, 0.28, 0.46, 0.72, 0.88].forEach((ratio, index) => {
    const x = minX + (maxX - minX) * ratio;
    const z = minZ + 0.4;
    const seed = stableHash(`floor-prop:${index}`);
    props.push({
      ...box(`floor-pallet-${index}`, "pallet", [x, 0.03, z], [0.42, 0.06, 0.42]),
      kind: "pallet",
      minimumDetail: "overview",
      rackId: "staging",
    });
    const stack = 0.16 + (seed % 3) * 0.07;
    props.push({
      ...box(`floor-carton-${index}`, "carton", [x, 0.06 + stack / 2, z], [0.34, stack, 0.34]),
      kind: "carton",
      minimumDetail: "overview",
      rackId: "staging",
    });
  });

  return props;
}

/**
 * Builds stable renderer-only geometry descriptors from existing visual rack footprints.
 * Route, time, snapshot, distance, and KPI data deliberately cannot enter this API.
 */
export function buildWarehouse3DEnvironment(
  graph: WarehouseGraph,
  transform: Warehouse3DTransform,
): Warehouse3DEnvironment {
  const sourceRects = computeRackRects(graph.aisleNodes, 10, graph.spatialLayout);
  const aisleRects = computeWarehouseAisleRects(graph.aisleNodes, graph.spatialLayout);
  const racks: WarehouseRackVisual[] = [];
  const props: WarehousePropVisual[] = [];

  sourceRects.forEach((rect, aisleIndex) => {
    const aisleGap = graph.spatialLayout?.localAisleSpacing ?? rect.width / 2;
    const centerX = rect.x + rect.width / 2;
    // Runs sit outside the walkable aisle band, so the operator stands in a
    // clear aisle beside the racking rather than inside it.
    const runDepth = (rect.width - aisleGap) / 2;
    const rowRects = [
      { x: centerX - aisleGap / 2 - runDepth, y: rect.y, width: runDepth, height: rect.height },
      { x: centerX + aisleGap / 2, y: rect.y, width: runDepth, height: rect.height },
    ];
    rowRects.forEach((rowRect, rowIndex) => {
      const rackId = `rack-${aisleIndex}-${rowIndex}`;
      const built = buildRackVisual(rackId, toWorldRect(rowRect, transform));
      racks.push(built.rack);
      props.push(...built.props);
    });
  });

  props.push(...buildFloorProps(transform));

  return {
    racks,
    props,
    aisles: aisleRects.map((rect, index) => buildAisleVisual(`lane-${index}`, rect, transform)),
    boundary: { ...buildBoundary(transform), signage: buildSignage(racks) },
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
    rackAssetBays: environment.racks.flatMap((rack) => rack.assetBays),
  };
}

/** Aisle and worker presets intentionally reveal close environment detail without changing camera UX. */
export function getWarehouseEnvironmentDetailLevel(
  cameraDetailLevel: WarehouseLocationDetailLevel,
  preset: WarehouseCameraPreset,
): WarehouseLocationDetailLevel {
  return preset === "aisle" || preset === "worker" ? "close" : cameraDetailLevel;
}
