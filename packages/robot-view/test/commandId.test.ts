import { describe, it, expect, afterEach } from 'vitest';
import { newCommandId } from '../src/joints/commandPath.js';

/**
 * `crypto.randomUUID()` exists only in secure contexts. The robot serves the console over plain
 * http on the local network, so the browser has `crypto` but no `randomUUID` - the id generator
 * threw inside the send scheduler and every approval did nothing. Caught on the robot, not here.
 */
describe('command id generation', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis.crypto, 'randomUUID');

  afterEach(() => {
    if (original) Object.defineProperty(globalThis.crypto, 'randomUUID', original);
    else delete (globalThis.crypto as { randomUUID?: unknown }).randomUUID;
  });

  it('produces a v4 uuid without crypto.randomUUID (insecure context)', () => {
    delete (globalThis.crypto as { randomUUID?: unknown }).randomUUID;
    const id = newCommandId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('produces distinct ids', () => {
    delete (globalThis.crypto as { randomUUID?: unknown }).randomUUID;
    const ids = new Set(Array.from({ length: 200 }, () => newCommandId()));
    expect(ids.size).toBe(200);
  });

  it('uses crypto.randomUUID when it exists', () => {
    Object.defineProperty(globalThis.crypto, 'randomUUID', {
      value: () => '11111111-2222-4333-8444-555555555555',
      configurable: true,
    });
    expect(newCommandId()).toBe('11111111-2222-4333-8444-555555555555');
  });
});
