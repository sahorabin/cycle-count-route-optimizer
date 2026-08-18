import { OrthographicCamera } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export interface WarehouseOrbitControlsOwner {
  readonly controls: OrbitControls;
  readonly isActive: () => boolean;
  readonly dispose: () => void;
}

export function createWarehouseOrbitControlsOwner(
  camera: OrthographicCamera,
  domElement: unknown,
): WarehouseOrbitControlsOwner | null {
  if (
    typeof HTMLCanvasElement === "undefined"
    || !(domElement instanceof HTMLCanvasElement)
    || !domElement.isConnected
  ) {
    return null;
  }

  const controls = new OrbitControls(camera);
  controls.connect(domElement);
  let active = true;

  return {
    controls,
    isActive: () => active,
    dispose: () => {
      if (!active) return;
      active = false;
      controls.dispose();
    },
  };
}
