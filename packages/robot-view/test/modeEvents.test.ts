import { describe, it, expect } from 'vitest';
import { PibRobotView, registerPibRobotView } from '../src/element/PibRobotView.js';

describe('command mode events', () => {
  registerPibRobotView();

  it('reports a blocked command mode as commandblocked, never as a load error', () => {
    const el = document.createElement('pib-robot-view') as PibRobotView;
    const seen: string[] = [];
    el.addEventListener('error', () => seen.push('error'));
    el.addEventListener('commandblocked', (event) => {
      seen.push(`commandblocked:${(event as CustomEvent<{ reason: string }>).detail.reason}`);
    });

    // Command mode before the mapping is there is a normal startup state, not a failure: raising
    // `error` here made the console latch its load error and drop every joint state afterwards.
    el.mode = 'command';

    expect(seen).toEqual(['commandblocked:joint mapping is not loaded']);
    expect(el.effectiveMode).toBe('preview');
  });
});
