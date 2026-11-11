import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { attachJointGizmo, disposeJointGizmo } from '../src/interaction/jointGizmo.js';
import type { ModelJoint, MotionEntry } from '../src/types.js';

function sampleEntry(): MotionEntry {
  const joint: ModelJoint = {
    name: 'rotation_elbow',
    type: 'revolute',
    parent: 'upper_arm',
    child: 'lower_arm',
    origin: { xyz: [0, 0, 0], rpy: [0, 0, 0] },
    axis: [0, 1, 0],
    limit: { lower: -Math.PI / 2, upper: Math.PI / 2 },
  };
  const parent = new THREE.Group();
  const motion = new THREE.Group();
  motion.position.set(0.1, 0.2, 0);
  parent.add(motion);
  return { joint, motion, axis: new THREE.Vector3(0, 1, 0) };
}

describe('attachJointGizmo', () => {
  it('adds axis and arc lines at the joint pivot', () => {
    const scene = new THREE.Scene();
    const entry = sampleEntry();
    const gizmo = attachJointGizmo(entry, scene);
    expect(gizmo.name).toBe('joint-gizmo');
    const lines = gizmo.children.filter((c) => (c as THREE.Line).isLine);
    expect(lines.length).toBeGreaterThanOrEqual(3);
    disposeJointGizmo(gizmo);
    expect(entry.motion.parent?.children.includes(gizmo)).toBe(false);
  });
});
