import type { MotionEntry, RobotModel, ViewerMode } from '../types.js';
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
  getRow: (jointName: string) => HTMLElement | null;
  getInput: (jointName: string) => HTMLInputElement | null;
  applyMode: (requestedMode: ViewerMode, effectiveMode: ViewerMode) => void;
}

export interface JointPanelOptions {
  root: ShadowRoot;
  model: RobotModel;
  parentOf: Map<string, string>;
  motions: MotionEntry[];
  mappingByJoint: Map<string, JointMappingEntry>;
  onJointChange: (jointName: string, value: number) => void;
  onRequestRender: () => void;
}

export function buildJointPanel(opts: JointPanelOptions): JointPanelHandles {
  const { root, model, parentOf, motions, mappingByJoint, onJointChange, onRequestRender } =
    opts;
  const jointsRoot = root.querySelector('#joints') as HTMLElement;
  const motionByJoint = new Map(motions.map((m) => [m.joint.name, m]));
  let requestedMode: ViewerMode = 'preview';
  let effectiveMode: ViewerMode = 'preview';

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
          <input type="range" min="${min}" max="${max}" step="1" value="0">`;
      jointsRoot.appendChild(wrap);
      const input = wrap.querySelector('input') as HTMLInputElement;
      const out = wrap.querySelector('.val') as HTMLElement;
      out.textContent = formatJointLabel(joint, 0);
      input.addEventListener('input', () => {
        const ui = Number(input.value);
        const v = fromUi(joint, ui);
        applyJointValue(joint, m.motion, m.axis, v);
        out.textContent = formatJointLabel(joint, v);
        onJointChange(joint.name, v);
        onRequestRender();
      });
    }
  }

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
      if (requestedMode === 'read') {
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
  };

  const getRow = (jointName: string): HTMLElement | null =>
    jointsRoot.querySelector(`[data-joint="${jointName}"]`);

  const getInput = (jointName: string): HTMLInputElement | null =>
    getRow(jointName)?.querySelector('input') ?? null;

  applyMode(requestedMode, effectiveMode);

  return { jointsRoot, setPose, setJointUi, getRow, getInput, applyMode };
}

export function midPoseValue(joint: RobotModel['joints'][0]): number {
  return joint.limit && !joint.name.endsWith('_door_rotation')
    ? (joint.limit.lower + joint.limit.upper) / 2
    : 0;
}
