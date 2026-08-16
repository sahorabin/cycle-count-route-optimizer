import { Canvas, useThree } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { OrthographicCamera } from "three";
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
    <mesh key={index} position={[rack.center.x, 0.62, rack.center.z]}>
      <boxGeometry args={[rack.width, 1.24, rack.depth]} />
      <meshStandardMaterial color="#526577" roughness={0.8} />
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

  return locations.map(({ id, point, selected }) => (
    <mesh key={id} position={[point.x, selected ? 0.22 : 0.11, point.z]}>
      <sphereGeometry args={[selected ? 0.18 : 0.09, 8, 6]} />
      <meshStandardMaterial color={selected ? color : "#a8b5bf"} roughness={0.75} />
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

function RouteTrail({ graph, timeline, transform, color }: {
  graph: WarehouseGraph;
  timeline: RouteTimeline;
  transform: Warehouse3DTransform;
  color: string;
}) {
  const positions = useMemo(() => {
    const values: number[] = [];
    for (const leg of timeline.legs) {
      for (const segment of leg.segments) {
        const from = projectNodeToWarehouse3D(graph, segment.from, transform);
        const to = projectNodeToWarehouse3D(graph, segment.to, transform);
        values.push(from.x, 0.09, from.z, to.x, 0.09, to.z);
      }
    }
    return new Float32Array(values);
  }, [graph, timeline, transform]);

  return (
    <lineSegments>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <lineBasicMaterial color={color} linewidth={2} />
    </lineSegments>
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
    <group position={[marker.x, 0.08, marker.z]}>
      <mesh position={[0, 0.3, 0]}>
        <cylinderGeometry args={[0.16, 0.2, 0.5, 10]} />
        <meshStandardMaterial color={color} roughness={0.55} />
      </mesh>
      <mesh position={[0, 0.67, 0]}>
        <sphereGeometry args={[0.16, 10, 8]} />
        <meshStandardMaterial color="#f4c7a1" roughness={0.7} />
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
