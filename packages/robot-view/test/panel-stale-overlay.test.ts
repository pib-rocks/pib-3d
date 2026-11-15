import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { buildJointPanel } from '../src/joints/panel.js';
import { mappingByUrdfJoint, type JointMappingDocument } from '../src/joints/mapping.js';
import { SHADOW_HTML, SHADOW_STYLES } from '../src/element/template.js';
import type { MotionEntry, RobotModel } from '../src/types.js';

const repoRoot = resolve(import.meta.dirname, '../../..');
const mappingDoc = JSON.parse(
  readFileSync(resolve(repoRoot, 'joints/mapping.json'), 'utf8'),
) as JointMappingDocument;
const modelDoc = JSON.parse(
  readFileSync(resolve(repoRoot, 'web/model.json'), 'utf8'),
) as RobotModel;

function buildFullPanel() {
  const host = document.createElement('div');
  host.attachShadow({ mode: 'open' }).innerHTML =
    `<style>${SHADOW_STYLES}</style>${SHADOW_HTML}`;
  const root = host.shadowRoot!;
  const parentOf = new Map(modelDoc.joints.map((j) => [j.child, j.parent]));
  const motions: MotionEntry[] = modelDoc.joints.map((joint) => ({
    joint,
    motion: new THREE.Object3D(),
    axis: new THREE.Vector3(...joint.axis),
  }));
  const panel = buildJointPanel({
    root,
    model: modelDoc,
    parentOf,
    motions,
    mappingByJoint: mappingByUrdfJoint(mappingDoc),
    onJointChange: () => {},
    onRequestRender: () => {},
  });
  return { root, panel };
}

describe('stale-live overlay', () => {
  it('renders #live-stale outside #panel over the host root', () => {
    const { root } = buildFullPanel();
    const stale = root.querySelector('#live-stale');
    const panel = root.querySelector('#panel');
    const wrap = root.querySelector('#wrap');
    expect(stale).not.toBeNull();
    expect(panel).not.toBeNull();
    expect(wrap).not.toBeNull();
    expect(panel?.contains(stale)).toBe(false);
    expect(wrap?.contains(stale)).toBe(true);
  });

  it('styles #live-stale as an absolute non-interactive overlay', () => {
    expect(SHADOW_STYLES).toMatch(/#live-stale \{[\s\S]*?position: absolute/);
    expect(SHADOW_STYLES).toMatch(/#live-stale \{[\s\S]*?pointer-events: none/);
  });

  it('toggling setStaleBanner does not change the joint list DOM structure', () => {
    const { root, panel } = buildFullPanel();
    const joints = root.querySelector('#joints');
    const firstRow = joints?.querySelector('.j');
    expect(joints).not.toBeNull();
    expect(firstRow).not.toBeNull();

    const jointsBefore = joints!.innerHTML;
    const firstRowBefore = firstRow!.outerHTML;
    const staleMsg =
      'Live-Gelenkzustand veraltet — seit über 500 ms keine neuen Messwerte.';

    panel.setStaleBanner(true, staleMsg);
    expect(root.querySelector('#live-stale')?.textContent).toBe(staleMsg);
    expect(root.querySelector('#live-stale')?.classList.contains('on')).toBe(true);
    expect(joints!.innerHTML).toBe(jointsBefore);
    expect(firstRow!.outerHTML).toBe(firstRowBefore);

    panel.setStaleBanner(false);
    expect(root.querySelector('#live-stale')?.textContent).toBe('');
    expect(root.querySelector('#live-stale')?.classList.contains('on')).toBe(false);
    expect(joints!.innerHTML).toBe(jointsBefore);
    expect(firstRow!.outerHTML).toBe(firstRowBefore);
  });
});