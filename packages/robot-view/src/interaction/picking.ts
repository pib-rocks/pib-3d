import * as THREE from 'three';
import type { RobotModel } from '../types.js';

export interface PickingContext {
  camera: THREE.PerspectiveCamera;
  modelRoot: THREE.Group;
  renderer: THREE.WebGLRenderer;
  linkNodes: Map<string, THREE.Object3D>;
  parentOf: Map<string, string>;
  jointOfLink: Map<string, RobotModel['joints'][0]>;
  partsOf: Map<string, string[]>;
  root: ShadowRoot;
  onSelect: (link: string, joint: string) => void;
  onRequestRender: () => void;
}

export function wirePicking(ctx: PickingContext): () => void {
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const originals = new Map<THREE.Material, { color: number | null; intensity: number }>();
  let selected: string | null = null;

  const info = ctx.root.querySelector('#info') as HTMLElement;
  const infoLink = ctx.root.querySelector('#info-link') as HTMLElement;
  const infoJoint = ctx.root.querySelector('#info-joint') as HTMLElement;
  const infoSummary = ctx.root.querySelector('#info-summary') as HTMLElement;
  const infoList = ctx.root.querySelector('#info-list') as HTMLElement;
  const tip = ctx.root.querySelector('#tip') as HTMLElement;

  function highlight(linkName: string, on: boolean): void {
    const node = ctx.linkNodes.get(linkName);
    if (!node) return;
    node.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !mesh.material) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        const std = m as THREE.MeshStandardMaterial;
        if (on) {
          if (!originals.has(m))
            originals.set(m, {
              color: std.emissive ? std.emissive.getHex() : null,
              intensity: std.emissiveIntensity,
            });
          if (std.emissive) {
            std.emissive.setHex(0x1f6feb);
            std.emissiveIntensity = 0.28;
            std.needsUpdate = true;
          }
        } else {
          const before = originals.get(m);
          if (before && std.emissive && before.color !== null) {
            std.emissive.setHex(before.color);
            std.emissiveIntensity = before.intensity;
            std.needsUpdate = true;
          }
        }
      }
    });
    ctx.onRequestRender();
  }

  function clearRowActive(jointName: string): void {
    const row = ctx.root.querySelector(`[data-joint="${jointName}"]`);
    row?.classList.remove('active');
  }

  function selectLink(linkName: string): void {
    let cur = linkName;
    let joint = ctx.jointOfLink.get(cur);
    while (!joint && ctx.parentOf.has(cur)) {
      cur = ctx.parentOf.get(cur)!;
      joint = ctx.jointOfLink.get(cur);
    }
    if (!joint) return;
    if (selected === cur) return;

    if (selected) {
      highlight(selected, false);
      const prev = ctx.jointOfLink.get(selected);
      if (prev) clearRowActive(prev.name);
    }
    selected = cur;
    highlight(cur, true);

    const parts = ctx.partsOf.get(cur) || [cur];
    infoLink.textContent = cur;
    infoJoint.textContent = joint.name;
    infoSummary.textContent = `${parts.length} Teil${parts.length === 1 ? '' : 'e'} im CAD`;
    infoList.textContent = parts.join(', ');
    info.classList.add('show');

    const row = ctx.root.querySelector(`[data-joint="${joint.name}"]`);
    if (row) {
      row.classList.add('active');
      row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      const input = row.querySelector('input');
      input?.focus({ preventScroll: true });
    }

    ctx.onSelect(cur, joint.name);
    ctx.onRequestRender();
  }

  function pick(event: PointerEvent): string | null {
    ctx.camera.updateMatrixWorld();
    const rect = ctx.renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, ctx.camera);
    const hits = raycaster.intersectObject(ctx.modelRoot, true);
    return hits.length ? (hits[0].object.userData.link as string) : null;
  }

  let down: { x: number; y: number; t: number } | null = null;
  const dom = ctx.renderer.domElement;

  const onPointerDown = (e: PointerEvent) => {
    down = { x: e.clientX, y: e.clientY, t: performance.now() };
  };
  const onPointerUp = (e: PointerEvent) => {
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    const quick = performance.now() - down.t < 500;
    down = null;
    if (moved > 5 || !quick) return;
    const link = pick(e);
    if (link) selectLink(link);
  };

  let lastHover = 0;
  const onPointerMove = (e: PointerEvent) => {
    if (e.buttons) {
      tip.classList.add('hidden');
      tip.style.display = 'none';
      return;
    }
    const now = performance.now();
    if (now - lastHover < 60) return;
    lastHover = now;
    const link = pick(e);
    dom.style.cursor = link ? 'pointer' : '';
    if (!link) {
      tip.style.display = 'none';
      return;
    }
    const parts = ctx.partsOf.get(link) || [link];
    tip.textContent = `${link} · ${parts.length} Teil${parts.length === 1 ? '' : 'e'}`;
    tip.style.display = 'block';
    tip.style.left = `${e.clientX + 14}px`;
    tip.style.top = `${e.clientY + 14}px`;
  };
  const onPointerLeave = () => {
    tip.style.display = 'none';
  };

  dom.addEventListener('pointerdown', onPointerDown);
  dom.addEventListener('pointerup', onPointerUp);
  dom.addEventListener('pointermove', onPointerMove);
  dom.addEventListener('pointerleave', onPointerLeave);

  return () => {
    dom.removeEventListener('pointerdown', onPointerDown);
    dom.removeEventListener('pointerup', onPointerUp);
    dom.removeEventListener('pointermove', onPointerMove);
    dom.removeEventListener('pointerleave', onPointerLeave);
    if (selected) highlight(selected, false);
  };
}

export function focusJointInPanel(root: ShadowRoot, jointName: string): void {
  const row = root.querySelector(`[data-joint="${jointName}"]`);
  if (!row) return;
  row.classList.add('active');
  row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  row.querySelector('input')?.focus({ preventScroll: true });
}
