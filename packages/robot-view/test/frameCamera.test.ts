import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { frameCameraOnModel } from '../src/scene/frameCamera.js';

class FakeControls {
  target = new THREE.Vector3();
}

describe('frameCameraOnModel', () => {
  it('offsets the orbit target left and moves the camera closer', () => {
    const modelRoot = new THREE.Group();
    modelRoot.add(new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2)));
    const camera = new THREE.PerspectiveCamera();
    const controls = new FakeControls() as unknown as import('three/addons/controls/OrbitControls.js').OrbitControls;

    frameCameraOnModel(modelRoot, camera, controls);

    const radius = 2;
    expect(controls.target.x).toBeCloseTo(-radius * 0.12, 5);
    expect(camera.position.x).toBeCloseTo(radius * 0.82, 5);
    expect(camera.position.z).toBeCloseTo(radius * 0.9, 5);
  });
});
