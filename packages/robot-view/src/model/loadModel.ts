import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { ModelLink, RobotModel } from '../types.js';

export interface LoadedLinks {
  linkNodes: Map<string, THREE.Object3D>;
  partsOf: Map<string, string[]>;
}

export type LoadProgress = (done: number, total: number) => void;

function meshUrl(model: RobotModel, link: ModelLink): string {
  const q = model.build ? `?v=${model.build}` : '';
  return `./${link.mesh}${q}`;
}

export async function loadLinkMeshes(
  model: RobotModel,
  onProgress: LoadProgress,
  parallelism = 6,
): Promise<LoadedLinks> {
  const loader = new GLTFLoader();
  const linkNodes = new Map<string, THREE.Object3D>();
  const partsOf = new Map(model.links.map((l) => [l.name, l.parts || [l.name]]));
  const done = { count: 0 };
  const total = model.links.length;
  const queue = model.links.slice();

  async function worker(): Promise<void> {
    while (queue.length) {
      const link = queue.shift();
      if (!link) break;
      const url = meshUrl(model, link);
      const gltf = await loader.loadAsync(url);
      const node = gltf.scene;
      node.name = link.name;
      node.traverse((o) => {
        o.userData.link = link.name;
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh && mesh.material) {
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const m of mats) {
            const std = m as THREE.MeshStandardMaterial;
            std.envMapIntensity = 0.6;
            if (std.metalness !== undefined) std.metalness = Math.min(std.metalness, 0.35);
          }
        }
      });
      linkNodes.set(link.name, node);
      done.count += 1;
      onProgress(done.count, total);
    }
  }

  await Promise.all(Array.from({ length: parallelism }, () => worker()));
  return { linkNodes, partsOf };
}

export async function fetchModel(modelUrl: string): Promise<RobotModel> {
  const response = await fetch(modelUrl);
  if (!response.ok) throw new Error(`model.json: HTTP ${response.status}`);
  return response.json() as Promise<RobotModel>;
}
