import type { ModelJoint, RobotModel } from '../types.js';

export type JointClass = 'driven' | 'coupled' | 'passive';

export interface JointMappingEntry {
  urdfJoint: string;
  motor: string | null;
  class: JointClass;
  type: string;
  direction: -1 | 1 | null;
  gearRatio: number;
  zeroOffsetDeg: number;
  limitsRad: [number, number] | null;
  axisDot: number | null;
  verifiedOnHardware: boolean;
  note?: string;
}

export interface JointMappingDocument {
  schemaVersion: number;
  robotVariant: string;
  modelBuild?: string;
  source?: Record<string, string>;
  joints: JointMappingEntry[];
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

/** Motor names for pib5advanced — pib-backend `pib_api/flask/seed_profiles/pib5advanced.py` (`MOTOR_MAPPING`). */
export const PIB5ADVANCED_MOTORS: readonly string[] = [
  'elbow_left',
  'elbow_right',
  'index_left_stretch',
  'index_right_stretch',
  'lower_arm_left_rotation',
  'lower_arm_right_rotation',
  'middle_left_stretch',
  'middle_right_stretch',
  'pinky_left_stretch',
  'pinky_right_stretch',
  'ring_left_stretch',
  'ring_right_stretch',
  'shoulder_horizontal_left',
  'shoulder_horizontal_right',
  'shoulder_vertical_left',
  'shoulder_vertical_right',
  'thumb_left_opposition',
  'thumb_left_stretch',
  'thumb_right_opposition',
  'thumb_right_stretch',
  'tilt_forward_motor',
  'turn_head_motor',
  'upper_arm_left_rotation',
  'upper_arm_right_rotation',
  'wrist_left',
  'wrist_right',
] as const;

const LIMIT_EPS = 1e-4;
const PIB5_MOTOR_SET = new Set<string>(PIB5ADVANCED_MOTORS);

export function modelRadToMotorCentideg(entry: JointMappingEntry, modelRad: number): number {
  const direction = entry.direction ?? 1;
  return (modelRad * (180 / Math.PI) + entry.zeroOffsetDeg) * 100 * direction;
}

export function motorCentidegToModelRad(entry: JointMappingEntry, motorCentideg: number): number {
  const direction = entry.direction ?? 1;
  const deg = motorCentideg / (100 * direction) - entry.zeroOffsetDeg;
  return deg * (Math.PI / 180);
}

export function expectedLimitsRad(joint: ModelJoint): [number, number] | null {
  if (joint.type === 'continuous') return null;
  if (!joint.limit) return null;
  return [joint.limit.lower, joint.limit.upper];
}

function limitsMatch(
  expected: [number, number] | null,
  actual: [number, number] | null,
): boolean {
  if (expected === null && actual === null) return true;
  if (expected === null || actual === null) return false;
  return (
    Math.abs(expected[0] - actual[0]) <= LIMIT_EPS &&
    Math.abs(expected[1] - actual[1]) <= LIMIT_EPS
  );
}

export function validateMapping(
  mapping: JointMappingDocument,
  model: RobotModel,
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const modelJointNames = new Set(model.joints.map((j) => j.name));
  const mappedNames = new Set(mapping.joints.map((j) => j.urdfJoint));

  for (const name of modelJointNames) {
    if (!mappedNames.has(name)) {
      errors.push(`model joint "${name}" is missing from the mapping`);
    }
  }
  for (const name of mappedNames) {
    if (!modelJointNames.has(name)) {
      errors.push(`mapping entry "${name}" is not a joint in model.json`);
    }
  }

  const motorsSeen = new Map<string, string>();
  for (const entry of mapping.joints) {
    if (entry.class === 'driven') {
      if (entry.motor == null) {
        errors.push(`driven joint "${entry.urdfJoint}" has no motor`);
      }
      if (entry.direction == null) {
        errors.push(`driven joint "${entry.urdfJoint}" has null direction`);
      }
      if (entry.motor != null) {
        if (!PIB5_MOTOR_SET.has(entry.motor)) {
          errors.push(`motor "${entry.motor}" on "${entry.urdfJoint}" is not in pib5advanced MOTOR_MAPPING`);
        }
        const prev = motorsSeen.get(entry.motor);
        if (prev) {
          errors.push(`motor "${entry.motor}" is assigned to both "${prev}" and "${entry.urdfJoint}"`);
        } else {
          motorsSeen.set(entry.motor, entry.urdfJoint);
        }
      }
    } else if (entry.class === 'coupled' || entry.class === 'passive') {
      if (entry.motor != null) {
        errors.push(`${entry.class} joint "${entry.urdfJoint}" must not have a motor`);
      }
    } else {
      errors.push(`joint "${entry.urdfJoint}" has unknown class "${String(entry.class)}"`);
    }

    const modelJoint = model.joints.find((j) => j.name === entry.urdfJoint);
    if (modelJoint) {
      const expected = expectedLimitsRad(modelJoint);
      if (!limitsMatch(expected, entry.limitsRad)) {
        errors.push(
          `limitsRad for "${entry.urdfJoint}" does not match model.json (expected ${JSON.stringify(expected)}, got ${JSON.stringify(entry.limitsRad)})`,
        );
      }
    }
  }

  for (const motor of PIB5ADVANCED_MOTORS) {
    if (!motorsSeen.has(motor)) {
      errors.push(`pib5advanced motor "${motor}" is not assigned to any driven joint`);
    }
  }

  if (!mapping.robotVariant) {
    warnings.push('mapping has no robotVariant');
  }

  return { ok: errors.length === 0, errors, warnings };
}

export function canCommand(
  mapping: JointMappingDocument | null,
  validation: ValidationResult | null,
): { ok: true } | { ok: false; reason: string } {
  if (!mapping) {
    return { ok: false, reason: 'joint mapping is not loaded' };
  }
  if (!validation?.ok) {
    const detail = validation?.errors[0] ?? 'mapping validation failed';
    return { ok: false, reason: detail };
  }
  for (const entry of mapping.joints) {
    if (entry.class !== 'driven') continue;
    if (entry.direction == null) {
      return {
        ok: false,
        reason: `driven joint "${entry.urdfJoint}" has no direction; hardware command refused`,
      };
    }
    if (!entry.verifiedOnHardware) {
      return {
        ok: false,
        reason:
          'mapping is not verified on hardware yet (verifiedOnHardware is false for driven joints)',
      };
    }
  }
  return { ok: true };
}

export interface LoadMappingResult {
  mapping: JointMappingDocument | null;
  loadError: string | null;
}

export async function loadMapping(url: string): Promise<LoadMappingResult> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      return { mapping: null, loadError: `Failed to load mapping (${res.status} ${res.statusText}) from ${url}` };
    }
    const mapping = (await res.json()) as JointMappingDocument;
    if (!Array.isArray(mapping.joints)) {
      return { mapping: null, loadError: `Invalid mapping JSON from ${url}: missing joints array` };
    }
    return { mapping, loadError: null };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { mapping: null, loadError: `Failed to load mapping from ${url}: ${message}` };
  }
}

export function mappingByUrdfJoint(mapping: JointMappingDocument): Map<string, JointMappingEntry> {
  return new Map(mapping.joints.map((e) => [e.urdfJoint, e]));
}

export function jointClassLabel(className: JointClass): string {
  switch (className) {
    case 'driven':
      return 'angetrieben';
    case 'coupled':
      return 'gekoppelt';
    case 'passive':
      return 'passiv';
  }
}

export function commandDisableTitle(entry: JointMappingEntry): string {
  if (entry.class === 'coupled') {
    return 'Gekoppelt — kein Motor, in Befehlsmodus nicht steuerbar';
  }
  if (entry.class === 'passive') {
    return 'Passiv — kein Motor, in Befehlsmodus nicht steuerbar';
  }
  return '';
}
