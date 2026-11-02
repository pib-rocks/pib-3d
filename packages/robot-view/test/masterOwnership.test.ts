import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { PibRobotView, registerPibRobotView } from '../src/element/PibRobotView.js';
import { uiRangeFromMotorLimits } from '../src/joints/commandPath.js';
import type { JointMappingEntry } from '../src/joints/mapping.js';
import type { ModelJoint } from '../src/types.js';

const elbowEntry: JointMappingEntry = {
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
  const internal = el as unknown as Record<string, unknown> & {
    _mapping: unknown;
    _mappingValidation: unknown;
    _effectiveMode: string;
    _motorLimits: Record<string, { minDeg: number; maxDeg: number }>;
    motionByJoint: Map<string, unknown>;
    panel: Record<string, ReturnType<typeof vi.fn>> | null;
    onDemand: { requestRender: () => void } | null;
    handleUiJointChange: (joint: string, value: number) => void;
    applyLiveFrame: (values: Record<string, number>) => void;
    syncPose: () => void;
  };
  internal._mapping = { schemaVersion: 1, robotVariant: 'test', joints: [elbowEntry] };
  internal._mappingValidation = { ok: true, errors: [], warnings: [] };
  internal._effectiveMode = 'command';
  internal._motorLimits = { elbow_right: { minDeg: -45, maxDeg: 90 } };
  internal.motionByJoint = new Map([
    [
      'rotation_elbow',
      {
        joint: { name: 'rotation_elbow', type: 'revolute', axis: [0, 0, 1], limit: { lower: -1.2, upper: 1.2 } },
        motion: new THREE.Object3D(),
        axis: new THREE.Vector3(0, 0, 1),
      },
    ],
  ]);
  internal.panel = {
    setJointUi: vi.fn(),
    setJointMessage: vi.fn(),
    setJointPending: vi.fn(),
    clearAllPending: vi.fn(),
  };
  internal.onDemand = { requestRender: vi.fn() };
  internal.syncPose = vi.fn();
  (internal as unknown as { _jointStates: Record<string, number> })._jointStates = { rotation_elbow: 0 };
  (internal as unknown as { _actualJoints: Record<string, number> })._actualJoints = { rotation_elbow: 0 };
  return { el, internal };
}

describe('the slider is the master of its joint', () => {
  it('a measured frame does not move a joint the user is commanding', () => {
    const { internal } = mount();
    internal.handleUiJointChange('rotation_elbow', 0.4);
    internal.applyLiveFrame({ rotation_elbow: 0.05 });
    const state = internal as unknown as { _jointStates: Record<string, number>; _actualJoints: Record<string, number> };
    expect(state._jointStates.rotation_elbow).toBeCloseTo(0.4, 9);
    expect(state._actualJoints.rotation_elbow).toBeCloseTo(0.05, 9);
  });

  it('seeds an untouched slider from the first frame, in command mode too', () => {
    const { internal } = mount();
    internal.applyLiveFrame({ rotation_elbow: 0.3 });
    const panel = (internal as unknown as { panel: { setJointUi: ReturnType<typeof vi.fn> } }).panel;
    expect(panel.setJointUi).toHaveBeenCalledWith('rotation_elbow', 0.3);
  });

  it('still follows the measurement for joints nobody commands', () => {
    const { internal } = mount();
    internal.applyLiveFrame({ rotation_elbow: 0.05 });
    const state = internal as unknown as { _jointStates: Record<string, number> };
    expect(state._jointStates.rotation_elbow).toBeCloseTo(0.05, 9);
  });
});

describe('the slider offers only what the motor and the joint both allow', () => {
  it('cuts the motor range at the joint limit', () => {
    const joint = {
      name: 'rotation_elbow',
      type: 'revolute',
      axis: [0, 0, 1],
      limit: { lower: THREE.MathUtils.degToRad(-68), upper: THREE.MathUtils.degToRad(68) },
    } as unknown as ModelJoint;
    // motor -45..90 -> the part above +68 is not a joint position
    expect(uiRangeFromMotorLimits(elbowEntry, joint, { elbow_right: { minDeg: -45, maxDeg: 90 } })).toEqual([-45, 68]);
  });

  it('keeps the head range the motor really has', () => {
    const entry: JointMappingEntry = { ...elbowEntry, urdfJoint: 'nodding_rotation', motor: 'tilt_forward_motor', direction: -1 };
    const joint = {
      name: 'nodding_rotation',
      type: 'revolute',
      axis: [1, 0, 0],
      limit: { lower: THREE.MathUtils.degToRad(-45), upper: THREE.MathUtils.degToRad(45) },
    } as unknown as ModelJoint;
    // motor -20..45 with direction -1 -> -45..20, and the joint allows all of it
    expect(uiRangeFromMotorLimits(entry, joint, { tilt_forward_motor: { minDeg: -20, maxDeg: 45 } })).toEqual([-45, 20]);
  });
});
