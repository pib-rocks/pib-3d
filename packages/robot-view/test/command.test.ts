import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { PibRobotView, registerPibRobotView } from '../src/element/PibRobotView.js';
import {
  buildCommandFromPending,
  CommandSendScheduler,
  motorLimitsProvided,
  validateDrivenValue,
} from '../src/joints/commandPath.js';
import type { JointMappingEntry } from '../src/joints/mapping.js';
import type { MotorLimitMap } from '../src/types.js';

const elbowEntry: JointMappingEntry = {
  urdfJoint: 'rotation_elbow',
  motor: 'elbow_right',
  class: 'driven',
  type: 'revolute',
  direction: 1,
  gearRatio: 1,
  zeroOffsetDeg: 0,
  limitsRad: [-1.5, 1.5],
  axisDot: 1,
  verifiedOnHardware: true,
};

const verifiedMapping = {
  schemaVersion: 1,
  robotVariant: 'test',
  joints: [elbowEntry],
};

const elbowLimits: MotorLimitMap = {
  elbow_right: { minDeg: -45, maxDeg: 90 },
};

function verifiedFixtureMapping() {
  return {
    schemaVersion: 1,
    robotVariant: 'pib5advanced',
    joints: [
      {
        ...elbowEntry,
        verifiedOnHardware: true,
      },
    ],
  };
}

describe('motorLimitsProvided', () => {
  it('requires limits for every driven motor', () => {
    expect(motorLimitsProvided(verifiedMapping, {})).toBe(false);
    expect(motorLimitsProvided(verifiedMapping, elbowLimits)).toBe(true);
  });
});

describe('validateDrivenValue', () => {
  it('refuses values outside database limits with limit in message', () => {
    const rad = (100 * Math.PI) / 180;
    const err = validateDrivenValue(elbowEntry, rad, elbowLimits);
    expect(err).toMatch(/90/);
    expect(err).toMatch(/elbow_right/);
  });
});

describe('buildCommandFromPending', () => {
  it('builds motors map in centideg', () => {
    const rad = Math.PI / 4;
    const built = buildCommandFromPending(
      { rotation_elbow: rad },
      verifiedMapping,
      elbowLimits,
      'ui',
      () => 'id-1',
    );
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.command.payload.commandId).toBe('id-1');
      expect(built.command.payload.motors.elbow_right).toBeCloseTo(4500, 0);
    }
  });

  it('refuses out-of-limit pending without building payload', () => {
    const rad = (100 * Math.PI) / 180;
    const built = buildCommandFromPending(
      { rotation_elbow: rad },
      verifiedMapping,
      elbowLimits,
      'ui',
      () => 'id-1',
    );
    expect(built.ok).toBe(false);
  });
});

describe('CommandSendScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('coalesces two flush requests before the timer fires', () => {
    const flushes: string[] = [];
    const sched = new CommandSendScheduler(120, (source) => flushes.push(source));
    sched.requestFlush('ui');
    sched.requestFlush('api');
    expect(flushes).toEqual([]);
    vi.advanceTimersByTime(0);
    expect(flushes).toEqual(['api']);
  });
});

describe('PibRobotView command lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    registerPibRobotView();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function mountWithMapping() {
    const el = new PibRobotView();
    const internal = el as unknown as {
      _mapping: typeof verifiedFixtureMapping;
      _mappingValidation: { ok: boolean; errors: string[]; warnings: string[] };
      _effectiveMode: 'command';
      _mode: 'command';
      _motorLimits: MotorLimitMap;
      _pendingJoints: Record<string, number>;
      _acceptedJoints: Record<string, number>;
      _actualJoints: Record<string, number>;
      _jointStates: Record<string, number>;
      motionByJoint: Map<
        string,
        { joint: { name: string; type: string; axis: number[] }; motion: THREE.Object3D; axis: THREE.Vector3 }
      >;
      panel: {
        setJointPending: ReturnType<typeof vi.fn>;
        clearAllPending: ReturnType<typeof vi.fn>;
        setJointUi: ReturnType<typeof vi.fn>;
        applyMotorLimits: ReturnType<typeof vi.fn>;
      } | null;
      syncCommandedPanel: () => void;
      onDemand: { requestRender: () => void; dispose: () => void } | null;
    };
    internal._mapping = verifiedFixtureMapping();
    internal._mappingValidation = { ok: true, errors: [], warnings: [] };
    internal._mode = 'command';
    internal._effectiveMode = 'command';
    internal._motorLimits = { ...elbowLimits };
    internal._actualJoints = { rotation_elbow: 0 };
    internal._acceptedJoints = { rotation_elbow: 0 };
    internal._jointStates = { rotation_elbow: 0 };
    const motion = new THREE.Object3D();
    internal.motionByJoint = new Map([
      [
        'rotation_elbow',
        {
          joint: {
            name: 'rotation_elbow',
            type: 'revolute',
            axis: [0, 0, 1],
          },
          motion,
          axis: new THREE.Vector3(0, 0, 1),
        },
      ],
    ]);
    internal.panel = {
      setJointPending: vi.fn(),
      clearAllPending: vi.fn(),
      setJointUi: vi.fn(),
      applyMotorLimits: vi.fn(),
    };
    internal.syncCommandedPanel = vi.fn();
    internal.onDemand = { requestRender: vi.fn(), dispose: vi.fn() };
    return el;
  }

  it('commands straight from the slider drag, without an approval step', () => {
    const el = mountWithMapping();
    const values: Array<Record<string, number>> = [];
    el.addEventListener('commandrequest', (e) => {
      values.push((e as CustomEvent<{ values: Record<string, number> }>).detail.values);
    });
    (el as unknown as { handleUiJointChange: (j: string, v: number) => void }).handleUiJointChange(
      'rotation_elbow',
      0.2,
    );
    vi.advanceTimersByTime(0);
    expect(values).toHaveLength(1);
    expect(values[0]!.rotation_elbow).toBeCloseTo(0.2, 9);
  });

  it('coalesces a fast drag into one command with the latest value', () => {
    const el = mountWithMapping();
    const values: Array<Record<string, number>> = [];
    el.addEventListener('commandrequest', (e) => {
      values.push((e as CustomEvent<{ values: Record<string, number> }>).detail.values);
    });
    const drag = (v: number) =>
      (el as unknown as { handleUiJointChange: (j: string, v: number) => void }).handleUiJointChange(
        'rotation_elbow',
        v,
      );
    drag(0.1);
    drag(0.2);
    drag(0.3);
    vi.advanceTimersByTime(0);
    expect(values).toHaveLength(1);
    expect(values[0]!.rotation_elbow).toBeCloseTo(0.3, 9);
  });

  it('approve emits exactly one commandrequest with unique commandId', () => {
    const el = mountWithMapping();
    const ids: string[] = [];
    el.addEventListener('commandrequest', (e) => {
      const ev = e as CustomEvent<{ commandId: string }>;
      ids.push(ev.detail.commandId);
    });
    (el as unknown as { handleUiJointChange: (j: string, v: number) => void }).handleUiJointChange(
      'rotation_elbow',
      0.3,
    );
    el.approve('ui');
    vi.advanceTimersByTime(0);
    expect(ids).toHaveLength(1);
    expect(ids[0]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('preventDefault leads to commandrejected and revert', () => {
    const el = mountWithMapping();
    const rejected: string[] = [];
    el.addEventListener('commandrejected', (e) => {
      rejected.push((e as CustomEvent<{ reason: string }>).detail.reason);
    });
    el.addEventListener('commandrequest', (e) => e.preventDefault());
    (el as unknown as { handleUiJointChange: (j: string, v: number) => void }).handleUiJointChange(
      'rotation_elbow',
      0.3,
    );
    el.approve('ui');
    vi.advanceTimersByTime(0);
    expect(rejected.length).toBe(1);
    expect((el as unknown as { _jointStates: Record<string, number> })._jointStates.rotation_elbow).toBe(
      0,
    );
  });

  it('two approvals inside minCommandIntervalMs produce one command with latest values', () => {
    const el = mountWithMapping();
    el.minCommandIntervalMs = 120;
    const payloads: Array<Record<string, number>> = [];
    el.addEventListener('commandrequest', (e) => {
      payloads.push((e as CustomEvent<{ values: Record<string, number> }>).detail.values);
    });
    (el as unknown as { handleUiJointChange: (j: string, v: number) => void }).handleUiJointChange(
      'rotation_elbow',
      0.2,
    );
    el.approve('ui');
    (el as unknown as { handleUiJointChange: (j: string, v: number) => void }).handleUiJointChange(
      'rotation_elbow',
      0.5,
    );
    el.approve('ui');
    vi.advanceTimersByTime(0);
    expect(payloads).toHaveLength(1);
    expect(payloads[0]!.rotation_elbow).toBeCloseTo(0.5, 5);
  });

  it('stop clears pending and emits estop; further approve sends nothing', () => {
    const el = mountWithMapping();
    const commands: unknown[] = [];
    const estops: unknown[] = [];
    el.addEventListener('commandrequest', (e) => commands.push(e));
    el.addEventListener('estop', (e) => estops.push(e));
    (el as unknown as { handleUiJointChange: (j: string, v: number) => void }).handleUiJointChange(
      'rotation_elbow',
      0.4,
    );
    el.stop('ui');
    expect(estops).toHaveLength(1);
    el.approve('ui');
    vi.advanceTimersByTime(200);
    expect(commands).toHaveLength(0);
  });

  it('refuses command mode without limits via guardReason', () => {
    const el = new PibRobotView();
    const internal = el as unknown as {
      _mapping: typeof verifiedFixtureMapping;
      _mappingValidation: { ok: boolean; errors: string[]; warnings: string[] };
      _mode: 'command';
      _motorLimits: MotorLimitMap;
      updateModeUi: () => void;
    };
    internal._mapping = verifiedFixtureMapping();
    internal._mappingValidation = { ok: true, errors: [], warnings: [] };
    internal._mode = 'command';
    internal._motorLimits = {};
    internal.updateModeUi();
    expect(el.effectiveMode).toBe('preview');
    expect(el.guardReason).toBe('limits not provided');
  });

  it('assigns unique commandIds across successive approvals', () => {
    const el = mountWithMapping();
    el.minCommandIntervalMs = 0;
    const ids = new Set<string>();
    let lastId = '';
    el.addEventListener('commandrequest', (e) => {
      lastId = (e as CustomEvent<{ commandId: string }>).detail.commandId;
      ids.add(lastId);
    });
    for (const v of [0.1, 0.2]) {
      (el as unknown as { handleUiJointChange: (j: string, n: number) => void }).handleUiJointChange(
        'rotation_elbow',
        v,
      );
      el.approve('ui');
      vi.advanceTimersByTime(0);
      el.confirmCommand(lastId);
    }
    expect(ids.size).toBe(2);
  });

  it('confirmCommand accepts in-flight command and emits commandaccepted', () => {
    const el = mountWithMapping();
    let commandId = '';
    el.addEventListener('commandrequest', (e) => {
      commandId = (e as CustomEvent<{ commandId: string }>).detail.commandId;
    });
    const accepted: string[] = [];
    el.addEventListener('commandaccepted', (e) => {
      accepted.push((e as CustomEvent<{ commandId: string }>).detail.commandId);
    });
    (el as unknown as { handleUiJointChange: (j: string, v: number) => void }).handleUiJointChange(
      'rotation_elbow',
      0.35,
    );
    el.approve('ui');
    vi.advanceTimersByTime(0);
    el.confirmCommand(commandId);
    expect(accepted).toEqual([commandId]);
    expect(el.commandedStates.rotation_elbow).toBeCloseTo(0.35, 5);
    const internal = el as unknown as {
      _pendingJoints: Record<string, number>;
      _acceptedJoints: Record<string, number>;
    };
    expect(Object.keys(internal._pendingJoints)).toHaveLength(0);
    expect(internal._acceptedJoints.rotation_elbow).toBeCloseTo(0.35, 5);
  });

  it('rejectCommand reverts pose and emits commandrejected', () => {
    const el = mountWithMapping();
    let commandId = '';
    el.addEventListener('commandrequest', (e) => {
      commandId = (e as CustomEvent<{ commandId: string }>).detail.commandId;
    });
    const reasons: string[] = [];
    el.addEventListener('commandrejected', (e) => {
      reasons.push((e as CustomEvent<{ reason: string }>).detail.reason);
    });
    (el as unknown as { handleUiJointChange: (j: string, v: number) => void }).handleUiJointChange(
      'rotation_elbow',
      0.4,
    );
    el.approve('ui');
    vi.advanceTimersByTime(0);
    el.rejectCommand(commandId, 'hardware fault');
    expect(reasons).toEqual(['hardware fault']);
    expect(
      (el as unknown as { _jointStates: Record<string, number> })._jointStates.rotation_elbow,
    ).toBe(0);
  });

  it('auto-rejects after ackTimeoutMs with no acknowledgement', () => {
    const el = mountWithMapping();
    el.ackTimeoutMs = 3000;
    let commandId = '';
    el.addEventListener('commandrequest', (e) => {
      commandId = (e as CustomEvent<{ commandId: string }>).detail.commandId;
    });
    const reasons: string[] = [];
    el.addEventListener('commandrejected', (e) => {
      reasons.push((e as CustomEvent<{ reason: string }>).detail.reason);
    });
    (el as unknown as { handleUiJointChange: (j: string, v: number) => void }).handleUiJointChange(
      'rotation_elbow',
      0.25,
    );
    el.approve('ui');
    vi.advanceTimersByTime(0);
    vi.advanceTimersByTime(3000);
    expect(reasons).toEqual(['no acknowledgement']);
    expect(
      (el as unknown as { _jointStates: Record<string, number> })._jointStates.rotation_elbow,
    ).toBe(0);
    expect(commandId).toBeTruthy();
  });

  it('second approve while in flight does not emit another commandrequest', () => {
    const el = mountWithMapping();
    const commands: unknown[] = [];
    el.addEventListener('commandrequest', (e) => commands.push(e));
    (el as unknown as { handleUiJointChange: (j: string, v: number) => void }).handleUiJointChange(
      'rotation_elbow',
      0.2,
    );
    el.approve('ui');
    vi.advanceTimersByTime(0);
    (el as unknown as { handleUiJointChange: (j: string, v: number) => void }).handleUiJointChange(
      'rotation_elbow',
      0.6,
    );
    el.approve('ui');
    vi.advanceTimersByTime(500);
    expect(commands).toHaveLength(1);
  });

  it('confirmCommand ignores unknown commandId', () => {
    const el = mountWithMapping();
    expect(() => el.confirmCommand('not-a-real-id')).not.toThrow();
    el.addEventListener('commandrequest', (e) => {
      const id = (e as CustomEvent<{ commandId: string }>).detail.commandId;
      expect(() => el.confirmCommand('wrong')).not.toThrow();
      el.confirmCommand(id);
    });
    (el as unknown as { handleUiJointChange: (j: string, v: number) => void }).handleUiJointChange(
      'rotation_elbow',
      0.15,
    );
    el.approve('ui');
    vi.advanceTimersByTime(0);
  });

  it('stop during in-flight drops command; late confirm is ignored', () => {
    const el = mountWithMapping();
    let commandId = '';
    el.addEventListener('commandrequest', (e) => {
      commandId = (e as CustomEvent<{ commandId: string }>).detail.commandId;
    });
    const accepted: unknown[] = [];
    el.addEventListener('commandaccepted', (e) => accepted.push(e));
    (el as unknown as { handleUiJointChange: (j: string, v: number) => void }).handleUiJointChange(
      'rotation_elbow',
      0.45,
    );
    el.approve('ui');
    vi.advanceTimersByTime(0);
    el.stop('ui');
    el.confirmCommand(commandId);
    expect(accepted).toHaveLength(0);
  });

  it('dispose clears ack timer so timeout does not fire', () => {
    const el = mountWithMapping();
    el.ackTimeoutMs = 5000;
    el.addEventListener('commandrequest', () => {});
    const rejected: unknown[] = [];
    el.addEventListener('commandrejected', (e) => rejected.push(e));
    (el as unknown as { handleUiJointChange: (j: string, v: number) => void }).handleUiJointChange(
      'rotation_elbow',
      0.3,
    );
    el.approve('ui');
    vi.advanceTimersByTime(0);
    el.dispose();
    vi.advanceTimersByTime(10000);
    expect(rejected).toHaveLength(0);
  });
});
