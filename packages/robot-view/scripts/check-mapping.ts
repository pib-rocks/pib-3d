import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { RobotModel } from '../src/types.js';
import {
  PIB5ADVANCED_MOTORS,
  validateMapping,
  type JointMappingDocument,
} from '../src/joints/mapping.ts';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const mappingPath = resolve(repoRoot, 'joints/mapping.json');
const modelPath = resolve(repoRoot, 'web/model.json');

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

const mapping = readJson<JointMappingDocument>(mappingPath);
const model = readJson<RobotModel>(modelPath);
const result = validateMapping(mapping, model);

let exitCode = 0;
const report: string[] = [];

if (result.warnings.length) {
  for (const w of result.warnings) report.push(`warning: ${w}`);
}
if (result.errors.length) {
  for (const e of result.errors) report.push(`error: ${e}`);
  exitCode = 1;
}

const drivenMotors = new Set(
  mapping.joints.filter((j) => j.class === 'driven' && j.motor).map((j) => j.motor as string),
);
const expected = new Set(PIB5ADVANCED_MOTORS);
for (const m of expected) {
  if (!drivenMotors.has(m)) {
    report.push(`error: driven mapping is missing pib5advanced motor "${m}"`);
    exitCode = 1;
  }
}
for (const m of drivenMotors) {
  if (!expected.has(m)) {
    report.push(`error: unexpected motor "${m}" (not in pib5advanced MOTOR_MAPPING)`);
    exitCode = 1;
  }
}

// web/ is what GitHub Pages serves; the build copies the mapping there. A stale copy would
// show the operator a different contract than the one this check just validated.
const servedPath = resolve(repoRoot, 'web/mapping.json');
try {
  const served = readFileSync(servedPath, 'utf8');
  if (served !== readFileSync(mappingPath, 'utf8')) {
    report.push('error: web/mapping.json differs from joints/mapping.json (run npm run build)');
    exitCode = 1;
  }
} catch {
  report.push('error: web/mapping.json is missing (run npm run build)');
  exitCode = 1;
}

// web/manifest.json is generated from the same two files; a stale copy would publish a manifest
// the viewer compares against and then refuse to move.
const manifestPath = resolve(repoRoot, 'web/manifest.json');
try {
  const manifest = readJson<{ motors?: string[]; jointNames?: string[]; mappingSha256?: string }>(
    manifestPath,
  );
  const servedMotors = (manifest.motors ?? []).slice().sort();
  const expectedMotors = [...drivenMotors].sort();
  if (JSON.stringify(servedMotors) !== JSON.stringify(expectedMotors)) {
    report.push('error: web/manifest.json motors differ from joints/mapping.json (run npm run build:demo)');
    exitCode = 1;
  }
  if ((manifest.jointNames ?? []).length !== mapping.joints.length) {
    report.push('error: web/manifest.json jointNames length differs from the mapping');
    exitCode = 1;
  }
} catch {
  report.push('error: web/manifest.json is missing (run npm run build:demo)');
  exitCode = 1;
}

if (report.length === 0) {
  console.log(
    `check:mapping OK — ${mapping.joints.length} joints, ${PIB5ADVANCED_MOTORS.length} motors (pib5advanced)`,
  );
} else {
  console.error(report.join('\n'));
  process.exit(exitCode);
}
