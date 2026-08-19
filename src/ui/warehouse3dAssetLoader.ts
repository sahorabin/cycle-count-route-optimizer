import { useEffect, useState } from "react";
import { Box3, Matrix4, Vector3 } from "three";
import type {
  AnimationClip, BufferGeometry, Group, Material, Mesh, MeshStandardMaterial,
} from "three";
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
  /**
   * Every drawable piece of a multi-material model, grounded on y = 0 and
   * centred in X/Z at its own natural scale. A caller places the whole figure
   * with one uniform group scale and dresses each piece by material name.
   */
  readonly parts: readonly WarehouseAssetPart[] | null;
  /**
   * Animation clips the file shipped with. Renderers sample these; nothing here
   * ever advances on its own, and no clip may move the figure through the scene.
   */
  readonly animations: readonly AnimationClip[];
}

export interface WarehouseAssetPart {
  /** Source material name, e.g. "Shirt" -- the handle for renderer-side dressing. */
  readonly name: string;
  readonly geometry: BufferGeometry;
  /** The model's own base colour, as a CSS hex string. */
  readonly color: string;
}

const FALLBACK: WarehouseAssetHandle = {
  status: "fallback",
  scene: null,
  normalization: null,
  geometry: null,
  material: null,
  naturalSize: null,
  parts: null,
  animations: [],
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
 * Splits a mesh's triangles into two material groups at a height, given as a
 * fraction of the mesh's own vertical extent. Nothing is deformed and no vertex
 * moves: only the index order and the group table change, so skinning, joints,
 * and weights all survive untouched.
 *
 * This is how a model that ships in street clothes gets work trousers without
 * editing the file that shipped.
 */
export function splitGeometryGroupsByHeight(
  geometry: BufferGeometry,
  matrixWorld: Matrix4,
  fractionOfHeight: number,
): boolean {
  const position = geometry.getAttribute("position");
  const index = geometry.getIndex();
  if (!position || !index || !Number.isFinite(fractionOfHeight)) return false;

  const point = new Vector3();
  const heights = new Float32Array(position.count);
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < position.count; i += 1) {
    point.fromBufferAttribute(position, i).applyMatrix4(matrixWorld);
    heights[i] = point.y;
    if (point.y < min) min = point.y;
    if (point.y > max) max = point.y;
  }
  if (!(max > min)) return false;

  const threshold = min + (max - min) * fractionOfHeight;
  const keep: number[] = [];
  const move: number[] = [];
  for (let i = 0; i < index.count; i += 3) {
    const [a, b, c] = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
    const centroid = (heights[a] + heights[b] + heights[c]) / 3;
    (centroid < threshold ? move : keep).push(a, b, c);
  }
  if (!move.length || !keep.length) return false;

  const ordered = [...keep, ...move];
  for (let i = 0; i < ordered.length; i += 1) index.setX(i, ordered[i]);
  index.needsUpdate = true;
  geometry.clearGroups();
  geometry.addGroup(0, keep.length, 0);
  geometry.addGroup(keep.length, move.length, 1);
  return true;
}

/**
 * Grounds a whole model on the floor plane and centres it in X/Z, keeping its
 * natural scale so the caller applies exactly one uniform factor. Every piece
 * shares one bounding box, so parts can never drift apart.
 */
function buildGroundedParts(meshes: readonly Mesh[]): {
  readonly parts: WarehouseAssetPart[];
  readonly size: Vector3;
} | null {
  const pieces = meshes.map((mesh) => {
    const geometry = mesh.geometry.clone();
    geometry.applyMatrix4(mesh.matrixWorld);
    geometry.computeBoundingBox();
    return { mesh, geometry };
  });

  const box = new Box3();
  for (const piece of pieces) {
    if (piece.geometry.boundingBox) box.union(piece.geometry.boundingBox);
  }

  const size = box.getSize(new Vector3());
  const center = box.getCenter(new Vector3());
  if (![size.x, size.y, size.z].every((value) => Number.isFinite(value) && value > 0)) return null;

  for (const piece of pieces) {
    piece.geometry.translate(-center.x, -box.min.y, -center.z);
  }

  return {
    size,
    parts: pieces.map(({ mesh, geometry }, index) => {
      const material = clampAssetMaterial(mesh.material) as MeshStandardMaterial;
      return {
        name: material.name || `part-${index}`,
        geometry,
        color: `#${material.color?.getHexString?.() ?? "ffffff"}`,
      };
    }),
  };
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
      const grounded = buildGroundedParts(meshes);
      if (!normalized || !grounded) return FAILED;

      const size = grounded.size;
      return {
        status: "ready",
        scene: gltf.scene,
        geometry: normalized.geometry,
        material: clampAssetMaterial(source.material),
        parts: grounded.parts,
        animations: gltf.animations ?? [],
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
