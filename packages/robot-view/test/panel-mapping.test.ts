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

function buildFullPanel(mode: 'preview' | 'command' = 'preview') {
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
  panel.applyMode(mode, mode === 'command' ? 'command' : 'preview');
  return { root, panel };
}

describe('joint panel mapping UI', () => {
  it('renders 48 joint rows', () => {
    const { root } = buildFullPanel();
    expect(root.querySelectorAll('.j').length).toBe(48);
  });

  it('shows 26 motor subtitles on driven joints', () => {
    const { root } = buildFullPanel();
    expect(root.querySelectorAll('.j .motor').length).toBe(26);
  });

  it('marks door joints as passiv', () => {
    const { root } = buildFullPanel();
    for (const name of ['upper_door_rotation', 'lower_door_rotation']) {
      const row = root.querySelector(`[data-joint="${name}"]`);
      expect(row?.querySelector('.badge')?.textContent).toBe('passiv');
      expect(row?.dataset.jointClass).toBe('passive');
    }
  });

  it('disables 22 non-driven rows in command mode', () => {
    const { root } = buildFullPanel('command');
    const inputs = [...root.querySelectorAll('#joints input')] as HTMLInputElement[];
    expect(inputs.length).toBe(48);
    const disabled = inputs.filter((i) => i.disabled);
    expect(disabled.length).toBe(22);
    const enabled = inputs.filter((i) => !i.disabled);
    expect(enabled.length).toBe(26);
  });
});
