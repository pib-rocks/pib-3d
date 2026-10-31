import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  canCommand,
  modelRadToMotorCentideg,
  motorCentidegToModelRad,
  validateMapping,
  type JointMappingDocument,
  type JointMappingEntry,
} from '../src/joints/mapping.js';
import type { RobotModel } from '../src/types.js';

const repoRoot = resolve(import.meta.dirname, '../../..');
const mappingDoc = JSON.parse(
  readFileSync(resolve(repoRoot, 'joints/mapping.json'), 'utf8'),
) as JointMappingDocument;
const modelDoc = JSON.parse(
  readFileSync(resolve(repoRoot, 'web/model.json'), 'utf8'),
) as RobotModel;

const drivenEntry = mappingDoc.joints.find((j) => j.class === 'driven' && j.motor)!;

describe('motor ↔ model conversions', () => {
  it('round-trips model rad through centideg', () => {
    const modelRad = 0.42;
    const cd = modelRadToMotorCentideg(drivenEntry, modelRad);
    const back = motorCentidegToModelRad(drivenEntry, cd);
    expect(back).toBeCloseTo(modelRad, 8);
  });

  it('flips sign when direction is -1', () => {
    const neg: JointMappingEntry = { ...drivenEntry, direction: -1 };
    const pos: JointMappingEntry = { ...drivenEntry, direction: 1 };
    const rad = 0.25;
    expect(modelRadToMotorCentideg(neg, rad)).toBeCloseTo(-modelRadToMotorCentideg(pos, rad), 6);
  });
});

describe('validateMapping', () => {
  it('accepts the committed mapping and model.json', () => {
    const result = validateMapping(mappingDoc, modelDoc);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects a model joint missing from the mapping', () => {
    const mapping = structuredClone(mappingDoc);
    mapping.joints = mapping.joints.filter((j) => j.urdfJoint !== 'rotation_elbow');
    const result = validateMapping(mapping, modelDoc);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('rotation_elbow'))).toBe(true);
  });

  it('rejects an extra mapping entry', () => {
    const mapping = structuredClone(mappingDoc);
    mapping.joints.push({
      ...mapping.joints[0]!,
      urdfJoint: 'not_in_model',
      motor: null,
      class: 'passive',
      direction: null,
    });
    const result = validateMapping(mapping, modelDoc);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('not_in_model'))).toBe(true);
  });

  it('rejects duplicate motors', () => {
    const mapping = structuredClone(mappingDoc);
    const a = mapping.joints.find((j) => j.motor === 'elbow_right')!;
    const b = mapping.joints.find((j) => j.motor === 'elbow_left')!;
    b.motor = a.motor;
    const result = validateMapping(mapping, modelDoc);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('elbow_right'))).toBe(true);
  });

  it('rejects motors outside pib5advanced', () => {
    const mapping = structuredClone(mappingDoc);
    const entry = mapping.joints.find((j) => j.motor === 'elbow_right')!;
    entry.motor = 'unknown_motor_xyz';
    const result = validateMapping(mapping, modelDoc);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('unknown_motor_xyz'))).toBe(true);
  });

  it('rejects driven joints without direction', () => {
    const mapping = structuredClone(mappingDoc);
    const entry = mapping.joints.find((j) => j.motor === 'wrist_right')!;
    entry.direction = null;
    const result = validateMapping(mapping, modelDoc);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('wrist_right') && e.includes('direction'))).toBe(
      true,
    );
  });

  it('rejects coupled joints with a motor', () => {
    const mapping = structuredClone(mappingDoc);
    const entry = mapping.joints.find((j) => j.urdfJoint === 'dof_wrist')!;
    entry.motor = 'elbow_right';
    const result = validateMapping(mapping, modelDoc);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('dof_wrist'))).toBe(true);
  });

  it('rejects limitsRad that do not match model.json', () => {
    const mapping = structuredClone(mappingDoc);
    const entry = mapping.joints.find((j) => j.urdfJoint === 'rotation_elbow')!;
    entry.limitsRad = [-9, 9];
    const result = validateMapping(mapping, modelDoc);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('rotation_elbow') && e.includes('limitsRad'))).toBe(
      true,
    );
  });
});

describe('canCommand', () => {
  it('is false while driven joints are not verified on hardware', () => {
    const validation = validateMapping(mappingDoc, modelDoc);
    const gate = canCommand(mappingDoc, validation);
    expect(gate.ok).toBe(false);
    if (!gate.ok) {
      expect(gate.reason).toMatch(/verifiedOnHardware/i);
    }
  });

  it('is false when validation failed', () => {
    const bad = { ok: false, errors: ['broken'], warnings: [] };
    expect(canCommand(mappingDoc, bad).ok).toBe(false);
  });
});
