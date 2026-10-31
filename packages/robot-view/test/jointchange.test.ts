import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { buildJointPanel } from '../src/joints/panel.js';
import type { MotionEntry, RobotModel } from '../src/types.js';
import { SHADOW_HTML, SHADOW_STYLES } from '../src/element/template.js';

describe('jointchange event payload', () => {
  it('includes joint, value, and source ui from slider input', () => {
    const host = document.createElement('div');
    host.attachShadow({ mode: 'open' }).innerHTML =
      `<style>${SHADOW_STYLES}</style>${SHADOW_HTML}`;
    const root = host.shadowRoot!;

    const joint = {
      name: 'rotation_elbow',
      type: 'revolute',
      parent: 'parent_link',
      child: 'child_link',
      origin: { xyz: [0, 0, 0], rpy: [0, 0, 0] },
      axis: [0, 0, 1],
      limit: { lower: -1.5, upper: 1.5 },
    };
    const motion = new THREE.Object3D();
    const motions: MotionEntry[] = [
      { joint, motion, axis: new THREE.Vector3(0, 0, 1) },
    ];
    const model: RobotModel = {
      links: [
        { name: 'parent_link', mesh: 'm.glb' },
        { name: 'child_link', mesh: 'm2.glb' },
      ],
      joints: [joint],
    };
    const events: Array<{ joint: string; value: number; source: string }> = [];
    buildJointPanel({
      root,
      model,
      parentOf: new Map([[joint.child, joint.parent]]),
      motions,
      onJointChange: (name, value) => events.push({ joint: name, value, source: 'ui' }),
      onRequestRender: () => {},
    });

    const input = root.querySelector('[data-joint="rotation_elbow"] input') as HTMLInputElement;
    input.value = '45';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    expect(events).toHaveLength(1);
    expect(events[0].joint).toBe('rotation_elbow');
    expect(events[0].source).toBe('ui');
    expect(events[0].value).toBeCloseTo(Math.PI / 4, 4);
  });
});

describe('PibRobotView jointchange from API', () => {
  it('uses source api in CustomEvent detail', () => {
    const detail = { joint: 'j', value: 0.25, source: 'api' as const };
    const ev = new CustomEvent('jointchange', {
      bubbles: true,
      composed: true,
      detail,
    });
    expect(ev.detail).toEqual(detail);
  });
});
