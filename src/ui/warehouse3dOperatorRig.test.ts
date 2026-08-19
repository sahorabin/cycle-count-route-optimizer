/**
 * The runtime animation contract, exercised against a real three.js skinned rig
 * rather than a mock.
 *
 * The renderer samples poses with `action.time = t; setEffectiveWeight(w);
 * mixer.update(0)`. Earlier verification only ever asserted that `action.time`
 * changed, which is exactly the signal that stayed green while the visible
 * human did not move. These tests assert the things a viewer actually sees:
 * bone matrices, skinned vertex positions, and a root that never moves because
 * of animation.
 */
import {
  AnimationClip,
  AnimationMixer,
  Bone,
  BufferAttribute,
  CylinderGeometry,
  Matrix4,
  MeshStandardMaterial,
  QuaternionKeyframeTrack,
  Skeleton,
  SkinnedMesh,
  Vector3,
} from "three";
import { describe, expect, test } from "vitest";

/** A two-bone limb with a clip that swings it, i.e. the smallest real walk. */
function buildRig() {
  const geometry = new CylinderGeometry(0.1, 0.1, 2, 4, 4);
  const position = geometry.getAttribute("position");
  const skinIndex: number[] = [];
  const skinWeight: number[] = [];
  for (let i = 0; i < position.count; i += 1) {
    // Below the midpoint belongs to the lower bone, above to the upper one.
    const belongsToTip = position.getY(i) > 0;
    skinIndex.push(belongsToTip ? 1 : 0, 0, 0, 0);
    skinWeight.push(1, 0, 0, 0);
  }
  geometry.setAttribute("skinIndex", new BufferAttribute(new Uint16Array(skinIndex), 4));
  geometry.setAttribute("skinWeight", new BufferAttribute(new Float32Array(skinWeight), 4));

  const root = new Bone();
  const tip = new Bone();
  tip.position.y = 1;
  root.add(tip);
  root.name = "Root";
  tip.name = "Tip";

  const mesh = new SkinnedMesh(geometry, new MeshStandardMaterial());
  mesh.add(root);
  mesh.bind(new Skeleton([root, tip], [new Matrix4(), new Matrix4()]));

  // A one-second swing of the tip bone, keyed like a real locomotion track.
  const swing = new QuaternionKeyframeTrack(
    `${tip.name}.quaternion`,
    [0, 0.25, 0.5, 0.75, 1],
    [
      0, 0, 0, 1,
      0.3826834, 0, 0, 0.9238795,
      0, 0, 0, 1,
      -0.3826834, 0, 0, 0.9238795,
      0, 0, 0, 1,
    ],
  );
  const clip = new AnimationClip("ReferencePoseTest", 1, [swing]);

  const mixer = new AnimationMixer(mesh);
  const action = mixer.clipAction(clip);
  action.play();
  return { mesh, root, tip, mixer, action, clip };
}

/** Exactly the renderer's sampling call, so the test covers the real method. */
function sampleAt(rig: ReturnType<typeof buildRig>, time: number, weight = 1) {
  rig.action.time = time;
  rig.action.setEffectiveWeight(weight);
  rig.mixer.update(0);
  rig.mesh.updateMatrixWorld(true);
  rig.mesh.skeleton.update();
}

/** Where a skinned vertex actually ends up, which is what a viewer sees. */
function skinnedVertex(rig: ReturnType<typeof buildRig>, index: number): Vector3 {
  const point = new Vector3().fromBufferAttribute(rig.mesh.geometry.getAttribute("position"), index);
  rig.mesh.applyBoneTransform(index, point);
  return point.applyMatrix4(rig.mesh.matrixWorld);
}

/**
 * A vertex the swinging bone owns, chosen furthest from that bone's pivot --
 * the one whose movement a viewer would actually notice.
 */
function tipVertexIndex(rig: ReturnType<typeof buildRig>): number {
  const position = rig.mesh.geometry.getAttribute("position");
  let best = -1;
  for (let i = 0; i < position.count; i += 1) {
    const y = position.getY(i);
    if (y <= 0) continue;
    if (best === -1 || y < position.getY(best)) best = i;
  }
  return best;
}

const PHASES = [0, 0.25, 0.5, 0.75];

describe("operator rig sampling", () => {
  test("binds every clip track to a bone that exists", () => {
    const rig = buildRig();
    const names = new Set<string>();
    rig.mesh.traverse((object) => { if ((object as Bone).isBone) names.add(object.name); });

    for (const track of rig.clip.tracks) {
      const bone = track.name.split(".")[0];
      expect({ track: track.name, bound: names.has(bone) })
        .toEqual({ track: track.name, bound: true });
    }
  });

  test("moves bone matrices between gait phases, not just the action time", () => {
    const rig = buildRig();
    const poses = PHASES.map((phase) => {
      sampleAt(rig, phase * rig.clip.duration);
      return rig.tip.matrixWorld.elements.slice();
    });

    const differs = (a: number[], b: number[]) =>
      a.some((value, index) => Math.abs(value - b[index]) > 1e-4);

    expect(differs(poses[0], poses[1])).toBe(true);
    expect(differs(poses[1], poses[2])).toBe(true);
    expect(differs(poses[2], poses[3])).toBe(true);
    // Opposite phases swing opposite ways, which is what alternating gait is.
    expect(differs(poses[1], poses[3])).toBe(true);
  });

  test("moves the visible skinned vertices, not only the skeleton", () => {
    const rig = buildRig();
    const index = tipVertexIndex(rig);

    const points = PHASES.map((phase) => {
      sampleAt(rig, phase * rig.clip.duration);
      return skinnedVertex(rig, index);
    });

    // The rendered surface has to travel a real distance, not a rounding error.
    expect(points[0].distanceTo(points[1])).toBeGreaterThan(0.1);
    expect(points[1].distanceTo(points[3])).toBeGreaterThan(0.2);
  });

  test("leaves the root transform untouched: position truth is not animation", () => {
    const rig = buildRig();
    const roots = PHASES.map((phase) => {
      sampleAt(rig, phase * rig.clip.duration);
      return rig.mesh.matrixWorld.elements.slice();
    });

    // Same root at every phase, while the limbs demonstrably moved above.
    for (const root of roots) expect(root).toEqual(roots[0]);
  });

  test("reproduces a pose exactly, forwards or backwards", () => {
    const rig = buildRig();
    const index = tipVertexIndex(rig);
    const at = (phase: number) => {
      sampleAt(rig, phase * rig.clip.duration);
      return skinnedVertex(rig, index).toArray();
    };

    const forward = [0, 0.25, 0.5, 0.75].map(at);
    const backward = [0.75, 0.5, 0.25, 0].map(at);

    expect(backward).toEqual([...forward].reverse());
    // And again after wandering elsewhere: no hidden accumulator.
    at(0.4);
    expect(at(0.25)).toEqual(forward[1]);
  });

  test("stops deforming when the clip is weighted out", () => {
    const rig = buildRig();
    const index = tipVertexIndex(rig);

    sampleAt(rig, 0.25 * rig.clip.duration, 0);
    const idle = skinnedVertex(rig, index);
    sampleAt(rig, 0.25 * rig.clip.duration, 1);
    const walking = skinnedVertex(rig, index);

    // Service weights the walk to zero; the limb must actually settle.
    expect(idle.distanceTo(walking)).toBeGreaterThan(0.1);
  });

  test("keeps two rigs independent, as Compare's two viewports need", () => {
    const left = buildRig();
    const right = buildRig();

    sampleAt(left, 0.25 * left.clip.duration);
    sampleAt(right, 0.75 * right.clip.duration);

    const index = tipVertexIndex(left);
    expect(skinnedVertex(left, index).toArray())
      .not.toEqual(skinnedVertex(right, index).toArray());
  });
});
