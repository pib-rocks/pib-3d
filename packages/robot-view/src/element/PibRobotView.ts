import * as THREE from 'three';
import { createScene, type SceneBundle } from '../scene/createScene.js';
import { fetchModel, loadLinkMeshes } from '../model/loadModel.js';
import {
  attachRootToScene,
  buildKinematicTree,
  type KinematicTree,
} from '../model/kinematicTree.js';
import { ensureFrameLinks } from '../model/frameLinks.js';
import { frameCameraOnModel, liftModelToFloor } from '../scene/frameCamera.js';
import {
  canCommand,
  loadMapping,
  mappingByUrdfJoint,
  validateMapping,
  type JointMappingDocument,
  type ValidationResult,
  type JointMappingEntry,
} from '../joints/mapping.js';
import { buildJointPanel, midPoseValue, type JointPanelHandles } from '../joints/panel.js';
import { applyJointValue } from '../joints/math.js';
import { wirePicking } from '../interaction/picking.js';
import { disposeObject3D, OnDemandRenderer } from '../render/onDemand.js';
import { SHADOW_HTML, SHADOW_STYLES } from './template.js';
import type {
  JointChangeDetail,
  JointChangeSource,
  MotionEntry,
  ReadyDetail,
  RobotModel,
  SelectionChangeDetail,
  ViewerMode,
} from '../types.js';

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
    this._jointStates = { ...map };
    this.applyJointStates('api');
  }

  get mode(): ViewerMode {
    return this._mode;
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

  getRenderCount(): number {
    return this.onDemand?.getRenderCount() ?? 0;
  }

  setJointStates(map: Record<string, number>): void {
    this._jointStates = { ...map };
    this.applyJointStates('api');
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

  private updateModeUi(): void {
    const requested = this._mode;
    let effective: ViewerMode = requested;
    if (requested === 'command') {
      const gate = canCommand(this._mapping, this._mappingValidation);
      if (!gate.ok) {
        effective = 'preview';
        if (this._lastCommandBlockReason !== gate.reason) {
          this._lastCommandBlockReason = gate.reason;
          this.emitMappingError(gate.reason);
        }
      } else {
        this._lastCommandBlockReason = null;
      }
    } else {
      this._lastCommandBlockReason = null;
    }
    this._effectiveMode = effective;
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
      const [model, mappingLoad] = await Promise.all([
        fetchModel(this._modelUrl),
        loadMapping(this._mappingUrl),
      ]);
      if (gen !== this.loadGeneration || this.disposed) return;

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

      const { linkNodes, partsOf } = await loadLinkMeshes(model, (done, total) => {
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
      liftModelToFloor(this.sceneBundle!.modelRoot);
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
        onJointChange: (joint, value) => {
          this._jointStates[joint] = value;
          this.emitJointChange(joint, value, 'ui');
        },
        onRequestRender: () => this.onDemand?.requestRender(),
      });
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
    this.onDemand?.requestRender();
    if (source === 'api') {
      for (const [name, radians] of Object.entries(this._jointStates)) {
        this.emitJointChange(name, radians, 'api');
      }
    }
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
}

export function registerPibRobotView(): void {
  if (!customElements.get(TAG)) {
    customElements.define(TAG, PibRobotView);
  }
}
