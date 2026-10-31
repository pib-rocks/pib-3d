import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  LiveJointInterpolator,
  sampleToModelJoints,
  type JointStateSample,
} from '../src/joints/liveState.js';
import type { JointMappingDocument } from '../src/joints/mapping.js';

const mapping: JointMappingDocument = {
  schemaVersion: 1,
  robotVariant: 'test',
  joints: [
    {
      urdfJoint: 'rotation_elbow',
      motor: 'elbow_right',
      class: 'driven',
      type: 'revolute',
      direction: -1,
      gearRatio: 1,
      zeroOffsetDeg: 0,
      limitsRad: [-1, 1],
      axisDot: -1,
      verifiedOnHardware: false,
    },
    {
      urdfJoint: 'turn_head',
      motor: 'turn_head_motor',
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

describe('sampleToModelJoints', () => {
  it('applies direction ±1 from mapping', () => {
    const sample: JointStateSample = {
      names: ['elbow_right', 'turn_head_motor'],
      positions: [0.2, 0.3],
      stampMs: 100,
    };
    const r = sampleToModelJoints(sample, mapping, null);
    expect(r.dropped).toBe(false);
    expect(r.unknown).toEqual([]);
    expect(r.values.rotation_elbow).toBeCloseTo(-0.2);
    expect(r.values.turn_head).toBeCloseTo(0.3);
  });

  it('lists unknown motors and drops out-of-order samples', () => {
    const sample: JointStateSample = {
      names: ['unknown_motor'],
      positions: [1],
      stampMs: 50,
    };
    const first = sampleToModelJoints(sample, mapping, null);
    expect(first.unknown).toEqual(['unknown_motor']);
    expect(first.values).toEqual({});

    const dup: JointStateSample = { names: [], positions: [], stampMs: 50 };
    const second = sampleToModelJoints(dup, mapping, 50);
    expect(second.dropped).toBe(true);

    const older: JointStateSample = { names: [], positions: [], stampMs: 40 };
    const third = sampleToModelJoints(older, mapping, 50);
    expect(third.dropped).toBe(true);
  });
});

describe('LiveJointInterpolator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reaches target and stops requesting frames', () => {
    const frames: number[] = [];
    const onUnknown = vi.fn();
    const interp = new LiveJointInterpolator(
      (values) => frames.push(values.rotation_elbow ?? 0),
      onUnknown,
    );

    interp.pushSample(
      { names: ['elbow_right'], positions: [1], stampMs: 0 },
      mapping,
    );
    vi.advanceTimersByTime(200);
    expect(frames.length).toBeGreaterThan(0);
    const last = frames[frames.length - 1]!;
    expect(last).toBeCloseTo(-1, 3);
    expect(interp.isAnimating).toBe(false);

    const countAfter = frames.length;
    vi.advanceTimersByTime(5000);
    expect(frames.length).toBe(countAfter);
    interp.dispose();
  });

  it('warns once per unknown motor', () => {
    const onUnknown = vi.fn();
    const interp = new LiveJointInterpolator(() => {}, onUnknown);
    interp.pushSample(
      { names: ['nope'], positions: [0], stampMs: 0 },
      mapping,
    );
    interp.pushSample(
      { names: ['nope'], positions: [0], stampMs: 50 },
      mapping,
    );
    expect(onUnknown).toHaveBeenCalledTimes(1);
    expect(onUnknown.mock.calls[0]![0]).toEqual(['nope']);
    interp.dispose();
  });

  it('dispose clears the animation timer', () => {
    const frames: number[] = [];
    const interp = new LiveJointInterpolator((v) => {
      frames.push(Object.keys(v).length);
    }, vi.fn());
    interp.pushSample(
      { names: ['elbow_right'], positions: [0.5], stampMs: 0 },
      mapping,
    );
    interp.dispose();
    const n = frames.length;
    vi.advanceTimersByTime(1000);
    expect(frames.length).toBe(n);
  });
});
