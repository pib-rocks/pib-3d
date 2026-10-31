import * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export type RenderFn = () => void;

export class OnDemandRenderer {
  private renderCount = 0;
  private scheduled = false;
  private active = true;
  private disposed = false;
  private rafId = 0;
  private readonly onControlsChange: () => void;

  constructor(
    private readonly renderFn: RenderFn,
    private readonly controls: OrbitControls,
  ) {
    this.onControlsChange = () => this.requestRender();
    this.controls.addEventListener('change', this.onControlsChange);
  }

  getRenderCount(): number {
    return this.renderCount;
  }

  setActive(active: boolean): void {
    if (this.active === active) return;
    this.active = active;
    if (active) this.requestRender();
  }

  requestRender(): void {
    if (this.disposed || !this.active) return;
    if (this.scheduled) return;
    this.scheduled = true;
    this.rafId = requestAnimationFrame(() => {
      this.scheduled = false;
      if (this.disposed || !this.active) return;
      this.controls.update();
      this.renderFn();
      this.renderCount += 1;
    });
  }

  dispose(): void {
    this.disposed = true;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.controls.removeEventListener('change', this.onControlsChange);
  }
}

export function disposeObject3D(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.geometry?.dispose();
      const mats = mesh.material;
      if (Array.isArray(mats)) mats.forEach((m) => m.dispose());
      else mats?.dispose();
    }
  });
}
