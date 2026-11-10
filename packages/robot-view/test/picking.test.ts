import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  highlightLinkMeshes,
  resolveSelectableLink,
} from '../src/interaction/picking.js';
import type { RobotModel } from '../src/types.js';

function meshWithLink(link: string): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(),
    new THREE.MeshStandardMaterial({ emissive: new THREE.Color(0x000000), emissiveIntensity: 0 }),
  );
  mesh.userData.link = link;
  return mesh;
}

describe('highlightLinkMeshes', () => {
  it('does not highlight child link meshes nested under the parent node', () => {
    const parent = new THREE.Group();
    parent.add(meshWithLink('shoulder'));
    const pivot = new THREE.Group();
    pivot.add(meshWithLink('upper_arm'));
    parent.add(pivot);

    const originals = new Map<THREE.Material, { color: number | null; intensity: number }>();
    highlightLinkMeshes(parent, 'shoulder', true, originals);

    const shoulderMat = (parent.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial;
    const childMat = (pivot.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial;
    expect(shoulderMat.emissive.getHex()).toBe(0x1f6feb);
    expect(childMat.emissive.getHex()).toBe(0x000000);
  });
});

describe('resolveSelectableLink', () => {
  const joint = {
    name: 'j_shoulder',
    parent: 'torso',
    child: 'shoulder',
    origin: { xyz: [0, 0, 0], rpy: [0, 0, 0] },
    axis: [0, 1, 0],
  } as RobotModel['joints'][0];

  const parentOf = new Map([['shoulder', 'torso'], ['upper_arm', 'shoulder']]);
  const jointOfLink = new Map([['shoulder', joint]]);

  it('returns null for structural root without a controllable joint', () => {
    expect(resolveSelectableLink('root', parentOf, jointOfLink)).toBeNull();
  });

  it('walks ancestors to the link that owns the joint', () => {
    const hit = resolveSelectableLink('upper_arm', parentOf, jointOfLink);
    expect(hit).toEqual({ link: 'shoulder', joint });
  });
});
