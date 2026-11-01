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
import { applyJointValue } from '../joints/math.js';
import { wirePicking } from '../interaction/picking.js';
import { disposeObject3D, OnDemandRenderer } from '../render/onDemand.js';
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
    return ['model-url', 'mapping-url', 'mode', 'show-controls'];
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
  private _modelConsistency: ModelConsistencyResult = { ok: true, reason: null };
  private _baseFrame: BaseFrameContext | null = null;
  private _tcpLink = TCP_LINK_RIGHT;
  private _poseSide: ArmSide = 'right';

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

  rejectCommand(commandId: string, reason: string): void {
    if (this._inFlightCommand?.commandId !== commandId) return;
    this.clearInFlightCommand();
    this.revertPendingToAccepted();
    this.clearPendingUi();
    this.emitCommandRejected(commandId, reason);
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
    if (dropped) return;
    this.armStaleTimer();
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
    this.updatePanelVisibility();
  }

  private wireVisibility(): void {
    this.onVisibilityChange = () => {
      const visible = !document.hidden;
      this.onDemand?.setActive(visible);
    };
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  private wireToolbar(): void {
    const root = this.shadow;
    const gridBtn = root.querySelector('[data-action="grid"]') as HTMLButtonElement;
    const spinBtn = root.querySelector('[data-action="spin"]') as HTMLButtonElement;
    root.querySelector('[data-action="zero"]')?.addEventListener('click', () => this.resetPose());
    root.querySelector('[data-action="mid"]')?.addEventListener('click', () => {
      this.panel?.setPose((j) => midPoseValue(j));
      for (const m of this.motions) {
        const v = midPoseValue(m.joint);
        this._jointStates[m.joint.name] = v;
        this.emitJointChange(m.joint.name, v, 'api');
      }
      this.syncPose();
    });
    gridBtn?.addEventListener('click', () => {
      if (!this.sceneBundle) return;
      this.sceneBundle.grid.visible = !this.sceneBundle.grid.visible;
      gridBtn.classList.toggle('on', this.sceneBundle.grid.visible);
      this.onDemand?.requestRender();
    });
    spinBtn?.addEventListener('click', () => {
      if (!this.sceneBundle) return;
      this.sceneBundle.controls.autoRotate = !this.sceneBundle.controls.autoRotate;
      spinBtn.classList.toggle('on', this.sceneBundle.controls.autoRotate);
      this.onDemand?.requestRender();
    });
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
          this.emitMappingError(gate.reason);
        }
      } else if (!this._mapping || !motorLimitsProvided(this._mapping, this._motorLimits)) {
        effective = 'preview';
        const reason = 'limits not provided';
        if (this._lastCommandBlockReason !== reason) {
          this._lastCommandBlockReason = reason;
          this.emitMappingError(reason);
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
      });
      this.panel.applyMotorLimits(this._motorLimits);
      this.updateModeUi();

      this.unpick?.();
      this.unpick = wirePicking({
        camera: this.sceneBundle!.camera,
        modelRoot: this.sceneBundle!.modelRoot,
        renderer: this.sceneBundle!.renderer,
        linkNodes,
        parentOf: this.kinematic.parentOf,
        jointOfLink: this.kinematic.jointOfLink,
        partsOf,
        root: this.shadow,
        onSelect: (link, joint) => {
          this.dispatchEvent(
            new CustomEvent<SelectionChangeDetail>('selectionchange', {
              bubbles: true,
              composed: true,
              detail: { link, joint },
            }),
          );
        },
        onRequestRender: () => this.onDemand?.requestRender(),
      });

      loading.style.display = 'none';
      this.applyJointStates('api');
      this.syncPose();
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
      this._jointStates[name] = radians;
      this._actualJoints[name] = radians;
      const m = this.motionByJoint.get(name);
      if (!m) continue;
      applyJointValue(m.joint, m.motion, m.axis, radians);
      if (this._effectiveMode !== 'command' || this._estopped) {
        this.panel?.setJointUi(name, radians);
      }
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
    this._jointStates[joint] = value;
    this.emitJointChange(joint, value, 'ui');
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

    const ev = new CustomEvent<CommandRequestDetail>('commandrequest', {
      bubbles: true,
      composed: true,
      cancelable: true,
      detail: built.command.payload,
    });
    this.dispatchEvent(ev);
    if (ev.defaultPrevented) {
      const reason =
        (ev as CustomEvent & { rejectionReason?: string }).rejectionReason ??
        'command refused by host';
      this.emitCommandRejected(built.command.payload.commandId, reason);
      this.revertPendingToAccepted();
      this.clearPendingUi();
      return;
    }

    const { commandId, values } = built.command.payload;
    this._inFlightCommand = {
      commandId,
      values: { ...values },
      joints: [...built.command.joints],
    };
    this.armAckTimer(commandId);
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
