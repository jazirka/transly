import { describe, expect, it } from 'vitest';
import { saveViaAndroid } from '../src/ui/android';
import type { AndroidBridge } from '../src/ui/android';

function mockBridge() {
  const got = { name: '', mime: '', chunks: [] as string[], ended: false };
  const bridge: AndroidBridge = {
    beginSave: (name, mime) => { got.name = name; got.mime = mime; return true; },
    saveChunk: c => { got.chunks.push(c); return true; },
    endSave: () => (got.ended = true),
  };
  return { bridge, got };
}

describe('saving through the Android app', () => {
  it('hands a large file over in pieces that join back to the same bytes', async () => {
    const bytes = new Uint8Array(2_600_001);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31 + (i >> 8)) & 255;
    const { bridge, got } = mockBridge();
    expect(await saveViaAndroid(bridge, 'p.transly.json', new Blob([bytes]), 'application/json')).toBe(true);
    expect(got.chunks.length).toBe(4);
    expect(got.chunks.slice(0, -1).every(c => c.length % 4 === 0 && !c.includes('='))).toBe(true);
    // (not toEqual: comparing 2.6 million elements one by one takes vitest longer than the test timeout)
    expect(Buffer.from(got.chunks.join(''), 'base64').equals(Buffer.from(bytes))).toBe(true);
    expect([got.name, got.mime, got.ended]).toEqual(['p.transly.json', 'application/json', true]);
  });

  it('stops and reports failure when the app refuses a piece or cannot start', async () => {
    const refuse: AndroidBridge = { beginSave: () => false, saveChunk: () => true, endSave: () => true };
    expect(await saveViaAndroid(refuse, 'a', new Blob(['x']), 'text/plain')).toBe(false);
    let n = 0;
    const flaky: AndroidBridge = { beginSave: () => true, saveChunk: () => ++n < 2, endSave: () => true };
    expect(await saveViaAndroid(flaky, 'a', new Blob([new Uint8Array(2_000_000)]), 'text/plain')).toBe(false);
    expect(n).toBe(2);
  });
});
