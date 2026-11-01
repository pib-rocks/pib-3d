import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { RobotModel } from '../src/types.js';
import { loadLinkMeshes } from '../src/model/loadModel.js';
import {
  buildViewerFkContext,
  applyModelJointRadians,
  computeHandMmInBaseFrame,
} from '../src/model/viewerFk.js';
import { TCP_LINK_LEFT, TCP_LINK_RIGHT } from '../src/scene/baseFrame.js';

const repoRoot = resolve(import.meta.dirname, '../../..');
const referencePath = resolve(repoRoot, 'tools/fk_reference.json');

interface FkCase {
  name: string;
  side: 'left' | 'right';
  jointsRad: Record<string, number>;
  sdkPalmMm: { x: number; y: number; z: number };
}

interface FkReferenceDoc {
  envelopeMm: { x: number; y: number; z: number };
  tcpLinkBySide: { right: string; left: string };
  cases: FkCase[];
}

describe('viewer FK vs pib-sdk reference', () => {
  let model: RobotModel;
  let fkCtx: ReturnType<typeof buildViewerFkContext>;
  const modelUrl = pathToFileURL(resolve(repoRoot, 'web/model.json')).href;

  beforeAll(async () => {
    model = JSON.parse(
      readFileSync(resolve(repoRoot, 'web/model.json'), 'utf8'),
    ) as RobotModel;
    const { linkNodes, partsOf } = await loadLinkMeshes(model, modelUrl, () => {});
    fkCtx = buildViewerFkContext(model, linkNodes, partsOf);
  }, 120_000);

  it('matches SDK palm positions within the recorded envelope', () => {
    const doc = JSON.parse(readFileSync(referencePath, 'utf8')) as FkReferenceDoc;
    const envelope = doc.envelopeMm;
    const lines: string[] = [];

    for (const testCase of doc.cases) {
      applyModelJointRadians(fkCtx.motions, testCase.jointsRad);
      const tcp =
        testCase.side === 'left' ? TCP_LINK_LEFT : TCP_LINK_RIGHT;
      const viewer = computeHandMmInBaseFrame(fkCtx, tcp);
      const sdk = testCase.sdkPalmMm;
      const delta = {
        x: Math.abs(viewer.x - sdk.x),
        y: Math.abs(viewer.y - sdk.y),
        z: Math.abs(viewer.z - sdk.z),
      };
      lines.push(
        `${testCase.name}: Δx=${delta.x.toFixed(2)} Δy=${delta.y.toFixed(2)} Δz=${delta.z.toFixed(2)} mm ` +
          `(viewer ${viewer.x.toFixed(1)}, ${viewer.y.toFixed(1)}, ${viewer.z.toFixed(1)} · ` +
          `sdk ${sdk.x.toFixed(1)}, ${sdk.y.toFixed(1)}, ${sdk.z.toFixed(1)})`,
      );
      expect(delta.x).toBeLessThanOrEqual(envelope.x);
      expect(delta.y).toBeLessThanOrEqual(envelope.y);
      expect(delta.z).toBeLessThanOrEqual(envelope.z);
    }

    // eslint-disable-next-line no-console
    console.log('\n' + lines.join('\n'));
  });
});
