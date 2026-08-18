import { describe, expect, test } from "vitest";
import { largeWarehouse } from "../data/largeWarehouse";
import { sampleWarehouse } from "../data/sampleWarehouse";
import { computeRackRects, computeWarehouseAisleRects } from "./rackLayout";
import { createWarehouse3DTransform, projectDisplayPointToWarehouse3D } from "./warehouse3dProjection";
import {
  buildWarehouse3DEnvironment,
  getWarehouseEnvironmentDetailLevel,
  getWarehouseEnvironmentRenderSet,
  WAREHOUSE_3D_ENVIRONMENT,
  type WarehouseEnvironmentBoxVisual,
  type WarehouseRackFootprint,
} from "./warehouse3dEnvironment";

function expectBoxInsideFootprint(
  visual: WarehouseEnvironmentBoxVisual,
  footprint: WarehouseRackFootprint,
): void {
  const [x, , z] = visual.center;
  const [width, , depth] = visual.size;
  expect(x - width / 2).toBeGreaterThanOrEqual(footprint.minX - 1e-9);
  expect(x + width / 2).toBeLessThanOrEqual(footprint.maxX + 1e-9);
  expect(z - depth / 2).toBeGreaterThanOrEqual(footprint.minZ - 1e-9);
  expect(z + depth / 2).toBeLessThanOrEqual(footprint.maxZ + 1e-9);
}

function allNumbers(value: unknown): number[] {
  if (typeof value === "number") return [value];
  if (Array.isArray(value)) return value.flatMap(allNumbers);
  if (value && typeof value === "object") {
    return Object.values(value).flatMap(allNumbers);
  }
  return [];
}

describe("warehouse3dEnvironment", () => {
  test("builds identical environment descriptors for the same warehouse", () => {
    const transform = createWarehouse3DTransform(largeWarehouse);
    const first = buildWarehouse3DEnvironment(largeWarehouse, transform);
    const second = buildWarehouse3DEnvironment(largeWarehouse, transform);

    expect(second).toEqual(first);
    expect(first.racks.length).toBe(
      computeRackRects(largeWarehouse.aisleNodes, 10, largeWarehouse.spatialLayout).length * 2,
    );
    expect(first.racks.every((rack) => rack.overviewMembers.length > 0)).toBe(true);
    expect(first.racks.every((rack) => rack.closeMembers.length > 0)).toBe(true);
  });

  test("preserves both halves of every existing rack footprint", () => {
    const transform = createWarehouse3DTransform(largeWarehouse);
    const environment = buildWarehouse3DEnvironment(largeWarehouse, transform);
    const expectedFootprints = computeRackRects(
      largeWarehouse.aisleNodes,
      10,
      largeWarehouse.spatialLayout,
    ).flatMap((rect) => {
      const rackWidth = (rect.width - largeWarehouse.spatialLayout!.localAisleSpacing) / 2;
      return [rect.x, rect.x + rect.width - rackWidth].map((x) => {
        const first = projectDisplayPointToWarehouse3D({ x, y: rect.y }, transform);
        const second = projectDisplayPointToWarehouse3D({
          x: x + rackWidth,
          y: rect.y + rect.height,
        }, transform);
        return {
          minX: Math.min(first.x, second.x),
          maxX: Math.max(first.x, second.x),
          minZ: Math.min(first.z, second.z),
          maxZ: Math.max(first.z, second.z),
        };
      });
    });

    expect(environment.racks.map((rack) => rack.footprint)).toEqual(expectedFootprints);
    environment.racks.forEach((rack) => {
      [...rack.overviewMembers, ...rack.closeMembers].forEach((member) => {
        expectBoxInsideFootprint(member, rack.footprint);
      });
    });
  });

  test("uses deterministic decorative shelf levels and bounded rack structures", () => {
    const environment = buildWarehouse3DEnvironment(
      sampleWarehouse,
      createWarehouse3DTransform(sampleWarehouse),
    );

    environment.racks.forEach((rack) => {
      expect(rack.shelfLevels).toEqual([...WAREHOUSE_3D_ENVIRONMENT.shelfLevels]);
      const uprights = [...rack.overviewMembers, ...rack.closeMembers]
        .filter((member) => member.kind === "rack-upright");
      const beams = [...rack.overviewMembers, ...rack.closeMembers]
        .filter((member) => member.kind === "rack-beam");
      const shelves = rack.closeMembers.filter((member) => member.kind === "rack-shelf");
      expect(uprights.length).toBeGreaterThan(0);
      expect(beams.length).toBeGreaterThan(0);
      expect(shelves.length).toBeGreaterThan(0);
      expect(uprights.every((member) => member.size[1] === WAREHOUSE_3D_ENVIRONMENT.rackHeight))
        .toBe(true);
      [...uprights, ...beams, ...shelves].forEach((member) => {
        expectBoxInsideFootprint(member, rack.footprint);
      });
    });
  });

  test("creates a stable sparse pallet and carton distribution independent of route state", () => {
    const transform = createWarehouse3DTransform(largeWarehouse);
    const workerEnvironment = buildWarehouse3DEnvironment(largeWarehouse, transform);
    const recommendedEnvironment = buildWarehouse3DEnvironment(largeWarehouse, transform);

    expect(workerEnvironment.props).toEqual(recommendedEnvironment.props);
    expect(workerEnvironment.props.some((prop) => prop.kind === "pallet")).toBe(true);
    expect(workerEnvironment.props.some((prop) => prop.kind === "carton")).toBe(true);
    expect(workerEnvironment.props.length).toBeGreaterThan(0);
    expect(workerEnvironment.props.length).toBeLessThan(
      workerEnvironment.racks.length
        * WAREHOUSE_3D_ENVIRONMENT.maximumBayCount
        * WAREHOUSE_3D_ENVIRONMENT.shelfLevels.length
        * 2,
    );
    const stored = workerEnvironment.props.filter((prop) => prop.rackId !== "staging");
    const staged = workerEnvironment.props.filter((prop) => prop.rackId === "staging");

    for (const prop of stored) {
      const rack = workerEnvironment.racks.find(({ id }) => id === prop.rackId);
      expect(rack).toBeDefined();
      expectBoxInsideFootprint(prop, rack!.footprint);
    }
    // Staged floor loads are decorative envelope props: on the deck, never in a rack.
    expect(staged.length).toBeGreaterThan(0);
    for (const prop of staged) {
      expect(workerEnvironment.racks.some(({ id }) => id === prop.rackId)).toBe(false);
      expect(prop.center[1]).toBeGreaterThan(0);
      expect(prop.center[1]).toBeLessThan(WAREHOUSE_3D_ENVIRONMENT.shelfLevels[0]);
    }
  });

  test("does not mutate warehouse or transform inputs", () => {
    const transform = createWarehouse3DTransform(largeWarehouse);
    const graphBefore = JSON.stringify(largeWarehouse);
    const transformBefore = JSON.stringify(transform);

    buildWarehouse3DEnvironment(largeWarehouse, transform);

    expect(JSON.stringify(largeWarehouse)).toBe(graphBefore);
    expect(JSON.stringify(transform)).toBe(transformBefore);
  });

  test("uses deterministic camera detail decisions without route or simulation inputs", () => {
    const environment = buildWarehouse3DEnvironment(
      largeWarehouse,
      createWarehouse3DTransform(largeWarehouse),
    );
    const overview = getWarehouseEnvironmentRenderSet(environment, "overview");
    const close = getWarehouseEnvironmentRenderSet(environment, "close");

    expect(getWarehouseEnvironmentRenderSet(environment, "overview")).toEqual(overview);
    expect(getWarehouseEnvironmentRenderSet(environment, "close")).toEqual(close);
    expect(close.rackMembers.length).toBeGreaterThan(overview.rackMembers.length);
    expect(close.storageProps.length).toBeGreaterThan(overview.storageProps.length);
    expect(close.storageProps).toEqual(environment.props);
    expect(getWarehouseEnvironmentDetailLevel("overview", "overview")).toBe("overview");
    expect(getWarehouseEnvironmentDetailLevel("overview", "top")).toBe("overview");
    expect(getWarehouseEnvironmentDetailLevel("overview", "aisle")).toBe("close");
    expect(getWarehouseEnvironmentDetailLevel("overview", "worker")).toBe("close");
    expect(getWarehouseEnvironmentDetailLevel("close", "overview")).toBe("close");
  });

  test("generates neutral aisle organization and a partial warehouse shell", () => {
    const environment = buildWarehouse3DEnvironment(
      largeWarehouse,
      createWarehouse3DTransform(largeWarehouse),
    );

    const sharedAisles = computeWarehouseAisleRects(
      largeWarehouse.aisleNodes,
      largeWarehouse.spatialLayout,
    );
    expect(environment.aisles).toHaveLength(sharedAisles.length);
    expect(environment.aisles.map(({ category }) => category))
      .toEqual(sharedAisles.map(({ category }) => category));
    expect(environment.aisles.filter(({ category }) => category === "local")).toHaveLength(30);
    expect(environment.aisles.filter(({ category }) => category === "internal-cross")).toHaveLength(4);
    expect(environment.aisles.filter(({ category }) => category === "block-separation")).toHaveLength(1);
    expect(environment.aisles.every((aisle) => aisle.id.startsWith("lane-"))).toBe(true);
    expect(environment.aisles.every((aisle) => aisle.markings.length >= 2)).toBe(true);
    expect(environment.boundary.walls).toHaveLength(3);
    expect(environment.boundary.columns.length).toBeGreaterThan(0);
    expect(environment.boundary.overheadFixtures.length).toBeGreaterThan(0);
  });

  test("keeps every physical rack footprint out of shared aisle floor space", () => {
    const environment = buildWarehouse3DEnvironment(
      largeWarehouse,
      createWarehouse3DTransform(largeWarehouse),
    );

    for (const rack of environment.racks) {
      for (const aisle of environment.aisles) {
        const [x, , z] = aisle.zone.center;
        const [width, , depth] = aisle.zone.size;
        const overlapX = Math.min(rack.footprint.maxX, x + width / 2)
          - Math.max(rack.footprint.minX, x - width / 2);
        const overlapZ = Math.min(rack.footprint.maxZ, z + depth / 2)
          - Math.max(rack.footprint.minZ, z - depth / 2);
        expect(overlapX > 1e-9 && overlapZ > 1e-9).toBe(false);
      }
    }
  });

  test("never generates NaN or infinite environment coordinates", () => {
    const environment = buildWarehouse3DEnvironment(
      largeWarehouse,
      createWarehouse3DTransform(largeWarehouse),
    );
    const numbers = allNumbers(environment);

    expect(numbers.length).toBeGreaterThan(0);
    expect(numbers.every(Number.isFinite)).toBe(true);
    expect(numbers.every((number) => !Number.isNaN(number))).toBe(true);
  });
});
