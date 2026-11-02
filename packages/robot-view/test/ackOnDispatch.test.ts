import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { PibRobotView, registerPibRobotView } from '../src/element/PibRobotView.js';
import type { JointMappingEntry } from '../src/joints/mapping.js';

const elbow: JointMappingEntry = {
  urdfJoint: 'rotation_elbow',
  motor: 'elbow_right',
  class: 'driven',
  type: 'revolute',
  direction: 1,
  gearRatio: 1,
  zeroOffsetDeg: 0,
  limitsRad: [-1.2, 1.2],
  axisDot: 1,
  verifiedOnHardware: true,
};

registerPibRobotView();

function mount() {
  const el = document.createElement('pib-robot-view') as PibRobotView;
  const i = el as unknown as Record<string, unknown> & {
    _mapping: unknown;
    _mappingValidation: unknown;
    _effectiveMode: string;
    _motorLimits: Record<string, { minDeg: number; maxDeg: number }>;
    motionByJoint: Map<string, unknown>;
    panel: Record<string, ReturnType<typeof vi.fn>> | null;
    onDemand: { requestRender: () => void } | null;
    handleUiJointChange: (j: string, v: number) => void;
    syncPose: () => void;
  };
  i._mapping = { schemaVersion: 1, robotVariant: 'test', joints: [elbow] };
  i._mappingValidation = { ok: true, errors: [], warnings: [] };
  i._effectiveMode = 'command';
  i._motorLimits = { elbow_right: { minDeg: -45, maxDeg: 90 } };
  i.motionByJoint = new Map([
    ['rotation_elbow', { joint: { name: 'rotation_elbow', type: 'revolute', axis: [0, 0, 1] }, motion: new THREE.Object3D(), axis: new THREE.Vector3(0, 0, 1) }],
  ]);
  i.panel = { setJointPending: vi.fn(), setJointMessage: vi.fn(), clearAllPending: vi.fn(), setJointUi: vi.fn() };
  i.onDemand = { requestRender: vi.fn() };
  i.syncPose = vi.fn();
  (i as unknown as { _jointStates: Record<string, number> })._jointStates = { rotation_elbow: 0 };
  return { el, i };
}

describe('acknowledgement on dispatch', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('publishes, confirms inside the dispatch, and never reports a missing acknowledgement', () => {
    const { el, i } = mount();
    const rejected: string[] = [];
    el.addEventListener('commandrejected', (e) => rejected.push((e as CustomEvent<{ reason: string }>).detail.reason));
    el.addEventListener('commandrequest', (e) => {
      // What Cerebra does: publish immediately, then confirm - the service answer may take seconds.
      el.confirmCommand((e as CustomEvent<{ commandId: string }>).detail.commandId);
    });

    i.handleUiJointChange('rotation_elbow', 0.9);
    vi.advanceTimersByTime(10_000);

    // A slow service used to raise "no acknowledgement" here, although the command was on its way.
    expect(rejected).toEqual([]);
  });

  it('reports a late service failure on the row without touching the value', () => {
    const { el, i } = mount();
    let id = '';
    el.addEventListener('commandrequest', (e) => {
      id = (e as CustomEvent<{ commandId: string }>).detail.commandId;
      el.confirmCommand(id);
    });
    const rejected: string[] = [];
    el.addEventListener('commandrejected', (e) => rejected.push((e as CustomEvent<{ reason: string }>).detail.reason));

    i.handleUiJointChange('rotation_elbow', 0.7);
    vi.advanceTimersByTime(200);
    el.reportCommandFailure(id, 'motor is off');

    expect(rejected).toEqual(['motor is off']);
    expect(i.panel!.setJointMessage).toHaveBeenCalledWith('rotation_elbow', 'motor is off');
    expect((i as unknown as { _jointStates: Record<string, number> })._jointStates.rotation_elbow).toBeCloseTo(0.7, 9);
  });
});
