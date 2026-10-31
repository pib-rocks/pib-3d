import * as THREE from 'three';
import type { ModelJoint } from '../types.js';

/** Fixed RPY (roll, pitch, yaw) to quaternion — same order as the legacy viewer. */
export function rpyQuat(r: number, p: number, y: number): THREE.Quaternion {
  const m = new THREE.Matrix4()
    .multiply(new THREE.Matrix4().makeRotationZ(y))
    .multiply(new THREE.Matrix4().makeRotationY(p))
    .multiply(new THREE.Matrix4().makeRotationX(r));
  return new THREE.Quaternion().setFromRotationMatrix(m);
}

export function uiRange(joint: ModelJoint): [number, number] {
  if (joint.type === 'prismatic') return [-80, 80];
  if (!joint.limit) return [-180, 180];
  return [
    Math.round(THREE.MathUtils.radToDeg(joint.limit.lower)),
    Math.round(THREE.MathUtils.radToDeg(joint.limit.upper)),
  ];
}

export function fromUi(joint: ModelJoint, ui: number): number {
  return joint.type === 'prismatic' ? ui / 1000 : THREE.MathUtils.degToRad(ui);
}

export function toUi(joint: ModelJoint, v: number): number {
  return joint.type === 'prismatic' ? v * 1000 : THREE.MathUtils.radToDeg(v);
}

export function formatJointLabel(joint: ModelJoint, v: number): string {
  return joint.type === 'prismatic'
    ? `${(v * 1000).toFixed(1)} mm`
    : `${THREE.MathUtils.radToDeg(v).toFixed(0)}°`;
}

export function prettyJointName(name: string): string {
  return name
    .replace(/_hinge$/, '')
    .replace(/_/g, ' ')
    .replace(/\b(\w)/g, (c) => c.toUpperCase());
}

export function applyJointValue(
  joint: ModelJoint,
  motion: THREE.Object3D,
  axis: THREE.Vector3,
  v: number,
): void {
  if (joint.type === 'prismatic') {
    motion.position.copy(axis).multiplyScalar(v);
  } else {
    motion.quaternion.setFromAxisAngle(axis, v);
  }
}
