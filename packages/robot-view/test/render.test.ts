import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OnDemandRenderer } from '../src/render/onDemand.js';

class FakeControls extends EventTarget {
  enableDamping = true;
  autoRotate = false;
  enabled = true;
  update = vi.fn();
}

describe('getRenderCount while idle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not grow when nothing triggers requestRender', () => {
    const renderFn = vi.fn();
    const controls = new FakeControls() as unknown as import('three/addons/controls/OrbitControls.js').OrbitControls;
    const loop = new OnDemandRenderer(renderFn, controls);
    loop.requestRender();
    vi.runAllTimers();
    const afterFirst = loop.getRenderCount();
    vi.advanceTimersByTime(5000);
    expect(loop.getRenderCount()).toBe(afterFirst);
    loop.dispose();
  });

  it('increments only when render is requested', () => {
    const renderFn = vi.fn();
    const controls = new FakeControls() as unknown as import('three/addons/controls/OrbitControls.js').OrbitControls;
    const loop = new OnDemandRenderer(renderFn, controls);
    loop.requestRender();
    vi.runAllTimers();
    expect(loop.getRenderCount()).toBe(1);
    vi.advanceTimersByTime(2000);
    expect(loop.getRenderCount()).toBe(1);
    loop.requestRender();
    vi.runAllTimers();
    expect(loop.getRenderCount()).toBe(2);
    loop.dispose();
  });
});
