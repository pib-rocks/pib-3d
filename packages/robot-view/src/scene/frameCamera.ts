import * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export { alignModelToBaseFrame, type BaseFrameContext } from './baseFrame.js';

export function frameCameraOnModel(
  modelRoot: THREE.Group,
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
): { size: THREE.Vector3; triangles: number } {
  const box = new THREE.Box3().setFromObject(modelRoot);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const radius = Math.max(size.x, size.y, size.z);
  controls.target.set(center.x, center.y * 0.95, center.z);
  camera.position.set(
    center.x + radius * 1.05,
    center.y + radius * 0.42,
    center.z + radius * 1.15,
  );
  camera.near = radius / 200;
  camera.far = radius * 60;
  camera.updateProjectionMatrix();

  let triangles = 0;
  modelRoot.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && mesh.geometry?.index) {
      triangles += mesh.geometry.index.count / 3;
    }
  });
  return { size, triangles };
}
