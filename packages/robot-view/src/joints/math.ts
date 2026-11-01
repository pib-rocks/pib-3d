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
    const span = joint.limit
      ? [joint.limit.lower, joint.limit.upper]
      : null;
    const clamped = span ? Math.min(Math.max(v, span[0]!), span[1]!) : v;
    motion.position.copy(axis).multiplyScalar(clamped);
  } else {
    // A servo may travel further than the joint it drives: the cable-driven fingers use 360
    // degrees of servo for 90 degrees of joint, so the ends of the servo range are slack and the
    // finger rests on its stop. Without this clamp the model would fold past the CAD limit.
    const lower = joint.limit?.lower;
    const upper = joint.limit?.upper;
    const clamped =
      lower !== undefined && upper !== undefined
        ? Math.min(Math.max(v, Math.min(lower, upper)), Math.max(lower, upper))
        : v;
    motion.quaternion.setFromAxisAngle(axis, clamped);
  }
}
