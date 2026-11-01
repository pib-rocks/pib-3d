import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import type { JointMappingDocument, RobotModel } from '../src/types.js';
import {
  applyModelJointRadians,
  buildViewerFkContext,
  computeHandMmInBaseFrame,
} from '../src/model/viewerFk.js';
import { TCP_LINK_LEFT, TCP_LINK_RIGHT } from '../src/scene/baseFrame.js';
import { sampleToModelJoints } from '../src/joints/liveState.js';

const repoRoot = resolve(import.meta.dirname, '../../..');

/**
 * The two arms are mirror images. When both shoulders and both elbows are driven with the same
 * magnitude, the hands must end up mirrored as well: same height, same distance forward, opposite
 * sides.
 *
 * This is the guard for the direction signs in joints/mapping.json. A wrong sign on one side
 * turns that arm to the far side of the body - it reads as a shoulder rotated by roughly 180
 * degrees - and nothing else in the build notices: the model is self-consistent, every mesh
 * check passes, and the manifest matches the robot. Only comparing the two arms catches it.
 */
describe('arm mirror symmetry', () => {
  let model: RobotModel;
  let mapping: JointMappingDocument;
  let fkCtx: ReturnType<typeof buildViewerFkContext>;

  beforeAll(async () => {
    model = JSON.parse(readFileSync(resolve(repoRoot, 'web/model.json'), 'utf8')) as RobotModel;
    mapping = JSON.parse(
      readFileSync(resolve(repoRoot, 'joints/mapping.json'), 'utf8'),
    ) as JointMappingDocument;
    // FK needs the kinematic tree, not the meshes: the geometry comes from web/model.json.
    // Each link gets a millimetre-sized box so the base-frame seating (which takes the lowest
    // geometry point) has something to measure - the pose numbers are what this test compares.
    const linkNodes = new Map<string, THREE.Object3D>(
      model.links.map((link) => {
        const node = new THREE.Object3D();
        node.name = link.name;
        node.add(new THREE.Mesh(new THREE.BoxGeometry(0.001, 0.001, 0.001)));
        return [link.name, node];
      }),
    );
    fkCtx = buildViewerFkContext(model, linkNodes, new Map());
  }, 120_000);

  /** Drive both arms with the same magnitudes and compare where the hands land. */
  function handsFor(innerRad: number, horizontalRad: number, elbowRad: number) {
    const names = [
      'shoulder_vertical_left',
      'shoulder_vertical_right',
      'shoulder_horizontal_left',
      'shoulder_horizontal_right',
      'elbow_left',
      'elbow_right',
    ];
    const positions = [
      innerRad,
      innerRad,
      horizontalRad,
      horizontalRad,
      elbowRad,
      elbowRad,
    ];
    const joints = sampleToModelJoints({ names, positions, stampMs: 1 }, mapping, null);
    expect(joints.unknown, 'shoulder/elbow motors must be mapped').toEqual([]);
    applyModelJointRadians(fkCtx.motions, joints.values);
    return {
      left: computeHandMmInBaseFrame(fkCtx, TCP_LINK_LEFT),
      right: computeHandMmInBaseFrame(fkCtx, TCP_LINK_RIGHT),
    };
  }

  const poses: Array<[string, number, number, number]> = [
    ['arms out and slightly down', 0.6, 0.5, 0.4],
    ['arms forward', 0.2, 0.9, 0.2],
    ['elbows bent', 0.45, 0.3, 1.0],
  ];

  for (const [label, inner, horizontal, elbow] of poses) {
    it(`keeps the hands mirrored (${label})`, () => {
      const { left, right } = handsFor(inner, horizontal, elbow);
      // Base frame: x lateral, y forward, z up.
      const heightDelta = Math.abs(left.z - right.z);
      const forwardDelta = Math.abs(left.y - right.y);
      const onOppositeSides = left.x > 0 && right.x < 0;

      const detail =
        `left ${left.x.toFixed(0)}/${left.y.toFixed(0)}/${left.z.toFixed(0)} mm, ` +
        `right ${right.x.toFixed(0)}/${right.y.toFixed(0)}/${right.z.toFixed(0)} mm, ` +
        `height ${heightDelta.toFixed(0)} mm, forward ${forwardDelta.toFixed(0)} mm`;

      // The CAD is not perfectly symmetric (the two arms are separate solids, and the left wrist
      // mate is still `fixed` upstream, PR-2089), so the thresholds are what the corrected
      // mapping achieves with margin - forward 20/41/1 mm, height 15/2/32 mm - while the broken
      // one lands at forward 100/345/143 mm.
      expect(onOppositeSides, `hands are not on opposite sides - ${detail}`).toBe(true);
      expect(heightDelta, `hand height differs - ${detail}`).toBeLessThanOrEqual(40);
      expect(forwardDelta, `hand forward position differs - ${detail}`).toBeLessThanOrEqual(60);
    });
  }
});
