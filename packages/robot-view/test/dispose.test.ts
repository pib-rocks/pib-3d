import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { PibRobotView, registerPibRobotView } from '../src/element/PibRobotView.js';
import { disposeObject3D } from '../src/render/onDemand.js';

describe('disposeObject3D', () => {
  it('disposes mesh geometry and material', () => {
    const geom = new THREE.BoxGeometry();
    const mat = new THREE.MeshBasicMaterial();
    const geomSpy = vi.spyOn(geom, 'dispose');
    const matSpy = vi.spyOn(mat, 'dispose');
    const root = new THREE.Mesh(geom, mat);
    disposeObject3D(root);
    expect(geomSpy).toHaveBeenCalled();
    expect(matSpy).toHaveBeenCalled();
  });
});

describe('PibRobotView.dispose()', () => {
  it('is idempotent and clears renderer geometry memory', () => {
    registerPibRobotView();
    const el = new PibRobotView();
    const rendererDispose = vi.fn();
    const memory = { geometries: 4 };
    const fakeBundle = {
      modelRoot: new THREE.Group(),
      grid: {
        geometry: { dispose: vi.fn() },
        material: { dispose: vi.fn() },
      },
      controls: { dispose: vi.fn() },
      renderer: {
        dispose: () => {
          rendererDispose();
          memory.geometries = 0;
        },
        domElement: document.createElement('canvas'),
        info: { memory },
      },
      scene: new THREE.Scene(),
      camera: new THREE.PerspectiveCamera(),
    };
    const internal = el as unknown as {
      disposed: boolean;
      sceneBundle: typeof fakeBundle | null;
      onDemand: { dispose: () => void } | null;
    };
    internal.disposed = false;
    internal.sceneBundle = fakeBundle;
    internal.onDemand = { dispose: vi.fn() };

    el.dispose();
    el.dispose();

    expect(rendererDispose).toHaveBeenCalledTimes(1);
    expect(memory.geometries).toBe(0);
  });
});
