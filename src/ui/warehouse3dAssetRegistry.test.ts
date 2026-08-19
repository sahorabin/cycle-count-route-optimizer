import { BoxGeometry, Matrix4, Vector3 } from "three";
import { describe, expect, test } from "vitest";
import {
  clearWarehouseAssetCache,
  loadWarehouseAsset,
  normalizeAssetGeometryToUnitBox,
  splitGeometryGroupsByHeight,
} from "./warehouse3dAssetLoader";
import { WAREHOUSE_3D_MATERIALS } from "./warehouse3dVisuals";
import {
  WAREHOUSE_OPERATOR_BONES,
  WAREHOUSE_OPERATOR_CLIPS,
  WAREHOUSE_REFERENCE_GAIT_BONES,
} from "./warehouse3dWorker";
import {
  getWarehouseAssetEntry,
  getWarehouseAssetLicenseReport,
  hasWarehouseAssetFile,
  normalizeAssetToEnvelope,
  WAREHOUSE_ASSET_REGISTRY,
} from "./warehouse3dAssetRegistry";

describe("warehouse asset registry", () => {
  test("declares every visual category the scene draws", () => {
    const categories = WAREHOUSE_ASSET_REGISTRY.map((entry) => entry.category);

    expect(categories).toContain("rack");
    expect(categories).toContain("pallet");
    expect(categories).toContain("carton");
    expect(categories).toContain("worker");
    expect(new Set(WAREHOUSE_ASSET_REGISTRY.map(({ id }) => id)).size)
      .toBe(WAREHOUSE_ASSET_REGISTRY.length);
  });

  test("gives every entry a positive envelope and an explanatory note", () => {
    for (const entry of WAREHOUSE_ASSET_REGISTRY) {
      expect({ id: entry.id, valid: Number.isFinite(entry.envelopeSpan) && entry.envelopeSpan > 0 })
        .toEqual({ id: entry.id, valid: true });
      expect(entry.note.length).toBeGreaterThan(10);
    }
    expect(getWarehouseAssetEntry("rack-run")?.category).toBe("rack");
    expect(getWarehouseAssetEntry("does-not-exist")).toBeNull();
  });

  test("never activates an asset without a redistributable licence", () => {
    for (const entry of WAREHOUSE_ASSET_REGISTRY) {
      if (!entry.file) {
        expect(hasWarehouseAssetFile(entry.id)).toBe(false);
        continue;
      }
      // A file may only be used when its licence permits shipping it here.
      expect({ id: entry.id, usable: hasWarehouseAssetFile(entry.id) })
        .toEqual({ id: entry.id, usable: entry.provenance.redistributable });
    }
  });

  test("reports provenance for every category so licensing stays auditable", () => {
    const report = getWarehouseAssetLicenseReport();

    expect(report).toHaveLength(WAREHOUSE_ASSET_REGISTRY.length);
    for (const row of report) {
      expect(typeof row.license).toBe("string");
      // Anything actually rendered from a file must name where it came from.
      if (row.usingAsset) expect(row.source).not.toBeNull();
    }
  });
});

describe("asset normalization", () => {
  test("fits the asset to the warehouse envelope, never the reverse", () => {
    const normalization = normalizeAssetToEnvelope({ width: 2, height: 8, depth: 1 }, 2.4);

    expect(normalization.scale).toBeCloseTo(0.3);
    expect(normalization.groundOffset).toBeCloseTo(1.2);
    // Doubling the source size halves the scale: the envelope is fixed.
    expect(normalizeAssetToEnvelope({ width: 4, height: 16, depth: 2 }, 2.4).scale)
      .toBeCloseTo(0.15);
  });

  test("falls back to identity for degenerate or invalid bounds", () => {
    const identity = { scale: 1, groundOffset: 0 };

    expect(normalizeAssetToEnvelope({ width: 0, height: 0, depth: 0 }, 2)).toEqual(identity);
    expect(normalizeAssetToEnvelope({ width: Number.NaN, height: 1, depth: 1 }, 2))
      .toEqual(identity);
    expect(normalizeAssetToEnvelope({ width: 1, height: 1, depth: 1 }, Number.POSITIVE_INFINITY))
      .toEqual(identity);
  });

  test("only ever produces finite transforms", () => {
    for (const span of [0.4, 1, 2.3, 12]) {
      const normalization = normalizeAssetToEnvelope({ width: 3, height: 5, depth: 2 }, span);
      expect(Number.isFinite(normalization.scale)).toBe(true);
      expect(Number.isFinite(normalization.groundOffset)).toBe(true);
    }
  });
});

describe("asset loading fallback", () => {
  test("resolves to the procedural fallback for any category without a file", async () => {
    clearWarehouseAssetCache();

    // Unknown ids and the intentionally procedural forklift share the same
    // safe loader contract: no fetch and no missing geometry exception.
    const handle = await loadWarehouseAsset("category-with-no-file");
    expect(handle.status).toBe("fallback");
    expect(handle.scene).toBeNull();
    expect(handle.geometry).toBeNull();
    expect(handle.parts).toBeNull();
    expect(WAREHOUSE_ASSET_REGISTRY.filter((entry) => entry.file === null)
      .map((entry) => entry.id)).toEqual(["forklift"]);
    await expect(loadWarehouseAsset("forklift")).resolves.toMatchObject({
      status: "fallback",
      scene: null,
      geometry: null,
    });
  });

  test("survives an asset that cannot be fetched or parsed", async () => {
    clearWarehouseAssetCache();

    // No DOM fetch here, so this exercises the real failure path: the loader
    // must degrade to procedural geometry rather than reject.
    const handle = await loadWarehouseAsset("rack-run");

    expect(handle.status).not.toBe("ready");
    expect(handle.geometry).toBeNull();
    expect(handle.material).toBeNull();
  });

  test("loads each asset once no matter how many racks reuse it", () => {
    clearWarehouseAssetCache();

    // One cached promise means one fetch, one parse, one geometry for 60 racks.
    expect(loadWarehouseAsset("rack-run")).toBe(loadWarehouseAsset("rack-run"));
  });

  test("treats an unknown id as a fallback rather than an error", async () => {
    const handle = await loadWarehouseAsset("not-registered");

    expect(handle.status).toBe("fallback");
    expect(handle.normalization).toBeNull();
  });

  test("keeps both route identities on exactly the same asset configuration", () => {
    // Compare fairness: asset choice is per category, never per route.
    const perRouteKeys = WAREHOUSE_ASSET_REGISTRY.filter((entry) =>
      entry.id.includes("worker") || entry.id.includes("recommended"));

    expect(perRouteKeys).toHaveLength(0);
    expect(getWarehouseAssetEntry("operator")?.category).toBe("worker");
  });
});

const ASSET_ROOT = "/public/assets/warehouse/steel_frame_shelves_01";

/** The shipped asset is read through Vite, so these tests fail if a file is lost. */
const assetText = import.meta.glob("/public/assets/warehouse/**/*.{gltf,txt}", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

const assetBinaries = import.meta.glob("/public/assets/warehouse/**/*.{bin,jpg}", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

const operationalSources = import.meta.glob("../{domain,simulation}/*.ts", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

describe("real rack asset", () => {
  const entry = getWarehouseAssetEntry("rack-run");

  test("registers Steel Frame Shelves 01 as the primary rack representation", () => {
    expect(entry?.category).toBe("rack");
    expect(entry?.file).toBe(`${ASSET_ROOT.replace("/public", "")}/steel_frame_shelves_01_1k.gltf`);
    expect(hasWarehouseAssetFile("rack-run")).toBe(true);
  });

  test("ships the registered file, its buffer, its textures, and its licence", () => {
    expect(Object.keys(assetText)).toContain(`/public${entry?.file}`);
    expect(Object.keys(assetText)).toContain(`${ASSET_ROOT}/LICENSE.txt`);
    expect(Object.keys(assetBinaries)).toContain(`${ASSET_ROOT}/steel_frame_shelves_01.bin`);
    expect(Object.keys(assetBinaries)
      .filter((key) => key.startsWith(ASSET_ROOT) && key.endsWith(".jpg"))).toHaveLength(3);
  });

  test("ships one small mesh with one material, so racks can share it", () => {
    const gltf = JSON.parse(assetText[`/public${entry?.file}`]);
    const indices = gltf.accessors[gltf.meshes[0].primitives[0].indices];

    expect(gltf.meshes).toHaveLength(1);
    expect(gltf.materials).toHaveLength(1);
    expect(indices.count / 3).toBe(4348);
  });

  test("records CC0 provenance for a redistributable asset", () => {
    const licence = assetText[`${ASSET_ROOT}/LICENSE.txt`];

    expect(entry?.provenance.license).toBe("CC0");
    expect(entry?.provenance.redistributable).toBe(true);
    expect(entry?.provenance.commercialUse).toBe(true);
    expect(entry?.provenance.source).toContain("polyhaven.com");
    expect(entry?.provenance.attribution).toContain("Poly Haven");
    expect(licence).toContain("CC0");
    expect(licence).toContain("https://polyhaven.com/a/steel_frame_shelves_01");
  });

  test("keeps imported material matte so racking stays readable, never near-black", () => {
    const { maxMetalness, minRoughness } = WAREHOUSE_3D_MATERIALS.importedAsset;

    // glTF defaults metalness to 1, which renders black without an env map.
    expect(maxMetalness).toBeLessThanOrEqual(0.2);
    expect(minRoughness).toBeGreaterThanOrEqual(0.5);
    expect(WAREHOUSE_3D_MATERIALS.shadowCasters.rackAsset).toBe(false);
  });

  test("never lets asset geometry reach routing, timing, or KPI code", () => {
    const offenders = Object.entries(operationalSources)
      .filter(([path]) => !path.endsWith(".test.ts"))
      .filter(([, source]) => /warehouse3d|\.\.\/ui\/|components\//.test(source))
      .map(([path]) => path);

    expect(Object.keys(operationalSources).length).toBeGreaterThan(10);
    expect(offenders).toEqual([]);
  });
});

describe("imported geometry normalization", () => {
  test("turns the model onto the run axis and bakes it into a unit box", () => {
    const entry = getWarehouseAssetEntry("rack-run");
    // Stand-in for the shipped model: wide face on local X, like the real file.
    const normalized = normalizeAssetGeometryToUnitBox(
      new BoxGeometry(10, 20, 5).translate(3, 11, -2),
      entry?.yawRadians,
    );

    expect(normalized).not.toBeNull();
    // Yaw put the model's wide face along Z, where warehouse runs extend.
    expect(normalized?.size.x).toBeCloseTo(5);
    expect(normalized?.size.z).toBeCloseTo(10);

    normalized?.geometry.computeBoundingBox();
    const box = normalized?.geometry.boundingBox;
    expect(box?.getSize(new Vector3()).toArray().map(Math.round)).toEqual([1, 1, 1]);
    // Centred on the origin, so a bay places it with position + size alone.
    expect(box?.getCenter(new Vector3()).toArray().every((value) => Math.abs(value) < 1e-6))
      .toBe(true);
  });

  test("reports null for degenerate geometry instead of NaN placement", () => {
    expect(normalizeAssetGeometryToUnitBox(new BoxGeometry(1, 0, 1))).toBeNull();
  });
});

describe("real storage assets", () => {
  const pallet = getWarehouseAssetEntry("pallet");
  const carton = getWarehouseAssetEntry("carton");

  test("registers a real pallet and a real carton as the storage representation", () => {
    expect(pallet?.file).toBe("/assets/warehouse/wooden_pallet_01/wooden_pallet_01.gltf");
    expect(carton?.file).toBe("/assets/warehouse/cardboard_box_01/cardboard_box_01_1k.gltf");
    expect(hasWarehouseAssetFile("pallet")).toBe(true);
    expect(hasWarehouseAssetFile("carton")).toBe(true);
  });

  test("ships every storage file the registry points at, plus its licence", () => {
    for (const entry of [pallet, carton]) {
      const file = entry?.file as string;
      const directory = `/public${file}`.replace(/\/[^/]+$/, "");
      expect(Object.keys(assetText)).toContain(`/public${file}`);
      expect(Object.keys(assetText)).toContain(`${directory}/LICENSE.txt`);
    }
    expect(Object.keys(assetBinaries))
      .toContain("/public/assets/warehouse/wooden_pallet_01/wooden_pallet_01.bin");
    expect(Object.keys(assetBinaries))
      .toContain("/public/assets/warehouse/cardboard_box_01/cardboard_box_01.bin");
  });

  test("records verified CC0 provenance for both storage assets", () => {
    const palletLicence = assetText["/public/assets/warehouse/wooden_pallet_01/LICENSE.txt"];
    const cartonLicence = assetText["/public/assets/warehouse/cardboard_box_01/LICENSE.txt"];

    for (const entry of [pallet, carton]) {
      expect(entry?.provenance.license).toBe("CC0");
      expect(entry?.provenance.redistributable).toBe(true);
      expect(entry?.provenance.commercialUse).toBe(true);
      expect(entry?.provenance.source).toMatch(/^https:\/\//);
      expect(entry?.provenance.attribution).not.toBeNull();
    }
    expect(palletLicence).toContain("CC0");
    expect(palletLicence).toContain("Lucian Pavel");
    // Conversion from OBJ is a modification, and CC0 permits it -- but it has
    // to be disclosed next to the file rather than quietly performed.
    expect(palletLicence).toContain("glTF 2.0");
    expect(cartonLicence).toContain("CC0");
    expect(cartonLicence).toContain("Rahul Chaudhary");
  });

  test("keeps neutral packaging: no invented SKU, quantity, or label data", () => {
    for (const entry of [pallet, carton]) {
      expect(entry?.note).not.toMatch(/sku|barcode|quantity|part number|supplier/i);
    }
    for (const licence of [
      assetText["/public/assets/warehouse/wooden_pallet_01/LICENSE.txt"],
      assetText["/public/assets/warehouse/cardboard_box_01/LICENSE.txt"],
    ]) {
      expect(licence).toContain("No inventory, SKU, quantity, or label data");
    }
  });

  test("ships one small mesh and one material per storage asset", () => {
    for (const file of [pallet?.file, carton?.file]) {
      const gltf = JSON.parse(assetText[`/public${file}`]);
      expect(gltf.meshes).toHaveLength(1);
      expect(gltf.materials).toHaveLength(1);
      // Neither may be metallic: glTF metalness renders near-black here.
      expect(gltf.materials[0].pbrMetallicRoughness.metallicFactor ?? 1).toBe(0);
    }
  });

  test("keeps the converted pallet buffer internally consistent", () => {
    // This asset was converted from OBJ by this repository, so its accessors
    // are ours to get wrong. A silently broken buffer would fall back to
    // procedural storage and look like nothing happened.
    const gltf = JSON.parse(assetText["/public/assets/warehouse/wooden_pallet_01/wooden_pallet_01.gltf"]);
    const buffer = gltf.buffers[0];
    const componentSize: Record<number, number> = { 5123: 2, 5126: 4 };
    const componentCount: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3 };

    for (const accessor of gltf.accessors) {
      const view = gltf.bufferViews[accessor.bufferView];
      const bytes = accessor.count * componentCount[accessor.type]
        * componentSize[accessor.componentType];
      expect({ type: accessor.type, fits: bytes <= view.byteLength }).toEqual({
        type: accessor.type, fits: true,
      });
      expect(view.byteOffset + view.byteLength).toBeLessThanOrEqual(buffer.byteLength);
    }

    const [position, , uv, indices] = gltf.accessors;
    expect(uv.count).toBe(position.count);
    expect(indices.count % 3).toBe(0);
    // 16-bit indices must still address every vertex.
    expect(position.count).toBeLessThan(65536);
    expect(position.min.every((value: number) => Number.isFinite(value))).toBe(true);
    expect(position.max.map((value: number, axis: number) => value - position.min[axis])
      .every((span: number) => span > 0)).toBe(true);
  });

  test("falls back per storage category when an asset cannot load", async () => {
    clearWarehouseAssetCache();

    // Node has no fetch for these paths, so both take the real failure path.
    for (const id of ["pallet", "carton"]) {
      const handle = await loadWarehouseAsset(id);
      expect({ id, status: handle.status }).not.toEqual({ id, status: "ready" });
      expect(handle.naturalSize).toBeNull();
      expect(handle.geometry).toBeNull();
    }
  });

  test("loads each storage asset once however many bays reuse it", () => {
    clearWarehouseAssetCache();

    expect(loadWarehouseAsset("pallet")).toBe(loadWarehouseAsset("pallet"));
    expect(loadWarehouseAsset("carton")).toBe(loadWarehouseAsset("carton"));
    // Categories stay independent: one shared handle each, never one shared load.
    expect(loadWarehouseAsset("pallet")).not.toBe(loadWarehouseAsset("carton"));
  });
});

const WORKER_ROOT = "/public/assets/worker/quaternius_man_01";

const workerText = import.meta.glob("/public/assets/worker/**/*.{gltf,txt}", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

const workerBinaries = import.meta.glob("/public/assets/worker/**/*.bin", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

describe("real worker asset", () => {
  const operator = getWarehouseAssetEntry("operator");
  const gltf = JSON.parse(workerText[`${WORKER_ROOT}/quaternius_man_01.gltf`]);

  test("registers a real human as the operator representation", () => {
    expect(operator?.category).toBe("worker");
    expect(operator?.file).toBe("/assets/worker/quaternius_man_01/quaternius_man_01.gltf");
    expect(hasWarehouseAssetFile("operator")).toBe(true);
  });

  test("ships the model, its buffer, and its licence", () => {
    expect(Object.keys(workerText)).toContain(`/public${operator?.file}`);
    expect(Object.keys(workerText)).toContain(`${WORKER_ROOT}/LICENSE.txt`);
    expect(Object.keys(workerBinaries)).toContain(`${WORKER_ROOT}/quaternius_man_01.bin`);
  });

  test("records verified CC0 provenance and discloses every modification", () => {
    const licence = workerText[`${WORKER_ROOT}/LICENSE.txt`];

    expect(operator?.provenance.license).toBe("CC0");
    expect(operator?.provenance.redistributable).toBe(true);
    expect(operator?.provenance.commercialUse).toBe(true);
    expect(operator?.provenance.source).toContain("poly.pizza");
    expect(operator?.provenance.attribution).toContain("Quaternius");
    expect(licence).toContain("CC0");
    expect(licence).toContain("Quaternius");
    // Posing and partitioning are modifications; CC0 allows them, honesty requires
    // that they are written down next to the file.
    expect(licence).toMatch(/baked/i);
    expect(licence).toMatch(/Workwear/);
  });

  test("ships a static posed mesh: no rig, no clips, no textures", () => {
    expect(gltf.skins ?? []).toHaveLength(0);
    expect(gltf.animations ?? []).toHaveLength(0);
    expect(gltf.images ?? []).toHaveLength(0);
    expect(gltf.meshes).toHaveLength(1);
    // One primitive per dressable region, so PPE is a material decision.
    expect(gltf.meshes[0].primitives.length).toBe(gltf.materials.length);
    expect(gltf.materials.map((m: { name: string }) => m.name)).toEqual(
      expect.arrayContaining(["Shirt", "Workwear", "Skin"]),
    );
  });

  test("stays small enough to be a sensible interactive download", () => {
    const triangles = gltf.meshes[0].primitives.reduce(
      (total: number, primitive: { indices: number }) =>
        total + gltf.accessors[primitive.indices].count / 3,
      0,
    );

    expect(triangles).toBe(1852);
    expect(gltf.buffers[0].byteLength).toBeLessThan(256 * 1024);
  });

  test("keeps the baked buffer internally consistent", () => {
    // This asset was baked by this repository, so its accessors are ours to
    // get wrong; a broken buffer would silently fall back to the procedural
    // figure and look like nothing happened.
    const componentSize: Record<number, number> = { 5123: 2, 5126: 4 };
    const componentCount: Record<string, number> = { SCALAR: 1, VEC3: 3 };

    for (const accessor of gltf.accessors) {
      const view = gltf.bufferViews[accessor.bufferView];
      const bytes = accessor.count * componentCount[accessor.type]
        * componentSize[accessor.componentType];
      expect({ type: accessor.type, fits: bytes <= view.byteLength })
        .toEqual({ type: accessor.type, fits: true });
      expect(view.byteOffset + view.byteLength).toBeLessThanOrEqual(gltf.buffers[0].byteLength);
    }

    for (const primitive of gltf.meshes[0].primitives) {
      const position = gltf.accessors[primitive.attributes.POSITION];
      expect(gltf.accessors[primitive.attributes.NORMAL].count).toBe(position.count);
      expect(gltf.accessors[primitive.indices].count % 3).toBe(0);
      expect(position.count).toBeLessThan(65536);
    }
  });

  test("stands on the floor plane with a credible human silhouette", () => {
    const mins = gltf.meshes[0].primitives.map(
      (p: { attributes: { POSITION: number } }) => gltf.accessors[p.attributes.POSITION].min);
    const maxes = gltf.meshes[0].primitives.map(
      (p: { attributes: { POSITION: number } }) => gltf.accessors[p.attributes.POSITION].max);
    const low = [0, 1, 2].map((axis) => Math.min(...mins.map((m: number[]) => m[axis])));
    const high = [0, 1, 2].map((axis) => Math.max(...maxes.map((m: number[]) => m[axis])));
    const size = [0, 1, 2].map((axis) => high[axis] - low[axis]);

    // Baked standing, not T-posed: height clearly dominates arm span.
    expect(size[1]).toBeGreaterThan(size[0] * 2.5);
    expect(size[1]).toBeGreaterThan(size[2] * 4);
    expect(Math.abs(low[1])).toBeLessThan(size[1] * 0.01);
  });

  test("falls back to the procedural operator when the model cannot load", async () => {
    clearWarehouseAssetCache();

    // No fetch for this path in node, so this is the real failure path.
    const handle = await loadWarehouseAsset("operator");

    expect(handle.status).not.toBe("ready");
    expect(handle.parts).toBeNull();
    expect(handle.naturalSize).toBeNull();
    expect(handle.normalization).toBeNull();
  });

  test("loads the operator once however many viewports show it", () => {
    clearWarehouseAssetCache();

    // Compare renders two viewports; they must not fetch or parse twice.
    expect(loadWarehouseAsset("operator")).toBe(loadWarehouseAsset("operator"));
  });
});

/** The rigged GLB's JSON chunk is ASCII, so clip and bone names survive a raw read. */
const riggedText = import.meta.glob("/public/assets/worker/**/*.glb", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

describe("rigged operator asset", () => {
  const RIGGED = "/public/assets/worker/quaternius_man_01/quaternius_man_01_rigged.glb";
  const entry = getWarehouseAssetEntry("operator-rigged");
  const glb = riggedText[RIGGED] ?? "";

  test("registers the rigged human as the primary operator", () => {
    expect(entry?.category).toBe("worker");
    expect(entry?.file).toBe("/assets/worker/quaternius_man_01/quaternius_man_01_rigged.glb");
    expect(hasWarehouseAssetFile("operator-rigged")).toBe(true);
    // The static bake stays registered as the rung below it.
    expect(hasWarehouseAssetFile("operator")).toBe(true);
    expect(entry?.envelopeSpan).toBe(getWarehouseAssetEntry("operator")?.envelopeSpan);
  });

  test("ships the file and documents both derivatives of the one CC0 source", () => {
    const licence = workerText["/public/assets/worker/quaternius_man_01/LICENSE.txt"];

    expect(Object.keys(riggedText)).toContain(RIGGED);
    expect(entry?.provenance.license).toBe("CC0");
    expect(entry?.provenance.redistributable).toBe(true);
    expect(entry?.provenance.source).toContain("poly.pizza");
    expect(entry?.provenance.attribution).toContain("Quaternius");
    expect(licence).toContain("quaternius_man_01_rigged.glb");
    expect(licence).toMatch(/byte-for-byte/i);
  });

  test("carries the skeleton and the standing clip the renderer asks for", () => {
    expect(glb.length).toBeGreaterThan(1000);
    expect(glb).toContain(WAREHOUSE_OPERATOR_CLIPS.idle);
    expect(WAREHOUSE_OPERATOR_CLIPS).not.toHaveProperty("walk");
    // glTF node names carry dots; three strips them when it builds the
    // skeleton, so the file says "MiddleHand.R" and the constant says
    // "MiddleHandR". Both spellings are pinned here on purpose.
    expect(glb).toContain("MiddleHand.R");
    expect(WAREHOUSE_OPERATOR_BONES.hand).toBe("MiddleHand.R".replace(/\./g, ""));
    expect(glb).toContain(`"${WAREHOUSE_OPERATOR_BONES.head}"`);
    for (const bone of Object.values(WAREHOUSE_REFERENCE_GAIT_BONES)) {
      const fileName = bone.replace(/([LR])$/, ".$1");
      expect(glb).toContain(`"${fileName}"`);
    }
    // A rigged file, not the static bake: it declares a skin and animations.
    expect(glb).toContain("skins");
    expect(glb).toContain("animations");
  });

  test("carries no root translation track that could move the operator", () => {
    // Locomotion would show up as a position track on the skeleton root or the
    // hips. Neither bone has one; only the feet and torso translate locally.
    const json = glb.slice(glb.indexOf("{"), glb.lastIndexOf("}") + 1);
    for (const root of ["Bone", "Hips"]) {
      expect({ root, path: json.includes(`"${root}.position"`) })
        .toEqual({ root, path: false });
    }
  });

  test("falls back through the ladder when the rigged operator cannot load", async () => {
    clearWarehouseAssetCache();

    // No fetch in node, so this exercises the real failure path.
    const handle = await loadWarehouseAsset("operator-rigged");

    expect(handle.status).not.toBe("ready");
    expect(handle.animations).toEqual([]);
    expect(handle.scene).toBeNull();
    expect(handle.naturalSize).toBeNull();
  });

  test("loads the operator once however many viewports animate it", () => {
    clearWarehouseAssetCache();

    // Compare renders two skeletons; they must share one fetch and one parse.
    expect(loadWarehouseAsset("operator-rigged")).toBe(loadWarehouseAsset("operator-rigged"));
    expect(loadWarehouseAsset("operator-rigged")).not.toBe(loadWarehouseAsset("operator"));
  });
});

describe("industrial context asset policy", () => {
  test("registers a deterministic procedural forklift fallback without a network dependency", () => {
    const forklift = getWarehouseAssetEntry("forklift");

    expect(forklift?.category).toBe("prop");
    expect(forklift?.file).toBeNull();
    expect(forklift?.provenance.source).toBeNull();
    expect(forklift?.provenance.redistributable).toBe(true);
    expect(forklift?.provenance.commercialUse).toBe(true);
    expect(hasWarehouseAssetFile("forklift")).toBe(false);
    expect(forklift?.note).toMatch(/procedural counterbalance forklift/i);
  });
});

describe("re-dressing imported geometry", () => {
  const identity = new Matrix4();

  test("splits a mesh into two material groups at a height fraction", () => {
    const geometry = new BoxGeometry(1, 2, 1);

    expect(splitGeometryGroupsByHeight(geometry, identity, 0.5)).toBe(true);
    expect(geometry.groups).toHaveLength(2);
    // Every triangle is still drawn exactly once: nothing added, nothing lost.
    const drawn = geometry.groups.reduce((total, group) => total + group.count, 0);
    expect(drawn).toBe(geometry.getIndex()?.count);
    expect(geometry.groups.map((group) => group.materialIndex)).toEqual([0, 1]);
    expect(geometry.groups[0].start).toBe(0);
    expect(geometry.groups[1].start).toBe(geometry.groups[0].count);
  });

  test("moves no vertex, so skinning and weights survive", () => {
    const geometry = new BoxGeometry(1, 2, 1);
    const before = Array.from(geometry.getAttribute("position").array);

    splitGeometryGroupsByHeight(geometry, identity, 0.4);

    expect(Array.from(geometry.getAttribute("position").array)).toEqual(before);
  });

  test("declines to split when the cut would leave a group empty", () => {
    for (const fraction of [0, 2, -0.5, Number.NaN]) {
      expect({ fraction, split: splitGeometryGroupsByHeight(
        new BoxGeometry(1, 2, 1), identity, fraction,
      ) }).toEqual({ fraction, split: false });
    }
  });

  test("measures the cut in world space, not in the file's own axes", () => {
    // The shipped model is authored Z-up; the split has to follow the matrix,
    // or a worker gets trousers across the chest.
    const upright = new BoxGeometry(1, 2, 1);
    const rotated = new BoxGeometry(1, 2, 1);
    const lieDown = new Matrix4().makeRotationX(Math.PI / 2);

    expect(splitGeometryGroupsByHeight(upright, identity, 0.4)).toBe(true);
    expect(splitGeometryGroupsByHeight(rotated, lieDown, 0.4)).toBe(true);

    const moved = (geometry: BoxGeometry) => {
      const index = geometry.getIndex() as { getX: (i: number) => number };
      const group = geometry.groups[1];
      return Array.from({ length: group.count }, (_, i) => index.getX(group.start + i));
    };
    // Same triangle count by symmetry, but a different set of faces goes below.
    expect(moved(rotated)).not.toEqual(moved(upright));
  });
});
