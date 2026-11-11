import { describe, expect, it, vi, beforeAll } from 'vitest';
import { PibRobotView, registerPibRobotView } from '../src/element/PibRobotView.js';

describe('loadPosesList', () => {
  beforeAll(() => {
    registerPibRobotView();
  });

  it('fills the pose select from the poses API', async () => {
    const el = new PibRobotView();
    (el as unknown as { _posesUrl: string })._posesUrl = '/api/pose';

    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        poses: [{ name: 'Wave' }, { name: 'Point' }],
      }),
    }));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      await (el as unknown as { loadPosesList: () => Promise<void> }).loadPosesList();
      const select = el.shadowRoot!.querySelector('#pose-select') as HTMLSelectElement;
      const labels = [...select.options].map((o) => o.textContent);
      expect(labels).toContain('Wave');
      expect(labels).toContain('Point');
      expect(fetchMock).toHaveBeenCalledWith('/api/pose', expect.objectContaining({
        headers: { Accept: 'application/json' },
      }));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
