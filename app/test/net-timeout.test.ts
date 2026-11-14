import { describe, expect, it } from 'vitest';
import { REQUEST_TIMEOUT_MS, httpTransport, isTimeout, withTimeout } from '../src/core';

describe('requests that get no answer', () => {
  it('carry a signal that gives them up', () => {
    const init = withTimeout({ method: 'GET' }, 50);
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(withTimeout({ signal: undefined }).signal).toBeInstanceOf(AbortSignal);
    const own = new AbortController().signal;
    expect(withTimeout({ signal: own }).signal).toBe(own);
    expect(REQUEST_TIMEOUT_MS).toBeGreaterThan(5000);
  });

  it('the relay transport turns a timeout into a sentence about the server', async () => {
    const silent: typeof fetch = (_u, init) => new Promise((_res, rej) => { init?.signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'TimeoutError' }))); });
    const t = httpTransport('http://x.test', ((u: RequestInfo | URL, init?: RequestInit) => silent(u, { ...init, signal: AbortSignal.timeout(20) })) as typeof fetch);
    await expect(t.get('room', 'meta' as never)).rejects.toThrow(/не відповів/);
    expect(isTimeout(Object.assign(new Error('x'), { name: 'AbortError' }))).toBe(true);
    expect(isTimeout(new Error('x'))).toBe(false);
  });
});
