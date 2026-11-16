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

describe('canvas notice overlays', () => {
  it('renders every notice outside #panel, inside the host root', () => {
    const { root } = buildFullPanel();
    const panel = root.querySelector('#panel');
    const wrap = root.querySelector('#wrap');
    expect(panel).not.toBeNull();
    expect(wrap).not.toBeNull();
    for (const id of ['#live-stale', '#guard', '#consistency']) {
      const el = root.querySelector(id);
      expect(el, id).not.toBeNull();
      expect(panel?.contains(el), id).toBe(false);
      expect(wrap?.contains(el), id).toBe(true);
    }
  });

  it('stacks the notices in an absolutely positioned, non-interactive container', () => {
    expect(SHADOW_STYLES).toMatch(/#notices \{[\s\S]*?position: absolute/);
    expect(SHADOW_STYLES).toMatch(/#notices \{[\s\S]*?pointer-events: none/);
    expect(SHADOW_STYLES).toMatch(/#notices > div \{[\s\S]*?display: none/);
    expect(SHADOW_STYLES).toMatch(/#notices > div\.on \{ display: block; \}/);
  });

  it('keeps the joint list untouched while a notice toggles', () => {
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

  it('keeps the joint list untouched while guard and consistency toggle', () => {
    const { root } = buildFullPanel();
    const joints = root.querySelector('#joints');
    const jointsBefore = joints!.innerHTML;

    for (const id of ['#guard', '#consistency']) {
      const el = root.querySelector(id) as HTMLElement;
      el.textContent = 'Befehlsmodus gesperrt: Mapping ungültig. Der Viewer bleibt in der Vorschau.';
      el.classList.add('on');
      expect(el.classList.contains('on'), id).toBe(true);
      expect(joints!.innerHTML, id).toBe(jointsBefore);
      el.classList.remove('on');
      el.textContent = '';
      expect(joints!.innerHTML, id).toBe(jointsBefore);
    }
  });

  it('reserves the command-delta line on every row', () => {
    // The delta used to be display:none until a joint moved, which grew that row by 16 px and
    // pushed every slider below it. The line is now part of every row's height.
    expect(SHADOW_STYLES).toMatch(/\.j \.cmd-delta \{[\s\S]*?display: block/);
    expect(SHADOW_STYLES).toMatch(/\.j \.cmd-delta \{[\s\S]*?min-height: 12px/);
    expect(SHADOW_STYLES).not.toMatch(/\.j \.cmd-delta\.on \{ display: block; \}/);
  });

  it('draws the focus ring around the whole row, not the slider input', () => {
    // The input's ring sat at the bottom of the label line and left the current, the position
    // and the delta line outside it.
    expect(SHADOW_STYLES).toMatch(/\.j:focus-within \{[\s\S]*?outline: 1px solid #e10072/);
    expect(SHADOW_STYLES).toMatch(/\.j input\[type=range\]:focus \{ outline: none; \}/);
  });
});
