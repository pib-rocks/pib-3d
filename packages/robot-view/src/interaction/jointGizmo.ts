import * as THREE from 'three';
import type { ModelJoint, MotionEntry } from '../types.js';

const AXIS_COLOR = 0x7aa2f7;
const ARC_COLOR = 0xffb454;
const ARC_ACCENT = 0x7aa2f7;
const ARC_RADIUS_M = 0.055;
const ARC_SEGMENTS = 32;
const AXIS_HALF_LEN = 0.09;

function basisPerpendicularTo(axis: THREE.Vector3): { u: THREE.Vector3; v: THREE.Vector3 } {
  const u = new THREE.Vector3();
  if (Math.abs(axis.x) < 0.9) u.set(1, 0, 0);
  else u.set(0, 1, 0);
  u.cross(axis).normalize();
  const v = new THREE.Vector3().crossVectors(axis, u).normalize();
  return { u, v };
}

function arcPoints(
  axis: THREE.Vector3,
  lower: number,
  upper: number,
  radius: number,
  segments: number,
): THREE.Vector3[] {
  const { u, v } = basisPerpendicularTo(axis);
  const out: THREE.Vector3[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = lower + ((upper - lower) * i) / segments;
    const c = Math.cos(t);
    const s = Math.sin(t);
    out.push(
      new THREE.Vector3()
        .copy(u)
        .multiplyScalar(radius * c)
        .addScaledVector(v, radius * s),
    );
  }
  return out;
}

function tickAt(
  axis: THREE.Vector3,
  angle: number,
  radius: number,
  length: number,
): THREE.Vector3[] {
  const { u, v } = basisPerpendicularTo(axis);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const onArc = new THREE.Vector3()
    .copy(u)
    .multiplyScalar(radius * c)
    .addScaledVector(v, radius * s);
  const outward = new THREE.Vector3()
    .copy(u)
    .multiplyScalar(c)
    .addScaledVector(v, s)
    .normalize()
    .multiplyScalar(length);
  return [onArc.clone(), onArc.clone().add(outward)];
}

export function attachJointGizmo(
  entry: MotionEntry,
  scene: THREE.Scene,
): THREE.Group {
  const { joint, motion } = entry;
  const axis = new THREE.Vector3(joint.axis[0], joint.axis[1], joint.axis[2]).normalize();
  const lower = joint.limit?.lower ?? -Math.PI;
  const upper = joint.limit?.upper ?? Math.PI;

  const group = new THREE.Group();
  group.name = 'joint-gizmo';

  const axisGeom = new THREE.BufferGeometry().setFromPoints([
    axis.clone().multiplyScalar(-AXIS_HALF_LEN),
    axis.clone().multiplyScalar(AXIS_HALF_LEN),
  ]);
  const axisLine = new THREE.Line(
    axisGeom,
    new THREE.LineBasicMaterial({ color: AXIS_COLOR, depthTest: false }),
  );
  axisLine.renderOrder = 12;
  group.add(axisLine);

  const arcGeom = new THREE.BufferGeometry().setFromPoints(
    arcPoints(axis, lower, upper, ARC_RADIUS_M, ARC_SEGMENTS),
  );
  const arcLine = new THREE.Line(
    arcGeom,
    new THREE.LineBasicMaterial({ color: ARC_COLOR, depthTest: false }),
  );
  arcLine.renderOrder = 12;
  group.add(arcLine);

  for (const angle of [lower, upper]) {
    const tickGeom = new THREE.BufferGeometry().setFromPoints(
      tickAt(axis, angle, ARC_RADIUS_M, 0.012),
    );
    const tick = new THREE.Line(
      tickGeom,
      new THREE.LineBasicMaterial({ color: ARC_ACCENT, depthTest: false }),
    );
    tick.renderOrder = 12;
    group.add(tick);
  }

  const parent = motion.parent ?? scene;
  parent.add(group);
  group.position.copy(motion.position);
  group.quaternion.copy(motion.quaternion);
  return group;
}

export function disposeJointGizmo(gizmo: THREE.Group | null): void {
  if (!gizmo) return;
  gizmo.parent?.remove(gizmo);
  gizmo.traverse((obj) => {
    const line = obj as THREE.Line;
    if (!line.isLine) return;
    line.geometry?.dispose();
    const mat = line.material;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else mat?.dispose();
  });
}
