import * as THREE from 'three';

/** URDF link used as the robot base origin in pose readouts (REP-103 foot-point frame). */
export const BASE_LINK = 'root';

/** Provisional TCP links until PR-2057 defines the operational hand frame. */
export const TCP_LINK_RIGHT = 'd01_r_palm_right';
export const TCP_LINK_LEFT = 'd01_l_palm_left';

export interface BaseFrameContext {
  /** Foot point in scene/world coordinates after the model is seated on the grid. */
  footWorld: THREE.Vector3;
  /** Maps a scene-space offset from the foot point into base frame metres (Z up). */
  sceneOffsetToBase: THREE.Matrix3;
}

const _footScratch = new THREE.Vector3();
const _pointScratch = new THREE.Vector3();

/**
 * Seat the model on the grid using the lowest geometry point at the current (zero) pose as the
 * foot point, instead of shifting by an unlabeled bounding-box minimum.
 */
export function alignModelToBaseFrame(
  modelRoot: THREE.Group,
  baseNode?: THREE.Object3D,
): BaseFrameContext {
  modelRoot.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(modelRoot);
  // The frame axis runs through the robot's centre, not through the mesh bounding box: an open
  // service lid must not move the origin sideways.
  const axis = new THREE.Vector3();
  if (baseNode) baseNode.getWorldPosition(axis);
  const footWorld = new THREE.Vector3(
    baseNode ? axis.x : (box.min.x + box.max.x) / 2,
    box.min.y,
    baseNode ? axis.z : (box.min.z + box.max.z) / 2,
  );
  modelRoot.position.y -= footWorld.y;
  modelRoot.updateMatrixWorld(true);
  footWorld.y = 0;

  const worldRot = new THREE.Matrix3().setFromMatrix4(modelRoot.matrixWorld);
  const sceneOffsetToBase = worldRot.clone().invert();

  return { footWorld, sceneOffsetToBase };
}

export function scenePointToBaseMetres(
  pointWorld: THREE.Vector3,
  ctx: BaseFrameContext,
  target = _pointScratch,
): THREE.Vector3 {
  target.copy(pointWorld).sub(ctx.footWorld);
  target.applyMatrix3(ctx.sceneOffsetToBase);
  return target;
}

export function linkOriginInBaseMetres(
  link: THREE.Object3D,
  ctx: BaseFrameContext,
): { x: number; y: number; z: number } {
  link.getWorldPosition(_footScratch);
  scenePointToBaseMetres(_footScratch, ctx, _footScratch);
  return { x: _footScratch.x, y: _footScratch.y, z: _footScratch.z };
}

export function formatPoseMmMetres(p: { x: number; y: number; z: number }): string {
  const mm = (v: number) => (v * 1000).toFixed(1);
  return `${mm(p.x)}, ${mm(p.y)}, ${mm(p.z)} mm`;
}
