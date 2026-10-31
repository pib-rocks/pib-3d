import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  rpyQuat,
  fromUi,
  toUi,
  applyJointValue,
  uiRange,
} from '../src/joints/math.js';
import type { ModelJoint } from '../src/types.js';

describe('rpyQuat', () => {
  it('matches fixed RPY order (Z * Y * X)', () => {
    const q = rpyQuat(0.1, 0.2, 0.3);
    const m = new THREE.Matrix4()
      .multiply(new THREE.Matrix4().makeRotationZ(0.3))
      .multiply(new THREE.Matrix4().makeRotationY(0.2))
      .multiply(new THREE.Matrix4().makeRotationX(0.1));
    const expected = new THREE.Quaternion().setFromRotationMatrix(m);
    expect(q.x).toBeCloseTo(expected.x, 5);
    expect(q.y).toBeCloseTo(expected.y, 5);
    expect(q.z).toBeCloseTo(expected.z, 5);
    expect(q.w).toBeCloseTo(expected.w, 5);
  });
});

describe('rad/deg UI conversion', () => {
  const revolute: ModelJoint = {
    name: 'j1',
    type: 'revolute',
    parent: 'a',
    child: 'b',
    origin: { xyz: [0, 0, 0], rpy: [0, 0, 0] },
    axis: [0, 0, 1],
    limit: { lower: -1, upper: 1 },
  };
  const prismatic: ModelJoint = {
    ...revolute,
    name: 'p1',
    type: 'prismatic',
    limit: undefined,
  };

  it('converts revolute deg ↔ rad', () => {
    const ui = toUi(revolute, Math.PI / 2);
    expect(ui).toBeCloseTo(90, 5);
    expect(fromUi(revolute, 90)).toBeCloseTo(Math.PI / 2, 5);
  });

  it('converts prismatic mm ↔ m', () => {
    expect(fromUi(prismatic, 12.5)).toBeCloseTo(0.0125, 6);
    expect(toUi(prismatic, 0.0125)).toBeCloseTo(12.5, 5);
  });

  it('uiRange uses degrees for revolute', () => {
    const [lo, hi] = uiRange(revolute);
    expect(lo).toBe(Math.round(THREE.MathUtils.radToDeg(-1)));
    expect(hi).toBe(Math.round(THREE.MathUtils.radToDeg(1)));
  });
});

describe('applyJointValue', () => {
  it('rotates revolute/continuous about axis', () => {
    const joint: ModelJoint = {
      name: 'r',
      type: 'continuous',
      parent: 'a',
      child: 'b',
      origin: { xyz: [0, 0, 0], rpy: [0, 0, 0] },
      axis: [0, 0, 1],
    };
    const motion = new THREE.Object3D();
    const axis = new THREE.Vector3(0, 0, 1);
    applyJointValue(joint, motion, axis, Math.PI / 2);
    const euler = new THREE.Euler().setFromQuaternion(motion.quaternion);
    expect(euler.z).toBeCloseTo(Math.PI / 2, 4);
  });

  it('translates prismatic along axis', () => {
    const joint: ModelJoint = {
      name: 'p',
      type: 'prismatic',
      parent: 'a',
      child: 'b',
      origin: { xyz: [0, 0, 0], rpy: [0, 0, 0] },
      axis: [1, 0, 0],
    };
    const motion = new THREE.Object3D();
    const axis = new THREE.Vector3(1, 0, 0);
    applyJointValue(joint, motion, axis, 0.05);
    expect(motion.position.x).toBeCloseTo(0.05, 6);
  });
});
