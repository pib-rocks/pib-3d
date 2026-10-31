import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export interface SceneBundle {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  grid: THREE.GridHelper;
  modelRoot: THREE.Group;
}

export function createScene(canvas: HTMLCanvasElement, width: number, height: number): SceneBundle {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio ?? 1, 2));
  renderer.setSize(width, height);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d1117);

  const camera = new THREE.PerspectiveCamera(42, width / height, 0.01, 200);
  camera.position.set(1.5, 1.15, 1.8);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 0.2;
  controls.maxDistance = 14;
  controls.target.set(0, 0.55, 0);
  controls.autoRotateSpeed = 0.7;

  scene.add(new THREE.HemisphereLight(0xffffff, 0x2b3138, 1.35));
  const key = new THREE.DirectionalLight(0xffffff, 2.0);
  key.position.set(2.5, 4.0, 2.0);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xbfd4ff, 0.75);
  fill.position.set(-2.5, 1.5, -2.0);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffffff, 0.5);
  rim.position.set(0, 2.0, -3.0);
  scene.add(rim);

  const grid = new THREE.GridHelper(4, 40, 0x3d444d, 0x21262d);
  grid.material.transparent = false;
  scene.add(grid);

  const modelRoot = new THREE.Group();
  modelRoot.rotation.x = -Math.PI / 2;
  scene.add(modelRoot);

  return { scene, camera, renderer, controls, grid, modelRoot };
}
