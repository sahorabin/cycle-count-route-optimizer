import { Canvas, useThree } from "@react-three/fiber";
import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { InstancedMesh, Object3D, OrthographicCamera, Quaternion, Vector3 } from "three";
import type { BufferGeometry, Material } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { NodeId, RouteTimeline, WarehouseGraph } from "../domain/types";
import type { SimulationSnapshot } from "../simulation/types";
import { buildCoordinateLookup, type Point } from "../ui/svgPoints";
import { useWarehouseAsset, type WarehouseAssetPart } from "../ui/warehouse3dAssetLoader";
import { buildWarehouseStorageRenderSet } from "../ui/warehouse3dStorage";
import {
  createWarehouseActiveServiceVisual,
  createWarehouseServiceCompletionVisual,
  getWarehouseLocationVisualState,
  getWarehouseStoryCameraFocus,
  getWarehouseWorkerCountingGesture,
  type WarehouseActiveServiceVisual,
  type WarehouseCountingGesture,
  type WarehouseServiceCompletionVisual,
  type WarehouseStoryCameraFocus,
} from "../ui/warehouse3dServiceVisual";
import {
  clampWarehouseCameraZoom,
  createWarehouseCameraChannel,
  createWarehouseCameraPresetView,
  createWarehouseStoryCameraView,
  getWarehouseCameraBaseZoom,
  getWarehouseDetailLevelForZoomRatio,
  getWarehouseZoomBucket,
  shouldRenderWarehouseLocation,
  WAREHOUSE_CAMERA_LIMITS,
  type WarehouseCameraChannel,
  type WarehouseCameraPreset,
  type WarehouseCameraView,
  type WarehouseLocationDetailLevel,
} from "../ui/warehouse3dCamera";
import { createWarehouseOrbitControlsOwner } from "../ui/warehouse3dControls";
import {
  buildWarehouse3DEnvironment,
  getWarehouseEnvironmentDetailLevel,
  getWarehouseEnvironmentRenderSet,
  type Warehouse3DEnvironment,
  type WarehouseEnvironmentBoxVisual,
} from "../ui/warehouse3dEnvironment";
import {
  buildOperatorCoordinateLookup,
  createWarehouse3DTransform,
  projectDisplayPointToWarehouse3D,
  projectNodeToWarehouse3D,
  projectSimulationMarkerTo3D,
  type Warehouse3DTransform,
} from "../ui/warehouse3dProjection";
import {
  buildWarehouse3DRouteVisualSegments,
  WAREHOUSE_3D_MATERIALS,
  WAREHOUSE_3D_VISUALS,
  type Warehouse3DRouteVisualSegment,
} from "../ui/warehouse3dVisuals";
import {
  createWarehouseOperatorScanner,
  createWarehouseWorkerPose,
  createWarehouseWorkerScanCue,
  createWarehouseWorkerVisual,
  getWarehouseOperatorPartColor,
  getWarehouseWorkerFigureScale,
  WAREHOUSE_WORKER_DEPTH_POLICY,
  WAREHOUSE_WORKER_COLORS,
  type WarehouseOperatorScanner,
  type WarehouseWorkerScanCue,
  type WarehouseWorkerVisualPart,
} from "../ui/warehouse3dWorker";
import type { ReplayRouteMode } from "./RouteSimulationReplay";

interface Warehouse3DViewportProps {
  graph: WarehouseGraph;
  timeline: RouteTimeline;
  snapshot: SimulationSnapshot;
  mode: ReplayRouteMode;
  accessibleLabel: string;
  fallback: ReactNode;
  cameraPreset?: WarehouseCameraPreset;
  cameraResetRequest?: number;
  cameraChannel?: WarehouseCameraChannel;
  cameraAuthority?: boolean;
  viewMode?: "compare" | "explore";
}

/** Deeper, lower-chroma identity hues: still unmistakable, no longer neon. */
/** Deeper than the shell tokens: these must hold their own on bright concrete. */
const ROUTE_COLORS: Record<ReplayRouteMode, string> = {
  worker: "#2f6fc4",
  recommended: "#1c8f6d",
};

interface InteractiveWarehouseCameraProps {
  preset: WarehouseCameraPreset;
  resetRequest: number;
  channel: WarehouseCameraChannel;
  authority: boolean;
  instanceId: string;
  workerPoint: { readonly x: number; readonly y: number; readonly z: number };
  onDetailLevelChange?: (level: WarehouseLocationDetailLevel) => void;
  onZoomBucketChange?: (bucket: number) => void;
  storyFocus?: WarehouseStoryCameraFocus | null;
  onUserCameraInteraction?: () => void;
}

export function InteractiveWarehouseCamera({
  preset,
  resetRequest,
  channel,
  authority,
  instanceId,
  workerPoint,
  onDetailLevelChange,
  onZoomBucketChange,
  storyFocus = null,
  onUserCameraInteraction,
}: InteractiveWarehouseCameraProps) {
  const { camera, gl, size, invalidate } = useThree();
  const controlsRef = useRef<OrbitControls | null>(null);
  const applyingViewRef = useRef(false);
  const applyViewRef = useRef<((view: WarehouseCameraView) => void) | null>(null);
  const latestPresetRef = useRef(preset);
  const latestWorkerPointRef = useRef(workerPoint);
  latestPresetRef.current = preset;
  latestWorkerPointRef.current = workerPoint;
  const baseZoom = getWarehouseCameraBaseZoom(size.width, size.height);
  // Renderer-only bookkeeping: whether the automatic shot currently owns the
  // camera. A user gesture drops it, which is what stops the story from
  // snapping the view back against their intent.
  const storyOwnsCameraRef = useRef(false);

  useLayoutEffect(() => {
    if (!(camera instanceof OrthographicCamera)) return;
    const owner = createWarehouseOrbitControlsOwner(camera, gl.domElement);
    if (!owner) return;
    const { controls } = owner;
    controls.enableRotate = true;
    controls.enableZoom = true;
    controls.enablePan = true;
    controls.enableDamping = false;
    controls.minPolarAngle = WAREHOUSE_CAMERA_LIMITS.minPolarAngle;
    controls.maxPolarAngle = WAREHOUSE_CAMERA_LIMITS.maxPolarAngle;
    controls.minZoom = baseZoom * WAREHOUSE_CAMERA_LIMITS.minZoomRatio;
    controls.maxZoom = baseZoom * WAREHOUSE_CAMERA_LIMITS.maxZoomRatio;
    camera.near = 0.1;
    camera.far = 100;

    const updateDetailLevel = () => {
      if (!owner.isActive()) return;
      const bucket = getWarehouseZoomBucket(camera.zoom, baseZoom);
      onDetailLevelChange?.(getWarehouseDetailLevelForZoomRatio(bucket));
      onZoomBucketChange?.(bucket);
    };
    const applyView = (view: WarehouseCameraView) => {
      if (!owner.isActive()) return;
      applyingViewRef.current = true;
      try {
        controls.target.set(...view.target);
        camera.position.set(...view.position);
        camera.zoom = clampWarehouseCameraZoom(view.zoom, baseZoom);
        camera.lookAt(...view.target);
        camera.updateProjectionMatrix();
        controls.update();
        updateDetailLevel();
        invalidate();
      } finally {
        applyingViewRef.current = false;
      }
    };
    applyViewRef.current = applyView;
    controlsRef.current = controls;

    const publishInteraction = () => {
      if (!owner.isActive() || applyingViewRef.current) return;
      storyOwnsCameraRef.current = false;
      onUserCameraInteraction?.();
      const previousTarget = controls.target.clone();
      controls.target.set(
        Math.min(WAREHOUSE_CAMERA_LIMITS.targetExtent, Math.max(-WAREHOUSE_CAMERA_LIMITS.targetExtent, controls.target.x)),
        0,
        Math.min(WAREHOUSE_CAMERA_LIMITS.targetExtent, Math.max(-WAREHOUSE_CAMERA_LIMITS.targetExtent, controls.target.z)),
      );
      camera.position.add(controls.target.clone().sub(previousTarget));
      camera.zoom = clampWarehouseCameraZoom(camera.zoom, baseZoom);
      camera.updateProjectionMatrix();
      updateDetailLevel();
      channel.publish({
        preset: latestPresetRef.current,
        position: [camera.position.x, camera.position.y, camera.position.z],
        target: [controls.target.x, controls.target.y, controls.target.z],
        zoom: camera.zoom,
      }, instanceId);
      invalidate();
    };
    controls.addEventListener("change", publishInteraction);
    const unsubscribe = channel.subscribe((view, sourceId) => {
      if (owner.isActive() && sourceId !== instanceId) applyView(view);
    });

    return () => {
      owner.dispose();
      unsubscribe();
      controls.removeEventListener("change", publishInteraction);
      if (controlsRef.current === controls) controlsRef.current = null;
      if (applyViewRef.current === applyView) applyViewRef.current = null;
    };
  }, [
    baseZoom,
    camera,
    channel,
    gl.domElement,
    instanceId,
    invalidate,
    onDetailLevelChange,
    onUserCameraInteraction,
    onZoomBucketChange,
  ]);

  // Automatic service framing. It applies an existing preset view blended toward
  // the service shot by a blend the simulation already decided, and hands the
  // camera back only when a story it actually owned ends.
  useLayoutEffect(() => {
    const applyView = applyViewRef.current;
    if (!authority || !applyView) return;

    const contextualView = () => createWarehouseCameraPresetView(
      latestPresetRef.current,
      baseZoom,
      latestWorkerPointRef.current,
    );

    if (storyFocus) {
      applyView(createWarehouseStoryCameraView(
        contextualView(),
        storyFocus.point,
        storyFocus.blend,
        baseZoom,
      ));
      storyOwnsCameraRef.current = true;
      return;
    }

    if (storyOwnsCameraRef.current) {
      storyOwnsCameraRef.current = false;
      applyView(contextualView());
    }
  }, [authority, baseZoom, storyFocus]);

  useLayoutEffect(() => {
    if (!authority || !controlsRef.current || !applyViewRef.current) return;
    const view = createWarehouseCameraPresetView(
      preset,
      baseZoom,
      latestWorkerPointRef.current,
    );
    applyViewRef.current(view);
    channel.publish(view, instanceId);
  }, [authority, baseZoom, channel, instanceId, preset, resetRequest]);

  return null;
}

interface InstancedEnvironmentBoxesProps {
  visuals: readonly WarehouseEnvironmentBoxVisual[];
  color: string;
  roughness?: number;
  metalness?: number;
  opacity?: number;
  emissive?: string;
  emissiveIntensity?: number;
  castShadow?: boolean;
  receiveShadow?: boolean;
}

/**
 * Position + size of every visual written into one instance matrix buffer. Both
 * the procedural boxes and the imported rack asset place through this, because
 * the asset is normalized into the same unit-box convention.
 */
function useInstanceMatrices(visuals: readonly WarehouseEnvironmentBoxVisual[]) {
  const meshRef = useRef<InstancedMesh>(null);
  const { invalidate } = useThree();

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const matrixSource = new Object3D();
    visuals.forEach((visual, index) => {
      matrixSource.position.set(...visual.center);
      matrixSource.scale.set(...visual.size);
      matrixSource.updateMatrix();
      mesh.setMatrixAt(index, matrixSource.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    invalidate();
  }, [invalidate, visuals]);

  return meshRef;
}

function InstancedEnvironmentBoxes({
  visuals,
  color,
  roughness = 0.9,
  metalness = 0,
  opacity = 1,
  emissive,
  emissiveIntensity = 0,
  castShadow = false,
  receiveShadow = false,
}: InstancedEnvironmentBoxesProps) {
  const meshRef = useInstanceMatrices(visuals);

  if (visuals.length === 0) return null;

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, visuals.length]}
      castShadow={castShadow}
      receiveShadow={receiveShadow}
    >
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial
        color={color}
        roughness={roughness}
        metalness={metalness}
        transparent={opacity < 1}
        opacity={opacity}
        depthWrite={opacity >= 1}
        emissive={emissive}
        emissiveIntensity={emissiveIntensity}
      />
    </instancedMesh>
  );
}

/**
 * One imported mesh, drawn once per rack bay from a single shared geometry and
 * material. Repeated racking never costs a second load, parse, or draw call.
 */
function InstancedAssetMeshes({
  visuals,
  geometry,
  material,
  castShadow = false,
  receiveShadow = false,
}: {
  visuals: readonly WarehouseEnvironmentBoxVisual[];
  geometry: BufferGeometry;
  material: Material;
  castShadow?: boolean;
  receiveShadow?: boolean;
}) {
  const meshRef = useInstanceMatrices(visuals);

  if (visuals.length === 0) return null;

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, visuals.length]}
      castShadow={castShadow}
      receiveShadow={receiveShadow}
    />
  );
}

const WarehouseFloor = memo(function WarehouseFloor({
  environment,
}: { environment: Warehouse3DEnvironment }) {
  const { floor, perimeterMarkings } = environment.boundary;
  const localAisles = environment.aisles
    .filter((aisle) => aisle.category === "local")
    .map((aisle) => aisle.zone);
  const internalCrossAisles = environment.aisles
    .filter((aisle) => aisle.category === "internal-cross")
    .map((aisle) => aisle.zone);
  const blockSeparations = environment.aisles
    .filter((aisle) => aisle.category === "block-separation")
    .map((aisle) => aisle.zone);
  const aisleMarkings = environment.aisles.flatMap((aisle) => aisle.markings);

  return (
    <>
      <InstancedEnvironmentBoxes visuals={[floor]} {...WAREHOUSE_3D_MATERIALS.floor} receiveShadow />
      <InstancedEnvironmentBoxes visuals={localAisles} {...WAREHOUSE_3D_MATERIALS.localAisle} />
      <InstancedEnvironmentBoxes
        visuals={internalCrossAisles}
        {...WAREHOUSE_3D_MATERIALS.internalCrossAisle}
      />
      <InstancedEnvironmentBoxes
        visuals={blockSeparations}
        {...WAREHOUSE_3D_MATERIALS.blockSeparation}
      />
      <InstancedEnvironmentBoxes visuals={aisleMarkings} {...WAREHOUSE_3D_MATERIALS.aisleMarking} />
      <InstancedEnvironmentBoxes
        visuals={perimeterMarkings}
        {...WAREHOUSE_3D_MATERIALS.perimeterMarking}
      />
    </>
  );
});

const WarehouseShell = memo(function WarehouseShell({
  environment,
}: { environment: Warehouse3DEnvironment }) {
  return (
    <>
      <InstancedEnvironmentBoxes
        visuals={environment.boundary.walls}
        {...WAREHOUSE_3D_MATERIALS.wall}
      />
      <InstancedEnvironmentBoxes
        visuals={environment.boundary.columns}
        {...WAREHOUSE_3D_MATERIALS.column}
      />
      <InstancedEnvironmentBoxes
        visuals={environment.boundary.overheadFixtures}
        {...WAREHOUSE_3D_MATERIALS.overheadFixture}
      />
      <InstancedEnvironmentBoxes
        visuals={environment.boundary.signage}
        {...WAREHOUSE_3D_MATERIALS.aisleSign}
      />
    </>
  );
});

const WarehouseRacks = memo(function WarehouseRacks({
  environment,
  detailLevel,
}: {
  environment: Warehouse3DEnvironment;
  detailLevel: WarehouseLocationDetailLevel;
}) {
  const renderSet = useMemo(
    () => getWarehouseEnvironmentRenderSet(environment, detailLevel),
    [detailLevel, environment],
  );
  const rackAsset = useWarehouseAsset("rack-run");
  const palletAsset = useWarehouseAsset("pallet");
  const cartonAsset = useWarehouseAsset("carton");
  const { geometry, material } = rackAsset;
  // The imported rack is the primary representation; the procedural frame is
  // what the warehouse falls back to when the asset cannot load.
  const importedRack = rackAsset.status === "ready" && geometry !== null && material !== null;

  // Storage assets resolve per category, so one failed model never removes the
  // other and never removes the procedural fallback underneath both.
  const storage = useMemo(
    () => buildWarehouseStorageRenderSet(renderSet.storageProps, {
      pallet: palletAsset.naturalSize,
      carton: cartonAsset.naturalSize,
    }),
    [cartonAsset.naturalSize, palletAsset.naturalSize, renderSet.storageProps],
  );

  const uprights = renderSet.rackMembers.filter((visual) => visual.kind === "rack-upright");
  const beams = renderSet.rackMembers.filter((visual) => visual.kind === "rack-beam");
  const shelves = renderSet.rackMembers.filter((visual) => visual.kind === "rack-shelf");
  const bases = renderSet.rackMembers.filter((visual) => visual.kind === "rack-base");
  const guards = renderSet.rackMembers.filter((visual) => visual.kind === "rack-guard");

  return (
    <>
      {importedRack ? (
        <InstancedAssetMeshes
          visuals={renderSet.rackAssetBays}
          geometry={geometry}
          material={material}
          castShadow={WAREHOUSE_3D_MATERIALS.shadowCasters.rackAsset}
          receiveShadow
        />
      ) : (
        <>
          <InstancedEnvironmentBoxes
            visuals={uprights}
            {...WAREHOUSE_3D_MATERIALS.rackUpright}
            castShadow={WAREHOUSE_3D_MATERIALS.shadowCasters.rackUpright}
            receiveShadow
          />
          <InstancedEnvironmentBoxes
            visuals={beams}
            {...WAREHOUSE_3D_MATERIALS.rackBeam}
            castShadow={WAREHOUSE_3D_MATERIALS.shadowCasters.rackBeam}
          />
          <InstancedEnvironmentBoxes
            visuals={shelves}
            {...WAREHOUSE_3D_MATERIALS.rackShelf}
            castShadow={WAREHOUSE_3D_MATERIALS.shadowCasters.rackShelf}
            receiveShadow
          />
          <InstancedEnvironmentBoxes
            visuals={bases}
            {...WAREHOUSE_3D_MATERIALS.rackUpright}
            castShadow={WAREHOUSE_3D_MATERIALS.shadowCasters.rackUpright}
          />
        </>
      )}
      <InstancedEnvironmentBoxes
        visuals={guards}
        {...WAREHOUSE_3D_MATERIALS.rackGuard}
        castShadow={WAREHOUSE_3D_MATERIALS.shadowCasters.rackGuard}
      />
      {palletAsset.geometry && palletAsset.material ? (
        <InstancedAssetMeshes
          visuals={storage.assetPallets}
          geometry={palletAsset.geometry}
          material={palletAsset.material}
          castShadow={WAREHOUSE_3D_MATERIALS.shadowCasters.pallet}
        />
      ) : null}
      {cartonAsset.geometry && cartonAsset.material ? (
        <InstancedAssetMeshes
          visuals={storage.assetCartons}
          geometry={cartonAsset.geometry}
          material={cartonAsset.material}
          castShadow={WAREHOUSE_3D_MATERIALS.shadowCasters.carton}
        />
      ) : null}
      <InstancedEnvironmentBoxes
        visuals={storage.proceduralPallets}
        {...WAREHOUSE_3D_MATERIALS.pallet}
        castShadow={WAREHOUSE_3D_MATERIALS.shadowCasters.pallet}
      />
      <InstancedEnvironmentBoxes
        visuals={storage.proceduralCartons}
        {...WAREHOUSE_3D_MATERIALS.carton}
        castShadow={WAREHOUSE_3D_MATERIALS.shadowCasters.carton}
      />
    </>
  );
});

/** Counted locations step down to a neutral, low-priority cue so the active one dominates. */
const COMPLETED_LOCATION_COLOR = WAREHOUSE_3D_MATERIALS.completedLocation;

function CompletedLocationMarker({ color }: { color: string }) {
  return (
    <>
      <mesh position={[0, 0.04, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[
          WAREHOUSE_3D_VISUALS.destination.ringInnerRadius,
          WAREHOUSE_3D_VISUALS.destination.ringOuterRadius,
          20,
        ]} />
        <meshBasicMaterial color={color} transparent opacity={0.5} />
      </mesh>
      <mesh position={[-0.06, 0.06, 0.04]} rotation={[0, -Math.PI / 4, 0]}>
        <boxGeometry args={[0.13, 0.025, 0.05]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <mesh position={[0.05, 0.06, -0.02]} rotation={[0, Math.PI / 3.4, 0]}>
        <boxGeometry args={[0.24, 0.025, 0.05]} />
        <meshBasicMaterial color={color} />
      </mesh>
    </>
  );
}

function DestinationMarker({ color, opacity, beaconScale }: {
  color: string;
  opacity: number;
  beaconScale: number;
}) {
  const destination = WAREHOUSE_3D_VISUALS.destination;
  return (
    <>
      <mesh position={[0, 0.045, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[destination.ringInnerRadius, destination.ringOuterRadius, 20]} />
        <meshBasicMaterial color={color} transparent={opacity < 1} opacity={opacity} />
      </mesh>
      <mesh position={[0, destination.stemY, 0]}>
        <cylinderGeometry args={[
          destination.stemRadius,
          destination.stemRadius,
          destination.stemHeight,
          6,
        ]} />
        <meshBasicMaterial color={color} transparent={opacity < 1} opacity={opacity} />
      </mesh>
      <mesh position={[0, destination.beaconY, 0]} scale={beaconScale}>
        <octahedronGeometry args={[destination.beaconRadius, 0]} />
        <meshBasicMaterial color={color} transparent={opacity < 1} opacity={opacity} />
      </mesh>
    </>
  );
}

/**
 * Renders the pending / active / completed hierarchy straight from snapshot
 * truth. Display points are projected once from a shared coordinate lookup
 * rather than rebuilt per location on every frame.
 */
function WarehouseLocations({
  graph,
  coordinates,
  transform,
  color,
  detailLevel,
  snapshot,
  routeIds,
  activePulse,
}: {
  graph: WarehouseGraph;
  coordinates: ReadonlyMap<NodeId, Point>;
  transform: Warehouse3DTransform;
  color: string;
  detailLevel: WarehouseLocationDetailLevel;
  snapshot: SimulationSnapshot;
  routeIds: ReadonlySet<NodeId>;
  activePulse: number;
}) {
  const locations = useMemo(
    () => graph.locations.flatMap((location) => {
      const point = coordinates.get(location.id);
      return point
        ? [{ id: location.id, point: projectDisplayPointToWarehouse3D(point, transform) }]
        : [];
    }),
    [coordinates, graph, transform],
  );

  return locations.flatMap(({ id, point }) => {
    const state = getWarehouseLocationVisualState(id, snapshot, routeIds);
    if (!shouldRenderWarehouseLocation(state !== "idle", detailLevel)) return [];

    if (state === "idle") {
      return [(
        <mesh key={id} position={[point.x, 0.08, point.z]}>
          <sphereGeometry args={[0.05, 8, 6]} />
          <meshStandardMaterial {...WAREHOUSE_3D_MATERIALS.unselectedLocation} />
        </mesh>
      )];
    }

    return [(
      <group key={id} position={[point.x, 0, point.z]}>
        {state === "completed" ? (
          <CompletedLocationMarker color={COMPLETED_LOCATION_COLOR} />
        ) : (
          <DestinationMarker
            color={color}
            opacity={state === "active" ? 1 : 0.62}
            beaconScale={state === "active" ? 1 + 0.16 * activePulse : 1}
          />
        )}
      </group>
    )];
  });
}

/**
 * World-space counting emphasis at the location currently being serviced:
 * a breathing ground halo, a soft vertical column, and a segmented progress
 * ring. Every value comes from the supplied descriptor -- nothing is timed,
 * measured, or recomputed here.
 */
function ActiveServiceVisual({ visual, color, detailLevel, standPoint }: {
  visual: WarehouseActiveServiceVisual;
  color: string;
  detailLevel: WarehouseLocationDetailLevel;
  standPoint: { readonly x: number; readonly z: number };
}) {
  const { position, pulse, ring } = visual;
  const accent = WAREHOUSE_3D_MATERIALS.activeAccent;
  // The frame faces the aisle the operator is standing in.
  const facingYaw = Math.atan2(position.x - standPoint.x, position.z - standPoint.z);
  const frame = { width: 0.52, height: 0.44, centerY: 0.95, thickness: 0.014 };
  const edges: Array<{ id: string; position: [number, number, number]; size: [number, number, number] }> = [
    {
      id: "top",
      position: [0, frame.centerY + frame.height / 2, 0],
      size: [frame.width, frame.thickness, frame.thickness],
    },
    {
      id: "bottom",
      position: [0, frame.centerY - frame.height / 2, 0],
      size: [frame.width, frame.thickness, frame.thickness],
    },
    {
      id: "left",
      position: [-frame.width / 2, frame.centerY, 0],
      size: [frame.thickness, frame.height, frame.thickness],
    },
    {
      id: "right",
      position: [frame.width / 2, frame.centerY, 0],
      size: [frame.thickness, frame.height, frame.thickness],
    },
  ];

  return (
    <>
      {/* Bay frame on the rack face being counted. */}
      <group position={[position.x, 0, position.z]} rotation={[0, facingYaw, 0]}>
        {edges.map((edge) => (
          <mesh key={edge.id} position={edge.position} renderOrder={3}>
            <boxGeometry args={edge.size} />
            <meshBasicMaterial
              color={accent}
              transparent
              opacity={0.7 + 0.25 * pulse}
              depthTest={false}
              depthWrite={false}
            />
          </mesh>
        ))}
      </group>

      {/* Operator standing position: floor marker plus service progress. */}
      <group position={[standPoint.x, 0, standPoint.z]}>
        <mesh position={[0, 0.035, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={2}>
          <ringGeometry args={[0.34, 0.4 + 0.03 * pulse, 32]} />
          <meshBasicMaterial
            color={accent}
            transparent
            opacity={0.24 + 0.18 * pulse}
            depthTest={false}
            depthWrite={false}
          />
        </mesh>
        {detailLevel === "overview" ? (
          <>
            <mesh position={[0, 0.055, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={3}>
              <ringGeometry args={[0.26, 0.31, 24]} />
              <meshBasicMaterial
                color={WAREHOUSE_3D_MATERIALS.progressTrack}
                transparent
                opacity={0.5}
                depthTest={false}
                depthWrite={false}
              />
            </mesh>
            {ring.filledFraction > 0 ? (
              <mesh position={[0, 0.06, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={3}>
                <ringGeometry args={[0.26, 0.33, 24, 1, 0, ring.filledFraction * Math.PI * 2]} />
                <meshBasicMaterial
                  color={color}
                  transparent
                  opacity={0.95}
                  depthTest={false}
                  depthWrite={false}
                />
              </mesh>
            ) : null}
          </>
        ) : ring.segments.map((segment) => (
          <mesh
            key={segment.index}
            position={[0, 0.06, 0]}
            rotation={[-Math.PI / 2, 0, 0]}
            renderOrder={3}
          >
            <ringGeometry args={[
              0.26,
              segment.filled ? 0.33 : 0.305,
              4,
              1,
              segment.startAngleRadians,
              ring.segmentAngleRadians * 0.72,
            ]} />
            <meshBasicMaterial
              color={segment.filled ? color : WAREHOUSE_3D_MATERIALS.progressTrack}
              transparent
              opacity={segment.filled ? 0.95 : 0.42}
              depthTest={false}
              depthWrite={false}
            />
          </mesh>
        ))}
      </group>
    </>
  );
}

/** A short expanding ring at the moment a count finishes. Adds no physical time. */
function ServiceCompletionPulse({ visual, color }: {
  visual: WarehouseServiceCompletionVisual;
  color: string;
}) {
  const inner = 0.32 + 0.62 * (1 - visual.intensity);

  return (
    <mesh
      position={[visual.position.x, 0.05, visual.position.z]}
      rotation={[-Math.PI / 2, 0, 0]}
      renderOrder={3}
    >
      <ringGeometry args={[inner, inner + 0.065, 32]} />
      <meshBasicMaterial
        color={color}
        transparent
        opacity={0.55 * visual.intensity}
        depthTest={false}
        depthWrite={false}
      />
    </mesh>
  );
}

function OfficeMarker({ graph, transform }: {
  graph: WarehouseGraph;
  transform: Warehouse3DTransform;
}) {
  const office = useMemo(
    () => projectNodeToWarehouse3D(graph, graph.start.id, transform),
    [graph, transform],
  );
  return (
    <mesh position={[office.x, 0.2, office.z]}>
      <cylinderGeometry args={[0.24, 0.24, 0.4, 4]} />
      <meshStandardMaterial {...WAREHOUSE_3D_MATERIALS.office} />
    </mesh>
  );
}

type RouteSegmentState = "planned" | "traversed" | "active";

function RouteTrailSegment({ segment, color, state }: {
  segment: Warehouse3DRouteVisualSegment;
  color: string;
  state: RouteSegmentState;
}) {
  const route = WAREHOUSE_3D_VISUALS.route;
  const radius = state === "active"
    ? route.activeRadius
    : state === "traversed" ? route.traversedRadius : route.radius;
  const opacity = state === "active"
    ? route.activeOpacity
    : state === "traversed" ? route.traversedOpacity : route.opacity;
  const quaternion = useMemo(() => {
    if (segment.visualLength === 0) return new Quaternion();
    const direction = new Vector3(
      segment.to.x - segment.from.x,
      segment.to.y - segment.from.y,
      segment.to.z - segment.from.z,
    ).normalize();
    return new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), direction);
  }, [segment]);

  if (segment.visualLength === 0) {
    return (
      <mesh position={[segment.from.x, segment.from.y, segment.from.z]} renderOrder={2}>
        <sphereGeometry args={[radius, 6, 5]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={opacity}
          depthTest={route.depthTest}
          depthWrite={route.depthWrite}
        />
      </mesh>
    );
  }

  return (
    <group>
      <mesh
        position={[segment.midpoint.x, segment.midpoint.y, segment.midpoint.z]}
        quaternion={quaternion}
        renderOrder={2}
      >
        <cylinderGeometry args={[
          radius,
          radius,
          segment.visualLength,
          route.radialSegments,
        ]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={opacity}
          depthTest={route.depthTest}
          depthWrite={route.depthWrite}
        />
      </mesh>
      <mesh position={[segment.from.x, segment.from.y, segment.from.z]} renderOrder={2}>
        <sphereGeometry args={[radius, 6, 5]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={opacity}
          depthTest={route.depthTest}
          depthWrite={route.depthWrite}
        />
      </mesh>
    </group>
  );
}

function RouteTrail({ graph, timeline, transform, color, activeLegIndex, complete, coordinates }: {
  graph: WarehouseGraph;
  timeline: RouteTimeline;
  transform: Warehouse3DTransform;
  color: string;
  activeLegIndex: number | null;
  complete: boolean;
  coordinates: ReadonlyMap<NodeId, Point>;
}) {
  const segments = useMemo(
    () => buildWarehouse3DRouteVisualSegments(graph, timeline, transform, coordinates),
    [coordinates, graph, timeline, transform],
  );
  const segmentState = (legIndex: number): RouteSegmentState => {
    if (complete) return "traversed";
    if (activeLegIndex === null) return "planned";
    if (legIndex < activeLegIndex) return "traversed";
    return legIndex === activeLegIndex ? "active" : "planned";
  };
  const finalPoint = segments.at(-1)?.to;

  return (
    <group>
      {segments.map((segment, index) => (
        <RouteTrailSegment
          key={`${segment.fromId}-${segment.toId}-${index}`}
          segment={segment}
          color={color}
          state={segmentState(segment.legIndex)}
        />
      ))}
      {finalPoint ? (
        <mesh position={[finalPoint.x, finalPoint.y, finalPoint.z]} renderOrder={2}>
          <sphereGeometry args={[WAREHOUSE_3D_VISUALS.route.radius, 6, 5]} />
          <meshBasicMaterial
            color={color}
            transparent
            opacity={WAREHOUSE_3D_VISUALS.route.opacity}
            depthTest={WAREHOUSE_3D_VISUALS.route.depthTest}
            depthWrite={WAREHOUSE_3D_VISUALS.route.depthWrite}
          />
        </mesh>
      ) : null}
    </group>
  );
}

/**
 * One worker primitive. The solid pass participates in scene depth so the
 * operator sits inside the racking; the ghost pass redraws only the
 * identifying parts depth-independently so they are never entirely lost.
 */
function WorkerVisualPartMesh({ part }: { part: WarehouseWorkerVisualPart }) {
  const policy = WAREHOUSE_WORKER_DEPTH_POLICY.body;
  const material = (
    <meshStandardMaterial
      color={part.color}
      roughness={part.role === "equipment" ? 0.62 : 0.78}
      metalness={part.role === "equipment" ? 0.1 : 0}
      depthTest={policy.depthTest}
      depthWrite={policy.depthWrite}
    />
  );

  if (part.primitive === "sphere") {
    return (
      <mesh
        position={part.position}
        rotation={part.rotation}
        scale={part.scale}
        renderOrder={policy.renderOrder}
        castShadow={WAREHOUSE_3D_MATERIALS.shadowCasters.worker}
      >
        <sphereGeometry args={[part.radius, 12, 10]} />
        {material}
      </mesh>
    );
  }

  if (part.primitive === "cylinder") {
    return (
      <mesh
        position={part.position}
        rotation={part.rotation}
        renderOrder={policy.renderOrder}
        castShadow={WAREHOUSE_3D_MATERIALS.shadowCasters.worker}
      >
        <cylinderGeometry args={[
          part.topRadius,
          part.bottomRadius,
          part.height,
          12,
        ]} />
        {material}
      </mesh>
    );
  }

  return (
    <mesh
      position={part.position}
      rotation={part.rotation}
      renderOrder={policy.renderOrder}
      castShadow={WAREHOUSE_3D_MATERIALS.shadowCasters.worker}
    >
      <boxGeometry args={part.size} />
      {material}
    </mesh>
  );
}

/** Expanding scan arcs from the scan head toward the bay being counted. */
function WorkerScanCue({ cue }: { cue: WarehouseWorkerScanCue }) {
  const quaternion = useMemo(
    () => new Quaternion().setFromUnitVectors(
      new Vector3(0, 0, 1),
      new Vector3(...cue.direction).normalize(),
    ),
    [cue],
  );
  const policy = WAREHOUSE_WORKER_DEPTH_POLICY.locator;

  return (
    <group position={cue.origin} quaternion={quaternion}>
      {cue.waves.map((wave) => (
        <mesh
          key={wave.index}
          position={[0, 0, wave.radius * 0.35]}
          rotation={[Math.PI / 2, 0, 0]}
          renderOrder={policy.renderOrder}
        >
          <torusGeometry args={[wave.radius, 0.006, 6, 12, Math.PI * 0.7]} />
          <meshBasicMaterial
            color={WAREHOUSE_3D_MATERIALS.activeAccent}
            transparent
            opacity={wave.opacity}
            depthTest={policy.depthTest}
            depthWrite={policy.depthWrite}
          />
        </mesh>
      ))}
    </group>
  );
}


/**
 * The imported operator. Its pieces are grounded on y = 0 at natural scale, so
 * one uniform factor puts a credible human next to the racking, and each piece
 * is dressed as PPE by its source material name. Ordinary depth testing: the
 * body is occluded by racking exactly like any other scene geometry.
 */
function OperatorAssetFigure({
  parts,
  scale,
}: {
  parts: readonly WarehouseAssetPart[];
  scale: number;
}) {
  return (
    <group scale={[scale, scale, scale]}>
      {parts.map((part) => (
        <mesh
          key={part.name}
          geometry={part.geometry}
          castShadow={WAREHOUSE_3D_MATERIALS.shadowCasters.worker}
          renderOrder={WAREHOUSE_WORKER_DEPTH_POLICY.body.renderOrder}
        >
          <meshStandardMaterial
            color={getWarehouseOperatorPartColor(part.name, part.color)}
            roughness={0.78}
            metalness={0}
            depthTest={WAREHOUSE_WORKER_DEPTH_POLICY.body.depthTest}
            depthWrite={WAREHOUSE_WORKER_DEPTH_POLICY.body.depthWrite}
          />
        </mesh>
      ))}
    </group>
  );
}

/** The handheld scanner the imported operator carries; the model has none. */
function OperatorScanner({ scanner }: { scanner: WarehouseOperatorScanner }) {
  return (
    <group position={scanner.position} rotation={[0, scanner.yawRadians, 0]}>
      <mesh castShadow={false}>
        <boxGeometry args={[0.05, 0.11, 0.045]} />
        <meshStandardMaterial
          color={WAREHOUSE_WORKER_COLORS.equipment}
          roughness={0.62}
          metalness={0.1}
        />
      </mesh>
      <mesh position={[0, 0.055, 0.02]}>
        <boxGeometry args={[0.042, 0.026, 0.03]} />
        <meshStandardMaterial color={WAREHOUSE_WORKER_COLORS.scannerHead} roughness={0.5} />
      </mesh>
    </group>
  );
}

function WorkerMarker({
  graph,
  timeline,
  snapshot,
  transform,
  color,
  gesture,
  figureScale,
  coordinates,
}: {
  graph: WarehouseGraph;
  timeline: RouteTimeline;
  snapshot: SimulationSnapshot;
  transform: Warehouse3DTransform;
  color: string;
  gesture: WarehouseCountingGesture | null;
  figureScale: number;
  coordinates: ReadonlyMap<NodeId, Point>;
}) {
  const pose = useMemo(
    () => createWarehouseWorkerPose(graph, timeline, snapshot, transform, coordinates),
    [coordinates, graph, snapshot, timeline, transform],
  );
  const visual = useMemo(
    () => createWarehouseWorkerVisual(color, gesture, figureScale),
    [color, figureScale, gesture],
  );
  const operator = useWarehouseAsset("operator");
  const operatorScanner = useMemo(() => createWarehouseOperatorScanner(gesture), [gesture]);
  // The imported operator scans from its own hand; the procedural figure keeps
  // emitting from the scan head its own pose already produces.
  const importedOperator = operator.status === "ready" && operator.parts !== null
    && operator.normalization !== null;
  const scanCue = useMemo(
    () => createWarehouseWorkerScanCue(gesture, importedOperator ? operatorScanner.head : undefined),
    [gesture, importedOperator, operatorScanner],
  );

  return (
    <group position={[pose.position.x, 0, pose.position.z]}>
      <mesh
        position={[0, 0.055, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        renderOrder={WAREHOUSE_WORKER_DEPTH_POLICY.locator.renderOrder}
      >
        <ringGeometry args={[
          WAREHOUSE_3D_VISUALS.worker.ringInnerRadius,
          WAREHOUSE_3D_VISUALS.worker.ringOuterRadius,
          24,
        ]} />
        <meshBasicMaterial color={color} depthTest={false} depthWrite={false} />
      </mesh>
      <group
        rotation={[0, pose.yawRadians, 0]}
        scale={[visual.figureScale, visual.figureScale, visual.figureScale]}
      >
        {importedOperator ? (
          <>
            <OperatorAssetFigure
              parts={operator.parts as readonly WarehouseAssetPart[]}
              scale={(operator.normalization?.scale ?? 1) * visual.figureScale}
            />
            <OperatorScanner scanner={operatorScanner} />
          </>
        ) : (
          visual.parts.map((part) => <WorkerVisualPartMesh key={part.id} part={part} />)
        )}
        {scanCue ? <WorkerScanCue cue={scanCue} /> : null}
      </group>
      {/* Small depth-independent pip so the operator stays locatable behind racking. */}
      <mesh
        position={[0, 2.05, 0]}
        renderOrder={WAREHOUSE_WORKER_DEPTH_POLICY.locator.renderOrder}
      >
        <sphereGeometry args={[WAREHOUSE_WORKER_DEPTH_POLICY.locator.pipRadius, 8, 6]} />
        <meshBasicMaterial color={color} depthTest={false} depthWrite={false} />
      </mesh>
    </group>
  );
}

/**
 * One key light does the grounding. Shadows are the cheapest way to give the
 * scene real object-to-floor contact, and they are dropped on narrow canvases
 * so mobile keeps its headroom.
 */
function WarehouseKeyLight() {
  const { size } = useThree();
  const { lighting, shadow } = WAREHOUSE_3D_MATERIALS;
  const castShadow = size.width >= shadow.minimumCanvasWidth;

  return (
    <directionalLight
      position={lighting.keyPosition}
      intensity={lighting.keyIntensity}
      castShadow={castShadow}
      shadow-mapSize-width={shadow.mapSize}
      shadow-mapSize-height={shadow.mapSize}
      shadow-camera-left={-shadow.frustum}
      shadow-camera-right={shadow.frustum}
      shadow-camera-top={shadow.frustum}
      shadow-camera-bottom={-shadow.frustum}
      shadow-camera-near={shadow.near}
      shadow-camera-far={shadow.far}
      shadow-bias={shadow.bias}
      shadow-intensity={shadow.opacity}
    />
  );
}

interface Warehouse3DSceneProps {
  graph: WarehouseGraph;
  timeline: RouteTimeline;
  snapshot: SimulationSnapshot;
  mode: ReplayRouteMode;
  cameraPreset: WarehouseCameraPreset;
  cameraResetRequest: number;
  cameraChannel: WarehouseCameraChannel;
  cameraAuthority: boolean;
  cameraInstanceId: string;
  viewMode: "compare" | "explore";
}

function Warehouse3DScene({
  graph,
  timeline,
  snapshot,
  mode,
  cameraPreset,
  cameraResetRequest,
  cameraChannel,
  cameraAuthority,
  cameraInstanceId,
  viewMode,
}: Warehouse3DSceneProps) {
  const transform = useMemo(() => createWarehouse3DTransform(graph), [graph]);
  const environment = useMemo(
    () => buildWarehouse3DEnvironment(graph, transform),
    [graph, transform],
  );
  const color = ROUTE_COLORS[mode];
  const workerPoint = useMemo(
    () => projectSimulationMarkerTo3D(graph, timeline, snapshot, transform),
    [graph, snapshot, timeline, transform],
  );
  // One coordinate lookup for every service visual and location marker in this
  // scene, instead of one rebuilt lookup per decorative primitive.
  const coordinates = useMemo(() => buildCoordinateLookup(graph), [graph]);
  // The operator and the walking overlay stand in the aisle, not inside the bin.
  const operatorCoordinates = useMemo(() => buildOperatorCoordinateLookup(graph), [graph]);
  const routeIds = useMemo(() => new Set(timeline.order.slice(1)), [timeline.order]);
  const activeService = useMemo(
    () => createWarehouseActiveServiceVisual(snapshot, transform, coordinates),
    [coordinates, snapshot, transform],
  );
  const completionVisual = useMemo(
    () => createWarehouseServiceCompletionVisual(timeline, snapshot, transform, coordinates),
    [coordinates, snapshot, timeline, transform],
  );
  const countingGesture = useMemo(
    () => getWarehouseWorkerCountingGesture(snapshot),
    [snapshot],
  );
  const activeStandPoint = useMemo(() => {
    if (!activeService) return null;
    const point = operatorCoordinates.get(activeService.locationId);
    return point ? projectDisplayPointToWarehouse3D(point, transform) : null;
  }, [activeService, operatorCoordinates, transform]);
  // One quantized zoom value drives every level-of-detail decision, so a whole
  // orbit or pinch produces a handful of React updates rather than one a frame.
  const [zoomBucket, setZoomBucket] = useState(1);
  const handleZoomBucketChange = useCallback((bucket: number) => {
    setZoomBucket((current) => current === bucket ? current : bucket);
  }, []);
  const detailLevel = getWarehouseDetailLevelForZoomRatio(zoomBucket);
  const environmentDetailLevel = getWarehouseEnvironmentDetailLevel(detailLevel, cameraPreset);
  const workerFigureScale = getWarehouseWorkerFigureScale(zoomBucket);

  // Renderer-ephemeral: the one service event the viewer has taken the camera
  // away from. Cleared whenever they ask for a preset or reset.
  const [suppressedLocationId, setSuppressedLocationId] = useState<NodeId | null>(null);
  useEffect(() => {
    setSuppressedLocationId(null);
  }, [cameraResetRequest]);
  const storyFocus = useMemo(
    () => getWarehouseStoryCameraFocus(timeline, snapshot, transform, coordinates, {
      viewMode,
      suppressedLocationId,
    }),
    [coordinates, snapshot, suppressedLocationId, timeline, transform, viewMode],
  );
  const storyFocusRef = useRef(storyFocus);
  storyFocusRef.current = storyFocus;
  const handleUserCameraInteraction = useCallback(() => {
    const locationId = storyFocusRef.current?.locationId ?? null;
    if (!locationId) return;
    setSuppressedLocationId((current) => current === locationId ? current : locationId);
  }, []);

  return (
    <>
      <InteractiveWarehouseCamera
        preset={cameraPreset}
        resetRequest={cameraResetRequest}
        channel={cameraChannel}
        authority={cameraAuthority}
        instanceId={cameraInstanceId}
        workerPoint={workerPoint}
        onZoomBucketChange={handleZoomBucketChange}
        storyFocus={storyFocus}
        onUserCameraInteraction={handleUserCameraInteraction}
      />
      <color attach="background" args={[WAREHOUSE_3D_MATERIALS.background]} />
      <hemisphereLight args={[
        WAREHOUSE_3D_MATERIALS.lighting.sky,
        WAREHOUSE_3D_MATERIALS.lighting.ground,
        WAREHOUSE_3D_MATERIALS.lighting.hemisphereIntensity,
      ]} />
      <WarehouseKeyLight />
      <directionalLight
        position={WAREHOUSE_3D_MATERIALS.lighting.fillPosition}
        intensity={WAREHOUSE_3D_MATERIALS.lighting.fillIntensity}
      />
      <WarehouseFloor environment={environment} />
      <WarehouseShell environment={environment} />
      <WarehouseRacks environment={environment} detailLevel={environmentDetailLevel} />
      <WarehouseLocations
        graph={graph}
        coordinates={coordinates}
        transform={transform}
        color={color}
        detailLevel={detailLevel}
        snapshot={snapshot}
        routeIds={routeIds}
        activePulse={activeService?.pulse ?? 0}
      />
      <OfficeMarker graph={graph} transform={transform} />
      <RouteTrail
        graph={graph}
        timeline={timeline}
        transform={transform}
        color={color}
        activeLegIndex={snapshot.current?.legIndex ?? null}
        complete={snapshot.isComplete}
        coordinates={operatorCoordinates}
      />
      {activeService ? (
        <ActiveServiceVisual
          visual={activeService}
          color={color}
          detailLevel={detailLevel}
          standPoint={activeStandPoint ?? activeService.position}
        />
      ) : null}
      {completionVisual ? (
        <ServiceCompletionPulse visual={completionVisual} color={COMPLETED_LOCATION_COLOR} />
      ) : null}
      <WorkerMarker
        graph={graph}
        timeline={timeline}
        snapshot={snapshot}
        transform={transform}
        color={color}
        gesture={countingGesture}
        figureScale={workerFigureScale}
        coordinates={operatorCoordinates}
      />
    </>
  );
}

function canAttemptWebGL(): boolean {
  if (typeof document === "undefined" || typeof window.WebGLRenderingContext === "undefined") {
    return false;
  }
  try {
    const probe = document.createElement("canvas");
    const context = probe.getContext("webgl2") ?? probe.getContext("webgl");
    if (!context) return false;
    context.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}

export function Warehouse3DViewport(props: Warehouse3DViewportProps) {
  const [webGLAvailable] = useState(canAttemptWebGL);
  const localCameraChannel = useMemo(createWarehouseCameraChannel, []);
  const cameraChannel = props.cameraChannel ?? localCameraChannel;
  const cameraPreset = props.cameraPreset ?? "overview";
  const cameraResetRequest = props.cameraResetRequest ?? 0;
  const cameraAuthority = props.cameraAuthority ?? true;
  const cameraInstanceId = `${useId()}-${props.mode}`;

  if (!webGLAvailable) {
    return <div className="warehouse-3d__fallback">{props.fallback}</div>;
  }

  return (
    <div
      className="warehouse-3d"
      data-warehouse-3d={props.mode}
      data-camera-preset={cameraPreset}
      data-camera-authority={String(cameraAuthority)}
    >
      <Canvas
        role="img"
        aria-label={props.accessibleLabel}
        aria-live="off"
        orthographic
        shadows
        camera={{ position: [15, 19, 15], zoom: 10, near: 0.1, far: 100 }}
        dpr={[1, 1.5]}
        frameloop="demand"
        fallback={<div className="warehouse-3d__fallback">{props.fallback}</div>}
        gl={{ antialias: true, alpha: false, powerPreference: "low-power" }}
      >
        <Warehouse3DScene
          graph={props.graph}
          timeline={props.timeline}
          snapshot={props.snapshot}
          mode={props.mode}
          cameraPreset={cameraPreset}
          cameraResetRequest={cameraResetRequest}
          cameraChannel={cameraChannel}
          cameraAuthority={cameraAuthority}
          cameraInstanceId={cameraInstanceId}
          viewMode={props.viewMode ?? "compare"}
        />
      </Canvas>
    </div>
  );
}
