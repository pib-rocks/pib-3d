import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { ModelLink, RobotModel } from '../types.js';

export interface LoadedLinks {
  linkNodes: Map<string, THREE.Object3D>;
  partsOf: Map<string, string[]>;
}

export type LoadProgress = (done: number, total: number) => void;

const modelCache = new Map<string, Promise<RobotModel>>();
const meshSceneCache = new Map<string, Promise<THREE.Object3D>>();

export function clearModelCache(): void {
  modelCache.clear();
  meshSceneCache.clear();
}

/**
 * Meshes live next to the model file, not next to the page. A host that mounts the viewer on
 * /joint-control/3d with model-url="/api/robot-model/model.json" must get
 * /api/robot-model/meshes/<file>, so the path is resolved against the model URL.
 */
export function meshUrl(model: RobotModel, link: ModelLink, modelUrl: string): string {
  const q = model.build ? `?v=${model.build}` : '';
  const base = new URL(modelUrl, document.baseURI);
  return new URL(`${link.mesh}${q}`, base).href;
}

function tuneMeshMaterials(mesh: THREE.Mesh): void {
  if (!mesh.material) return;
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const m of mats) {
    const std = m as THREE.MeshStandardMaterial;
    std.envMapIntensity = 0.6;
    if (std.metalness !== undefined) std.metalness = Math.min(std.metalness, 0.35);
  }
}

function preparePrototypeScene(scene: THREE.Object3D, linkName: string): void {
  scene.name = linkName;
  scene.traverse((o) => {
    o.userData.link = linkName;
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) tuneMeshMaterials(mesh);
  });
}

function cloneLinkScene(proto: THREE.Object3D, linkName: string): THREE.Object3D {
  const node = proto.clone(true);
  node.name = linkName;
  node.traverse((o) => {
    o.userData.link = linkName;
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (mesh.geometry) mesh.geometry = mesh.geometry.clone();
    if (mesh.material) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      mesh.material =
        mats.length === 1 ? mats[0]!.clone() : mats.map((m) => m.clone());
      tuneMeshMaterials(mesh);
    }
  });
  return node;
}

async function loadMeshPrototype(url: string, linkName: string): Promise<THREE.Object3D> {
  let pending = meshSceneCache.get(url);
  if (!pending) {
    const loader = new GLTFLoader();
    pending = loader.loadAsync(url).then((gltf) => {
      const scene = gltf.scene;
      preparePrototypeScene(scene, linkName);
      return scene;
    });
    meshSceneCache.set(url, pending);
  }
  const proto = await pending;
  return cloneLinkScene(proto, linkName);
}

export async function loadLinkMeshes(
  model: RobotModel,
  modelUrl: string,
  onProgress: LoadProgress,
  parallelism = 6,
): Promise<LoadedLinks> {
  const linkNodes = new Map<string, THREE.Object3D>();
  const partsOf = new Map(model.links.map((l) => [l.name, l.parts || [l.name]]));
  const done = { count: 0 };
  const total = model.links.length;
  const queue = model.links.slice();

  async function worker(): Promise<void> {
    while (queue.length) {
      const link = queue.shift();
      if (!link) break;
      const url = meshUrl(model, link, modelUrl);
      const node = await loadMeshPrototype(url, link.name);
      linkNodes.set(link.name, node);
      done.count += 1;
      onProgress(done.count, total);
    }
  }

  await Promise.all(Array.from({ length: parallelism }, () => worker()));
  return { linkNodes, partsOf };
}

export async function fetchModel(modelUrl: string): Promise<RobotModel> {
  let pending = modelCache.get(modelUrl);
  if (!pending) {
    pending = (async () => {
      const response = await fetch(modelUrl);
      if (!response.ok) throw new Error(`model.json: HTTP ${response.status}`);
      return response.json() as Promise<RobotModel>;
    })();
    modelCache.set(modelUrl, pending);
  }
  return pending;
}
