import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { PibRobotView, registerPibRobotView } from '../src/element/PibRobotView.js';
import type { JointMappingDocument } from '../src/joints/mapping.js';
import type { RobotModel } from '../src/types.js';

const mapping: JointMappingDocument = {
  schemaVersion: 1,
  robotVariant: 'test',
  joints: [
    {
      urdfJoint: 'rotation_elbow',
      motor: 'elbow_right',
      class: 'driven',
      type: 'revolute',
      direction: 1,
      gearRatio: 1,
      zeroOffsetDeg: 0,
      limitsRad: [-1, 1],
      axisDot: 1,
      verifiedOnHardware: false,
    },
  ],
};

function wireMinimalViewer(el: PibRobotView): {
  renderCount: () => number;
  requestRender: ReturnType<typeof vi.fn>;
} {
  const requestRender = vi.fn();
  let count = 0;
  const internal = el as unknown as {
    _mapping: JointMappingDocument;
    motionByJoint: Map<string, unknown>;
    panel: { setJointUi: ReturnType<typeof vi.fn>; setStaleBanner: ReturnType<typeof vi.fn> };
    onDemand: { requestRender: () => void; getRenderCount: () => number };
    liveInterp: unknown;
  };
  internal._mapping = mapping;
  internal.motionByJoint = new Map([
    [
      'rotation_elbow',
      {
        joint: {
          name: 'rotation_elbow',
          type: 'revolute',
          parent: 'a',
          child: 'b',
          origin: { xyz: [0, 0, 0], rpy: [0, 0, 0] },
          axis: [0, 0, 1],
          limit: { lower: -1, upper: 1 },
        },
        motion: new THREE.Object3D(),
        axis: new THREE.Vector3(0, 0, 1),
      },
    ],
  ]);
  internal.panel = {
    setJointUi: vi.fn(),
    setStaleBanner: vi.fn(),
  };
  internal.onDemand = {
    requestRender: () => {
      requestRender();
      count += 1;
    },
    getRenderCount: () => count,
    dispose: vi.fn(),
  };
  return {
    renderCount: () => count,
    requestRender,
  };
}

describe('PibRobotView live joint state', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    registerPibRobotView();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('marks stale after staleAfterMs and clears on the next sample', () => {
    const el = new PibRobotView();
    el.staleAfterMs = 200;
    wireMinimalViewer(el);

    el.setJointStateSample({ names: ['elbow_right'], positions: [0], stampMs: 0 });
    expect(el.stale).toBe(false);

    vi.advanceTimersByTime(199);
    expect(el.stale).toBe(false);
    vi.advanceTimersByTime(2);
    expect(el.stale).toBe(true);

    el.setJointStateSample({ names: ['elbow_right'], positions: [0.1], stampMs: 50 });
    expect(el.stale).toBe(false);
    el.dispose();
  });

  it('dispose clears stale timer', () => {
    const el = new PibRobotView();
    wireMinimalViewer(el);
    el.setJointStateSample({ names: ['elbow_right'], positions: [0], stampMs: 0 });
    el.dispose();
    vi.advanceTimersByTime(2000);
    expect(el.stale).toBe(false);
  });

  it('does not grow render count after the stream ends', () => {
    const el = new PibRobotView();
    const { renderCount } = wireMinimalViewer(el);
    el.setJointStateSample({ names: ['elbow_right'], positions: [0], stampMs: 0 });
    el.setJointStateSample({ names: ['elbow_right'], positions: [0.5], stampMs: 50 });
    vi.advanceTimersByTime(300);
    const afterStream = renderCount();
    vi.advanceTimersByTime(5000);
    expect(renderCount()).toBe(afterStream);
    el.dispose();
  });

  it('resolves motor keys in setJointStates', () => {
    const el = new PibRobotView();
    wireMinimalViewer(el);
    el.setJointStates({ elbow_right: 0.25 });
    expect(el.jointStates.rotation_elbow).toBeCloseTo(0.25);
    el.dispose();
  });
});
