import type {
  CountServiceClass,
  CountServiceProfile,
  NodeId,
} from "../domain/types";

/** Synthetic portfolio-demo assumptions; these are not measured productivity standards. */
export const DEMO_COUNT_SERVICE_SECONDS: Readonly<Record<CountServiceClass, number>> = {
  simple: 20,
  standard: 35,
  complex: 60,
};

const SERVICE_CLASSES: readonly CountServiceClass[] = ["simple", "standard", "complex"];

function stableLocationOrdinal(locationId: NodeId): number {
  const canonicalLocation = /^loc-([A-Z])(\d{2})$/.exec(locationId);
  if (canonicalLocation) {
    return (canonicalLocation[1].charCodeAt(0) - 65) * 10
      + Math.max(0, Number(canonicalLocation[2]) - 1);
  }

  let hash = 0;
  for (let index = 0; index < locationId.length; index += 1) {
    hash = (Math.imul(hash, 31) + locationId.charCodeAt(index)) >>> 0;
  }
  return hash;
}

export function getDemoCountServiceProfile(locationId: NodeId): CountServiceProfile {
  const serviceClass = SERVICE_CLASSES[stableLocationOrdinal(locationId) % SERVICE_CLASSES.length];
  return {
    locationId,
    serviceClass,
    durationSeconds: DEMO_COUNT_SERVICE_SECONDS[serviceClass],
    source: "synthetic-demo",
  };
}

export function buildDemoCountServiceProfiles(
  locationIds: readonly NodeId[],
): ReadonlyMap<NodeId, CountServiceProfile> {
  return new Map(locationIds.map((locationId) => [
    locationId,
    getDemoCountServiceProfile(locationId),
  ]));
}
