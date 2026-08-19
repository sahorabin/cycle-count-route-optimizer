/**
 * Renderer-only adapter from the warehouse's existing deterministic storage
 * descriptors to imported pallet and carton assets.
 *
 * The descriptors are the truth: this module never invents a bay, moves a rack,
 * or reads imported geometry back into anything operational. It only answers
 * "given this envelope and this model's natural proportions, where does the
 * model sit?" -- uniformly scaled, bottom-grounded, and never stretched.
 *
 * Nothing here carries inventory meaning. A pallet and a carton are visual
 * context; no SKU, quantity, or label is derived from either.
 */
import type {
  WarehouseEnvironmentBoxVisual,
  WarehousePropVisual,
} from "./warehouse3dEnvironment";

export type WarehouseAssetSize = readonly [number, number, number];

export interface WarehouseStorageRenderSet {
  /** Placements for the imported pallet model, in descriptor order. */
  readonly assetPallets: readonly WarehouseEnvironmentBoxVisual[];
  /** Placements for the imported carton model, in descriptor order. */
  readonly assetCartons: readonly WarehouseEnvironmentBoxVisual[];
  /** Descriptors still drawn as procedural boxes, already re-grounded. */
  readonly proceduralPallets: readonly WarehousePropVisual[];
  readonly proceduralCartons: readonly WarehousePropVisual[];
}

/**
 * A carton keeps a small margin inside the pallet it stands on, so a load never
 * reads as overhanging into the aisle or the neighbouring bay.
 */
export const CARTON_FOOTPRINT_MARGIN = 0.92;

/**
 * Deterministic per-carton size variation, indexed by a stable hash of the
 * descriptor id. Always at or below the envelope, so variation can never push a
 * carton through a beam. Uniform, so carton proportions never distort.
 */
export const CARTON_SCALE_VARIATION = [1, 0.93, 0.86] as const;

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function bottomOf(visual: WarehouseEnvironmentBoxVisual): number {
  return visual.center[1] - visual.size[1] / 2;
}

function topOf(visual: WarehouseEnvironmentBoxVisual): number {
  return visual.center[1] + visual.size[1] / 2;
}

export interface FitStorageAssetOptions {
  /** Y the asset's base must rest on. Defaults to the envelope's own floor. */
  readonly supportY?: number;
  /** Extra horizontal limit, e.g. the pallet deck a carton stands on. */
  readonly footprintLimit?: readonly [number, number];
  /** Deterministic uniform shrink applied after the fit. */
  readonly scaleFactor?: number;
}

/**
 * Fits a model into an envelope with ONE uniform scale -- the smallest ratio
 * across the axes -- then bottom-aligns it. The result is a box descriptor in
 * the same position/size convention every instanced mesh already uses, so the
 * caller places it without knowing it came from a file.
 *
 * Returns `null` for degenerate input, which is what keeps a malformed asset a
 * fallback rather than NaN geometry.
 */
export function fitStorageAssetToEnvelope(
  envelope: WarehouseEnvironmentBoxVisual,
  naturalSize: WarehouseAssetSize,
  options: FitStorageAssetOptions = {},
): WarehouseEnvironmentBoxVisual | null {
  const [naturalX, naturalY, naturalZ] = naturalSize;
  const [envelopeX, envelopeY, envelopeZ] = envelope.size;
  const { supportY, footprintLimit, scaleFactor = 1 } = options;

  const measurements = [naturalX, naturalY, naturalZ, envelopeX, envelopeY, envelopeZ, scaleFactor];
  if (!measurements.every((value) => Number.isFinite(value) && value > 0)) return null;

  const ratios = [envelopeX / naturalX, envelopeY / naturalY, envelopeZ / naturalZ];
  if (footprintLimit) {
    ratios.push(footprintLimit[0] / naturalX, footprintLimit[1] / naturalZ);
  }

  const scale = Math.min(...ratios) * scaleFactor;
  if (!Number.isFinite(scale) || scale <= 0) return null;

  const size = [naturalX * scale, naturalY * scale, naturalZ * scale] as const;
  const base = supportY ?? bottomOf(envelope);

  return {
    id: envelope.id,
    kind: envelope.kind,
    center: [envelope.center[0], base + size[1] / 2, envelope.center[2]],
    size,
  };
}

/** Moves a procedural descriptor so its base rests on `supportY`, size untouched. */
function groundProceduralProp(prop: WarehousePropVisual, supportY: number): WarehousePropVisual {
  if (Math.abs(bottomOf(prop) - supportY) < 1e-9) return prop;
  return { ...prop, center: [prop.center[0], supportY + prop.size[1] / 2, prop.center[2]] };
}

export interface WarehouseStorageAssetSizes {
  readonly pallet: WarehouseAssetSize | null;
  readonly carton: WarehouseAssetSize | null;
}

/**
 * Splits the existing storage descriptors into imported-asset placements and
 * procedural fallbacks, one category at a time. A failed pallet does not affect
 * cartons and vice versa; if both fail the result is exactly today's procedural
 * storage.
 *
 * Cartons are grounded on whatever height the pallet beneath them actually
 * ended up with, so an imported pallet and a procedural one both carry their
 * load without floating or sinking.
 */
export function buildWarehouseStorageRenderSet(
  props: readonly WarehousePropVisual[],
  sizes: WarehouseStorageAssetSizes,
): WarehouseStorageRenderSet {
  const assetPallets: WarehouseEnvironmentBoxVisual[] = [];
  const assetCartons: WarehouseEnvironmentBoxVisual[] = [];
  const proceduralPallets: WarehousePropVisual[] = [];
  const proceduralCartons: WarehousePropVisual[] = [];

  /** Rendered top surface of each pallet, whatever drew it. */
  const deckHeights = new Map<string, { top: number; footprint: readonly [number, number] }>();

  for (const prop of props) {
    if (prop.kind !== "pallet") continue;
    const placed = sizes.pallet && fitStorageAssetToEnvelope(prop, sizes.pallet);
    if (placed) {
      assetPallets.push(placed);
      deckHeights.set(prop.id, { top: topOf(placed), footprint: [placed.size[0], placed.size[2]] });
    } else {
      proceduralPallets.push(prop);
      deckHeights.set(prop.id, { top: topOf(prop), footprint: [prop.size[0], prop.size[2]] });
    }
  }

  for (const prop of props) {
    if (prop.kind !== "carton") continue;
    const deck = prop.supportedBy ? deckHeights.get(prop.supportedBy) : undefined;
    const supportY = deck?.top ?? bottomOf(prop);
    const footprintLimit = deck
      ? ([deck.footprint[0] * CARTON_FOOTPRINT_MARGIN,
          deck.footprint[1] * CARTON_FOOTPRINT_MARGIN] as const)
      : undefined;

    const placed = sizes.carton && fitStorageAssetToEnvelope(prop, sizes.carton, {
      supportY,
      footprintLimit,
      scaleFactor: CARTON_SCALE_VARIATION[stableHash(prop.id) % CARTON_SCALE_VARIATION.length],
    });

    if (placed) assetCartons.push(placed);
    else proceduralCartons.push(groundProceduralProp(prop, supportY));
  }

  return { assetPallets, assetCartons, proceduralPallets, proceduralCartons };
}
