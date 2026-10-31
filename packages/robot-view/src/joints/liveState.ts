import type { JointMappingDocument, JointMappingEntry } from './mapping.js';
import { mappingByUrdfJoint } from './mapping.js';

export interface JointStateSample {
  names: string[];
  positions: number[];
  stampMs: number;
}

export interface SampleToModelResult {
  values: Record<string, number>;
  unknown: string[];
  dropped: boolean;
}

export function mappingByMotor(mapping: JointMappingDocument): Map<string, JointMappingEntry> {
  const out = new Map<string, JointMappingEntry>();
  for (const entry of mapping.joints) {
    if (entry.motor) out.set(entry.motor, entry);
  }
  return out;
}

export function sampleToModelJoints(
  sample: JointStateSample,
  mapping: JointMappingDocument,
  previousStampMs: number | null,
): SampleToModelResult {
  if (previousStampMs != null && sample.stampMs <= previousStampMs) {
    return { values: {}, unknown: [], dropped: true };
  }

  const byMotor = mappingByMotor(mapping);
  const values: Record<string, number> = {};
  const unknown: string[] = [];

  for (let i = 0; i < sample.names.length; i++) {
    const motor = sample.names[i]!;
    const motorRad = sample.positions[i]!;
    const entry = byMotor.get(motor);
    if (!entry) {
      unknown.push(motor);
      continue;
    }
    const direction = entry.direction ?? 1;
    values[entry.urdfJoint] = motorRad * direction;
  }

  return { values, unknown, dropped: false };
}

/** Resolve URDF joint keys and motor-name keys to URDF joints in model radians. */
export function resolveJointStateMap(
  map: Record<string, number>,
  mapping: JointMappingDocument,
): Record<string, number> {
  const byMotor = mappingByMotor(mapping);
  const byUrdf = mappingByUrdfJoint(mapping);
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(map)) {
    const motorEntry = byMotor.get(key);
    if (motorEntry) {
      const direction = motorEntry.direction ?? 1;
      out[motorEntry.urdfJoint] = value * direction;
    } else if (byUrdf.has(key)) {
      out[key] = value;
    } else {
      out[key] = value;
    }
  }
  return out;
}

export type LiveFrameCallback = (values: Record<string, number>) => void;

export class LiveJointInterpolator {
  private previousStampMs: number | null = null;
  private periodMs = 50;
  private displayed: Record<string, number> = {};
  private target: Record<string, number> = {};
  private wallDeadlineMs = 0;
  private timerId: ReturnType<typeof setTimeout> | null = null;
  private animating = false;
  private stampWallOffsetMs: number | null = null;
  private readonly warnedUnknown = new Set<string>();

  constructor(
    private readonly onFrame: LiveFrameCallback,
    private readonly onUnknown: (motors: string[]) => void,
  ) {}

  get isAnimating(): boolean {
    return this.animating;
  }

  seedDisplay(values: Record<string, number>): void {
    this.displayed = { ...values };
  }

  pushSample(
    sample: JointStateSample,
    mapping: JointMappingDocument,
  ): { dropped: boolean; values: Record<string, number> } {
    const { values, unknown, dropped } = sampleToModelJoints(
      sample,
      mapping,
      this.previousStampMs,
    );
    if (dropped) return { dropped: true, values: {} };

    const freshUnknown = unknown.filter((m) => !this.warnedUnknown.has(m));
    if (freshUnknown.length) {
      for (const m of freshUnknown) this.warnedUnknown.add(m);
      this.onUnknown(freshUnknown);
    }

    if (this.previousStampMs != null) {
      const delta = sample.stampMs - this.previousStampMs;
      if (delta > 0 && delta < 1000) this.periodMs = delta;
    } else {
      this.stampWallOffsetMs = Date.now() - sample.stampMs;
    }
    this.previousStampMs = sample.stampMs;

    for (const [joint, v] of Object.entries(values)) {
      this.target[joint] = v;
      if (!(joint in this.displayed)) this.displayed[joint] = v;
    }

    const offset = this.stampWallOffsetMs ?? 0;
    this.wallDeadlineMs = sample.stampMs + offset + 2 * this.periodMs;
    this.ensureAnimating();
    return { dropped: false, values };
  }

  dispose(): void {
    this.clearTimer();
    this.animating = false;
  }

  private clearTimer(): void {
    if (this.timerId != null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }

  private ensureAnimating(): void {
    if (this.animating) return;
    this.animating = true;
    this.scheduleTick();
  }

  private scheduleTick(): void {
    if (this.timerId != null) return;
    this.timerId = setTimeout(() => this.tick(), 16);
  }

  private tick(): void {
    this.timerId = null;
    if (!this.animating) return;

    const now = Date.now();
    if (now >= this.wallDeadlineMs) {
      this.displayed = { ...this.target };
      this.onFrame(this.displayed);
      this.animating = false;
      return;
    }

    const alpha = 0.4;
    const next: Record<string, number> = { ...this.displayed };
    let settling = false;
    for (const [joint, target] of Object.entries(this.target)) {
      const cur = this.displayed[joint] ?? target;
      if (Math.abs(cur - target) < 1e-5) {
        next[joint] = target;
        continue;
      }
      settling = true;
      next[joint] = cur + (target - cur) * alpha;
    }
    this.displayed = next;
    this.onFrame(this.displayed);

    if (settling && now < this.wallDeadlineMs) {
      this.scheduleTick();
    } else {
      this.displayed = { ...this.target };
      this.onFrame(this.displayed);
      this.animating = false;
    }
  }
}
