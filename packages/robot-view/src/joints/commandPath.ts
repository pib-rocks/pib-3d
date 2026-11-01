import type { ModelJoint } from '../types.js';
import {
  modelRadToMotorCentideg,
  motorCentidegToModelRad,
  type JointMappingDocument,
  type JointMappingEntry,
} from './mapping.js';
import { toUi } from './math.js';

export interface MotorLimitDeg {
  minDeg: number;
  maxDeg: number;
}

export type MotorLimitMap = Record<string, MotorLimitDeg>;

export interface CommandPayload {
  commandId: string;
  values: Record<string, number>;
  motors: Record<string, number>;
  source: 'ui' | 'api';
}

export interface BuiltCommand {
  payload: CommandPayload;
  joints: string[];
}

export function motorLimitsProvided(
  mapping: JointMappingDocument,
  limits: MotorLimitMap,
): boolean {
  if (!limits || Object.keys(limits).length === 0) return false;
  for (const entry of mapping.joints) {
    if (entry.class !== 'driven' || !entry.motor) continue;
    const lim = limits[entry.motor];
    if (!lim || typeof lim.minDeg !== 'number' || typeof lim.maxDeg !== 'number') {
      return false;
    }
  }
  return true;
}

export function uiRangeFromMotorLimits(
  entry: JointMappingEntry,
  joint: ModelJoint,
  limits: MotorLimitMap,
): [number, number] | null {
  if (!entry.motor) return null;
  const lim = limits[entry.motor];
  if (!lim) return null;
  const minRad = motorCentidegToModelRad(entry, lim.minDeg * 100);
  const maxRad = motorCentidegToModelRad(entry, lim.maxDeg * 100);
  const lo = Math.min(minRad, maxRad);
  const hi = Math.max(minRad, maxRad);
  return [Math.round(toUi(joint, lo)), Math.round(toUi(joint, hi))];
}

export function validateDrivenValue(
  entry: JointMappingEntry,
  modelRad: number,
  limits: MotorLimitMap,
): string | null {
  if (entry.class !== 'driven' || !entry.motor) {
    return `joint "${entry.urdfJoint}" is not driven`;
  }
  const lim = limits[entry.motor];
  if (!lim) {
    return `no limits for motor "${entry.motor}"`;
  }
  const cd = modelRadToMotorCentideg(entry, modelRad);
  const minCd = lim.minDeg * 100;
  const maxCd = lim.maxDeg * 100;
  const lo = Math.min(minCd, maxCd);
  const hi = Math.max(minCd, maxCd);
  if (cd < lo - 1e-6 || cd > hi + 1e-6) {
    return (
      `motor "${entry.motor}" centideg ${cd.toFixed(0)} outside limit ` +
      `[${lim.minDeg}°, ${lim.maxDeg}°]`
    );
  }
  return null;
}

export function buildCommandFromPending(
  pending: Record<string, number>,
  mapping: JointMappingDocument,
  limits: MotorLimitMap,
  source: 'ui' | 'api',
  newCommandId: () => string,
): { ok: true; command: BuiltCommand } | { ok: false; reason: string } {
  const byJoint = new Map(mapping.joints.map((e) => [e.urdfJoint, e]));
  const values: Record<string, number> = {};
  const motors: Record<string, number> = {};
  const joints: string[] = [];

  for (const [joint, rad] of Object.entries(pending)) {
    const entry = byJoint.get(joint);
    if (!entry) {
      return { ok: false, reason: `unknown joint "${joint}"` };
    }
    const err = validateDrivenValue(entry, rad, limits);
    if (err) return { ok: false, reason: err };
    if (!entry.motor) {
      return { ok: false, reason: `driven joint "${joint}" has no motor` };
    }
    values[joint] = rad;
    motors[entry.motor] = modelRadToMotorCentideg(entry, rad);
    joints.push(joint);
  }

  if (joints.length === 0) {
    return { ok: false, reason: 'no pending joint values to approve' };
  }

  return {
    ok: true,
    command: {
      joints,
      payload: {
        commandId: newCommandId(),
        values,
        motors,
        source,
      },
    },
  };
}

export type FlushHandler = (source: 'ui' | 'api') => void;

/** Coalesces rapid approve() calls and enforces min spacing between successful sends. */
export class CommandSendScheduler {
  private lastSentMs = 0;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingSource: 'ui' | 'api' = 'ui';

  constructor(
    private intervalMs: number,
    private readonly onFlush: FlushHandler,
  ) {}

  get hasScheduledFlush(): boolean {
    return this.flushTimer != null;
  }

  requestFlush(source: 'ui' | 'api'): void {
    this.pendingSource = source;
    if (this.flushTimer != null) return;
    const now = Date.now();
    const delay =
      this.lastSentMs === 0 ? 0 : Math.max(0, this.intervalMs - (now - this.lastSentMs));
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.onFlush(this.pendingSource);
    }, delay);
  }

  markSent(): void {
    this.lastSentMs = Date.now();
  }

  reset(): void {
    if (this.flushTimer != null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.lastSentMs = 0;
  }

  cancelScheduled(): void {
    if (this.flushTimer != null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }
}
