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
  toleranceMm: number;
  tcpLinkBySide: { right: string; left: string };
  cases: FkCase[];
}

type Point = { x: number; y: number; z: number };

/**
 * pib-sdk's arm model is idealized (5-15 mm per segment, PR-2158) and the two base frames are
 * defined differently, so absolute palm positions cannot agree - comparing them would measure the
 * frame offset, not the kinematics. The distance the hand travels between two poses cancels the
 * frame out and leaves the geometry. This is a regression guard: it does not prove that the
 * two models agree - they do not, by up to 75 mm of hand travel - it fails when the difference
 * changes, which means the CAD or the SDK geometry moved underneath it (PR-2158).
 */
function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

describe('viewer FK vs pib-sdk reference', () => {
  let model: RobotModel;
  let fkCtx: ReturnType<typeof buildViewerFkContext>;

  beforeAll(async () => {
    model = JSON.parse(
      readFileSync(resolve(repoRoot, 'web/model.json'), 'utf8'),
    ) as RobotModel;
    const modelUrl = pathToFileURL(resolve(repoRoot, 'web/model.json')).href;
    const { linkNodes, partsOf } = await loadLinkMeshes(model, modelUrl, () => {});
    fkCtx = buildViewerFkContext(model, linkNodes, partsOf);
  }, 120_000);

  it('records the FK difference to pib-sdk and fails when it grows', () => {
    const doc = JSON.parse(readFileSync(referencePath, 'utf8')) as FkReferenceDoc;
    const tolerance = doc.toleranceMm;
    const lines: string[] = [];
    let worst = 0;

    for (const side of ['right', 'left'] as const) {
      const cases = doc.cases.filter((c) => c.side === side);
      if (cases.length < 2) continue;
      const tcp = side === 'left' ? TCP_LINK_LEFT : TCP_LINK_RIGHT;
      const viewerPoints = cases.map((testCase) => {
        applyModelJointRadians(fkCtx.motions, testCase.jointsRad);
        return computeHandMmInBaseFrame(fkCtx, tcp);
      });

      for (let i = 0; i < cases.length; i += 1) {
        for (let j = i + 1; j < cases.length; j += 1) {
          const sdk = distance(cases[i]!.sdkPalmMm, cases[j]!.sdkPalmMm);
          const viewer = distance(viewerPoints[i]!, viewerPoints[j]!);
          const delta = Math.abs(sdk - viewer);
          worst = Math.max(worst, delta);
          lines.push(
            `${side} ${cases[i]!.name} -> ${cases[j]!.name}: sdk ${sdk.toFixed(1)} mm, ` +
              `viewer ${viewer.toFixed(1)} mm, delta ${delta.toFixed(1)} mm`,
          );
          expect(delta, `${cases[i]!.name} -> ${cases[j]!.name} (${side})`).toBeLessThanOrEqual(
            tolerance,
          );
        }
      }
    }

    // eslint-disable-next-line no-console
    console.log(
      `FK distance check, tolerance ${tolerance} mm, worst delta ${worst.toFixed(1)} mm\n` +
        lines.join('\n'),
    );
  });
});
