import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { JointMappingDocument } from '../src/joints/mapping.js';
import { sampleToModelJoints } from '../src/joints/liveState.js';

const repoRoot = resolve(import.meta.dirname, '../../..');

/**
 * A finger is a linkage: one motor turns the knuckle and the two joints behind it bend by the
 * same angle. The mapping carries that as `coupling` on the follower joints; without it the
 * knuckles curl and the finger segments stay straight, which is what the robot never looks like.
 */
describe('finger coupling', () => {
  let mapping: JointMappingDocument;

  beforeAll(() => {
    mapping = JSON.parse(
      readFileSync(resolve(repoRoot, 'joints/mapping.json'), 'utf8'),
    ) as JointMappingDocument;
  });

  function sample(motors: Record<string, number>) {
    const names = Object.keys(motors);
    return sampleToModelJoints(
      { names, positions: names.map((n) => motors[n]!), stampMs: 1 },
      mapping,
      null,
    );
  }

  it('bends every joint of the left index finger by the knuckle angle', () => {
    const { values } = sample({ index_left_stretch: -1.0 });
    expect(values['j1_5']).toBeCloseTo(-1.0, 9);
    expect(values['j2_1']).toBeCloseTo(-1.0, 9);
    expect(values['d55_finger_tip_5_hinge']).toBeCloseTo(-1.0, 9);
  });

  it('bends the right index finger the same way', () => {
    const { values } = sample({ index_right_stretch: -1.0 });
    expect(values['j1']).toBeCloseTo(-1.0, 9);
    expect(values['j2']).toBeCloseTo(-1.0, 9);
    expect(values['j3']).toBeCloseTo(-1.0, 9);
  });

  it('leaves the thumb tip hinge straight, as the robot does', () => {
    // Photo of the real right hand (2026-11-01): the thumb is a straight digit while its knuckle
    // motor sits at its -90 degree stop. Coupling it to the knuckle would fold it to 83 degrees.
    const { values } = sample({ thumb_left_stretch: -1.0 });
    expect(values['j1_7']).toBeCloseTo(-1.0, 9);
    expect(values['d58_thumb_tip_1_hinge'] ?? 0).toBeCloseTo(0, 9);
  });

  it('leaves the followers at zero when the knuckle motor is missing', () => {
    const { values } = sample({});
    for (const joint of ['j1', 'j2', 'j3', 'j1_5', 'j2_1', 'd55_finger_tip_5_hinge']) {
      expect(values[joint] ?? 0).toBeCloseTo(0, 9);
    }
  });

  it('gives every follower the same travel as its knuckle', () => {
    for (const entry of mapping.joints) {
      if (!entry.coupling || !entry.limitsRad) continue;
      const source = mapping.joints.find((j) => j.urdfJoint === entry.coupling!.follows);
      expect(source, `${entry.urdfJoint} follows an unknown joint`).toBeTruthy();
      if (!source?.limitsRad) continue;
      const sourceSpan = source.limitsRad[1] - source.limitsRad[0];
      const targetSpan = entry.limitsRad[1] - entry.limitsRad[0];
      expect(
        Math.abs(targetSpan - sourceSpan),
        `${entry.urdfJoint} travels ${targetSpan.toFixed(3)} rad, its knuckle ${sourceSpan.toFixed(3)}`,
      ).toBeLessThan(1e-6);

      if (entry.coupling.factor === 1) {
        // Same axis sense: the knuckle's range has to land inside the follower's range.
        for (const angle of source.limitsRad) {
          expect(
            angle >= entry.limitsRad[0] - 1e-9 && angle <= entry.limitsRad[1] + 1e-9,
            `${entry.urdfJoint} leaves its limits at ${angle}`,
          ).toBe(true);
        }
      } else {
        // Anti-parallel axis (the thumb): the CAD writes that limit in the opposite sense.
        expect(
          source.limitsRad.every((angle) => {
            const value = -angle;
            return value >= entry.limitsRad[0] - 1e-9 && value <= entry.limitsRad[1] + 1e-9;
          }),
          `${entry.urdfJoint}: expected a limit mirrored against its knuckle`,
        ).toBe(false);
      }
    }
  });

  it('couples every finger joint that has a knuckle above it', () => {
    const unCoupled = mapping.joints
      .filter((entry) => entry.class === 'coupled' && !entry.coupling)
      .map((entry) => entry.urdfJoint);
    // The wrist pair belongs to the parallel wrist mechanism; the thumb tip hinges stay straight
    // because the robot's thumb is one rigid digit, not a linkage (see the photo check).
    expect(unCoupled.sort()).toEqual([
      'd58_thumb_tip_1_hinge',
      'd58_thumb_tip_hinge',
      'dof_wrist',
      'dof_wrist_1',
    ]);
  });
});
