import type { JointMappingDocument } from '../joints/mapping.js';

export interface RobotModelManifest {
  version?: string;
  modelBuild?: string;
  links?: number;
  joints?: number;
  jointNames?: string[];
  motors?: string[];
  mappingSha256?: string;
  integrity?: 'ok' | 'mismatch';
  files?: Record<string, string>;
  meshes?: string[];
}

export interface ModelConsistencyResult {
  ok: boolean;
  reason: string | null;
}

export function drivenMotorsFromMapping(mapping: JointMappingDocument): string[] {
  return mapping.joints
    .filter((e) => e.class === 'driven' && e.motor != null)
    .map((e) => e.motor!)
    .sort((a, b) => a.localeCompare(b));
}

export function formatMotorSetMismatch(
  modelMotors: readonly string[],
  robotMotors: readonly string[],
): string {
  const modelSet = new Set(modelMotors);
  const robotSet = new Set(robotMotors);
  const missing = robotMotors.filter((m) => !modelSet.has(m));
  const extra = modelMotors.filter((m) => !robotSet.has(m));
  const parts: string[] = [];
  if (missing.length) parts.push(`missing ${missing.join(', ')}`);
  if (extra.length) parts.push(`extra ${extra.join(', ')}`);
  return `model has ${modelMotors.length} motors, robot has ${robotMotors.length}${parts.length ? `: ${parts.join(', ')}` : ''}`;
}

export function computeModelConsistency(
  mapping: JointMappingDocument | null,
  manifest: RobotModelManifest | null,
  expectedMotors: string[] | null,
): ModelConsistencyResult {
  if (manifest?.integrity === 'mismatch') {
    return {
      ok: false,
      reason: 'installed model is inconsistent (integrity mismatch)',
    };
  }

  if (!mapping) {
    return { ok: true, reason: null };
  }

  const mappingMotors = drivenMotorsFromMapping(mapping);

  if (manifest?.motors != null) {
    const manifestMotors = [...manifest.motors].sort((a, b) => a.localeCompare(b));
    const modelSet = new Set(manifestMotors);
    const robotSet = new Set(mappingMotors);
    if (
      manifestMotors.length !== mappingMotors.length ||
      manifestMotors.some((m) => !robotSet.has(m)) ||
      mappingMotors.some((m) => !modelSet.has(m))
    ) {
      return {
        ok: false,
        reason: formatMotorSetMismatch(manifestMotors, mappingMotors),
      };
    }
  }

  if (expectedMotors != null) {
    const robotMotors = [...expectedMotors].sort((a, b) => a.localeCompare(b));
    const modelSet = new Set(mappingMotors);
    const expectedSet = new Set(robotMotors);
    if (
      robotMotors.length !== mappingMotors.length ||
      robotMotors.some((m) => !modelSet.has(m)) ||
      mappingMotors.some((m) => !expectedSet.has(m))
    ) {
      return {
        ok: false,
        reason: formatMotorSetMismatch(mappingMotors, robotMotors),
      };
    }
  }

  return { ok: true, reason: null };
}

export async function fetchModelManifest(
  modelUrl: string,
): Promise<{ manifest: RobotModelManifest | null }> {
  const url = new URL('manifest.json', new URL(modelUrl, document.baseURI)).href;
  try {
    const res = await fetch(url);
    if (res.status === 404) {
      return { manifest: null };
    }
    if (!res.ok) {
      return { manifest: null };
    }
    const manifest = (await res.json()) as RobotModelManifest;
    return { manifest };
  } catch {
    return { manifest: null };
  }
}
