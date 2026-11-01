#!/usr/bin/env node
/**
 * Write web/manifest.json from the real model and mapping, so the published demo describes the
 * same install the backend would serve. Run by `npm run build:demo`.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const modelPath = resolve(repoRoot, 'web/model.json');
const mappingPath = resolve(repoRoot, 'joints/mapping.json');
const outPath = resolve(repoRoot, 'web/manifest.json');
const { version } = JSON.parse(readFileSync(resolve(here, '../package.json'), 'utf8'));

const modelRaw = readFileSync(modelPath);
const mappingRaw = readFileSync(mappingPath);
const model = JSON.parse(modelRaw);
const mapping = JSON.parse(mappingRaw);

const joints = Array.isArray(mapping.joints) ? mapping.joints : [];
const jointNames = joints.map((e) => e.urdfJoint).filter(Boolean);
const motors = joints
  .filter((e) => e.class === 'driven' && e.motor)
  .map((e) => e.motor)
  .sort();

const manifest = {
  version: `v${version}`,
  modelBuild: model.build ?? '',
  links: (model.links ?? []).length,
  joints: jointNames.length,
  jointNames,
  motors,
  mappingSha256: createHash('sha256').update(mappingRaw).digest('hex'),
  integrity: 'ok',
  files: { model: './model.json', mapping: './mapping.json' },
  meshes: (model.links ?? [])
    .filter((l) => l.mesh)
    .map((l) => ({ name: l.mesh.split('/').pop(), url: `./${l.mesh}` })),
};

writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(
  `manifest: ${manifest.joints} joints, ${manifest.motors.length} motors, sha ${manifest.mappingSha256.slice(0, 8)}`,
);
