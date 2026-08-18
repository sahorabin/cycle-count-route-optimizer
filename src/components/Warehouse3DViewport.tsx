import { Canvas, useThree } from "@react-three/fiber";
import { memo, useCallback, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DoubleSide, InstancedMesh, Object3D, OrthographicCamera, Quaternion, Vector3 } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { NodeId, RouteTimeline, WarehouseGraph } from "../domain/types";
import type { SimulationSnapshot } from "../simulation/types";
import { buildCoordinateLookup, type Point } from "../ui/svgPoints";
import {
  createWarehouseActiveServiceVisual,
  createWarehouseServiceCompletionVisual,
  getWarehouseLocationVisualState,
  getWarehouseWorkerCountingGesture,
  type WarehouseActiveServiceVisual,
  type WarehouseCountingGesture,
  type WarehouseServiceCompletionVisual,
} from "../ui/warehouse3dServiceVisual";
import {
  clampWarehouseCameraZoom,
  createWarehouseCameraChannel,
  createWarehouseCameraPresetView,
  getWarehouseLocationDetailLevel,
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
  createWarehouse3DTransform,
  projectDisplayPointToWarehouse3D,
  projectNodeToWarehouse3D,
  projectSimulationMarkerTo3D,
  type Warehouse3DTransform,
} from "../ui/warehouse3dProjection";
import {
  buildWarehouse3DRouteVisualSegments,
  WAREHOUSE_3D_VISUALS,
  type Warehouse3DRouteVisualSegment,
} from "../ui/warehouse3dVisuals";
import {
  createWarehouseWorkerPose,
  createWarehouseWorkerVisual,
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
}

const ROUTE_COLORS: Record<ReplayRouteMode, string> = {
  worker: "#2563eb",
  recommended: "#0f9f75",
};
const TARGET_WORLD_SPAN = 20;

interface InteractiveWarehouseCameraProps {
  preset: WarehouseCameraPreset;
  resetRequest: number;
  channel: WarehouseCameraChannel;
  authority: boolean;
  instanceId: string;
  workerPoint: { readonly x: number; readonly y: number; readonly z: number };
  onDetailLevelChange: (level: WarehouseLocationDetailLevel) => void;
}

export function InteractiveWarehouseCamera({
  preset,
  resetRequest,
  channel,
  authority,
  instanceId,
  workerPoint,
  onDetailLevelChange,
}: InteractiveWarehouseCameraProps) {
  const { camera, gl, size, invalidate } = useThree();
  const controlsRef = useRef<OrbitControls | null>(null);
  const applyingViewRef = useRef(false);
  const applyViewRef = useRef<((view: WarehouseCameraView) => void) | null>(null);
  const latestPresetRef = useRef(preset);
  const latestWorkerPointRef = useRef(workerPoint);
  latestPresetRef.current = preset;
  latestWorkerPointRef.current = workerPoint;
  const baseZoom = Math.max(
    1,
    Math.min(size.width / (TARGET_WORLD_SPAN * 1.35), size.height / TARGET_WORLD_SPAN),
  );

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
      onDetailLevelChange(getWarehouseLocationDetailLevel(camera.zoom, baseZoom));
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
  }, [baseZoom, camera, channel, gl.domElement, instanceId, invalidate, onDetailLevelChange]);

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
}

function InstancedEnvironmentBoxes({
  visuals,
  color,
  roughness = 0.9,
  metalness = 0,
  opacity = 1,
  emissive,
  emissiveIntensity = 0,
}: InstancedEnvironmentBoxesProps) {
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

  if (visuals.length === 0) return null;

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, visuals.length]}>
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
      <InstancedEnvironmentBoxes visuals={[floor]} color="#dce3e6" roughness={1} />
      <InstancedEnvironmentBoxes visuals={localAisles} color="#e9eef0" roughness={1} />
      <InstancedEnvironmentBoxes visuals={internalCrossAisles} color="#dfe9eb" roughness={1} />
      <InstancedEnvironmentBoxes visuals={blockSeparations} color="#d5e2e5" roughness={1} />
      <InstancedEnvironmentBoxes visuals={aisleMarkings} color="#d1a93c" roughness={0.85} />
      <InstancedEnvironmentBoxes visuals={perimeterMarkings} color="#c08b2c" roughness={0.85} />
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
        color="#c7d1d6"
        roughness={0.94}
        opacity={0.46}
      />
      <InstancedEnvironmentBoxes
        visuals={environment.boundary.columns}
        color="#7f8b93"
        roughness={0.82}
        metalness={0.08}
      />
      <InstancedEnvironmentBoxes
        visuals={environment.boundary.overheadFixtures}
        color="#e7eff0"
        roughness={0.4}
        emissive="#d9e8ea"
        emissiveIntensity={0.55}
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
  const uprights = renderSet.rackMembers.filter((visual) => visual.kind === "rack-upright");
  const beams = renderSet.rackMembers.filter((visual) => visual.kind === "rack-beam");
  const shelves = renderSet.rackMembers.filter((visual) => visual.kind === "rack-shelf");
  const pallets = renderSet.storageProps.filter((visual) => visual.kind === "pallet");
  const cartons = renderSet.storageProps.filter((visual) => visual.kind === "carton");

  return (
    <>
      <InstancedEnvironmentBoxes
        visuals={uprights}
        color="#66757e"
        roughness={0.78}
        metalness={0.16}
      />
      <InstancedEnvironmentBoxes
        visuals={beams}
        color="#7e8c94"
        roughness={0.8}
        metalness={0.12}
      />
      <InstancedEnvironmentBoxes
        visuals={shelves}
        color="#aeb9be"
        roughness={0.9}
        opacity={0.76}
      />
      <InstancedEnvironmentBoxes visuals={pallets} color="#806f5a" roughness={1} />
      <InstancedEnvironmentBoxes visuals={cartons} color="#a58d6c" roughness={0.96} />
    </>
  );
});

/** Counted locations step down to a neutral, low-priority cue so the active one dominates. */
const COMPLETED_LOCATION_COLOR = "#8b9aa5";

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
      <mesh position={[0, 0.64, 0]}>
        <cylinderGeometry args={[
          destination.stemRadius,
          destination.stemRadius,
          destination.stemHeight,
          8,
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
          <sphereGeometry args={[0.065, 8, 6]} />
          <meshStandardMaterial color="#b7c1c9" roughness={0.85} />
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
function ActiveServiceVisual({ visual, color }: {
  visual: WarehouseActiveServiceVisual;
  color: string;
}) {
  const { position, pulse, ring } = visual;

  return (
    <group position={[position.x, 0, position.z]}>
      <mesh position={[0, 0.035, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={2}>
        <ringGeometry args={[0.64, 0.74 + 0.06 * pulse, 32]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.26 + 0.2 * pulse}
          depthTest={false}
          depthWrite={false}
        />
      </mesh>
      <mesh position={[0, 0.85, 0]}>
        <cylinderGeometry args={[0.34, 0.34, 1.7, 12, 1, true]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.08 + 0.05 * pulse}
          depthWrite={false}
          side={DoubleSide}
        />
      </mesh>
      {ring.segments.map((segment) => (
        <mesh
          key={segment.index}
          position={[0, 0.06, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          renderOrder={3}
        >
          <ringGeometry args={[
            0.5,
            segment.filled ? 0.61 : 0.57,
            4,
            1,
            segment.startAngleRadians,
            ring.segmentAngleRadians * 0.72,
          ]} />
          <meshBasicMaterial
            color={segment.filled ? color : "#a7b3bc"}
            transparent
            opacity={segment.filled ? 0.95 : 0.38}
            depthTest={false}
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  );
}

/** A short expanding ring at the moment a count finishes. Adds no physical time. */
function ServiceCompletionPulse({ visual, color }: {
  visual: WarehouseServiceCompletionVisual;
  color: string;
}) {
  const inner = 0.5 + 0.85 * (1 - visual.intensity);

  return (
    <mesh
      position={[visual.position.x, 0.05, visual.position.z]}
      rotation={[-Math.PI / 2, 0, 0]}
      renderOrder={3}
    >
      <ringGeometry args={[inner, inner + 0.09, 32]} />
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
    <mesh position={[office.x, 0.24, office.z]}>
      <cylinderGeometry args={[0.3, 0.3, 0.48, 4]} />
      <meshStandardMaterial color="#f59e0b" roughness={0.65} />
    </mesh>
  );
}

function RouteTrailSegment({ segment, color }: {
  segment: Warehouse3DRouteVisualSegment;
  color: string;
}) {
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
        <sphereGeometry args={[WAREHOUSE_3D_VISUALS.route.radius, 8, 6]} />
        <meshBasicMaterial
          color={color}
          depthTest={WAREHOUSE_3D_VISUALS.route.depthTest}
          depthWrite={WAREHOUSE_3D_VISUALS.route.depthWrite}
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
          WAREHOUSE_3D_VISUALS.route.radius,
          WAREHOUSE_3D_VISUALS.route.radius,
          segment.visualLength,
          WAREHOUSE_3D_VISUALS.route.radialSegments,
        ]} />
        <meshBasicMaterial
          color={color}
          depthTest={WAREHOUSE_3D_VISUALS.route.depthTest}
          depthWrite={WAREHOUSE_3D_VISUALS.route.depthWrite}
        />
      </mesh>
      <mesh position={[segment.from.x, segment.from.y, segment.from.z]} renderOrder={2}>
        <sphereGeometry args={[WAREHOUSE_3D_VISUALS.route.radius, 8, 6]} />
        <meshBasicMaterial
          color={color}
          depthTest={WAREHOUSE_3D_VISUALS.route.depthTest}
          depthWrite={WAREHOUSE_3D_VISUALS.route.depthWrite}
        />
      </mesh>
    </group>
  );
}

function RouteTrail({ graph, timeline, transform, color }: {
  graph: WarehouseGraph;
  timeline: RouteTimeline;
  transform: Warehouse3DTransform;
  color: string;
}) {
  const segments = useMemo(
    () => buildWarehouse3DRouteVisualSegments(graph, timeline, transform),
    [graph, timeline, transform],
  );
  const finalPoint = segments.at(-1)?.to;

  return (
    <group>
      {segments.map((segment, index) => (
        <RouteTrailSegment
          key={`${segment.fromId}-${segment.toId}-${index}`}
          segment={segment}
          color={color}
        />
      ))}
      {finalPoint ? (
        <mesh position={[finalPoint.x, finalPoint.y, finalPoint.z]} renderOrder={2}>
          <sphereGeometry args={[WAREHOUSE_3D_VISUALS.route.radius, 8, 6]} />
          <meshBasicMaterial
            color={color}
            depthTest={WAREHOUSE_3D_VISUALS.route.depthTest}
            depthWrite={WAREHOUSE_3D_VISUALS.route.depthWrite}
          />
        </mesh>
      ) : null}
    </group>
  );
}

function WorkerVisualPartMesh({ part }: { part: WarehouseWorkerVisualPart }) {
  const material = (
    <meshStandardMaterial
      color={part.color}
      roughness={part.role === "equipment" ? 0.62 : 0.78}
      metalness={part.role === "equipment" ? 0.1 : 0}
      depthTest={false}
      depthWrite={false}
    />
  );

  if (part.primitive === "sphere") {
    return (
      <mesh
        position={part.position}
        rotation={part.rotation}
        scale={part.scale}
        renderOrder={5}
      >
        <sphereGeometry args={[part.radius, 12, 10]} />
        {material}
      </mesh>
    );
  }

  if (part.primitive === "cylinder") {
    return (
      <mesh position={part.position} rotation={part.rotation} renderOrder={5}>
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
    <mesh position={part.position} rotation={part.rotation} renderOrder={5}>
      <boxGeometry args={part.size} />
      {material}
    </mesh>
  );
}

function WorkerMarker({ graph, timeline, snapshot, transform, color, gesture }: {
  graph: WarehouseGraph;
  timeline: RouteTimeline;
  snapshot: SimulationSnapshot;
  transform: Warehouse3DTransform;
  color: string;
  gesture: WarehouseCountingGesture | null;
}) {
  const pose = useMemo(
    () => createWarehouseWorkerPose(graph, timeline, snapshot, transform),
    [graph, snapshot, timeline, transform],
  );
  const visual = useMemo(
    () => createWarehouseWorkerVisual(color, gesture),
    [color, gesture],
  );

  return (
    <group position={[pose.position.x, 0, pose.position.z]}>
      <mesh
        position={[0, 0.05, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        renderOrder={3}
      >
        <circleGeometry args={[WAREHOUSE_3D_VISUALS.worker.discRadius, 24]} />
        <meshBasicMaterial color="#ffffff" depthTest={false} depthWrite={false} />
      </mesh>
      <mesh
        position={[0, 0.055, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        renderOrder={4}
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
        {visual.parts.map((part) => <WorkerVisualPartMesh key={part.id} part={part} />)}
      </group>
    </group>
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
  const [detailLevel, setDetailLevel] = useState<WarehouseLocationDetailLevel>("overview");
  const environmentDetailLevel = getWarehouseEnvironmentDetailLevel(detailLevel, cameraPreset);
  const handleDetailLevelChange = useCallback((nextLevel: WarehouseLocationDetailLevel) => {
    setDetailLevel((currentLevel) => currentLevel === nextLevel ? currentLevel : nextLevel);
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
        onDetailLevelChange={handleDetailLevelChange}
      />
      <color attach="background" args={["#eef3f5"]} />
      <hemisphereLight args={["#f7fbfc", "#7d898e", 1.35]} />
      <directionalLight position={[8, 14, 10]} intensity={1.25} />
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
      <RouteTrail graph={graph} timeline={timeline} transform={transform} color={color} />
      {activeService ? <ActiveServiceVisual visual={activeService} color={color} /> : null}
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
        />
      </Canvas>
    </div>
  );
}
