import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { wireHandDrag, type DragStatus } from '../src/interaction/ikDrag.js';

/**
 * The drag start is pure geometry plus one fetch: no WebGL needed, so the whole handle path can
 * run here. This is the test that catches "the handle cannot be grabbed".
 */
function fakeDom(width = 949, height = 475) {
  const handlers = new Map<string, ((event: unknown) => void)[]>();
  const dom = {
    style: { cursor: '' },
    getBoundingClientRect: () => ({ left: 0, top: 0, width, height, right: width, bottom: height }),
    setPointerCapture: () => undefined,
    addEventListener: (type: string, fn: (event: unknown) => void) => {
      handlers.set(type, [...(handlers.get(type) ?? []), fn]);
    },
    removeEventListener: () => undefined,
    fire: (type: string, props: Record<string, unknown>) => {
      for (const fn of handlers.get(type) ?? []) {
        fn({ type, preventDefault: () => undefined, stopPropagation: () => undefined, ...props });
      }
    },
  };
  return dom;
}

function setup() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 949 / 475, 0.1, 100);
  camera.position.set(1.9, 1.1, 1.9);
  camera.lookAt(0, 0.7, 0);
  camera.updateMatrixWorld(true);

  const palm = new THREE.Object3D();
  palm.position.set(-0.609, 0.732, -0.106);
  scene.add(palm);

  const dom = fakeDom();
  const statuses: DragStatus[] = [];
  const fetchImpl = vi.fn(async () =>
    ({
      ok: true,
      json: async () => ({
        jointNames: ['shoulder_vertical_right', 'shoulder_horizontal_right', 'upper_arm_right', 'elbow_right', 'forearm_right', 'wrist_right'],
        jointsRad: [0, 0, 0, 0, 0, 0],
        reach: { ok: true, distanceMm: 0, blockedBy: null },
      }),
    }) as unknown as Response,
  );

  const handle = wireHandDrag({
    scene,
    camera,
    dom: dom as unknown as HTMLElement,
    controls: { enabled: true },
    baseFrame: {
      footWorld: new THREE.Vector3(0, 0, 0),
      sceneOffsetToBase: new THREE.Matrix3(),
    },
    linkNodes: new Map([
      ['d01_r_palm_right', palm],
      ['d01_l_palm_left', new THREE.Object3D()],
    ]),
    entries: [],
    ikUrl: '/api/kinematics/inverse',
    seedFor: () => [0, 0, 0, 0, 0, 0],
    onJoints: () => undefined,
    onStatus: (status) => statuses.push(status),
    onRequestRender: () => undefined,
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });

  const sphere = scene.children.find((child) => child.name === 'ik-handle:right') as
    | THREE.Mesh
    | undefined;
  const screen = new THREE.Vector3();
  sphere!.getWorldPosition(screen);
  screen.project(camera);
  const x = ((screen.x + 1) / 2) * 949;
  const y = ((1 - screen.y) / 2) * 475;

  return { scene, camera, dom, statuses, fetchImpl, drag: handle, palm, sphere, x, y };
}

describe('wireHandDrag', () => {
  it('puts a handle on each palm', () => {
    const { scene } = setup();
    const names = scene.children.map((child) => child.name).filter(Boolean);
    expect(names).toContain('ik-handle:right');
    expect(names).toContain('ik-handle:left');
  });

  it('starts a drag when the pointer lands on the handle', () => {
    const { dom, statuses, x, y } = setup();
    dom.fire('pointerdown', { clientX: x, clientY: y, button: 0, pointerId: 1 });
    expect(statuses.map((status) => status.kind)).toContain('solving');
  });

  it('does not start a drag when the pointer misses', () => {
    const { dom, statuses, x, y } = setup();
    dom.fire('pointerdown', { clientX: x + 200, clientY: y + 120, button: 0, pointerId: 1 });
    expect(statuses).toHaveLength(0);
  });

  it('moves the handle with the palm', () => {
    const { drag, palm, sphere } = setup();
    palm.position.set(0.2, 0.5, -0.3);
    palm.updateMatrixWorld(true);
    drag.sync();
    expect(sphere.position.x).toBeCloseTo(0.2, 6);
    expect(sphere.position.y).toBeCloseTo(0.5, 6);
    expect(sphere.position.z).toBeCloseTo(-0.3, 6);
  });

  it('asks the backend once the handle is dragged', async () => {
    const { dom, fetchImpl, x, y } = setup();
    dom.fire('pointerdown', { clientX: x, clientY: y, button: 0, pointerId: 1 });
    dom.fire('pointermove', { clientX: x + 30, clientY: y, pointerId: 1 });
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    const body = JSON.parse(String(fetchImpl.mock.calls[0]![1]?.body));
    expect(body.side).toBe('right');
    expect(body.xyzM).toHaveLength(3);
  });
});
