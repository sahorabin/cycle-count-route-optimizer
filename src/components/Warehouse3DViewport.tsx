import { Canvas, useThree } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { OrthographicCamera, Quaternion, Vector3 } from "three";
import type { RouteTimeline, WarehouseGraph } from "../domain/types";
import type { SimulationSnapshot } from "../simulation/types";
import { computeRackRects } from "../ui/rackLayout";
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
import type { ReplayRouteMode } from "./RouteSimulationReplay";

interface Warehouse3DViewportProps {
  graph: WarehouseGraph;
  timeline: RouteTimeline;
  snapshot: SimulationSnapshot;
  mode: ReplayRouteMode;
  accessibleLabel: string;
  fallback: ReactNode;
}

const ROUTE_COLORS: Record<ReplayRouteMode, string> = {
  worker: "#2563eb",
  recommended: "#0f9f75",
};
const TARGET_WORLD_SPAN = 20;

function FixedComparisonCamera() {
  const { camera, size, invalidate } = useThree();

  useLayoutEffect(() => {
    if (!(camera instanceof OrthographicCamera)) return;
    camera.position.set(15, 19, 15);
    camera.lookAt(0, 0, 0);
    camera.zoom = Math.max(
      1,
      Math.min(size.width / (TARGET_WORLD_SPAN * 1.35), size.height / TARGET_WORLD_SPAN),
    );
    camera.near = 0.1;
    camera.far = 100;
    camera.updateProjectionMatrix();
    invalidate();
  }, [camera, invalidate, size.height, size.width]);

  return null;
}

function WarehouseFloor({ transform }: { transform: Warehouse3DTransform }) {
  const width = (transform.maxX - transform.minX) * transform.visualScale + 2;
  const depth = (transform.maxY - transform.minY) * transform.visualScale + 2;
  const gridSize = Math.max(width, depth);

  return (
    <>
      <mesh position={[0, -0.08, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[width, depth]} />
        <meshStandardMaterial color="#edf2f4" roughness={0.95} />
      </mesh>
      <gridHelper args={[gridSize, 16, "#cbd5e1", "#dfe6ec"]} position={[0, -0.02, 0]} />
    </>
  );
}

function WarehouseRacks({ graph, transform }: {
  graph: WarehouseGraph;
  transform: Warehouse3DTransform;
}) {
  const racks = useMemo(
    () => computeRackRects(graph.aisleNodes).flatMap((rect) => {
      const aisleGap = rect.width / 2;
      const rackWidth = (rect.width - aisleGap) / 2;
      const centerY = rect.y + rect.height / 2;
      return [
        rect.x + rackWidth / 2,
        rect.x + rect.width - rackWidth / 2,
      ].map((centerX) => ({
        center: projectDisplayPointToWarehouse3D({ x: centerX, y: centerY }, transform),
        width: rackWidth * transform.visualScale,
        depth: rect.height * transform.visualScale,
      }));
    }),
    [graph.aisleNodes, transform],
  );

  return racks.map((rack, index) => (
    <mesh
      key={index}
      position={[rack.center.x, WAREHOUSE_3D_VISUALS.rack.height / 2, rack.center.z]}
    >
      <boxGeometry args={[rack.width, WAREHOUSE_3D_VISUALS.rack.height, rack.depth]} />
      <meshStandardMaterial
        color={WAREHOUSE_3D_VISUALS.rack.color}
        roughness={WAREHOUSE_3D_VISUALS.rack.roughness}
        metalness={0}
      />
    </mesh>
  ));
}

function WarehouseLocations({ graph, timeline, transform, color }: {
  graph: WarehouseGraph;
  timeline: RouteTimeline;
  transform: Warehouse3DTransform;
  color: string;
}) {
  const routeIds = useMemo(() => new Set(timeline.order.slice(1)), [timeline.order]);
  const locations = useMemo(
    () => graph.locations.map((location) => ({
      id: location.id,
      point: projectNodeToWarehouse3D(graph, location.id, transform),
      selected: routeIds.has(location.id),
    })),
    [graph, routeIds, transform],
  );

  return locations.map(({ id, point, selected }) => selected ? (
    <group key={id} position={[point.x, 0, point.z]}>
      <mesh position={[0, 0.045, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[
          WAREHOUSE_3D_VISUALS.destination.ringInnerRadius,
          WAREHOUSE_3D_VISUALS.destination.ringOuterRadius,
          20,
        ]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <mesh position={[0, 0.64, 0]}>
        <cylinderGeometry args={[
          WAREHOUSE_3D_VISUALS.destination.stemRadius,
          WAREHOUSE_3D_VISUALS.destination.stemRadius,
          WAREHOUSE_3D_VISUALS.destination.stemHeight,
          8,
        ]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <mesh position={[0, WAREHOUSE_3D_VISUALS.destination.beaconY, 0]}>
        <octahedronGeometry args={[WAREHOUSE_3D_VISUALS.destination.beaconRadius, 0]} />
        <meshBasicMaterial color={color} />
      </mesh>
    </group>
  ) : (
    <mesh key={id} position={[point.x, 0.08, point.z]}>
      <sphereGeometry args={[0.065, 8, 6]} />
      <meshStandardMaterial color="#b7c1c9" roughness={0.85} />
    </mesh>
  ));
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

function WorkerMarker({ graph, timeline, snapshot, transform, color }: {
  graph: WarehouseGraph;
  timeline: RouteTimeline;
  snapshot: SimulationSnapshot;
  transform: Warehouse3DTransform;
  color: string;
}) {
  const marker = useMemo(
    () => projectSimulationMarkerTo3D(graph, timeline, snapshot, transform),
    [graph, snapshot, timeline, transform],
  );

  return (
    <group position={[marker.x, 0, marker.z]}>
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
      <mesh position={[0, WAREHOUSE_3D_VISUALS.worker.bodyY, 0]} renderOrder={5}>
        <cylinderGeometry args={[
          WAREHOUSE_3D_VISUALS.worker.bodyTopRadius,
          WAREHOUSE_3D_VISUALS.worker.bodyBottomRadius,
          WAREHOUSE_3D_VISUALS.worker.bodyHeight,
          12,
        ]} />
        <meshBasicMaterial color={color} depthTest={false} depthWrite={false} />
      </mesh>
      <mesh position={[0, WAREHOUSE_3D_VISUALS.worker.headY, 0]} renderOrder={5}>
        <sphereGeometry args={[WAREHOUSE_3D_VISUALS.worker.headRadius, 12, 10]} />
        <meshBasicMaterial color="#f4c7a1" depthTest={false} depthWrite={false} />
      </mesh>
    </group>
  );
}

function Warehouse3DScene({ graph, timeline, snapshot, mode }: Omit<
  Warehouse3DViewportProps,
  "accessibleLabel" | "fallback"
>) {
  const transform = useMemo(() => createWarehouse3DTransform(graph), [graph]);
  const color = ROUTE_COLORS[mode];

  return (
    <>
      <FixedComparisonCamera />
      <color attach="background" args={["#f7fafc"]} />
      <ambientLight intensity={1.2} />
      <directionalLight position={[8, 14, 10]} intensity={1.5} />
      <WarehouseFloor transform={transform} />
      <WarehouseRacks graph={graph} transform={transform} />
      <WarehouseLocations graph={graph} timeline={timeline} transform={transform} color={color} />
      <OfficeMarker graph={graph} transform={transform} />
      <RouteTrail graph={graph} timeline={timeline} transform={transform} color={color} />
      <WorkerMarker
        graph={graph}
        timeline={timeline}
        snapshot={snapshot}
        transform={transform}
        color={color}
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

  if (!webGLAvailable) {
    return <div className="warehouse-3d__fallback">{props.fallback}</div>;
  }

  return (
    <div className="warehouse-3d" data-warehouse-3d={props.mode}>
      <Canvas
        role="img"
        aria-label={props.accessibleLabel}
        aria-live="off"
        orthographic
        camera={{ position: [15, 19, 15], zoom: 10, near: 0.1, far: 100 }}
        dpr={[1, 1.5]}
        frameloop="demand"
        events={() => ({ enabled: false, priority: 1 })}
        fallback={<div className="warehouse-3d__fallback">{props.fallback}</div>}
        gl={{ antialias: true, alpha: false, powerPreference: "low-power" }}
      >
        <Warehouse3DScene
          graph={props.graph}
          timeline={props.timeline}
          snapshot={props.snapshot}
          mode={props.mode}
        />
      </Canvas>
    </div>
  );
}
