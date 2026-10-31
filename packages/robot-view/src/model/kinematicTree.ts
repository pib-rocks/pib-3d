import * as THREE from 'three';
import { rpyQuat } from '../joints/math.js';
import type { MotionEntry, RobotModel } from '../types.js';

export interface KinematicTree {
  parentOf: Map<string, string>;
  jointOfLink: Map<string, RobotModel['joints'][0]>;
  motions: MotionEntry[];
  rootLink: string;
}

export function buildKinematicTree(
  model: RobotModel,
  linkNodes: Map<string, THREE.Object3D>,
): KinematicTree {
  const parentOf = new Map<string, string>();
  const motions: MotionEntry[] = [];
  const jointOfLink = new Map<string, RobotModel['joints'][0]>();

  for (const joint of model.joints) {
    parentOf.set(joint.child, joint.parent);
    jointOfLink.set(joint.child, joint);
    const pivot = new THREE.Group();
    pivot.name = `pivot:${joint.name}`;
    pivot.position.fromArray(joint.origin.xyz);
    pivot.quaternion.copy(
      rpyQuat(joint.origin.rpy[0], joint.origin.rpy[1], joint.origin.rpy[2]),
    );
    const childNode = linkNodes.get(joint.child);
    const parentNode = linkNodes.get(joint.parent);
    if (!childNode || !parentNode) {
      throw new Error(`Missing link nodes for joint ${joint.name}`);
    }
    pivot.add(childNode);
    parentNode.add(pivot);

    const motion = childNode;
    const axis = new THREE.Vector3().fromArray(joint.axis).normalize();
    motions.push({ joint, motion, axis });
  }

  const rootLink = model.links.map((l) => l.name).find((n) => !parentOf.has(n));
  if (!rootLink) throw new Error('No root link found');

  return { parentOf, jointOfLink, motions, rootLink };
}

export function attachRootToScene(
  modelRoot: THREE.Group,
  linkNodes: Map<string, THREE.Object3D>,
  rootLink: string,
): void {
  const root = linkNodes.get(rootLink);
  if (!root) throw new Error(`Root link ${rootLink} not loaded`);
  modelRoot.add(root);
}
