import * as THREE from 'three';
import type { JointMappingEntry } from '../joints/mapping.js';

/**
 * Drag a hand in the picture and let the arm solve. The solver lives in the robot backend
 * (POST /kinematics/inverse, PR-2180); this module owns the handle, the drag plane, the request
 * coalescing and the units.
 *
 * Position-only by decision: the hand's orientation stays free, the target is a point.
 */

export interface ReachReport {
  ok: boolean;
  distanceMm: number;
  blockedBy: string | null;
}

export interface IkAnswer {
  jointNames: string[];
  jointsRad: number[] | null;
  reach: ReachReport;
}

export interface IkTarget {
  side: 'left' | 'right';
  xyzM: [number, number, number];
  seedRad: number[] | null;
}

export type DragStatus =
  | { kind: 'idle' }
  | { kind: 'solving' }
  | { kind: 'reached'; distanceMm: number }
  | { kind: 'edge'; distanceMm: number; blockedBy: string | null }
  | { kind: 'unavailable'; reason: string };

/**
 * Keep one request in flight and remember only the newest target. A drag produces targets faster
 * than the backend answers; sending each one would queue up motion the user has already
 * abandoned.
 */
export class IkClient {
  private inFlight = false;
  private pending: IkTarget | null = null;
  private disposed = false;
  /** A single slow answer is normal while dragging; three in a row is a real problem. */
  private timeouts = 0;

  constructor(
    private readonly url: string,
    private readonly onAnswer: (answer: IkAnswer) => void,
    private readonly onFailure: (reason: string) => void,
    private readonly fetchImpl: typeof fetch = (...args) => fetch(...args),
    private readonly timeoutMs = 400,
  ) {}

  get pendingTarget(): IkTarget | null {
    return this.pending;
  }

  request(target: IkTarget): void {
    if (this.disposed) return;
    if (this.inFlight) {
      this.pending = target;
      return;
    }
    void this.send(target);
  }

  dispose(): void {
    this.disposed = true;
    this.pending = null;
  }

  private async send(target: IkTarget): Promise<void> {
    this.inFlight = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(this.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          side: target.side,
          xyzM: target.xyzM,
          seedRad: target.seedRad,
          // The drag loop needs a fast answer, not the patient search: a target that does not
          // converge used to run 50 x 200 iterations (4.5 s on the robot).
          restarts: 2,
          maxIterations: 60,
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        this.timeouts = 0;
        this.onFailure(`backend answered ${response.status}`);
      } else {
        this.timeouts = 0;
        this.onAnswer((await response.json()) as IkAnswer);
      }
    } catch (error) {
      // A timeout is a normal event during a fast drag: the next target is already waiting. Only
      // a run of them means the backend is really stuck.
      if ((error as { name?: string })?.name === 'AbortError') {
        this.timeouts += 1;
        this.onFailure(this.timeouts >= 3 ? 'backend did not answer in time' : 'slow');
      } else {
        this.timeouts = 0;
        this.onFailure('backend not reachable');
      }
    } finally {
      clearTimeout(timer);
      this.inFlight = false;
      const next = this.pending;
      this.pending = null;
      if (next && !this.disposed) void this.send(next);
    }
  }
}

/** Limit how far one joint may move between two commands, so a fast drag cannot slam the arm. */
export function clampDeltaRad(
  previous: readonly number[],
  next: readonly number[],
  maxRadPerSecond: number,
  deltaSeconds: number,
): number[] {
  const budget = Math.max(0, maxRadPerSecond) * Math.max(0, deltaSeconds);
  return next.map((value, index) => {
    const before = previous[index] ?? value;
    const delta = value - before;
    if (Math.abs(delta) <= budget) return value;
    return before + Math.sign(delta) * budget;
  });
}

/**
 * Where the pointer sits on a plane through `anchor` with normal `normal`.
 * `ndc` is the pointer in normalised device coordinates (-1..1).
 */
export function pointerPlanePoint(
  camera: THREE.Camera,
  ndc: { x: number; y: number },
  anchor: THREE.Vector3,
  normal: THREE.Vector3,
  target = new THREE.Vector3(),
): THREE.Vector3 | null {
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), camera);
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, anchor);
  const hit = ray.ray.intersectPlane(plane, target);
  return hit ? target : null;
}

/**
 * pib-sdk names two arm joints differently from the mapping's motors: its `upper_arm_right` is the
 * mapping's `upper_arm_right_rotation`, its `forearm_right` is `lower_arm_right_rotation`. Without
 * this table two of six joints would silently drop out of every answer.
 */
export const SDK_TO_MAPPING_MOTOR: Record<string, string> = {
  upper_arm_left: 'upper_arm_left_rotation',
  upper_arm_right: 'upper_arm_right_rotation',
  forearm_left: 'lower_arm_left_rotation',
  forearm_right: 'lower_arm_right_rotation',
};

export function mappingMotorFor(sdkName: string): string {
  return SDK_TO_MAPPING_MOTOR[sdkName] ?? sdkName;
}

/**
 * pib-sdk answers in the joint convention its motors use; the model speaks URDF angles.
 * `direction` is the mapping's sign, `gearRatio` the motor-to-joint ratio.
 */
export function toModelAngles(
  jointsRad: readonly number[],
  entries: readonly Pick<
    JointMappingEntry,
    'motor' | 'urdfJoint' | 'direction' | 'gearRatio' | 'sdkSign'
  >[],
  jointNames: readonly string[],
): Record<string, number> {
  const byMotor = new Map(entries.map((entry) => [entry.motor, entry]));
  const out: Record<string, number> = {};
  jointNames.forEach((motor, index) => {
    const entry = byMotor.get(mappingMotorFor(motor));
    const value = jointsRad[index];
    if (!entry || value === undefined) return;
    out[entry.urdfJoint] =
      (value * (entry.sdkSign ?? 1) * (entry.direction ?? 1)) / (entry.gearRatio || 1);
  });
  return out;
}

export interface HandDragContext {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  dom: HTMLElement;
  controls: { enabled: boolean };
  baseFrame: { footWorld: THREE.Vector3; sceneOffsetToBase: THREE.Matrix3 };
  linkNodes: Map<string, THREE.Object3D>;
  entries: JointMappingEntry[];
  ikUrl: string;
  /** Current arm angles in the order the backend's `jointNames` use, or null while unknown. */
  seedFor: (side: 'left' | 'right') => number[] | null;
  onJoints: (angles: Record<string, number>, reach: ReachReport) => void;
  onStatus: (status: DragStatus) => void;
  onRequestRender: () => void;
  maxRadPerSecond?: number;
  tcpLink?: { left: string; right: string };
  headLink?: string;
  /** Current model joint angles in radians. */
  getJointRad?: (urdfJoint: string) => number;
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

const HEAD_PAN_JOINT = 'gearing_rotation__new_body_';
const HEAD_TILT_JOINT = 'nodding_rotation';
const HEAD_PAN_CLAMP = 1.5708;
const HEAD_TILT_CLAMP = 0.785398;
const HEAD_HANDLE_OFFSET_Y = 0.08;

const HANDLE_RADIUS_M = 0.035;
const COLOR_OK = 0x59d18c;
const COLOR_EDGE = 0xd8a33a;
const COLOR_BUSY = 0x7aa2f7;

/**
 * Two draggable spheres, one per palm. Dragging one asks the backend for joint angles and hands
 * them to the element, which streams them through the existing command path.
 */
export interface HandDragHandle {
  dispose(): void;
  /** Put the handles back on the palms; call it whenever the pose changed. */
  sync(): void;
}

export function wireHandDrag(ctx: HandDragContext): HandDragHandle {
  const tcp = ctx.tcpLink ?? { left: 'd01_l_palm_left', right: 'd01_r_palm_right' };
  const headLinkName = ctx.headLink ?? 'a81_motor_shaft';
  const maxRate = ((ctx.maxRadPerSecond ?? 60) * Math.PI) / 180;
  const handles: Record<'left' | 'right' | 'head', THREE.Mesh | null> = {
    left: null,
    right: null,
    head: null,
  };
  const material = new THREE.MeshBasicMaterial({
    color: COLOR_OK,
    transparent: true,
    opacity: 0.45,
    depthTest: false,
  });
  const geometry = new THREE.SphereGeometry(HANDLE_RADIUS_M, 16, 12);

  for (const side of ['left', 'right'] as const) {
    const node = ctx.linkNodes.get(tcp[side]);
    if (!node) continue;
    const mesh = new THREE.Mesh(geometry, material.clone());
    mesh.renderOrder = 10;
    mesh.name = `ik-handle:${side}`;
    node.add(mesh);
    handles[side] = mesh;
    mesh.getWorldPosition(mesh.position);
    // The handle is a scene-level object: it must not inherit the link's transform.
    ctx.scene.attach(mesh);
    mesh.position.copy(node.getWorldPosition(new THREE.Vector3()));
  }

  const headNode =
    ctx.linkNodes.get(headLinkName) ?? ctx.linkNodes.get('a71_inner_part') ?? null;
  const hasHeadMotors = ctx.entries.some(
    (e) => e.urdfJoint === HEAD_PAN_JOINT || e.urdfJoint === HEAD_TILT_JOINT,
  );
  if (headNode && hasHeadMotors) {
    const mesh = new THREE.Mesh(geometry, material.clone());
    mesh.renderOrder = 10;
    mesh.name = 'ik-handle:head';
    ctx.scene.add(mesh);
    handles.head = mesh;
    const wp = headNode.getWorldPosition(new THREE.Vector3());
    mesh.position.copy(wp).add(new THREE.Vector3(0, HEAD_HANDLE_OFFSET_Y, 0));
  }

  let dragging: { side: 'left' | 'right'; depth: number } | null = null;
  let headDragging: { startX: number; startY: number; pan0: number; tilt0: number } | null = null;
  let lastAngles: number[] = [];
  let lastApplyAt = 0;

  const client = new IkClient(
    ctx.ikUrl,
    applyAnswer,
    (reason) => {
      if (reason === 'slow') {
        // Still computing: keep the colour, say nothing alarming.
        ctx.onStatus({ kind: 'solving' });
        return;
      }
      setColor(COLOR_EDGE);
      ctx.onStatus({ kind: 'unavailable', reason });
    },
    ctx.fetchImpl,
  );

  function setColor(color: number): void {
    for (const side of ['left', 'right'] as const) handles[side]?.material instanceof THREE.MeshBasicMaterial
      ? ((handles[side]!.material as THREE.MeshBasicMaterial).color.setHex(color))
      : undefined;
  }

  function applyAnswer(answer: IkAnswer): void {
    if (!answer.jointsRad) {
      setColor(COLOR_EDGE);
      ctx.onStatus({ kind: 'edge', distanceMm: answer.reach.distanceMm, blockedBy: answer.reach.blockedBy });
      return;
    }
    const now = performance.now();
    const dt = lastApplyAt === 0 ? 0.12 : Math.min(0.25, (now - lastApplyAt) / 1000);
    lastApplyAt = now;
    const clamped = clampDeltaRad(lastAngles, answer.jointsRad, maxRate, dt);
    lastAngles = clamped;
    const angles = toModelAngles(clamped, ctx.entries, answer.jointNames);
    ctx.onJoints(angles, answer.reach);
    if (answer.reach.ok) {
      setColor(COLOR_BUSY);
      ctx.onStatus({ kind: 'reached', distanceMm: answer.reach.distanceMm });
    } else {
      setColor(COLOR_EDGE);
      ctx.onStatus({
        kind: 'edge',
        distanceMm: answer.reach.distanceMm,
        blockedBy: answer.reach.blockedBy,
      });
    }
    sync();
    ctx.onRequestRender();
  }

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  function toNdc(event: PointerEvent): void {
    const rect = ctx.dom.getBoundingClientRect();
    pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
  }

  function handleAt(event: PointerEvent): 'left' | 'right' | 'head' | null {
    toNdc(event);
    raycaster.setFromCamera(pointer, ctx.camera);
    const targets = (['left', 'right', 'head'] as const)
      .map((side) => handles[side])
      .filter(Boolean);
    const hit = raycaster.intersectObjects(targets as THREE.Object3D[], false)[0];
    if (!hit) return null;
    const id = hit.object.name.split(':')[1];
    return id === 'left' || id === 'right' || id === 'head' ? id : null;
  }

  function targetFromPointer(event: PointerEvent, side: 'left' | 'right', depth: number): THREE.Vector3 | null {
    const handle = handles[side];
    if (!handle) return null;
    const normal = ctx.camera.getWorldDirection(new THREE.Vector3());
    const anchor = handle.position.clone().addScaledVector(normal, depth);
    const point = pointerPlanePoint(ctx.camera, { x: pointer.x, y: pointer.y }, anchor, normal);
    if (!point) return null;
    const base = point.clone().sub(ctx.baseFrame.footWorld).applyMatrix3(ctx.baseFrame.sceneOffsetToBase);
    return base;
  }

  function onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    const hit = handleAt(event);
    if (!hit) return;
    event.preventDefault();
    event.stopPropagation();
    if (hit === 'head') {
      const pan0 = ctx.getJointRad?.(HEAD_PAN_JOINT) ?? 0;
      const tilt0 = ctx.getJointRad?.(HEAD_TILT_JOINT) ?? 0;
      headDragging = { startX: event.clientX, startY: event.clientY, pan0, tilt0 };
      ctx.controls.enabled = false;
      ctx.dom.setPointerCapture?.(event.pointerId);
      return;
    }
    if (!ctx.ikUrl) {
      ctx.onStatus({ kind: 'unavailable', reason: 'inverse kinematics needs the robot backend' });
      return;
    }
    dragging = { side: hit, depth: 0 };
    lastAngles = ctx.seedFor(hit) ?? [];
    lastApplyAt = 0;
    ctx.controls.enabled = false;
    ctx.dom.setPointerCapture?.(event.pointerId);
    ctx.onStatus({ kind: 'solving' });
  }

  function onPointerMove(event: PointerEvent): void {
    if (headDragging) {
      event.preventDefault();
      event.stopPropagation();
      ctx.dom.style.cursor = 'grabbing';
      const dx = event.clientX - headDragging.startX;
      const dy = event.clientY - headDragging.startY;
      const panRad = Math.min(
        HEAD_PAN_CLAMP,
        Math.max(-HEAD_PAN_CLAMP, headDragging.pan0 + dx * 0.01),
      );
      const tiltRad = Math.min(
        HEAD_TILT_CLAMP,
        Math.max(-HEAD_TILT_CLAMP, headDragging.tilt0 - dy * 0.01),
      );
      ctx.onJoints(
        { [HEAD_PAN_JOINT]: panRad, [HEAD_TILT_JOINT]: tiltRad },
        { ok: true, distanceMm: 0, blockedBy: null },
      );
      ctx.onRequestRender();
      return;
    }
    if (!dragging) {
      const hovered = handleAt(event);
      ctx.dom.style.cursor = hovered ? 'grab' : '';
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    ctx.dom.style.cursor = 'grabbing';
    toNdc(event);
    const base = targetFromPointer(event, dragging.side, dragging.depth);
    if (!base) return;
    client.request({
      side: dragging.side,
      xyzM: [base.x, base.y, base.z],
      seedRad: ctx.seedFor(dragging.side),
    });
  }

  function onPointerUp(event: PointerEvent): void {
    if (headDragging) {
      event.preventDefault();
      event.stopPropagation();
      headDragging = null;
      ctx.controls.enabled = true;
      ctx.dom.style.cursor = '';
      sync();
      return;
    }
    if (!dragging) return;
    event.preventDefault();
    event.stopPropagation();
    dragging = null;
    ctx.controls.enabled = true;
    ctx.dom.style.cursor = '';
    setColor(COLOR_OK);
    sync();
    ctx.onStatus({ kind: 'idle' });
  }

  function onWheel(event: WheelEvent): void {
    if (!dragging) return;
    event.preventDefault();
    dragging.depth += Math.sign(event.deltaY) * 0.02;
    const base = targetFromPointer(event as unknown as PointerEvent, dragging.side, dragging.depth);
    if (!base) return;
    client.request({
      side: dragging.side,
      xyzM: [base.x, base.y, base.z],
      seedRad: ctx.seedFor(dragging.side),
    });
  }

  /** Put each handle back on its palm. The arm moves, the handle has to move with it - a handle
   * left behind at the start pose makes the next drag feel like it begins somewhere else. */
  function sync(): void {
    // While IK is master the handle is the target the user is dragging; snapping it back onto the
    // measured palm every live frame is what made the ghost jump back mid-drag.
    if (dragging) {
      ctx.onRequestRender();
      return;
    }
    for (const side of ['left', 'right'] as const) {
      const handle = handles[side];
      const node = ctx.linkNodes.get(tcp[side]);
      if (!handle || !node) continue;
      node.getWorldPosition(handle.position);
      handle.updateMatrixWorld();
    }
    const headHandle = handles.head;
    const headAnchor =
      ctx.linkNodes.get(headLinkName) ?? ctx.linkNodes.get('a71_inner_part') ?? null;
    if (headHandle && headAnchor) {
      const wp = headAnchor.getWorldPosition(new THREE.Vector3());
      headHandle.position.copy(wp).add(new THREE.Vector3(0, HEAD_HANDLE_OFFSET_Y, 0));
      headHandle.updateMatrixWorld();
    }
    ctx.onRequestRender();
  }

  ctx.dom.addEventListener('pointerdown', onPointerDown, true);
  ctx.dom.addEventListener('pointermove', onPointerMove, true);
  ctx.dom.addEventListener('pointerup', onPointerUp, true);
  ctx.dom.addEventListener('wheel', onWheel, { capture: true, passive: false });

  const dispose = () => {
    ctx.dom.removeEventListener('pointerdown', onPointerDown, true);
    ctx.dom.removeEventListener('pointermove', onPointerMove, true);
    ctx.dom.removeEventListener('pointerup', onPointerUp, true);
    ctx.dom.removeEventListener('wheel', onWheel, true);
    client.dispose();
    for (const side of ['left', 'right', 'head'] as const) {
      const handle = handles[side];
      if (handle) {
        ctx.scene.remove(handle);
        (handle.material as THREE.Material).dispose();
      }
    }
    geometry.dispose();
    ctx.onRequestRender();
  };

  return { dispose, sync };
}

/** The order pib-sdk's arm chain uses, which is also the order of `jointsRad` in an answer. */
export const SDK_ARM_JOINTS: Record<'left' | 'right', string[]> = {
  left: [
    'shoulder_vertical_left',
    'shoulder_horizontal_left',
    'upper_arm_left',
    'elbow_left',
    'forearm_left',
    'wrist_left',
  ],
  right: [
    'shoulder_vertical_right',
    'shoulder_horizontal_right',
    'upper_arm_right',
    'elbow_right',
    'forearm_right',
    'wrist_right',
  ],
};

/**
 * Current model angles in the order the backend expects, so a solve starts from where the arm
 * is instead of from zeros - otherwise the first drag may pick the other elbow solution.
 */
export function seedFromModel(
  anglesByJoint: Record<string, number>,
  entries: readonly Pick<
    JointMappingEntry,
    'motor' | 'urdfJoint' | 'direction' | 'gearRatio' | 'sdkSign'
  >[],
  side: 'left' | 'right',
): number[] | null {
  const byMotor = new Map(entries.map((entry) => [entry.motor, entry]));
  const seed: number[] = [];
  for (const sdkName of SDK_ARM_JOINTS[side]) {
    const entry = byMotor.get(mappingMotorFor(sdkName));
    if (!entry) return null;
    const model = anglesByJoint[entry.urdfJoint] ?? 0;
    seed.push(model * (entry.direction ?? 1) * (entry.gearRatio || 1) * (entry.sdkSign ?? 1));
  }
  return seed;
}
