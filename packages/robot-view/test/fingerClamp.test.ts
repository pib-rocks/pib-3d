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
import { sampleToModelJoints } from '../src/joints/liveState.js';

const repoRoot = resolve(import.meta.dirname, '../../..');

/**
 * The cable-driven finger servos travel 360 degrees where the finger joint only travels 90. The
 * ends of the servo range are slack, so the finger rests on its stop instead of folding past it.
 * Without the clamp the model hyperextends at servo -180 and folds through the palm at +180.
 */
describe('finger travel clamp', () => {
  let model: RobotModel;
  let mapping: JointMappingDocument;
  let fkCtx: ReturnType<typeof buildViewerFkContext>;

  beforeAll(() => {
    model = JSON.parse(readFileSync(resolve(repoRoot, 'web/model.json'), 'utf8')) as RobotModel;
    mapping = JSON.parse(
      readFileSync(resolve(repoRoot, 'joints/mapping.json'), 'utf8'),
    ) as JointMappingDocument;
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

  function handForIndexServo(degrees: number) {
    const joints = sampleToModelJoints(
      { names: ['index_right_stretch'], positions: [(degrees * Math.PI) / 180], stampMs: 1 },
      mapping,
      null,
    );
    expect(joints.unknown).toEqual([]);
    applyModelJointRadians(fkCtx.motions, joints.values);
    // The fingertip link, not the palm: the palm does not move when a finger curls.
    return computeHandMmInBaseFrame(fkCtx, 'd55_finger_tip');
  }

  function distance(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  }

  it('holds the fingertip still below the extended stop', () => {
    const atMinus90 = handForIndexServo(-90);
    const atMinus180 = handForIndexServo(-180);
    expect(distance(atMinus90, atMinus180)).toBeLessThan(1);
  });

  it('holds the fingertip still beyond the closed stop', () => {
    const atPlus90 = handForIndexServo(90);
    const atPlus180 = handForIndexServo(180);
    expect(distance(atPlus90, atPlus180)).toBeLessThan(1);
  });

  it('still moves between the stops', () => {
    const extended = handForIndexServo(-90);
    const closed = handForIndexServo(90);
    expect(distance(extended, closed)).toBeGreaterThan(50);
  });
});
