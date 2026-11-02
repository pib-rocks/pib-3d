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

function buildFullPanel(
  mode: 'preview' | 'command' = 'preview',
  labelsByMotor?: Record<string, string>,
) {
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
    labelsByMotor,
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
  it('renders one row per driven joint, and nothing else', () => {
    const { root } = buildFullPanel();
    const rows = [...root.querySelectorAll('.j')];
    expect(rows.length).toBe(26);
    for (const row of rows) expect(row.dataset.jointClass).toBe('driven');
  });

  it('labels a row with the host name of its motor', () => {
    const { root } = buildFullPanel('command', { turn_head_motor: 'Head · Head Rotation' });
    const row = root.querySelector('[data-joint="gearing_rotation__new_body_"]');
    expect(row?.querySelector('.name')?.textContent).toBe('Head · Head Rotation');
  });

  it('shows 26 motor subtitles on driven joints', () => {
    const { root } = buildFullPanel();
    expect(root.querySelectorAll('.j .motor').length).toBe(26);
  });

  it('orders the rows anatomically inside a region', () => {
    const { root } = buildFullPanel('command');
    const names = [...root.querySelectorAll('.j')].map(
      (row) => (row as HTMLElement).dataset.joint ?? '',
    );
    // One arm as the CAD names it: shoulder vertical, shoulder horizontal, upper arm, elbow,
    // forearm, wrist - the order the joint tabs use, not the CAD order.
    const arm = [
      'rotation_inner_shoulder',
      'rotation_shoulder_left',
      'central_rotator_rotation',
      'rotation_elbow',
      'rotate_forearm',
      'rotation_wrist_right',
    ];
    const start = names.indexOf(arm[0]!);
    expect(names.slice(start, start + arm.length)).toEqual(arm);
  });

  it('leaves passive and coupled joints out of the panel', () => {
    const { root } = buildFullPanel();
    for (const name of ['upper_door_rotation', 'lower_door_rotation', 'd55_finger_tip']) {
      expect(root.querySelector(`[data-joint="${name}"]`)).toBeNull();
    }
  });

  it('enables every slider in command mode', () => {
    const { root } = buildFullPanel('command');
    const inputs = [...root.querySelectorAll('#joints input')] as HTMLInputElement[];
    expect(inputs.length).toBe(26);
    expect(inputs.filter((i) => i.disabled).length).toBe(0);
  });
});
