import * as THREE from 'three';
import type { RobotModel } from '../types.js';

/** Frame-only URDF links have no baked mesh; the tree still needs a node for each joint endpoint. */
export function ensureFrameLinks(
  model: RobotModel,
  linkNodes: Map<string, THREE.Object3D>,
  partsOf: Map<string, string[]>,
): void {
  for (const joint of model.joints) {
    for (const name of [joint.parent, joint.child]) {
      if (linkNodes.has(name)) continue;
      const g = new THREE.Group();
      g.name = name;
      linkNodes.set(name, g);
      if (!partsOf.has(name)) partsOf.set(name, [name]);
    }
  }
}
