import * as THREE from 'three';
import type { MotionEntry, RobotModel } from '../types.js';
import { applyJointValue } from '../joints/math.js';
import {
  alignModelToBaseFrame,
  BASE_LINK,
  linkOriginInBaseMetres,
  TCP_LINK_RIGHT,
  type BaseFrameContext,
} from '../scene/baseFrame.js';
import { attachRootToScene, buildKinematicTree } from './kinematicTree.js';
import { ensureFrameLinks } from './frameLinks.js';

export interface PoseInBaseFrame {
  base: { x: number; y: number; z: number };
  hand: { x: number; y: number; z: number };
}

export interface ViewerFkContext {
  modelRoot: THREE.Group;
  baseFrame: BaseFrameContext;
  linkNodes: Map<string, THREE.Object3D>;
  motions: MotionEntry[];
}

export function buildViewerFkContext(
  model: RobotModel,
  linkNodes: Map<string, THREE.Object3D>,
  partsOf: Map<string, string[]>,
): ViewerFkContext {
  ensureFrameLinks(model, linkNodes, partsOf);
  const kinematic = buildKinematicTree(model, linkNodes);
  const modelRoot = new THREE.Group();
  modelRoot.rotation.x = -Math.PI / 2;
  attachRootToScene(modelRoot, linkNodes, kinematic.rootLink);
  // Same call the element makes: the frame axis runs through the root link, not the mesh box.
  const baseFrame = alignModelToBaseFrame(modelRoot, linkNodes.get(BASE_LINK));
  return { modelRoot, baseFrame, linkNodes, motions: kinematic.motions };
}

export function applyModelJointRadians(
  motions: MotionEntry[],
  jointRadians: Record<string, number>,
): void {
  for (const m of motions) {
    const v = jointRadians[m.joint.name] ?? 0;
    applyJointValue(m.joint, m.motion, m.axis, v);
  }
}

export function computePoseInBaseFrame(
  ctx: ViewerFkContext,
  tcpLink = TCP_LINK_RIGHT,
): PoseInBaseFrame {
  ctx.modelRoot.updateMatrixWorld(true);
  const baseNode = ctx.linkNodes.get(BASE_LINK);
  const handNode = ctx.linkNodes.get(tcpLink);
  if (!baseNode || !handNode) {
    throw new Error(`Missing link for pose (${BASE_LINK} / ${tcpLink})`);
  }
  return {
    base: linkOriginInBaseMetres(baseNode, ctx.baseFrame),
    hand: linkOriginInBaseMetres(handNode, ctx.baseFrame),
  };
}

export function computeHandMmInBaseFrame(
  ctx: ViewerFkContext,
  tcpLink = TCP_LINK_RIGHT,
): { x: number; y: number; z: number } {
  const hand = computePoseInBaseFrame(ctx, tcpLink).hand;
  return {
    x: hand.x * 1000,
    y: hand.y * 1000,
    z: hand.z * 1000,
  };
}
