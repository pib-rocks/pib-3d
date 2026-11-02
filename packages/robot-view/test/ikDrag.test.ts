import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  clampDeltaRad,
  IkClient,
  pointerPlanePoint,
  toModelAngles,
  type IkAnswer,
} from '../src/interaction/ikDrag.js';

describe('clampDeltaRad', () => {
  it('passes a small step through unchanged', () => {
    expect(clampDeltaRad([0, 0], [0.01, 0.02], 1.0, 0.1)).toEqual([0.01, 0.02]);
  });

  it('caps a fast drag at the velocity budget', () => {
    // 1 rad/s for 0.1 s is 0.1 rad of travel.
    expect(clampDeltaRad([0, 0], [0.5, -0.5], 1.0, 0.1)).toEqual([0.1, -0.1]);
  });

  it('uses the previous value as the base when the joint is new', () => {
    expect(clampDeltaRad([], [0.3], 1.0, 0.1)).toEqual([0.3]);
  });
});

describe('pointerPlanePoint', () => {
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.set(0, 0, 5);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);

  it('maps the screen centre onto the anchor on a camera-facing plane', () => {
    const anchor = new THREE.Vector3(0, 0, 0);
    const normal = new THREE.Vector3(0, 0, 1);
    const hit = pointerPlanePoint(camera, { x: 0, y: 0 }, anchor, normal);
    expect(hit).not.toBeNull();
    expect(hit!.x).toBeCloseTo(0, 6);
    expect(hit!.y).toBeCloseTo(0, 6);
    expect(hit!.z).toBeCloseTo(0, 6);
  });

  it('moves the point with the pointer', () => {
    const anchor = new THREE.Vector3(0, 0, 0);
    const normal = new THREE.Vector3(0, 0, 1);
    const right = pointerPlanePoint(camera, { x: 0.5, y: 0 }, anchor, normal)!;
    const up = pointerPlanePoint(camera, { x: 0, y: 0.5 }, anchor, normal)!;
    expect(right.x).toBeGreaterThan(0);
    expect(up.y).toBeGreaterThan(0);
  });
});

describe('toModelAngles', () => {
  const entries = [
    { motor: 'shoulder_vertical_right', urdfJoint: 'rotation_inner_shoulder_1', direction: -1, gearRatio: 1 },
    { motor: 'elbow_right', urdfJoint: 'rotation_elbow_1', direction: 1, gearRatio: 2 },
  ];

  it('applies the mapping direction and the gear ratio', () => {
    const angles = toModelAngles(
      [0.4, 0.6],
      entries,
      ['shoulder_vertical_right', 'elbow_right'],
    );
    expect(angles['rotation_inner_shoulder_1']).toBeCloseTo(-0.4, 9);
    expect(angles['rotation_elbow_1']).toBeCloseTo(0.3, 9);
  });

  it('applies sdkSign where the servo turns against the CAD axis', () => {
    const sign = [
      { motor: 'upper_arm_left_rotation', urdfJoint: 'central_rotator_rotation_1', direction: -1, gearRatio: 1, sdkSign: -1 },
    ];
    const angles = toModelAngles([0.4], sign, ['upper_arm_left']);
    // motor = sdkSign * sdk = -0.4, model = direction * motor = +0.4
    expect(angles['central_rotator_rotation_1']).toBeCloseTo(0.4, 9);
  });

  it('ignores motors the mapping does not know', () => {
    const angles = toModelAngles([0.4], entries, ['unknown_motor']);
    expect(angles).toEqual({});
  });
});

describe('IkClient', () => {
  function deferredFetch() {
    const calls: Array<{ body: string; resolve: (answer: IkAnswer) => void }> = [];
    const impl = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise((resolve) => {
        calls.push({
          body: String(init?.body ?? ''),
          resolve: (answer: IkAnswer) =>
            resolve({ ok: true, status: 200, json: async () => answer } as Response),
        });
      });
    });
    return { impl: impl as unknown as typeof fetch, calls };
  }

  const answer: IkAnswer = {
    jointNames: ['a'],
    jointsRad: [0],
    reach: { ok: true, distanceMm: 0, blockedBy: null },
  };

  it('keeps one request in flight and sends only the newest target afterwards', async () => {
    const { impl, calls } = deferredFetch();
    const onAnswer = vi.fn();
    const client = new IkClient('/ik', onAnswer, () => {}, impl);

    client.request({ side: 'right', xyzM: [1, 0, 0], seedRad: null });
    client.request({ side: 'right', xyzM: [2, 0, 0], seedRad: null });
    client.request({ side: 'right', xyzM: [3, 0, 0], seedRad: null });

    expect(calls).toHaveLength(1);

    calls[0]!.resolve(answer);
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    expect(JSON.parse(calls[1]!.body).xyzM).toEqual([3, 0, 0]);

    calls[1]!.resolve(answer);
    await vi.waitFor(() => expect(onAnswer).toHaveBeenCalledTimes(2));
    expect(calls).toHaveLength(2);
  });

  it('reports a timeout as a failure without throwing', async () => {
    const onFailure = vi.fn();
    const impl = vi.fn(() => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      return Promise.reject(error);
    }) as unknown as typeof fetch;
    const client = new IkClient('/ik', () => {}, onFailure, impl, 5);
    client.request({ side: 'left', xyzM: [0, 0, 1], seedRad: null });
    await vi.waitFor(() => expect(onFailure).toHaveBeenCalled());
    expect(onFailure.mock.calls[0]![0]).toMatch(/did not answer/);
  });
});

describe('seedFromModel', () => {
  it('round trips through toModelAngles', async () => {
    const { seedFromModel, SDK_ARM_JOINTS } = await import('../src/interaction/ikDrag.js');
    const entries = SDK_ARM_JOINTS.right.map((sdkName, index) => ({
      motor: sdkName.replace('upper_arm_right', 'upper_arm_right_rotation').replace('forearm_right', 'lower_arm_right_rotation'),
      urdfJoint: `joint_${index}`,
      direction: index % 2 === 0 ? -1 : 1,
      gearRatio: 1,
    }));
    const model = Object.fromEntries(entries.map((entry, index) => [entry.urdfJoint, 0.1 * (index + 1)]));
    const seed = seedFromModel(model, entries, 'right')!;
    const back = toModelAngles(seed, entries, SDK_ARM_JOINTS.right);
    for (const entry of entries) expect(back[entry.urdfJoint]).toBeCloseTo(model[entry.urdfJoint]!, 9);
  });
});
