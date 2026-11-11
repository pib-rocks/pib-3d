import * as THREE from 'three';
import { createScene, type SceneBundle } from '../scene/createScene.js';
import { fetchModel, loadLinkMeshes } from '../model/loadModel.js';
import {
  attachRootToScene,
  buildKinematicTree,
  type KinematicTree,
} from '../model/kinematicTree.js';
import { ensureFrameLinks } from '../model/frameLinks.js';
import { frameCameraOnModel, alignModelToBaseFrame, type BaseFrameContext } from '../scene/frameCamera.js';
import {
  BASE_LINK,
  TCP_LINK_LEFT,
  TCP_LINK_RIGHT,
  formatPoseMmMetres,
  linkOriginInBaseMetres,
} from '../scene/baseFrame.js';
import {
  canCommand,
  loadMapping,
  motorCentidegToModelRad,
  mappingByUrdfJoint,
  validateMapping,
  type JointMappingDocument,
  type ValidationResult,
  type JointMappingEntry,
} from '../joints/mapping.js';
import {
  LiveJointInterpolator,
  resolveJointStateMap,
  type JointStateSample,
} from '../joints/liveState.js';
import { buildJointPanel, midPoseValue, type JointPanelHandles } from '../joints/panel.js';
import { applyJointValue, formatJointLabel, fromUi, toUi } from '../joints/math.js';
import { wirePicking } from '../interaction/picking.js';
import { disposeObject3D, OnDemandRenderer } from '../render/onDemand.js';
import { seedFromModel, wireHandDrag, type DragStatus } from '../interaction/ikDrag.js';
import { SHADOW_HTML, SHADOW_STYLES } from './template.js';
import type {
  CommandAcceptedDetail,
  CommandRejectedDetail,
  CommandRequestDetail,
  EStopDetail,
  JointChangeDetail,
  JointChangeSource,
  MotorLimitMap,
  MotionEntry,
  PoseChangeDetail,
  ReadyDetail,
  RobotModel,
  RobotPose,
  ArmSide,
  SelectionChangeDetail,
  ViewerMode,
} from '../types.js';
import {
  buildCommandFromPending,
  CommandSendScheduler,
  motorLimitsProvided,
  newCommandId,
} from '../joints/commandPath.js';
import {
  computeModelConsistency,
  fetchModelManifest,
  type ModelConsistencyResult,
  type RobotModelManifest,
} from '../model/modelConsistency.js';

const TAG = 'pib-robot-view';

export class PibRobotView extends HTMLElement {
  static get observedAttributes(): string[] {
    return ['model-url', 'mapping-url', 'mode', 'show-controls', 'ik-url', 'poses-url'];
  }

  private shadow: ShadowRoot;
  private canvas!: HTMLCanvasElement;
  private sceneBundle: SceneBundle | null = null;
  private onDemand: OnDemandRenderer | null = null;
  private kinematic: KinematicTree | null = null;
  private motions: MotionEntry[] = [];
  private linkNodes: Map<string, THREE.Object3D> = new Map();
  private panel: JointPanelHandles | null = null;
  private unpick: (() => void) | null = null;
  private resizeObs: ResizeObserver | null = null;
  private intersectObs: IntersectionObserver | null = null;
  private onVisibilityChange: (() => void) | null = null;
  private disposed = false;
  private loadGeneration = 0;
  private _modelUrl = './model.json';
  private _mappingUrl = './mapping.json';
  private _jointStates: Record<string, number> = {};
  private _mode: ViewerMode = 'preview';
  private _effectiveMode: ViewerMode = 'preview';
  private _mapping: JointMappingDocument | null = null;
  private _mappingValidation: ValidationResult | null = null;
  private _lastCommandBlockReason: string | null = null;
  private _showControls = true;
  private motionByJoint = new Map<string, MotionEntry>();
  private _commandedStates: Record<string, number> = {};
  private _staleAfterMs = 500;
  private _stale = false;
  private staleTimer: ReturnType<typeof setTimeout> | null = null;
  private liveInterp: LiveJointInterpolator | null = null;
  private _motorLimits: MotorLimitMap = {};
  private _minCommandIntervalMs = 120;
  private _estopped = false;
  private _pendingJoints: Record<string, number> = {};
  /** Joints whose value the user (slider or IK drag) owns: measurements must not move them. */
  private _uiOwned = new Set<string>();
  /** Joints of the last confirmed command, so a late service failure can name its rows. */
  private _lastSent: { commandId: string; joints: string[] } | null = null;
  private _acceptedJoints: Record<string, number> = {};
  private _actualJoints: Record<string, number> = {};
  private commandScheduler: CommandSendScheduler | null = null;
  private _inFlightCommand: {
    commandId: string;
    values: Record<string, number>;
    joints: string[];
  } | null = null;
  private ackTimer: ReturnType<typeof setTimeout> | null = null;
  private _ackTimeoutMs = 3000;
  private _manifest: RobotModelManifest | null = null;
  private _expectedMotors: string[] | null = null;
  private _ikUrl = '';
  private _posesUrl = '';
  private handDrag: { dispose(): void; sync(): void } | null = null;
  private _labelsByMotor: Record<string, string> = {};
  private _modelConsistency: ModelConsistencyResult = { ok: true, reason: null };
  private _baseFrame: BaseFrameContext | null = null;
  private _tcpLink = TCP_LINK_RIGHT;
  private _poseSide: ArmSide = 'right';
  private _selectedJoint: string | null = null;
  private unwiredJointHud: (() => void) | null = null;
  private jointCtrlDrag: {
    pointerId: number;
    startX: number;
    startRad: number;
    joint: string;
  } | null = null;

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
    this.shadow.innerHTML = `<style>${SHADOW_STYLES}</style>${SHADOW_HTML}`;
    this.canvas = this.shadow.querySelector('canvas')!;
  }

  connectedCallback(): void {
    if (this.hasAttribute('model-url')) {
      this._modelUrl = this.getAttribute('model-url')!;
    }
    if (this.hasAttribute('mapping-url')) {
      this._mappingUrl = this.getAttribute('mapping-url')!;
    }
    if (this.hasAttribute('mode')) {
      this._mode = this.getAttribute('mode') as ViewerMode;
    }
    this._showControls = this.getAttribute('show-controls') !== 'false';
    this.initScene();
    this.wireVisibility();
    void this.load();
  }

  disconnectedCallback(): void {
    this.dispose();
  }

  attributeChangedCallback(name: string, _old: string | null, value: string | null): void {
    if (name === 'model-url' && value != null) {
      this._modelUrl = value;
      if (this.isConnected) void this.load();
    } else if (name === 'mapping-url' && value != null) {
      this._mappingUrl = value;
      if (this.isConnected) void this.load();
    } else if (name === 'mode' && value) {
      this._mode = value as ViewerMode;
      this.updateModeUi();
    } else if (name === 'poses-url') {
      this._posesUrl = value ?? '';
      if (this.isConnected) void this.loadPosesList();
    } else if (name === 'ik-url') {
      this._ikUrl = value ?? '';
      this.wireHandDrag();
    } else if (name === 'show-controls') {
      this._showControls = value !== 'false' && value !== '0';
      this.updatePanelVisibility();
    }
  }

  get modelUrl(): string {
    return this._modelUrl;
  }
  set modelUrl(v: string) {
    this._modelUrl = v;
    this.setAttribute('model-url', v);
  }

  get mappingUrl(): string {
    return this._mappingUrl;
  }
  set mappingUrl(v: string) {
    this._mappingUrl = v;
    this.setAttribute('mapping-url', v);
  }

  get jointStates(): Record<string, number> {
    return { ...this._jointStates };
  }
  set jointStates(map: Record<string, number>) {
    this.setJointStates(map);
  }

  get commandedStates(): Record<string, number> {
    return { ...this._commandedStates };
  }
  set commandedStates(map: Record<string, number>) {
    this.setCommandedStates(map);
  }

  get staleAfterMs(): number {
    return this._staleAfterMs;
  }
  set staleAfterMs(ms: number) {
    this._staleAfterMs = Math.max(0, ms);
  }

  get stale(): boolean {
    return this._stale;
  }

  get mode(): ViewerMode {
    return this._mode;
  }
  /** The mode the viewer actually runs in: `command` falls back to `preview` when the
   *  mapping cannot be trusted. Read `guardReason` for why. */
  get effectiveMode(): ViewerMode {
    return this._effectiveMode;
  }
  get guardReason(): string | null {
    return this._lastCommandBlockReason;
  }
  get manifest(): RobotModelManifest | null {
    return this._manifest;
  }
  get expectedMotors(): string[] | null {
    return this._expectedMotors ? [...this._expectedMotors] : null;
  }
  get modelConsistency(): ModelConsistencyResult {
    return { ok: this._modelConsistency.ok, reason: this._modelConsistency.reason };
  }
  get readOnly(): boolean {
    return !this._modelConsistency.ok;
  }
  setExpectedMotors(motors: string[] | null): void {
    this._expectedMotors = motors ? [...motors].sort((a, b) => a.localeCompare(b)) : null;
    this.recomputeModelConsistency();
    this.updateModeUi();
  }
  /** Backend base URL for named poses, e.g. "/api/pose". */
  get posesUrl(): string {
    return this._posesUrl;
  }
  set posesUrl(url: string) {
    this._posesUrl = url;
    this.setAttribute('poses-url', url);
    if (this.isConnected) void this.loadPosesList();
  }

  /** Backend endpoint for inverse kinematics; without it the drag handles stay inert. */
  get ikUrl(): string {
    return this._ikUrl;
  }
  set ikUrl(url: string) {
    this._ikUrl = url;
    this.setAttribute('ik-url', url);
    this.wireHandDrag();
  }

  /** Human names per motor, so the panel can show "Left Hand · Index Finger" instead of a CAD name. */
  get labels(): Record<string, string> {
    return { ...this._labelsByMotor };
  }
  set labels(map: Record<string, string>) {
    this._labelsByMotor = { ...map };
    this.panel?.applyLabels(this._labelsByMotor);
  }

  set mode(v: ViewerMode) {
    this._mode = v;
    this.setAttribute('mode', v);
    this.updateModeUi();
  }

  get showControls(): boolean {
    return this._showControls;
  }
  set showControls(v: boolean) {
    this._showControls = v;
    this.setAttribute('show-controls', v ? 'true' : 'false');
    this.updatePanelVisibility();
  }

  get limits(): MotorLimitMap {
    return { ...this._motorLimits };
  }
  set limits(map: MotorLimitMap) {
    this.setLimits(map);
  }

  get minCommandIntervalMs(): number {
    return this._minCommandIntervalMs;
  }
  set minCommandIntervalMs(ms: number) {
    this._minCommandIntervalMs = Math.max(0, ms);
  }

  get ackTimeoutMs(): number {
    return this._ackTimeoutMs;
  }
  set ackTimeoutMs(ms: number) {
    this._ackTimeoutMs = Math.max(0, ms);
  }

  confirmCommand(commandId: string): void {
    if (this._inFlightCommand?.commandId !== commandId) return;
    const { values, joints } = this._inFlightCommand;
    this.clearAckTimer();
    this._inFlightCommand = null;
    for (const joint of joints) {
      this._acceptedJoints[joint] = values[joint]!;
      delete this._pendingJoints[joint];
      this.panel?.setJointPending(joint, false);
    }
    this._commandedStates = { ...values };
    this._lastSent = { commandId, joints: [...joints] };
    this.syncCommandedPanel();
    this.commandScheduler?.markSent();
    this.resendIfDirty();
    this.dispatchEvent(
      new CustomEvent<CommandAcceptedDetail>('commandaccepted', {
        bubbles: true,
        composed: true,
        detail: { commandId },
      }),
    );
  }

  /**
   * A command was published and confirmed, but the service came back with a failure (out of range,
   * motor off, ...). Report it on the row; the slider stays where the user put it.
   */
  reportCommandFailure(commandId: string, reason: string): void {
    const joints =
      this._lastSent?.commandId === commandId
        ? this._lastSent.joints
        : (this._inFlightCommand?.commandId === commandId ? this._inFlightCommand.joints : []);
    for (const joint of joints) this.panel?.setJointMessage(joint, reason);
    this.emitCommandRejected(commandId, reason);
    if (this.handDrag) this.showDragStatus({ kind: 'unavailable', reason });
  }

  rejectCommand(commandId: string, reason: string): void {
    if (this._inFlightCommand?.commandId !== commandId) return;
    const joints = Object.keys(this._inFlightCommand.values);
    this.clearInFlightCommand();
    // The slider stays where the user put it. Rewriting it to the measured position is what made
    // it jump back on every refused command; the refusal is reported on the row instead.
    this.clearPendingUi();
    for (const joint of joints) this.panel?.setJointMessage(joint, reason);
    this.emitCommandRejected(commandId, reason);
    // The drag loop has to say when a command did not land - otherwise the panel keeps looking
    // green while the arm stands still (motor power off, write failure, no acknowledgement).
    if (this.handDrag) {
      this.showDragStatus({ kind: 'unavailable', reason });
    }
    this.resendIfDirty();
  }

  setLimits(map: MotorLimitMap): void {
    this._motorLimits = { ...map };
    this.panel?.applyMotorLimits(this._motorLimits);
    this.updateModeUi();
  }

  approve(source: JointChangeSource = 'ui'): void {
    if (this._estopped || this._effectiveMode !== 'command') return;
    if (this._inFlightCommand) return;
    if (!this._mapping || !motorLimitsProvided(this._mapping, this._motorLimits)) return;
    if (Object.keys(this._pendingJoints).length === 0) return;
    this.ensureCommandScheduler();
    this.commandScheduler!.requestFlush(source);
  }

  cancelPending(): void {
    if (this._effectiveMode !== 'command') return;
    for (const joint of Object.keys(this._pendingJoints)) this._uiOwned.delete(joint);
    this.clearPendingUi();
    this.revertPendingToAccepted();
  }

  stop(source: 'ui' | 'api' = 'ui'): void {
    this._estopped = true;
    this.clearInFlightCommand();
    this.commandScheduler?.cancelScheduled();
    this.commandScheduler?.reset();
    this.clearPendingUi();
    this._pendingJoints = {};
    this._commandedStates = {};
    this._uiOwned.clear();
    this._acceptedJoints = { ...this._actualJoints };
    this.syncCommandedPanel();
    this.applyPoseToModel(this._actualJoints);
    this.dispatchEvent(
      new CustomEvent<EStopDetail>('estop', {
        bubbles: true,
        composed: true,
        detail: { source },
      }),
    );
  }

  getRenderCount(): number {
    return this.onDemand?.getRenderCount() ?? 0;
  }

  /** Provisional tool-centre point link (palm origin until PR-2057). */
  get tcpLink(): string {
    return this._tcpLink;
  }

  set tcpLink(linkName: string) {
    this._tcpLink = linkName;
    this._poseSide = linkName === TCP_LINK_LEFT ? 'left' : 'right';
    this.syncPose();
  }

  get poseSide(): ArmSide {
    return this._poseSide;
  }

  set poseSide(side: ArmSide) {
    this._poseSide = side;
    this._tcpLink = side === 'left' ? TCP_LINK_LEFT : TCP_LINK_RIGHT;
    this.syncPose();
  }

  /**
   * Base link and TCP positions in metres, REP-103 base frame (foot point, Z up).
   * Returns null before the model is loaded.
   */
  getPose(side: ArmSide = this._poseSide): RobotPose | null {
    if (!this._baseFrame || !this.linkNodes.size) return null;
    const tcp = side === 'left' ? TCP_LINK_LEFT : TCP_LINK_RIGHT;
    const baseNode = this.linkNodes.get(BASE_LINK);
    const handNode = this.linkNodes.get(tcp);
    if (!baseNode || !handNode) return null;
    this.sceneBundle?.modelRoot.updateMatrixWorld(true);
    return {
      // The base is the frame's origin by definition; the root link sits inside the body, so
      // reporting its position here would read like a 0.77 m offset.
      base: { x: 0, y: 0, z: 0 },
      hand: linkOriginInBaseMetres(handNode, this._baseFrame),
    };
  }

  setJointStates(map: Record<string, number>): void {
    this._jointStates = this._mapping ? resolveJointStateMap(map, this._mapping) : { ...map };
    this._actualJoints = { ...this._jointStates };
    if (this._effectiveMode === 'command' && !this._estopped) {
      this._acceptedJoints = { ...this._actualJoints };
    }
    this.applyJointStates('api');
  }

  setCommandedStates(map: Record<string, number>): void {
    this._commandedStates = this._mapping ? resolveJointStateMap(map, this._mapping) : { ...map };
    this.syncCommandedPanel();
  }

  setJointStateSample(sample: JointStateSample): void {
    if (!this._mapping || this.disposed) return;
    if (!this.liveInterp) {
      this.liveInterp = new LiveJointInterpolator(
        (values) => this.applyLiveFrame(values),
        (unknown) => this.emitLiveUnknown(unknown),
      );
      this.liveInterp.seedDisplay(this._jointStates);
    }
    const { dropped } = this.liveInterp.pushSample(sample, this._mapping);
    // Liveness is "a sample arrived", not "the stamp advanced": a dropped duplicate must not
    // leave the stale banner up for the rest of the session.
    this.armStaleTimer();
    if (dropped) return;
  }

  setJoint(name: string, radians: number): void {
    this._jointStates[name] = radians;
    const m = this.motionByJoint.get(name);
    if (m) {
      applyJointValue(m.joint, m.motion, m.axis, radians);
      this.panel?.setJointUi(name, radians);
      this.onDemand?.requestRender();
    }
    this.emitJointChange(name, radians, 'api');
    this.syncPose();
  }

  focusJoint(name: string): void {
    const m = this.motionByJoint.get(name);
    if (!m) return;
    const link = m.joint.child;
    this.dispatchEvent(
      new CustomEvent<SelectionChangeDetail>('selectionchange', {
        bubbles: true,
        composed: true,
        detail: { link, joint: name },
      }),
    );
    const row = this.panel?.getRow(name);
    row?.classList.add('active');
    row?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    this.panel?.getInput(name)?.focus({ preventScroll: true });
    this.onDemand?.requestRender();
  }

  resetPose(): void {
    this.panel?.setPose(() => 0);
    this._jointStates = {};
    for (const m of this.motions) {
      this.emitJointChange(m.joint.name, 0, 'api');
    }
    this.syncPose();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.loadGeneration += 1;

    this.unpick?.();
    this.unpick = null;
    this.unwiredJointHud?.();
    this.unwiredJointHud = null;
    this.resizeObs?.disconnect();
    this.resizeObs = null;
    this.intersectObs?.disconnect();
    this.intersectObs = null;
    if (this.onVisibilityChange) {
      document.removeEventListener('visibilitychange', this.onVisibilityChange);
      this.onVisibilityChange = null;
    }

    this.onDemand?.dispose();
    this.onDemand = null;

    this.handDrag?.dispose();
    this.handDrag = null;
    if (this.sceneBundle) {
      disposeObject3D(this.sceneBundle.modelRoot);
      this.sceneBundle.grid.geometry.dispose();
      (this.sceneBundle.grid.material as THREE.Material).dispose();
      this.sceneBundle.controls.dispose();
      this.sceneBundle.renderer.dispose();
      this.sceneBundle = null;
    }

    this.kinematic = null;
    this.motions = [];
    this.linkNodes.clear();
    this.motionByJoint.clear();
    this.panel = null;
    this._mapping = null;
    this._mappingValidation = null;
    this._manifest = null;
    this._modelConsistency = { ok: true, reason: null };
    this.clearStaleTimer();
    this.liveInterp?.dispose();
    this.liveInterp = null;
    this.clearInFlightCommand();
    this.commandScheduler?.cancelScheduled();
    this.commandScheduler = null;
  }

  private initScene(): void {
    if (this.sceneBundle) return;
    const w = this.clientWidth || globalThis.innerWidth;
    const h = this.clientHeight || globalThis.innerHeight;
    this.sceneBundle = createScene(this.canvas, w, h);
    this.onDemand = new OnDemandRenderer(() => {
      if (!this.sceneBundle) return;
      this.sceneBundle.renderer.render(this.sceneBundle.scene, this.sceneBundle.camera);
    }, this.sceneBundle.controls);

    this.resizeObs = new ResizeObserver(() => this.handleResize());
    this.resizeObs.observe(this);

    this.intersectObs = new IntersectionObserver(
      (entries) => {
        const visible = entries.some((e) => e.isIntersecting);
        this.onDemand?.setActive(visible && !document.hidden);
      },
      { threshold: 0 },
    );
    this.intersectObs.observe(this);

    this.wireToolbar();
    this.wireJointHud();
    this.updatePanelVisibility();
  }

  private wireVisibility(): void {
    this.onVisibilityChange = () => {
      const visible = !document.hidden;
      this.onDemand?.setActive(visible);
    };
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  /**
   * Fetch a named pose from the backend and take it: joints in the picture, and - in command
   * mode - the same values sent to the robot.
   */
  private async applyNamedPose(name: string): Promise<void> {
    if (!this._posesUrl || !this._mapping) return;
    const url = `${this._posesUrl.replace(/\/$/, '')}/by-name/${encodeURIComponent(name)}`;
    try {
      const response = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!response.ok) {
        this.showDragStatus({ kind: 'unavailable', reason: `Pose "${name}" nicht verfügbar` });
        return;
      }
      const body = (await response.json()) as {
        motorPositions?: { motorName: string; position: number }[];
      };
      const byMotor = new Map(
        this._mapping.joints.filter((e) => e.motor).map((e) => [e.motor as string, e]),
      );
      let applied = 0;
      for (const { motorName, position } of body.motorPositions ?? []) {
        const entry = byMotor.get(motorName);
        if (!entry) continue;
        const radians = motorCentidegToModelRad(entry, position);
        this._jointStates[entry.urdfJoint] = radians;
        this._uiOwned.add(entry.urdfJoint);
        this.panel?.setJointUi(entry.urdfJoint, radians);
        if (this._effectiveMode === 'command') this._pendingJoints[entry.urdfJoint] = radians;
        applied += 1;
      }
      if (!applied) {
        this.showDragStatus({ kind: 'unavailable', reason: `Pose "${name}" hat keine Gelenke` });
        return;
      }
      this.applyJointStates('api');
      this.syncPose();
      this.onDemand?.requestRender();
      if (this._effectiveMode === 'command') {
        this.ensureCommandScheduler();
        this.commandScheduler!.requestFlush('api');
      }
    } catch {
      this.showDragStatus({ kind: 'unavailable', reason: `Pose "${name}" nicht erreichbar` });
    }
  }

  private async loadPosesList(): Promise<void> {
    const select = this.shadow.querySelector('#pose-select') as HTMLSelectElement | null;
    if (!select) return;
    const placeholder = '<option value="">Pose wählen …</option>';
    if (!this._posesUrl) {
      select.innerHTML = placeholder;
      return;
    }
    try {
      const response = await fetch(`${this._posesUrl.replace(/\/$/, '')}`, {
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) {
        select.innerHTML = placeholder;
        return;
      }
      const body = (await response.json()) as
        | { poses?: { poseId?: string; name: string; active?: boolean }[] }
        | { poseId?: string; name: string; active?: boolean }[];
      const poses = Array.isArray(body) ? body : (body.poses ?? []);
      const opts = poses
        .filter((p) => p.name)
        .map((p) => `<option value="${p.name}">${p.name}</option>`)
        .join('');
      select.innerHTML = placeholder + opts;
    } catch {
      select.innerHTML = placeholder;
    }
  }

  private wireToolbar(): void {
    const root = this.shadow;
    root.querySelector('[data-action="startup"]')?.addEventListener('click', () => {
      void this.applyNamedPose('Startup/Resting');
    });
    root.querySelector('[data-action="calibration"]')?.addEventListener('click', () => {
      void this.applyNamedPose('Calibration');
    });
    const poseSelect = root.querySelector('#pose-select') as HTMLSelectElement | null;
    poseSelect?.addEventListener('change', () => {
      const name = poseSelect.value;
      if (!name) return;
      void this.applyNamedPose(name);
      poseSelect.value = '';
    });
    void this.loadPosesList();
    // The grid is part of the view now and the model never spins on its own: a rotating scene
    // makes it hard to aim at a handle.
    if (this.sceneBundle) {
      this.sceneBundle.grid.visible = true;
      this.sceneBundle.controls.autoRotate = false;
    }
  }

  private isControllableJoint(jointName: string): boolean {
    const entry = this._mapping ? mappingByUrdfJoint(this._mapping).get(jointName) : undefined;
    return entry?.class === 'driven';
  }

  private syncJointHudFromPanel(jointName: string): void {
    const hud = this.shadow.querySelector('#joint-hud') as HTMLElement | null;
    const nameEl = this.shadow.querySelector('#joint-hud-name') as HTMLElement | null;
    const slider = this.shadow.querySelector('#joint-hud-slider') as HTMLInputElement | null;
    const valEl = this.shadow.querySelector('#joint-hud-val') as HTMLElement | null;
    if (!hud || !nameEl || !slider || !valEl) return;

    const row = this.panel?.getRow(jointName);
    const panelInput = this.panel?.getInput(jointName);
    const motion = this.motionByJoint.get(jointName);
    if (!row || !panelInput || !motion || !this.isControllableJoint(jointName)) {
      hud.hidden = true;
      return;
    }

    const nameLabel = row.querySelector('.name')?.textContent ?? jointName;
    const radians = this._jointStates[jointName] ?? 0;
    slider.min = panelInput.min;
    slider.max = panelInput.max;
    slider.step = panelInput.step;
    slider.value = panelInput.value;
    slider.disabled = panelInput.disabled;
    nameEl.textContent = nameLabel;
    valEl.textContent = formatJointLabel(motion.joint, radians);
    hud.hidden = false;
  }

  private hideJointHud(): void {
    const hud = this.shadow.querySelector('#joint-hud') as HTMLElement | null;
    if (hud) hud.hidden = true;
  }

  private wireJointHud(): void {
    this.unwiredJointHud?.();
    const bundle = this.sceneBundle;
    if (!bundle) return;

    const slider = this.shadow.querySelector('#joint-hud-slider') as HTMLInputElement | null;
    const onHudInput = () => {
      if (!this._selectedJoint || !slider) return;
      const joint = this._selectedJoint;
      const motion = this.motionByJoint.get(joint);
      if (!motion) return;
      const v = fromUi(motion.joint, Number(slider.value));
      const panelInput = this.panel?.getInput(joint);
      if (panelInput) panelInput.value = slider.value;
      applyJointValue(motion.joint, motion.motion, motion.axis, v);
      this.handleUiJointChange(joint, v);
      this.syncJointHudFromPanel(joint);
      this.onDemand?.requestRender();
    };
    slider?.addEventListener('input', onHudInput);

    const dom = bundle.renderer.domElement;
    const onPointerDown = (e: PointerEvent) => {
      if (!this._selectedJoint || !e.ctrlKey || e.button !== 0) return;
      const motion = this.motionByJoint.get(this._selectedJoint);
      if (!motion || !this.isControllableJoint(this._selectedJoint)) return;
      const panelInput = this.panel?.getInput(this._selectedJoint);
      if (!panelInput || panelInput.disabled) return;
      e.preventDefault();
      e.stopPropagation();
      this.jointCtrlDrag = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startRad: this._jointStates[this._selectedJoint] ?? 0,
        joint: this._selectedJoint,
      };
      bundle.controls.enabled = false;
      dom.setPointerCapture(e.pointerId);
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!this.jointCtrlDrag || e.pointerId !== this.jointCtrlDrag.pointerId) return;
      e.preventDefault();
      const motion = this.motionByJoint.get(this.jointCtrlDrag.joint);
      if (!motion) return;
      const deltaX = e.clientX - this.jointCtrlDrag.startX;
      const nextRad = this.jointCtrlDrag.startRad + deltaX * 0.01;
      const ui = Math.round(toUi(motion.joint, nextRad));
      const panelInput = this.panel?.getInput(this.jointCtrlDrag.joint);
      const sliderEl = this.shadow.querySelector('#joint-hud-slider') as HTMLInputElement | null;
      const min = panelInput ? Number(panelInput.min) : -180;
      const max = panelInput ? Number(panelInput.max) : 180;
      const clampedUi = Math.min(max, Math.max(min, ui));
      const v = fromUi(motion.joint, clampedUi);
      if (panelInput) panelInput.value = String(clampedUi);
      if (sliderEl) sliderEl.value = String(clampedUi);
      applyJointValue(motion.joint, motion.motion, motion.axis, v);
      this.handleUiJointChange(this.jointCtrlDrag.joint, v);
      this.syncJointHudFromPanel(this.jointCtrlDrag.joint);
      this.onDemand?.requestRender();
    };
    const endCtrlDrag = (e: PointerEvent) => {
      if (!this.jointCtrlDrag || e.pointerId !== this.jointCtrlDrag.pointerId) return;
      this.jointCtrlDrag = null;
      bundle.controls.enabled = true;
      dom.releasePointerCapture?.(e.pointerId);
    };

    dom.addEventListener('pointerdown', onPointerDown, true);
    dom.addEventListener('pointermove', onPointerMove, true);
    dom.addEventListener('pointerup', endCtrlDrag, true);
    dom.addEventListener('pointercancel', endCtrlDrag, true);

    this.unwiredJointHud = () => {
      slider?.removeEventListener('input', onHudInput);
      dom.removeEventListener('pointerdown', onPointerDown, true);
      dom.removeEventListener('pointermove', onPointerMove, true);
      dom.removeEventListener('pointerup', endCtrlDrag, true);
      dom.removeEventListener('pointercancel', endCtrlDrag, true);
    };
  }

  private onJointSelected(link: string, joint: string): void {
    this._selectedJoint = joint;
    this.dispatchEvent(
      new CustomEvent<SelectionChangeDetail>('selectionchange', {
        bubbles: true,
        composed: true,
        detail: { link, joint },
      }),
    );
    if (this.isControllableJoint(joint)) this.syncJointHudFromPanel(joint);
    else this.hideJointHud();
  }

  private updatePanelVisibility(): void {
    const panel = this.shadow.querySelector('#panel');
    panel?.classList.toggle('hidden', !this._showControls);
  }

  private recomputeModelConsistency(): void {
    this._modelConsistency = computeModelConsistency(
      this._mapping,
      this._manifest,
      this._expectedMotors,
    );
  }

  private updateModeUi(): void {
    const requested = this._mode;
    let effective: ViewerMode = requested;
    const inconsistent = !this._modelConsistency.ok;
    const consistencyReason = this._modelConsistency.reason;

    if (inconsistent) {
      effective = 'read';
      this._lastCommandBlockReason = consistencyReason;
    } else if (requested === 'command') {
      const gate = canCommand(this._mapping, this._mappingValidation);
      if (!gate.ok) {
        effective = 'preview';
        if (this._lastCommandBlockReason !== gate.reason) {
          this._lastCommandBlockReason = gate.reason;
          this.emitCommandBlocked(gate.reason);
        }
      } else if (!this._mapping || !motorLimitsProvided(this._mapping, this._motorLimits)) {
        effective = 'preview';
        const reason = 'limits not provided';
        if (this._lastCommandBlockReason !== reason) {
          this._lastCommandBlockReason = reason;
          this.emitCommandBlocked(reason);
        }
      } else {
        this._lastCommandBlockReason = null;
      }
    } else {
      this._lastCommandBlockReason = null;
    }
    this._effectiveMode = effective;

    const consistencyEl = this.shadow.querySelector('#consistency') as HTMLElement | null;
    if (consistencyEl) {
      consistencyEl.textContent = inconsistent ? (consistencyReason ?? '') : '';
      consistencyEl.classList.toggle('on', inconsistent);
    }

    const guard = this.shadow.querySelector('#guard') as HTMLElement | null;
    if (guard) {
      const blocked = !inconsistent && requested === 'command' && effective !== 'command';
      guard.textContent = blocked
        ? `Befehlsmodus gesperrt: ${this._lastCommandBlockReason ?? 'Mapping ungültig'}. Der Viewer bleibt in der Vorschau.`
        : '';
      guard.classList.toggle('on', blocked);
    }
    this.panel?.applyMode(requested, effective);
  }

  // "command mode blocked" is a state, not a fault: raising `error` here made the console latch
  // its load error and drop every later joint state, which showed up as a permanently stale
  // live state.
  private emitCommandBlocked(reason: string): void {
    console.warn(`command blocked: ${reason}`);
    this.dispatchEvent(
      new CustomEvent('commandblocked', {
        bubbles: true,
        composed: true,
        detail: { reason },
      }),
    );
  }

  private emitMappingError(message: string): void {
    console.error(message);
    this.dispatchEvent(
      new CustomEvent('error', {
        bubbles: true,
        composed: true,
        detail: { message },
      }),
    );
  }

  private handleResize(): void {
    if (!this.sceneBundle) return;
    const w = this.clientWidth || 1;
    const h = this.clientHeight || 1;
    this.sceneBundle.camera.aspect = w / h;
    this.sceneBundle.camera.updateProjectionMatrix();
    this.sceneBundle.renderer.setSize(w, h);
    this.onDemand?.requestRender();
  }

  private async load(): Promise<void> {
    const gen = ++this.loadGeneration;
    const loading = this.shadow.querySelector('#loading') as HTMLElement;
    const bar = this.shadow.querySelector('#load-bar') as HTMLElement;
    const txt = this.shadow.querySelector('#load-txt') as HTMLElement;
    const errEl = this.shadow.querySelector('#load-err') as HTMLElement;
    loading.style.display = 'grid';
    errEl.textContent = '';
    txt.textContent = 'Modell wird geladen …';
    bar.style.width = '0%';

    try {
      const [model, mappingLoad, manifestLoad] = await Promise.all([
        fetchModel(this._modelUrl),
        loadMapping(this._mappingUrl),
        fetchModelManifest(this._modelUrl),
      ]);
      if (gen !== this.loadGeneration || this.disposed) return;

      this._manifest = manifestLoad.manifest;
      if (mappingLoad.loadError || !mappingLoad.mapping) {
        this._mapping = null;
        this._mappingValidation = {
          ok: false,
          errors: [mappingLoad.loadError ?? 'mapping failed to load'],
          warnings: [],
        };
        this.emitMappingError(this._mappingValidation.errors[0]!);
      } else {
        this._mapping = mappingLoad.mapping;
        this._mappingValidation = validateMapping(mappingLoad.mapping, model);
        if (!this._mappingValidation.ok) {
          this.emitMappingError(this._mappingValidation.errors.join('; '));
        }
        for (const w of this._mappingValidation.warnings) {
          console.warn(w);
        }
      }
      this.recomputeModelConsistency();

      const { linkNodes, partsOf } = await loadLinkMeshes(model, this._modelUrl, (done, total) => {
        bar.style.width = `${(done / total) * 100}%`;
        txt.textContent = `${done} / ${total} Bauteile`;
      });
      if (gen !== this.loadGeneration || this.disposed) return;

      this.linkNodes = linkNodes;
      ensureFrameLinks(model, linkNodes, partsOf);
      this.kinematic = buildKinematicTree(model, linkNodes);
      this.motions = this.kinematic.motions;
      this.motionByJoint = new Map(this.motions.map((m) => [m.joint.name, m]));

      if (!this.sceneBundle) this.initScene();
      attachRootToScene(this.sceneBundle!.modelRoot, linkNodes, this.kinematic.rootLink);
      this._baseFrame = alignModelToBaseFrame(
        this.sceneBundle!.modelRoot,
        this.linkNodes.get(BASE_LINK),
      );
      const { size, triangles } = frameCameraOnModel(
        this.sceneBundle!.modelRoot,
        this.sceneBundle!.camera,
        this.sceneBundle!.controls,
      );

      const stats = this.shadow.querySelector('#stats') as HTMLElement;
      stats.innerHTML =
        `<b>${model.links.length}</b> Links · <b>${model.joints.length}</b> Joints<br>` +
        `<b>${Math.round(triangles).toLocaleString('de-DE')}</b> Dreiecke · ` +
        `${size.x.toFixed(2)} × ${size.y.toFixed(2)} × ${size.z.toFixed(2)} m`;

      this.shadow.querySelector('#joints')!.innerHTML = '';
      const mapByJoint = this._mapping
        ? mappingByUrdfJoint(this._mapping)
        : new Map<string, JointMappingEntry>();
      this.panel = buildJointPanel({
        root: this.shadow,
        model,
        parentOf: this.kinematic.parentOf,
        motions: this.motions,
        mappingByJoint: mapByJoint,
        onJointChange: (joint, value) => this.handleUiJointChange(joint, value),
        onRequestRender: () => this.onDemand?.requestRender(),
        onApprove: () => this.approve('ui'),
        onCancelPending: () => this.cancelPending(),
        onEstop: () => this.stop('ui'),
        labelsByMotor: this._labelsByMotor,
      });
      this.panel.applyMotorLimits(this._motorLimits);
      this.updateModeUi();

      this.unpick?.();
      this.unpick = wirePicking({
        camera: this.sceneBundle!.camera,
        modelRoot: this.sceneBundle!.modelRoot,
        renderer: this.sceneBundle!.renderer,
        scene: this.sceneBundle!.scene,
        linkNodes,
        parentOf: this.kinematic.parentOf,
        jointOfLink: this.kinematic.jointOfLink,
        motionByJoint: this.motionByJoint,
        partsOf,
        root: this.shadow,
        onSelect: (link, joint) => this.onJointSelected(link, joint),
        onClearSelection: () => {
          this._selectedJoint = null;
          this.hideJointHud();
        },
        onRequestRender: () => this.onDemand?.requestRender(),
      });

      loading.style.display = 'none';
      this.applyJointStates('api');
      this.syncPose();
      this.wireHandDrag();
      void this.loadPosesList();
      this.onDemand?.requestRender();

      this.dispatchEvent(
        new CustomEvent<ReadyDetail>('ready', {
          bubbles: true,
          composed: true,
          detail: { links: model.links.length, joints: model.joints.length },
        }),
      );
    } catch (e) {
      if (gen !== this.loadGeneration || this.disposed) return;
      const message = String(e && (e as Error).stack ? (e as Error).stack : e);
      errEl.textContent = message;
      txt.textContent = 'Laden fehlgeschlagen';
      console.error(message);
      this.dispatchEvent(
        new CustomEvent('error', {
          bubbles: true,
          composed: true,
          detail: { message },
        }),
      );
    }
  }

  private applyJointStates(source: JointChangeSource): void {
    for (const [name, radians] of Object.entries(this._jointStates)) {
      const m = this.motionByJoint.get(name);
      if (!m) continue;
      applyJointValue(m.joint, m.motion, m.axis, radians);
      this.panel?.setJointUi(name, radians);
    }
    if (Object.keys(this._actualJoints).length === 0 && Object.keys(this._jointStates).length > 0) {
      this._actualJoints = { ...this._jointStates };
      this._acceptedJoints = { ...this._actualJoints };
    }
    this.onDemand?.requestRender();
    if (source === 'api') {
      for (const [name, radians] of Object.entries(this._jointStates)) {
        this.emitJointChange(name, radians, 'api');
      }
    }
    this.syncPose();
  }

  private applyLiveFrame(values: Record<string, number>): void {
    for (const [name, radians] of Object.entries(values)) {
      this._actualJoints[name] = radians;
      const m = this.motionByJoint.get(name);
      if (!m) continue;
      // The slider (and the IK drag) is the master of a joint it commands: feeding the measured
      // value back makes the thumb and the ghost jump between Soll and Ist. Every other joint keeps
      // following the measurement - otherwise the panel would show a pose the robot is not in.
      if (this._effectiveMode === 'command' && !this._estopped && this._uiOwned.has(name)) continue;
      this._jointStates[name] = radians;
      applyJointValue(m.joint, m.motion, m.axis, radians);
      this.panel?.setJointUi(name, radians);
    }
    this.onDemand?.requestRender();
    this.syncPose();
  }

  private syncCommandedPanel(): void {
    if (!this.panel) return;
    const driven = new Set(
      this._mapping?.joints.filter((e) => e.class === 'driven').map((e) => e.urdfJoint) ?? [],
    );
    for (const name of driven) {
      const v = this._commandedStates[name];
      this.panel.setCommandedJoint(name, v ?? null);
    }
    this.onDemand?.requestRender();
  }

  private armStaleTimer(): void {
    this.clearStaleTimer(false);
    this.setStaleFlag(false);
    if (this._staleAfterMs <= 0) return;
    this.staleTimer = setTimeout(() => this.setStaleFlag(true), this._staleAfterMs);
  }

  private clearStaleTimer(clearBanner = true): void {
    if (this.staleTimer != null) {
      clearTimeout(this.staleTimer);
      this.staleTimer = null;
    }
    if (clearBanner) this.setStaleFlag(false);
  }

  private setStaleFlag(value: boolean): void {
    if (this._stale === value) return;
    this._stale = value;
    this.panel?.setStaleBanner(
      value,
      value
        ? `Live-Gelenkzustand veraltet — seit über ${this._staleAfterMs} ms keine neuen Messwerte.`
        : undefined,
    );
  }

  private emitLiveUnknown(motors: string[]): void {
    const message = `Unbekannte Motoren in JointState: ${motors.join(', ')}`;
    console.warn(message);
    this.dispatchEvent(
      new CustomEvent('livejointunknown', {
        bubbles: true,
        composed: true,
        detail: { motors },
      }),
    );
  }

  private emitJointChange(joint: string, value: number, source: JointChangeSource): void {
    this.dispatchEvent(
      new CustomEvent<JointChangeDetail>('jointchange', {
        bubbles: true,
        composed: true,
        detail: { joint, value, source },
      }),
    );
  }

  private syncPose(): void {
    this.handDrag?.sync();
    const pose = this.getPose();
    const baseEl = this.shadow.querySelector('#pose-base') as HTMLElement | null;
    const handEl = this.shadow.querySelector('#pose-hand') as HTMLElement | null;
    if (baseEl && handEl) {
      if (!pose) {
        baseEl.textContent = '–';
        handEl.textContent = '–';
      } else {
        baseEl.textContent = formatPoseMmMetres(pose.base);
        handEl.textContent = formatPoseMmMetres(pose.hand);
      }
    }
    if (!pose) return;
    this.dispatchEvent(
      new CustomEvent<PoseChangeDetail>('posechange', {
        bubbles: true,
        composed: true,
        detail: {
          side: this._poseSide,
          base: pose.base,
          hand: pose.hand,
        },
      }),
    );
  }

  private handleUiJointChange(joint: string, value: number): void {
    this._uiOwned.add(joint);
    this._jointStates[joint] = value;
    this.emitJointChange(joint, value, 'ui');
    if (this._selectedJoint === joint) this.syncJointHudFromPanel(joint);
    this.syncPose();
    if (this._effectiveMode !== 'command' || this._estopped) return;
    const entry = this._mapping ? mappingByUrdfJoint(this._mapping).get(joint) : undefined;
    if (entry?.class !== 'driven') return;
    this._pendingJoints[joint] = value;
    this.panel?.setJointPending(joint, true);
    // Live control: the drag itself commands the motor. The scheduler throttles to
    // _minCommandIntervalMs and coalesces to the latest value, so a fast drag still produces a
    // steady stream instead of one request per pixel.
    if (this._inFlightCommand) {
      this._dirtyDuringFlight = true;
      return;
    }
    this.ensureCommandScheduler();
    this.commandScheduler!.requestFlush('ui');
  }

  /** A slider moved while a command was in flight: send the newest value once it resolves. */
  private _dirtyDuringFlight = false;

  private resendIfDirty(): void {
    if (!this._dirtyDuringFlight) return;
    this._dirtyDuringFlight = false;
    if (Object.keys(this._pendingJoints).length === 0) return;
    this.ensureCommandScheduler();
    this.commandScheduler!.requestFlush('ui');
  }

  private wireHandDrag(): void {
    this.handDrag?.dispose();
    this.handDrag = null;
    const bundle = this.sceneBundle;
    const frame = this._baseFrame;
    if (!bundle || !frame || !this._mapping) return;

    this.handDrag = wireHandDrag({
      scene: bundle.scene,
      camera: bundle.camera,
      dom: bundle.renderer.domElement,
      controls: bundle.controls,
      baseFrame: frame,
      linkNodes: this.linkNodes,
      entries: this._mapping.joints,
      ikUrl: this._ikUrl,
      getJointRad: (j) => this._jointStates[j] ?? 0,
      seedFor: (side) => seedFromModel(this._jointStates, this._mapping!.joints, side),
      onJoints: (angles) => {
        for (const [joint, radians] of Object.entries(angles)) {
          this.handleUiJointChange(joint, radians);
        }
        this.applyJointStates('ui');
        this.onDemand?.requestRender();
      },
      onStatus: (status) => this.showDragStatus(status),
      onRequestRender: () => this.onDemand?.requestRender(),
    });
  }

  private showDragStatus(status: DragStatus): void {
    const el = this.shadow.querySelector('#ik-status') as HTMLElement | null;
    if (!el) return;
    el.classList.toggle('edge', status.kind === 'edge');
    el.classList.toggle('unavailable', status.kind === 'unavailable');
    if (status.kind === 'idle') {
      el.hidden = true;
      el.textContent = '';
      return;
    }
    el.hidden = false;
    if (status.kind === 'solving') el.textContent = 'Rechnet …';
    else if (status.kind === 'reached') el.textContent = 'Roboter folgt';
    else if (status.kind === 'edge') {
      const reason =
        status.blockedBy === 'joint_limit'
          ? 'Gelenk am Anschlag'
          : status.blockedBy === 'behind_body'
            ? 'hinter dem Körper'
            : 'außerhalb der Reichweite';
      el.textContent = `${reason} · ${Math.round(status.distanceMm)} mm fehlen`;
    } else el.textContent = `Keine Inverse Kinematik: ${status.reason}`;
  }

  private ensureCommandScheduler(): void {
    if (this.commandScheduler) return;
    this.commandScheduler = new CommandSendScheduler(this._minCommandIntervalMs, (source) =>
      this.flushCommand(source),
    );
  }

  private flushCommand(source: JointChangeSource): void {
    if (this._estopped || this._effectiveMode !== 'command' || !this._mapping) return;
    if (this._inFlightCommand) return;
    const built = buildCommandFromPending(
      this._pendingJoints,
      this._mapping,
      this._motorLimits,
      source,
      () => newCommandId(),
    );
    if (!built.ok) {
      this.emitCommandRejected('', built.reason);
      this.revertPendingToAccepted();
      this.clearPendingUi();
      return;
    }

    const { commandId, values } = built.command.payload;
    // Before the host is asked: it may publish (and confirm) inside this dispatch.
    this._inFlightCommand = {
      commandId,
      values: { ...values },
      joints: [...built.command.joints],
    };
    const ev = new CustomEvent<CommandRequestDetail>('commandrequest', {
      bubbles: true,
      composed: true,
      cancelable: true,
      detail: built.command.payload,
    });
    this.dispatchEvent(ev);
    if (ev.defaultPrevented) {
      this._inFlightCommand = null;
      const reason =
        (ev as CustomEvent & { rejectionReason?: string }).rejectionReason ??
        'command refused by host';
      this.emitCommandRejected(built.command.payload.commandId, reason);
      this.revertPendingToAccepted();
      this.clearPendingUi();
      return;
    }

    // A host that publishes and confirms inside the dispatch has already cleared the command; only
    // an unanswered one needs the timer.
    if (this._inFlightCommand?.commandId === commandId) this.armAckTimer(commandId);
  }

  private armAckTimer(commandId: string): void {
    this.clearAckTimer();
    if (this._ackTimeoutMs <= 0) return;
    this.ackTimer = setTimeout(() => {
      this.ackTimer = null;
      this.rejectCommand(commandId, 'no acknowledgement');
    }, this._ackTimeoutMs);
  }

  private clearAckTimer(): void {
    if (this.ackTimer != null) {
      clearTimeout(this.ackTimer);
      this.ackTimer = null;
    }
  }

  private clearInFlightCommand(): void {
    this.clearAckTimer();
    this._inFlightCommand = null;
  }

  private emitCommandRejected(commandId: string, reason: string): void {
    this.dispatchEvent(
      new CustomEvent<CommandRejectedDetail>('commandrejected', {
        bubbles: true,
        composed: true,
        detail: { commandId, reason },
      }),
    );
  }

  private clearPendingUi(): void {
    this.panel?.clearAllPending();
    this._pendingJoints = {};
  }

  private revertPendingToAccepted(): void {
    const pose: Record<string, number> = { ...this._jointStates };
    for (const joint of Object.keys(this._pendingJoints)) {
      if (joint in this._acceptedJoints) pose[joint] = this._acceptedJoints[joint]!;
      else if (joint in this._actualJoints) pose[joint] = this._actualJoints[joint]!;
      else pose[joint] = 0;
    }
    this.applyPoseToModel(pose);
  }

  private applyPoseToModel(pose: Record<string, number>): void {
    this._jointStates = { ...pose };
    for (const [name, radians] of Object.entries(pose)) {
      const m = this.motionByJoint.get(name);
      if (!m) continue;
      applyJointValue(m.joint, m.motion, m.axis, radians);
      this.panel?.setJointUi(name, radians);
    }
    this.onDemand?.requestRender();
  }
}

export function registerPibRobotView(): void {
  if (!customElements.get(TAG)) {
    customElements.define(TAG, PibRobotView);
  }
}
