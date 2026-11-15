import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import {
  buildJointPanel,
  temperatureTelemetryClass,
} from '../src/joints/panel.js';
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

describe('joint panel motor telemetry', () => {
  it('renders current and temperature for a driven row', () => {
    const { root, panel } = buildFullPanel();
    panel.setJointTelemetry({
      shoulder_vertical_right: { currentMa: 290, temperatureC: 66 },
    });
    const row = root.querySelector('[data-joint="rotation_inner_shoulder_1"]');
    expect(row?.querySelector('.curr')?.textContent).toBe('290 mA');
    expect(row?.querySelector('.temp')?.textContent).toBe('66 °C');
    expect(root.querySelector('#joints')?.classList.contains('has-temp-col')).toBe(true);
  });

  it('renders neither telemetry value when the motor has no payload', () => {
    const { root, panel } = buildFullPanel();
    panel.setJointTelemetry({ elbow_right: { currentMa: 30, temperatureC: 40 } });
    const row = root.querySelector('[data-joint="rotation_inner_shoulder_1"]');
    expect(row?.querySelector('.curr')?.textContent).toBe('');
    expect(row?.querySelector('.temp')?.textContent).toBe('');
    const rowText = row?.textContent ?? '';
    expect(rowText).not.toMatch(/\b0\s*mA\b/);
    expect(rowText).not.toMatch(/\b0\s*°C\b/);
  });

  it('applies neutral, amber and red temperature classes', () => {
    expect(temperatureTelemetryClass(59)).toBe('');
    expect(temperatureTelemetryClass(60)).toBe('amber');
    expect(temperatureTelemetryClass(69)).toBe('amber');
    expect(temperatureTelemetryClass(70)).toBe('red');
    expect(temperatureTelemetryClass(80)).toBe('red');

    const { root, panel } = buildFullPanel();
    const joint = 'rotation_inner_shoulder_1';

    panel.setJointTelemetry({ shoulder_vertical_right: { temperatureC: 55 } });
    let temp = root.querySelector(`[data-joint="${joint}"] .temp`);
    expect(temp?.classList.contains('amber')).toBe(false);
    expect(temp?.classList.contains('red')).toBe(false);

    panel.setJointTelemetry({ shoulder_vertical_right: { temperatureC: 66 } });
    temp = root.querySelector(`[data-joint="${joint}"] .temp`);
    expect(temp?.classList.contains('amber')).toBe(true);
    expect(temp?.classList.contains('red')).toBe(false);

    panel.setJointTelemetry({ shoulder_vertical_right: { temperatureC: 72 } });
    temp = root.querySelector(`[data-joint="${joint}"] .temp`);
    expect(temp?.classList.contains('red')).toBe(true);
    expect(temp?.classList.contains('amber')).toBe(false);
  });

  it('hides the temperature column when no row has a temperature value', () => {
    const { root, panel } = buildFullPanel();
    panel.setJointTelemetry({
      shoulder_vertical_right: { currentMa: 64 },
      elbow_right: { currentMa: 30 },
    });
    const joints = root.querySelector('#joints')!;
    expect(joints.classList.contains('has-temp-col')).toBe(false);
    expect(SHADOW_STYLES).toMatch(/\.j \.temp \{[^}]*display:\s*none/);
    expect(SHADOW_STYLES).toMatch(/#joints\.has-temp-col \.j \.temp/);
    for (const temp of [...joints.querySelectorAll('.temp')]) {
      expect(temp.textContent).toBe('');
    }
    expect(root.querySelector('[data-joint="rotation_inner_shoulder_1"] .curr')?.textContent).toBe(
      '64 mA',
    );
  });
});