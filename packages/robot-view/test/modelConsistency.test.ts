import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  computeModelConsistency,
  drivenMotorsFromMapping,
  formatMotorSetMismatch,
} from '../src/model/modelConsistency.js';
import { PibRobotView, registerPibRobotView } from '../src/element/PibRobotView.js';
import type { JointMappingDocument } from '../src/joints/mapping.js';

const repoRoot = resolve(import.meta.dirname, '../../..');
const mappingDoc = JSON.parse(
  readFileSync(resolve(repoRoot, 'joints/mapping.json'), 'utf8'),
) as JointMappingDocument;
const mappingMotors = drivenMotorsFromMapping(mappingDoc);

describe('formatMotorSetMismatch', () => {
  it('names missing and extra motors', () => {
    const msg = formatMotorSetMismatch(
      ['a', 'b'],
      ['a', 'b', 'c'],
    );
    expect(msg).toBe('model lists 2 motors, robot lists 3 - missing c');
  });
});

describe('computeModelConsistency', () => {
  it('accepts null manifest and no expectedMotors', () => {
    expect(computeModelConsistency(mappingDoc, null, null)).toEqual({ ok: true, reason: null });
  });

  it('rejects integrity mismatch', () => {
    const result = computeModelConsistency(
      mappingDoc,
      { integrity: 'mismatch', motors: mappingMotors },
      null,
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('installed model is inconsistent (integrity mismatch)');
  });

  it('rejects manifest motor set difference with missing and extra named', () => {
    const manifestMotors = mappingMotors.filter((m) => m !== 'elbow_right');
    manifestMotors.push('wrist_extra');
    const result = computeModelConsistency(
      mappingDoc,
      { integrity: 'ok', motors: manifestMotors },
      null,
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('missing elbow_right');
    expect(result.reason).toContain('extra wrist_extra');
  });

  it('rejects expectedMotors missing one motor', () => {
    const expected = mappingMotors.filter((m) => m !== 'wrist_left');
    const result = computeModelConsistency(mappingDoc, null, expected);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('extra wrist_left');
  });

  it('accepts matching manifest and expectedMotors', () => {
    const result = computeModelConsistency(
      mappingDoc,
      { integrity: 'ok', motors: [...mappingMotors] },
      [...mappingMotors],
    );
    expect(result).toEqual({ ok: true, reason: null });
  });
});

describe('PibRobotView model consistency UI', () => {
  beforeEach(() => {
    registerPibRobotView();
  });

  function mountWithConsistency(
    manifest: { integrity?: 'ok' | 'mismatch'; motors?: string[] } | null,
    expectedMotors: string[] | null = null,
  ) {
    const el = new PibRobotView();
    const internal = el as unknown as {
      _mapping: JointMappingDocument;
      _mappingValidation: { ok: boolean; errors: string[]; warnings: string[] };
      _manifest: typeof manifest;
      _expectedMotors: string[] | null;
      _mode: 'preview' | 'command' | 'read';
      recomputeModelConsistency: () => void;
      updateModeUi: () => void;
      panel: { applyMode: ReturnType<typeof vi.fn> };
    };
    internal._mapping = mappingDoc;
    internal._mappingValidation = { ok: true, errors: [], warnings: [] };
    internal._manifest = manifest;
    internal._expectedMotors = expectedMotors;
    internal._mode = 'preview';
    internal.panel = { applyMode: vi.fn() };
    internal.recomputeModelConsistency();
    internal.updateModeUi();
    return el;
  }

  it('shows no consistency banner when manifest is absent and checks pass', () => {
    const el = mountWithConsistency(null);
    expect(el.manifest).toBeNull();
    expect(el.modelConsistency.ok).toBe(true);
    const banner = el.shadowRoot!.querySelector('#consistency')!;
    expect(banner.classList.contains('on')).toBe(false);
    expect(banner.textContent).toBe('');
    expect(el.readOnly).toBe(false);
  });

  it('forces read mode and banner on integrity mismatch', () => {
    const el = mountWithConsistency({ integrity: 'mismatch', motors: mappingMotors });
    expect(el.readOnly).toBe(true);
    expect(el.effectiveMode).toBe('read');
    const banner = el.shadowRoot!.querySelector('#consistency')!;
    expect(banner.classList.contains('on')).toBe(true);
    expect(banner.textContent).toBe('installed model is inconsistent (integrity mismatch)');
    expect(el.guardReason).toBe(banner.textContent);
  });

  it('refuses command mode while inconsistent', () => {
    const el = mountWithConsistency({ integrity: 'mismatch' });
    el.mode = 'command';
    expect(el.effectiveMode).toBe('read');
    expect(el.guardReason).toContain('integrity mismatch');
    expect(el.mode).toBe('command');
  });

  it('updates when setExpectedMotors introduces a mismatch', () => {
    const el = mountWithConsistency({ integrity: 'ok', motors: [...mappingMotors] });
    expect(el.readOnly).toBe(false);
    el.setExpectedMotors(mappingMotors.filter((m) => m !== 'elbow_left'));
    expect(el.readOnly).toBe(true);
    expect(el.modelConsistency.reason).toContain('extra elbow_left');
  });
});