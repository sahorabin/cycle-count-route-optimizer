/**
 * Renderer-only hybrid asset layer.
 *
 * Every visual category the scene draws is declared here with its licensing
 * provenance and a world-space envelope taken from the existing warehouse
 * layout. When an entry has no `file`, the scene renders its procedural
 * fallback -- the application never depends on an asset being present.
 *
 * Assets are presentation. Nothing in this module may be read by routing,
 * timing, or KPI code: envelopes flow warehouse → asset, never the reverse.
 */

export type WarehouseAssetCategory = "rack" | "pallet" | "carton" | "worker" | "prop";

export type WarehouseAssetLicense =
  | "CC0"
  | "CC-BY"
  | "public-domain"
  | "proprietary"
  | "none";

export interface WarehouseAssetProvenance {
  /** Where the file came from. `null` while the category is procedural. */
  readonly source: string | null;
  readonly license: WarehouseAssetLicense;
  /** Whether the licence permits shipping the file inside this repository. */
  readonly redistributable: boolean;
  readonly attribution: string | null;
  readonly commercialUse: boolean;
}

export interface WarehouseAssetEntry {
  readonly id: string;
  readonly category: WarehouseAssetCategory;
  /** Path under the served asset root, or `null` to use the procedural fallback. */
  readonly file: string | null;
  readonly provenance: WarehouseAssetProvenance;
  /** Longest world-space dimension the asset is normalized into. */
  readonly envelopeSpan: number;
  /**
   * Yaw applied when the asset is normalized, so the model's face axis lines up
   * with the warehouse run axis. Asset metadata: the file rotates, the layout
   * never does.
   */
  readonly yawRadians?: number;
  /** Human-readable note explaining the current state of this category. */
  readonly note: string;
}

/**
 * Every visual category now ships a licence-cleared file, and each entry
 * documents the envelope it normalizes into. An entry with `file: null` renders
 * procedural geometry, which is also what a failed load falls back to.
 */
export const WAREHOUSE_ASSET_REGISTRY: readonly WarehouseAssetEntry[] = [
  {
    id: "forklift",
    category: "prop",
    file: null,
    provenance: {
      source: null,
      license: "none",
      redistributable: true,
      attribution: null,
      commercialUse: true,
    },
    envelopeSpan: 2.1,
    note: "A restrained procedural counterbalance forklift is the deterministic "
      + "fallback after the capped real-asset search produced no inspectable, "
      + "license-cleared web asset. It is static renderer context only.",
  },
  {
    id: "rack-run",
    category: "rack",
    file: "/assets/warehouse/steel_frame_shelves_01/steel_frame_shelves_01_1k.gltf",
    provenance: {
      source: "https://polyhaven.com/a/steel_frame_shelves_01",
      license: "CC0",
      redistributable: true,
      attribution: "Steel Frame Shelves 01 by James Ray Cock (Poly Haven), CC0",
      commercialUse: true,
    },
    envelopeSpan: 2.3,
    // The model's wide face is its local X; warehouse runs extend along world Z.
    yawRadians: Math.PI / 2,
    note: "Real CC0 industrial steel shelving, tiled along each rack run; the "
      + "procedural frame remains the fallback if the asset cannot load.",
  },
  {
    id: "pallet",
    category: "pallet",
    file: "/assets/warehouse/wooden_pallet_01/wooden_pallet_01.gltf",
    provenance: {
      source: "https://opengameart.org/content/cc0-crates-wooden-pallet",
      license: "CC0",
      redistributable: true,
      attribution: "Wooden pallet by Lucian Pavel (OpenGameArt), CC0",
      commercialUse: true,
    },
    envelopeSpan: 0.45,
    note: "Real CC0 wooden pallet, uniformly scaled into each existing pallet "
      + "descriptor; the procedural block remains the fallback.",
  },
  {
    id: "carton",
    category: "carton",
    file: "/assets/warehouse/cardboard_box_01/cardboard_box_01_1k.gltf",
    provenance: {
      source: "https://polyhaven.com/a/cardboard_box_01",
      license: "CC0",
      redistributable: true,
      attribution: "Cardboard Box 01 by Rahul Chaudhary (Poly Haven), CC0",
      commercialUse: true,
    },
    envelopeSpan: 0.4,
    note: "Real CC0 corrugated shipping carton, uniformly scaled onto the "
      + "pallet below it; the procedural block remains the fallback.",
  },
  {
    id: "operator-rigged",
    category: "worker",
    file: "/assets/worker/quaternius_man_01/quaternius_man_01_rigged.glb",
    provenance: {
      source: "https://poly.pizza/m/HMnuH5geEG",
      license: "CC0",
      redistributable: true,
      attribution: "Man by Quaternius (poly.pizza), CC0",
      commercialUse: true,
    },
    envelopeSpan: 1.76,
    note: "The same CC0 human, unmodified, with its skeleton intact. This is the "
      + "primary operator mannequin; its rejected authored walk is not sampled. "
      + "The static bake below and procedural figure remain the fallback ladder.",
  },
  {
    id: "operator",
    category: "worker",
    file: "/assets/worker/quaternius_man_01/quaternius_man_01.gltf",
    provenance: {
      source: "https://poly.pizza/m/HMnuH5geEG",
      license: "CC0",
      redistributable: true,
      attribution: "Man by Quaternius (poly.pizza), CC0",
      commercialUse: true,
    },
    envelopeSpan: 1.76,
    note: "Real CC0 human, posed and baked to a static mesh here; PPE colours "
      + "are applied by the renderer. The procedural figure remains the fallback.",
  },
];

export function getWarehouseAssetEntry(id: string): WarehouseAssetEntry | null {
  return WAREHOUSE_ASSET_REGISTRY.find((entry) => entry.id === id) ?? null;
}

/** True only when a licence-cleared file is actually registered for this id. */
export function hasWarehouseAssetFile(id: string): boolean {
  const entry = getWarehouseAssetEntry(id);
  return Boolean(entry?.file) && Boolean(entry?.provenance.redistributable);
}

export interface WarehouseAssetBounds {
  readonly width: number;
  readonly height: number;
  readonly depth: number;
}

export interface WarehouseAssetNormalization {
  readonly scale: number;
  /** Y offset that puts the asset's base on the floor plane. */
  readonly groundOffset: number;
}

/**
 * Scales an imported asset into the warehouse, never the other way round: the
 * source bounding box is fitted to the registered envelope span. Degenerate or
 * non-finite bounds fall back to an identity transform so a malformed asset can
 * never produce NaN geometry.
 */
export function normalizeAssetToEnvelope(
  bounds: WarehouseAssetBounds,
  envelopeSpan: number,
): WarehouseAssetNormalization {
  const dimensions = [bounds.width, bounds.height, bounds.depth];
  const longest = Math.max(...dimensions);

  if (!dimensions.every(Number.isFinite) || !Number.isFinite(envelopeSpan) || longest <= 0) {
    return { scale: 1, groundOffset: 0 };
  }

  const scale = envelopeSpan / longest;
  return { scale, groundOffset: (bounds.height * scale) / 2 };
}

export interface WarehouseAssetLicenseReport {
  readonly id: string;
  readonly category: WarehouseAssetCategory;
  readonly usingAsset: boolean;
  readonly source: string | null;
  readonly license: WarehouseAssetLicense;
  readonly attribution: string | null;
}

/** Flat provenance listing, so licensing stays auditable as assets are added. */
export function getWarehouseAssetLicenseReport(): WarehouseAssetLicenseReport[] {
  return WAREHOUSE_ASSET_REGISTRY.map((entry) => ({
    id: entry.id,
    category: entry.category,
    usingAsset: hasWarehouseAssetFile(entry.id),
    source: entry.provenance.source,
    license: entry.provenance.license,
    attribution: entry.provenance.attribution,
  }));
}
