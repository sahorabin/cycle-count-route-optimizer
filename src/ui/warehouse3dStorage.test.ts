import { describe, expect, test } from "vitest";
import { largeWarehouse } from "../data/largeWarehouse";
import {
  buildWarehouse3DEnvironment,
  getWarehouseEnvironmentRenderSet,
  WAREHOUSE_3D_ENVIRONMENT,
  type WarehouseEnvironmentBoxVisual,
  type WarehousePropVisual,
} from "./warehouse3dEnvironment";
import { createWarehouse3DTransform } from "./warehouse3dProjection";
import {
  buildWarehouseStorageRenderSet,
  CARTON_SCALE_VARIATION,
  fitStorageAssetToEnvelope,
  type WarehouseAssetSize,
} from "./warehouse3dStorage";

/** Natural bounds of the shipped models, as their glTF accessors report them. */
const PALLET: WarehouseAssetSize = [1.2414, 0.156, 1.2734];
const CARTON: WarehouseAssetSize = [0.387, 0.342, 0.516];

const transform = createWarehouse3DTransform(largeWarehouse);
const environment = buildWarehouse3DEnvironment(largeWarehouse, transform);
const closeProps = getWarehouseEnvironmentRenderSet(environment, "close").storageProps;

const bottom = (visual: WarehouseEnvironmentBoxVisual) => visual.center[1] - visual.size[1] / 2;
const top = (visual: WarehouseEnvironmentBoxVisual) => visual.center[1] + visual.size[1] / 2;
const aspect = (size: readonly number[]) => [size[0] / size[1], size[2] / size[1]];

describe("uniform storage fit", () => {
  test("scales by one factor so imported proportions survive", () => {
    const envelope: WarehousePropVisual = {
      id: "bay", kind: "pallet", center: [1, 2, 3], size: [0.2, 0.05, 0.6],
      minimumDetail: "close", rackId: "rack-0-0",
    };

    const placed = fitStorageAssetToEnvelope(envelope, PALLET);

    // 0.2 / 1.2414 is the tightest ratio, so it sets all three axes.
    const scale = 0.2 / PALLET[0];
    expect(placed?.size).toEqual([PALLET[0] * scale, PALLET[1] * scale, PALLET[2] * scale]);
    expect(aspect(placed?.size ?? [])[0]).toBeCloseTo(aspect(PALLET)[0], 9);
    expect(aspect(placed?.size ?? [])[1]).toBeCloseTo(aspect(PALLET)[1], 9);
  });

  test("never exceeds the envelope on any axis", () => {
    const envelope: WarehouseEnvironmentBoxVisual = {
      id: "bay", kind: "carton", center: [0, 1, 0], size: [0.3, 0.9, 0.2],
    };

    const placed = fitStorageAssetToEnvelope(envelope, CARTON);

    placed?.size.forEach((value, axis) => {
      expect({ axis, within: value <= envelope.size[axis] + 1e-9 }).toEqual({ axis, within: true });
    });
  });

  test("bottom-aligns to the envelope floor, or to an explicit support", () => {
    const envelope: WarehouseEnvironmentBoxVisual = {
      id: "bay", kind: "pallet", center: [0, 1, 0], size: [0.4, 0.2, 0.4],
    };

    expect(bottom(fitStorageAssetToEnvelope(envelope, PALLET)!)).toBeCloseTo(0.9, 9);
    expect(bottom(fitStorageAssetToEnvelope(envelope, PALLET, { supportY: 2.5 })!))
      .toBeCloseTo(2.5, 9);
  });

  test("honours an extra footprint limit, e.g. the deck below a carton", () => {
    const envelope: WarehouseEnvironmentBoxVisual = {
      id: "bay", kind: "carton", center: [0, 1, 0], size: [1, 1, 1],
    };

    const placed = fitStorageAssetToEnvelope(envelope, CARTON, { footprintLimit: [0.2, 0.2] });

    // The model is deeper than it is wide, so depth is what the deck limits.
    expect(placed?.size[2]).toBeCloseTo(0.2, 9);
    expect(placed?.size[0]).toBeLessThan(0.2);
    expect(aspect(placed?.size ?? [])[0]).toBeCloseTo(aspect(CARTON)[0], 9);
  });

  test("returns null for degenerate input rather than NaN placement", () => {
    const envelope: WarehouseEnvironmentBoxVisual = {
      id: "bay", kind: "pallet", center: [0, 1, 0], size: [0.4, 0.2, 0.4],
    };

    expect(fitStorageAssetToEnvelope(envelope, [0, 1, 1])).toBeNull();
    expect(fitStorageAssetToEnvelope(envelope, [1, Number.NaN, 1])).toBeNull();
    expect(fitStorageAssetToEnvelope({ ...envelope, size: [0.4, 0, 0.4] }, PALLET)).toBeNull();
    expect(fitStorageAssetToEnvelope(envelope, PALLET, { scaleFactor: 0 })).toBeNull();
  });
});

describe("storage render set", () => {
  const set = buildWarehouseStorageRenderSet(closeProps, { pallet: PALLET, carton: CARTON });

  test("turns every storage descriptor into exactly one placement", () => {
    const pallets = closeProps.filter((prop) => prop.kind === "pallet").length;
    const cartons = closeProps.filter((prop) => prop.kind === "carton").length;

    expect(set.assetPallets).toHaveLength(pallets);
    expect(set.assetCartons).toHaveLength(cartons);
    expect(set.proceduralPallets).toHaveLength(0);
    expect(set.proceduralCartons).toHaveLength(0);
    expect(pallets).toBeGreaterThan(50);
  });

  test("produces identical placements for the same descriptors", () => {
    // Compare fairness: Worker and Recommended build this from the same
    // environment, so the only visible difference stays the route.
    expect(buildWarehouseStorageRenderSet(closeProps, { pallet: PALLET, carton: CARTON }))
      .toEqual(set);
  });

  test("keeps every rack load inside its own rack footprint", () => {
    const racks = new Map(environment.racks.map((rack) => [rack.id, rack.footprint]));

    for (const placed of [...set.assetPallets, ...set.assetCartons]) {
      const footprint = racks.get(placed.id.split("-").slice(0, 3).join("-"));
      if (!footprint) continue; // staged floor loads are not in a rack

      // No aisle intrusion and no reach into the neighbouring bay.
      expect({ id: placed.id, insideX: placed.center[0] - placed.size[0] / 2 >= footprint.minX - 1e-9
        && placed.center[0] + placed.size[0] / 2 <= footprint.maxX + 1e-9 })
        .toEqual({ id: placed.id, insideX: true });
      expect({ id: placed.id, insideZ: placed.center[2] - placed.size[2] / 2 >= footprint.minZ - 1e-9
        && placed.center[2] + placed.size[2] / 2 <= footprint.maxZ + 1e-9 })
        .toEqual({ id: placed.id, insideZ: true });
    }
  });

  test("grounds every load: on a shelf, on the floor, or on the pallet below", () => {
    const decks = new Map(set.assetPallets.map((placed) => [placed.id, top(placed)]));

    for (const placed of set.assetPallets) {
      const descriptor = closeProps.find((prop) => prop.id === placed.id) as WarehousePropVisual;
      // A pallet rests exactly where its descriptor's floor is: shelf or slab.
      expect(bottom(placed)).toBeCloseTo(bottom(descriptor), 9);
    }

    for (const placed of set.assetCartons) {
      const descriptor = closeProps.find((prop) => prop.id === placed.id) as WarehousePropVisual;
      expect(bottom(placed)).toBeCloseTo(decks.get(descriptor.supportedBy as string) as number, 9);
    }
  });

  test("never pushes a load through the shelf above it", () => {
    const levels = [...WAREHOUSE_3D_ENVIRONMENT.shelfLevels];

    for (const placed of set.assetCartons) {
      const above = levels.find((level) => level > top(placed) - 1e-9);
      if (above === undefined) continue;
      expect({ id: placed.id, clear: top(placed) < above }).toEqual({ id: placed.id, clear: true });
    }
  });

  test("varies carton size deterministically without distorting it", () => {
    const rackCartons = set.assetCartons.filter((placed) => !placed.id.startsWith("floor"));
    // Three descriptor heights times three deterministic shrink factors is the
    // whole vocabulary; nothing here is random.
    const scales = new Set(rackCartons.map((placed) => (placed.size[1] / CARTON[1]).toFixed(4)));

    expect(scales.size).toBeGreaterThan(1);
    expect(scales.size).toBeLessThanOrEqual(3 * CARTON_SCALE_VARIATION.length);
    for (const placed of rackCartons) {
      expect(aspect(placed.size)[0]).toBeCloseTo(aspect(CARTON)[0], 6);
      expect(aspect(placed.size)[1]).toBeCloseTo(aspect(CARTON)[1], 6);
    }
  });

  test("leaves the warehouse sparse rather than filling every bay", () => {
    const bays = environment.racks.reduce((total, rack) => total + rack.assetBays.length, 0)
      * (WAREHOUSE_3D_ENVIRONMENT.shelfLevels.length - 1);

    expect(set.assetPallets.length).toBeLessThan(bays / 2);
  });
});

describe("storage fallback", () => {
  test("falls back per category, keeping the other real", () => {
    const noPallet = buildWarehouseStorageRenderSet(closeProps, { pallet: null, carton: CARTON });
    const noCarton = buildWarehouseStorageRenderSet(closeProps, { pallet: PALLET, carton: null });

    expect(noPallet.assetPallets).toHaveLength(0);
    expect(noPallet.proceduralPallets.length).toBeGreaterThan(0);
    expect(noPallet.assetCartons.length).toBeGreaterThan(0);

    expect(noCarton.assetCartons).toHaveLength(0);
    expect(noCarton.proceduralCartons.length).toBeGreaterThan(0);
    expect(noCarton.assetPallets.length).toBeGreaterThan(0);
  });

  test("renders the untouched procedural warehouse when both assets fail", () => {
    const none = buildWarehouseStorageRenderSet(closeProps, { pallet: null, carton: null });

    expect(none.assetPallets).toHaveLength(0);
    expect(none.assetCartons).toHaveLength(0);
    // Byte-for-byte the descriptors the environment already produced.
    expect([...none.proceduralPallets, ...none.proceduralCartons].sort((a, b) =>
      a.id.localeCompare(b.id))).toEqual([...closeProps].sort((a, b) => a.id.localeCompare(b.id)));
  });

  test("still grounds a procedural carton on a real pallet below it", () => {
    const mixed = buildWarehouseStorageRenderSet(closeProps, { pallet: PALLET, carton: null });
    const decks = new Map(mixed.assetPallets.map((placed) => [placed.id, top(placed)]));

    for (const carton of mixed.proceduralCartons) {
      expect(bottom(carton)).toBeCloseTo(decks.get(carton.supportedBy as string) as number, 9);
    }
  });

  test("emits only finite geometry in every fallback combination", () => {
    for (const sizes of [
      { pallet: PALLET, carton: CARTON }, { pallet: null, carton: CARTON },
      { pallet: PALLET, carton: null }, { pallet: null, carton: null },
    ]) {
      const built = buildWarehouseStorageRenderSet(closeProps, sizes);
      const numbers = [...built.assetPallets, ...built.assetCartons,
        ...built.proceduralPallets, ...built.proceduralCartons]
        .flatMap((placed) => [...placed.center, ...placed.size]);

      expect(numbers.every(Number.isFinite)).toBe(true);
      expect(numbers.length).toBeGreaterThan(0);
    }
  });
});
