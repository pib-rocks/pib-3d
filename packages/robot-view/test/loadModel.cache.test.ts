import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  clearModelCache,
  fetchModel,
  loadLinkMeshes,
  meshUrl,
} from '../src/model/loadModel.js';
import type { RobotModel } from '../src/types.js';

const loadAsync = vi.fn();

vi.mock('three/addons/loaders/GLTFLoader.js', () => ({
  GLTFLoader: class {
    loadAsync = loadAsync;
  },
}));

function makeGltfScene(): THREE.Object3D {
  const scene = new THREE.Group();
  const geom = new THREE.BoxGeometry();
  const mat = new THREE.MeshStandardMaterial({ emissive: new THREE.Color(0x000000) });
  const mesh = new THREE.Mesh(geom, mat);
  scene.add(mesh);
  return scene;
}

const miniModel = {
  build: 't1',
  links: [
    { name: 'root', mesh: 'meshes/root.glb' },
    { name: 'arm', mesh: 'meshes/arm.glb' },
  ],
  joints: [{ name: 'j1', parent: 'root', child: 'arm', origin: { xyz: [0, 0, 0], rpy: [0, 0, 0] }, axis: [0, 1, 0] }],
} as unknown as RobotModel;

describe('model and mesh cache', () => {
  beforeEach(() => {
    clearModelCache();
    loadAsync.mockReset();
    loadAsync.mockImplementation(async () => ({ scene: makeGltfScene() }));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => miniModel,
      })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reuses fetch and GLTF loads across loadLinkMeshes calls', async () => {
    const modelUrl = 'http://localhost/model.json';
    const loadedA = await fetchModel(modelUrl);
    await loadLinkMeshes(loadedA, modelUrl, () => {});
    const loadedB = await fetchModel(modelUrl);
    await loadLinkMeshes(loadedB, modelUrl, () => {});

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(loadAsync).toHaveBeenCalledTimes(2);
    const armUrl = meshUrl(miniModel, miniModel.links[1]!, modelUrl);
    const rootUrl = meshUrl(miniModel, miniModel.links[0]!, modelUrl);
    expect(loadAsync).toHaveBeenCalledWith(armUrl);
    expect(loadAsync).toHaveBeenCalledWith(rootUrl);
  });

  it('fetchModel shares one in-flight request per URL', async () => {
    const url = 'http://localhost/model.json';
    const [a, b] = await Promise.all([fetchModel(url), fetchModel(url)]);
    expect(a).toBe(b);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('instances own cloned materials independent of the cache', async () => {
    const modelUrl = 'http://localhost/model.json';
    const first = await loadLinkMeshes(miniModel, modelUrl, () => {});
    const second = await loadLinkMeshes(miniModel, modelUrl, () => {});

    const matA = (first.linkNodes.get('arm')!.children[0] as THREE.Mesh).material as THREE.Material;
    const matB = (second.linkNodes.get('arm')!.children[0] as THREE.Mesh).material as THREE.Material;
    expect(matA).not.toBe(matB);
  });
});
