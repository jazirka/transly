import { describe, expect, it } from 'vitest';
import { deriveKeys, emptyProject, open, seal, syncOnce } from '../src/core';
import type { SavedProject, Transport } from '../src/core';

describe('crypto: limits the existing test does not pin down', () => {
  it('a passphrase of exactly 8 characters is accepted, 7 is refused', async () => {
    await expect(deriveKeys('1234567')).rejects.toThrow(/8 символів/);
    await expect(deriveKeys('12345678')).resolves.toMatchObject({ room: expect.stringMatching(/^[0-9a-f]{64}$/) });
  }, 30_000);

  it('the same text sealed twice gives different bytes (a fresh nonce each time), and a flipped bit is refused', async () => {
    const keys = await deriveKeys('correct horse battery');
    const a = await seal(keys, 'той самий текст'), b = await seal(keys, 'той самий текст');
    expect(Array.from(a.slice(0, 12))).not.toEqual(Array.from(b.slice(0, 12)));
    expect(Array.from(a)).not.toEqual(Array.from(b));
    const tampered = a.slice(); tampered[tampered.length - 1]! ^= 1;
    await expect(open(keys, tampered)).rejects.toThrow(/пароль/);
    const flippedNonce = a.slice(); flippedNonce[0]! ^= 1;
    await expect(open(keys, flippedNonce)).rejects.toThrow(/пароль/);
  }, 30_000);

  it('truncated data is reported as damaged, not as a wrong password', async () => {
    const keys = await deriveKeys('correct horse battery');
    await expect(open(keys, new Uint8Array(28))).rejects.toThrow(/пошкоджено/);
    await expect(open(keys, new Uint8Array(0))).rejects.toThrow(/пошкоджено/);
    await expect(open(keys, new Uint8Array(29))).rejects.toThrow(/пароль/);
  }, 30_000);
});

describe('syncOnce: the retry loop', () => {
  const keysP = deriveKeys('shared secret phrase');
  it('gives up with a clear message after exactly maxTries lost races', async () => {
    const keys = await keysP;
    let gets = 0, puts = 0;
    const t: Transport = { get: async () => { gets++; return null; }, put: async () => { puts++; return { ok: false, conflict: true }; } };
    await expect(syncOnce(t, keys, emptyProject('P'), { maxTries: 3 })).rejects.toThrow(/постійно змінює дані/);
    expect([gets, puts]).toEqual([3, 3]);
  }, 30_000);

  it('with nothing on the server it pushes the local project and reports that nothing was pulled', async () => {
    const keys = await keysP;
    let stored: Uint8Array | null = null;
    const t: Transport = { get: async () => (stored ? { etag: 'e1', bytes: stored } : null), put: async (_r, _k, bytes, ifMatch) => { expect(ifMatch).toBeNull(); stored = bytes; return { ok: true, etag: 'e1' }; } };
    const local: SavedProject = { ...emptyProject('P'), files: { 'M.json': { a: { target: 'х', status: 'draft', mt: 5 } } } };
    const r = await syncOnce(t, keys, local);
    expect(r).toMatchObject({ pulled: false, pushed: true, conflicts: 0 });
    expect(r.project.files['M.json']!.a!.target).toBe('х');
    expect(JSON.parse(await open(keys, stored!)).files['M.json'].a.target).toBe('х');
  }, 30_000);

  it('a conflict on the first push is retried against the newer server copy and merged', async () => {
    const keys = await keysP;
    const remoteProj: SavedProject = { ...emptyProject('P'), files: { 'M.json': { b: { target: 'з сервера', status: 'draft', mt: 7 } } } };
    const remoteBytes = await seal(keys, JSON.stringify(remoteProj));
    let puts = 0;
    const t: Transport = { get: async () => ({ etag: 'e' + puts, bytes: remoteBytes }), put: async (_r, _k, _b, ifMatch) => { puts++; return puts === 1 ? { ok: false, conflict: true } : (expect(ifMatch).toBe('e1'), { ok: true, etag: 'e2' }); } };
    const local: SavedProject = { ...emptyProject('P'), files: { 'M.json': { a: { target: 'моє', status: 'draft', mt: 5 } } } };
    const r = await syncOnce(t, keys, local);
    expect(puts).toBe(2);
    expect(Object.keys(r.project.files['M.json']!).sort()).toEqual(['a', 'b']);
    expect(r.pulled).toBe(true);
  }, 30_000);
});
