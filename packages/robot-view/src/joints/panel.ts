import * as THREE from 'three';
import type { MotionEntry, MotorLimitMap, RobotModel, ViewerMode } from '../types.js';
import { uiRangeFromMotorLimits } from './commandPath.js';
import { HEAD, LEFT_ARM, REGION_ORDER, RIGHT_ARM } from './regions.js';
import {
  formatJointLabel,
  fromUi,
  prettyJointName,
  toUi,
  uiRange,
  applyJointValue,
} from './math.js';
import {
  commandDisableTitle,
  jointClassLabel,
  type JointMappingEntry,
} from './mapping.js';

export interface JointPanelHandles {
  jointsRoot: HTMLElement;
  setPose: (fn: (joint: RobotModel['joints'][0]) => number) => void;
  setJointUi: (jointName: string, radians: number) => void;
  setCommandedJoint: (jointName: string, radians: number | null) => void;
  setJointPending: (jointName: string, pending: boolean) => void;
  clearAllPending: () => void;
  setStaleBanner: (stale: boolean, message?: string) => void;
  getRow: (jointName: string) => HTMLElement | null;
  getInput: (jointName: string) => HTMLInputElement | null;
  applyMode: (requestedMode: ViewerMode, effectiveMode: ViewerMode) => void;
  applyMotorLimits: (limits: MotorLimitMap | null) => void;
  setCommandBarVisible: (visible: boolean) => void;
}

export interface JointPanelOptions {
  root: ShadowRoot;
  model: RobotModel;
  parentOf: Map<string, string>;
  motions: MotionEntry[];
  mappingByJoint: Map<string, JointMappingEntry>;
  onJointChange: (jointName: string, value: number) => void;
  onRequestRender: () => void;
  onApprove?: () => void;
  onCancelPending?: () => void;
  onEstop?: () => void;
}

export function buildJointPanel(opts: JointPanelOptions): JointPanelHandles {
  const {
    root,
    model,
    parentOf,
    motions,
    mappingByJoint,
    onJointChange,
    onRequestRender,
    onApprove,
    onCancelPending,
    onEstop,
  } = opts;
  const jointsRoot = root.querySelector('#joints') as HTMLElement;
  const motionByJoint = new Map(motions.map((m) => [m.joint.name, m]));
  let requestedMode: ViewerMode = 'preview';
  let effectiveMode: ViewerMode = 'preview';
  let motorLimits: MotorLimitMap | null = null;
  const commanded = new Map<string, number>();
  const pending = new Set<string>();

  const tools = root.querySelector('#tools') as HTMLElement | null;
  if (tools && !root.querySelector('[data-action="approve"]')) {
    const bar = document.createElement('div');
    bar.id = 'command-bar';
    bar.className = 'command-bar';
    bar.innerHTML = `
      <button type="button" data-action="approve">Befehl freigeben</button>
      <button type="button" data-action="cancel-pending">Ausstehend verwerfen</button>
      <button type="button" data-action="estop" class="danger">E-Stop</button>`;
    tools.after(bar);
    bar.querySelector('[data-action="approve"]')?.addEventListener('click', () => onApprove?.());
    bar
      .querySelector('[data-action="cancel-pending"]')
      ?.addEventListener('click', () => onCancelPending?.());
    bar.querySelector('[data-action="estop"]')?.addEventListener('click', () => onEstop?.());
  }

  const pctOnTrack = (joint: RobotModel['joints'][0], radians: number): number => {
    const [min, max] = uiRange(joint);
    const ui = toUi(joint, radians);
    if (max === min) return 0;
    return Math.min(100, Math.max(0, ((ui - min) / (max - min)) * 100));
  };

  const updateTrackMarkers = (
    joint: RobotModel['joints'][0],
    row: HTMLElement,
    actualRad: number,
    commandedRad: number | null,
  ) => {
    const fill = row.querySelector('.track .fill.ist') as HTMLElement | null;
    const soll = row.querySelector('.track .mark.soll') as HTMLElement | null;
    const delta = row.querySelector('.cmd-delta') as HTMLElement | null;
    if (fill) fill.style.width = `${pctOnTrack(joint, actualRad)}%`;
    if (soll) {
      if (commandedRad == null) {
        soll.classList.remove('on');
      } else {
        soll.style.left = `${pctOnTrack(joint, commandedRad)}%`;
        soll.classList.add('on');
      }
    }
    if (delta) {
      if (commandedRad == null) {
        delta.classList.remove('on');
        delta.textContent = '';
      } else {
        const deg = THREE.MathUtils.radToDeg(actualRad - commandedRad);
        delta.textContent = `Δ ${deg >= 0 ? '+' : ''}${deg.toFixed(1)}° · Soll / Ist`;
        delta.classList.add('on');
      }
    }
  };

  const chainOf = (link: string): string[] => {
    const out: string[] = [];
    let cur: string | undefined = link;
    while (cur) {
      out.push(cur);
      cur = parentOf.has(cur)
        ? model.joints.find((j) => j.child === cur)?.parent
        : undefined;
    }
    return out;
  };

  const groups = new Map(REGION_ORDER.map((k) => [k, [] as MotionEntry[]]));
  for (const m of motions) {
    const chain = chainOf(m.joint.child);
    const palm = chain.find((n) => n.includes('palm'));
    let region: (typeof REGION_ORDER)[number];
    if (HEAD.has(m.joint.name)) region = 'Kopf';
    else if (LEFT_ARM.has(m.joint.name)) region = 'Linker Arm';
    else if (RIGHT_ARM.has(m.joint.name)) region = 'Rechter Arm';
    else if (palm) region = palm.includes('_l_') ? 'Linke Hand' : 'Rechte Hand';
    else region = 'Körper';
    groups.get(region)!.push(m);
  }

  for (const region of REGION_ORDER) {
    const items = groups.get(region)!;
    if (!items.length) continue;
    const h = document.createElement('h2');
    h.textContent = `${region} · ${items.length}`;
    jointsRoot.appendChild(h);
    for (const m of items) {
      const { joint } = m;
      const mapEntry = mappingByJoint.get(joint.name);
      const className = mapEntry?.class ?? 'coupled';
      const badge = jointClassLabel(className);
      const motorLine =
        mapEntry?.class === 'driven' && mapEntry.motor
          ? `<div class="motor" title="Motor">${mapEntry.motor}</div>`
          : '';
      const wrap = document.createElement('div');
      wrap.className = 'j';
      wrap.dataset.joint = joint.name;
      if (mapEntry) wrap.dataset.jointClass = mapEntry.class;
      const [min, max] = uiRange(joint);
      wrap.innerHTML = `
          <div class="row">
            <span class="name" title="${joint.name}">${prettyJointName(joint.name)}</span>
            <span class="badge">${badge}</span>
            <span class="val"></span>
          </div>
          ${motorLine}
          <div class="slider">
            <div class="track"><span class="fill ist"></span><span class="mark soll" title="Soll"></span></div>
            <input type="range" min="${min}" max="${max}" step="1" value="0">
          </div>
          <div class="cmd-delta"></div>`;
      jointsRoot.appendChild(wrap);
      const input = wrap.querySelector('input') as HTMLInputElement;
      const out = wrap.querySelector('.val') as HTMLElement;
      out.textContent = formatJointLabel(joint, 0);
      updateTrackMarkers(joint, wrap, 0, null);
      input.addEventListener('input', () => {
        const ui = Number(input.value);
        const v = fromUi(joint, ui);
        applyJointValue(joint, m.motion, m.axis, v);
        out.textContent = formatJointLabel(joint, v);
        updateTrackMarkers(joint, wrap, v, commanded.get(joint.name) ?? null);
        onJointChange(joint.name, v);
        onRequestRender();
      });
    }
  }

  const applySliderRange = (joint: RobotModel['joints'][0], input: HTMLInputElement) => {
    const entry = mappingByJoint.get(joint.name);
    if (effectiveMode === 'command' && entry?.class === 'driven' && motorLimits) {
      const range = uiRangeFromMotorLimits(entry, joint, motorLimits);
      if (range) {
        input.min = String(range[0]);
        input.max = String(range[1]);
        return;
      }
    }
    const [min, max] = uiRange(joint);
    input.min = String(min);
    input.max = String(max);
  };

  const setCommandBarVisible = (visible: boolean) => {
    const bar = root.querySelector('#command-bar') as HTMLElement | null;
    if (bar) bar.classList.toggle('on', visible);
  };

  const applyMode = (req: ViewerMode, effective: ViewerMode) => {
    requestedMode = req;
    effectiveMode = effective;
    for (const m of motions) {
      const row = getRow(m.joint.name);
      const input = row?.querySelector('input') as HTMLInputElement | null;
      if (!input) continue;
      const entry = mappingByJoint.get(m.joint.name);
      let enabled = true;
      let title = '';
      if (requestedMode === 'read' || effectiveMode === 'read') {
        enabled = false;
        title = 'Nur-Lesen — Schieberegler deaktiviert';
      } else if (effectiveMode === 'command') {
        if (entry?.class === 'driven') {
          enabled = true;
        } else {
          enabled = false;
          title = entry ? commandDisableTitle(entry) : 'Kein Mapping — nicht befehlbar';
        }
      }
      input.disabled = !enabled;
      input.title = title;
      applySliderRange(m.joint, input);
    }
    setCommandBarVisible(effective === 'command');
  };

  const setJointPending = (jointName: string, isPending: boolean) => {
    const row = getRow(jointName);
    if (!row) return;
    if (isPending) pending.add(jointName);
    else pending.delete(jointName);
    row.classList.toggle('pending', isPending);
  };

  const clearAllPending = () => {
    for (const name of [...pending]) setJointPending(name, false);
    pending.clear();
  };

  const applyMotorLimits = (limits: MotorLimitMap | null) => {
    motorLimits = limits;
    for (const m of motions) {
      const row = getRow(m.joint.name);
      const input = row?.querySelector('input') as HTMLInputElement | null;
      if (input) applySliderRange(m.joint, input);
    }
  };

  const setPose = (fn: (joint: RobotModel['joints'][0]) => number) => {
    for (const m of motions) {
      const { joint, motion, axis } = m;
      const v = fn(joint);
      applyJointValue(joint, motion, axis, v);
      setJointUi(joint.name, v);
    }
    onRequestRender();
  };

  const setJointUi = (jointName: string, radians: number) => {
    const m = motionByJoint.get(jointName);
    if (!m) return;
    const row = getRow(jointName);
    const input = row?.querySelector('input') as HTMLInputElement | null;
    const out = row?.querySelector('.val') as HTMLElement | null;
    if (input) input.value = String(toUi(m.joint, radians));
    if (out) out.textContent = formatJointLabel(m.joint, radians);
    if (row) {
      updateTrackMarkers(m.joint, row, radians, commanded.get(jointName) ?? null);
    }
  };

  const setCommandedJoint = (jointName: string, radians: number | null) => {
    const entry = mappingByJoint.get(jointName);
    if (entry?.class !== 'driven') return;
    if (radians == null) commanded.delete(jointName);
    else commanded.set(jointName, radians);
    const m = motionByJoint.get(jointName);
    const row = getRow(jointName);
    if (!m || !row) return;
    const actual = inputRadiansFromRow(row, m.joint) ?? 0;
    updateTrackMarkers(m.joint, row, actual, commanded.get(jointName) ?? null);
  };

  const inputRadiansFromRow = (row: HTMLElement, joint: RobotModel['joints'][0]): number | null => {
    const input = row.querySelector('input') as HTMLInputElement | null;
    if (!input) return null;
    return fromUi(joint, Number(input.value));
  };

  const setStaleBanner = (stale: boolean, message?: string) => {
    const el = root.querySelector('#live-stale') as HTMLElement | null;
    if (!el) return;
    el.textContent = stale
      ? (message ??
        'Live-Gelenkzustand veraltet — seit längerem keine neuen Messwerte.')
      : '';
    el.classList.toggle('on', stale);
  };

  const getRow = (jointName: string): HTMLElement | null =>
    jointsRoot.querySelector(`[data-joint="${jointName}"]`);

  const getInput = (jointName: string): HTMLInputElement | null =>
    getRow(jointName)?.querySelector('input') ?? null;

  applyMode(requestedMode, effectiveMode);

  return {
    jointsRoot,
    setPose,
    setJointUi,
    setCommandedJoint,
    setJointPending,
    clearAllPending,
    setStaleBanner,
    getRow,
    getInput,
    applyMode,
    applyMotorLimits,
    setCommandBarVisible,
  };
}

export function midPoseValue(joint: RobotModel['joints'][0]): number {
  return joint.limit && !joint.name.endsWith('_door_rotation')
    ? (joint.limit.lower + joint.limit.upper) / 2
    : 0;
}
