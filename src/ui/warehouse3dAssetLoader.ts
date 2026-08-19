import { useEffect, useState } from "react";
import { Vector3 } from "three";
import type { BufferGeometry, Group, Material, Mesh, MeshStandardMaterial } from "three";
import { WAREHOUSE_3D_MATERIALS } from "./warehouse3dVisuals";
import {
  getWarehouseAssetEntry,
  hasWarehouseAssetFile,
  normalizeAssetToEnvelope,
  type WarehouseAssetNormalization,
} from "./warehouse3dAssetRegistry";

export type WarehouseAssetStatus = "fallback" | "loading" | "ready" | "error";

export interface WarehouseAssetHandle {
  readonly status: WarehouseAssetStatus;
  readonly scene: Group | null;
  readonly normalization: WarehouseAssetNormalization | null;
  /**
   * Source geometry baked into a unit box centred on the origin, so a caller
   * places it with the same position/size matrix an instanced box uses.
   */
  readonly geometry: BufferGeometry | null;
  readonly material: Material | null;
  /**
   * World-space size of the source model before unit normalization. Callers that
   * must preserve an object's proportions (a pallet, a carton) scale this by one
   * uniform factor rather than stretching it per axis.
   */
  readonly naturalSize: readonly [number, number, number] | null;
}

const FALLBACK: WarehouseAssetHandle = {
  status: "fallback",
  scene: null,
  normalization: null,
  geometry: null,
  material: null,
  naturalSize: null,
};

const FAILED: WarehouseAssetHandle = { ...FALLBACK, status: "error" };

/**
 * Turns imported geometry so its face axis follows the warehouse run axis, then
 * bakes it into a unit box centred on the origin. Placement afterwards is pure
 * position + size -- the same matrix every procedural box already uses -- so the
 * asset conforms to the layout instead of the layout conforming to the asset.
 *
 * Returns `null` for degenerate bounds, which is what makes a malformed asset a
 * fallback rather than NaN geometry.
 */
export function normalizeAssetGeometryToUnitBox(
  geometry: BufferGeometry,
  yawRadians = 0,
): { readonly geometry: BufferGeometry; readonly size: Vector3 } | null {
  if (yawRadians) geometry.rotateY(yawRadians);
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (!box) return null;

  const size = box.getSize(new Vector3());
  const center = box.getCenter(new Vector3());
  if (![size.x, size.y, size.z].every((value) => Number.isFinite(value) && value > 0)) {
    return null;
  }

  geometry.translate(-center.x, -center.y, -center.z);
  geometry.scale(1 / size.x, 1 / size.y, 1 / size.z);
  return { geometry, size };
}

/**
 * glTF defaults metalness to 1, which renders near-black in a scene with no
 * environment map. Assets are clamped back into the same matte industrial range
 * the procedural structure uses so an imported rack stays readable against the
 * bright floor.
 */
function clampAssetMaterial(material: Material | Material[]): Material {
  const resolved = Array.isArray(material) ? material[0] : material;
  const standard = resolved as MeshStandardMaterial;
  const { maxMetalness, minRoughness } = WAREHOUSE_3D_MATERIALS.importedAsset;

  if (typeof standard.metalness === "number") {
    standard.metalness = Math.min(standard.metalness, maxMetalness);
  }
  if (typeof standard.roughness === "number") {
    standard.roughness = Math.max(standard.roughness, minRoughness);
  }
  return resolved;
}

/** One in-flight promise per asset id, so repeated racks never refetch or re-parse. */
const assetCache = new Map<string, Promise<WarehouseAssetHandle>>();

/** Test seam: drops cached loads so provenance changes are observable. */
export function clearWarehouseAssetCache(): void {
  assetCache.clear();
}

/**
 * Loads a registered asset, normalizes it into its declared envelope, and
 * resolves to the procedural fallback whenever the category has no
 * licence-cleared file or the file cannot be parsed. GLTFLoader is imported
 * dynamically so an empty registry costs the bundle nothing. Repeat callers get
 * the identical promise, so sixty racks share one fetch, parse, and geometry.
 */
export function loadWarehouseAsset(id: string): Promise<WarehouseAssetHandle> {
  const entry = getWarehouseAssetEntry(id);
  if (!entry || !entry.file || !hasWarehouseAssetFile(id)) return Promise.resolve(FALLBACK);

  const cached = assetCache.get(id);
  if (cached) return cached;

  const pending = (async (): Promise<WarehouseAssetHandle> => {
    try {
      const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
      const gltf = await new GLTFLoader().loadAsync(entry.file as string);

      gltf.scene.updateMatrixWorld(true);
      const meshes: Mesh[] = [];
      gltf.scene.traverse((object) => {
        if ((object as Mesh).isMesh) meshes.push(object as Mesh);
      });
      const source = meshes[0];
      if (!source) return FAILED;

      const baked = source.geometry.clone();
      baked.applyMatrix4(source.matrixWorld);
      const normalized = normalizeAssetGeometryToUnitBox(baked, entry.yawRadians);
      if (!normalized) return FAILED;

      const { size } = normalized;
      return {
        status: "ready",
        scene: gltf.scene,
        geometry: normalized.geometry,
        material: clampAssetMaterial(source.material),
        naturalSize: [size.x, size.y, size.z],
        normalization: normalizeAssetToEnvelope(
          { width: size.x, height: size.y, depth: size.z },
          entry.envelopeSpan,
        ),
      };
    } catch {
      // A missing or malformed asset must never break the simulation.
      return FAILED;
    }
  })();

  assetCache.set(id, pending);
  return pending;
}

/**
 * React view of the same contract. It starts on the fallback, so the first
 * frame always renders a complete warehouse rather than a gap.
 */
export function useWarehouseAsset(id: string): WarehouseAssetHandle {
  const [handle, setHandle] = useState<WarehouseAssetHandle>(FALLBACK);

  useEffect(() => {
    if (!hasWarehouseAssetFile(id)) {
      setHandle(FALLBACK);
      return undefined;
    }

    let active = true;
    setHandle({ ...FALLBACK, status: "loading" });
    loadWarehouseAsset(id).then((resolved) => {
      if (active) setHandle(resolved);
    });

    return () => {
      active = false;
    };
  }, [id]);

  return handle;
}
