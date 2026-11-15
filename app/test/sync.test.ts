import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRelay } from '../server/relay.ts';
import { deriveKeys, emptyProject, httpTransport, open, seal, syncOnce } from '../src/core';
import type { Entry, SavedProject, Unit } from '../src/core';

const unit = (key: string, source: string): Unit => ({ key, source, speaker: '', kind: 'dialogue', context: 'c' });
const entry = (target: string, mt: number): Entry => ({ target, status: 'draft', mt });
const withFile = (p: SavedProject, e: Record<string, Entry>): SavedProject => ({ ...p, files: { ...p.files, 'Map001.json': { ...(p.files['Map001.json'] ?? {}), ...e } } });

describe('crypto', () => {
  it('round-trips, rejects a wrong passphrase and short passphrases', async () => {
    const a = await deriveKeys('correct horse battery');
    const b = await deriveKeys('wrong passphrase!!');
    const sealed = await seal(a, 'Привіт, світе');
    expect(await open(a, sealed)).toBe('Привіт, світе');
    await expect(open(b, sealed)).rejects.toThrow(/пароль/);
    await expect(deriveKeys('short')).rejects.toThrow(/8 символів/);
    expect(a.room).toMatch(/^[0-9a-f]{64}$/);
    expect(a.room).not.toBe(b.room);
    expect((await deriveKeys('correct horse battery')).room).toBe(a.room);
  }, 30_000);
});

describe('sync through a real relay', () => {
  let server: ReturnType<typeof createRelay>;
  let base = '';
  beforeAll(async () => {
    server = createRelay({ rateLimit: 10_000 });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>(r => server.close(() => r())));

  it('PC and phone converge: snapshot goes to the phone, edits merge, newer wins, conflicts are counted', async () => {
    const keys = await deriveKeys('shared secret phrase');
    const t = httpTransport(base);
    const pc0: SavedProject = { ...withFile(emptyProject('T'), { a: entry('pc-a', 10), b: entry('pc-b', 10) }), snapshot: { 'Map001.json': [unit('a', 'A'), unit('b', 'B')] }, assetsRev: 100, reference: { lang: 'ru', texts: { 'Map001.json': { a: 'А' } } } };

    const r1 = await syncOnce(t, keys, pc0);
    expect(r1).toMatchObject({ pushed: true, pulled: false, gotSnapshot: false });

    const phone0 = emptyProject('T');
    const r2 = await syncOnce(t, keys, phone0);
    expect(r2.gotSnapshot).toBe(true);
    expect(r2.project.snapshot?.['Map001.json']).toHaveLength(2);
    expect(r2.project.reference?.texts['Map001.json']).toEqual({ a: 'А' });
    expect(r2.project.assetsRev).toBe(100);
    expect(r2.project.files['Map001.json']).toMatchObject({ a: { target: 'pc-a' } });

    const phone1 = withFile(r2.project, { a: entry('phone-a', 20), c: entry('phone-c', 20) });
    const pc1 = withFile(r1.project, { b: entry('pc-b2', 30) });
    const r3 = await syncOnce(t, keys, phone1);
    const r4 = await syncOnce(t, keys, pc1);
    expect(r4.project.files['Map001.json']).toMatchObject({ a: { target: 'phone-a' }, b: { target: 'pc-b2' }, c: { target: 'phone-c' } });
    expect(r3.conflicts).toBe(1); // a: pc-a vs phone-a, both edited
    // With a last-sync time between the first and the second round of edits, the old PC edit is not a conflict.
    const quiet = await syncOnce(t, keys, withFile(r4.project, { a: entry('phone-a2', 40) }), { since: 25 });
    expect(quiet.conflicts).toBe(0);
    const r5 = await syncOnce(t, keys, r3.project);
    expect(r5.project.files['Map001.json']).toMatchObject({ a: { target: 'phone-a2' }, b: { target: 'pc-b2' } });
  });

  it('a device with the wrong passphrase sees nothing and fails to decrypt nothing', async () => {
    const other = await deriveKeys('some other phrase!');
    const r = await syncOnce(httpTransport(base), other, emptyProject('X'));
    expect(r.pulled).toBe(false);
  });

  it('refuses stale writes and unknown paths', async () => {
    const room = 'a'.repeat(64);
    const put = (body: string, ifMatch?: string) => fetch(`${base}/r/${room}/data`, { method: 'PUT', body, ...(ifMatch ? { headers: { 'If-Match': ifMatch } } : {}) });
    const first = await put('one');
    expect(first.status).toBe(200);
    expect((await put('two')).status).toBe(412);
    expect((await put('two', '"stale"')).status).toBe(412);
    expect((await put('two', first.headers.get('ETag')!)).status).toBe(200);
    expect((await fetch(`${base}/r/not-a-room/data`)).status).toBe(404);
    expect((await fetch(`${base}/r/${room}/evil`)).status).toBe(404);
  });

  it('forgets old blobs', async () => {
    let t = 0;
    const s = createRelay({ ttlMs: 1000, now: () => t });
    await new Promise<void>(r => s.listen(0, '127.0.0.1', r));
    const b = `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
    const room = 'b'.repeat(64);
    await fetch(`${b}/r/${room}/data`, { method: 'PUT', body: 'x' });
    expect((await fetch(`${b}/r/${room}/data`)).status).toBe(200);
    t = 5000;
    expect((await fetch(`${b}/r/${room}/data`)).status).toBe(404);
    await new Promise<void>(r => s.close(() => r()));
  });
});

describe('the relay is hard to abuse', () => {
  const start = async (o: Parameters<typeof createRelay>[0]) => {
    const s = createRelay({ rateLimit: 10_000, ...o });
    await new Promise<void>(r => s.listen(0, '127.0.0.1', r));
    return { s, b: `http://127.0.0.1:${(s.address() as AddressInfo).port}`, stop: () => new Promise<void>(r => s.close(() => r())) };
  };
  const room = (n: number): string => n.toString(16).padStart(64, '0');
  it('one client opens only a few new rooms per hour, so the rooms of the others are not used up in a moment', async () => {
    let t = 0;
    const { b, stop } = await start({ newRoomsPerHour: 3, maxRooms: 100, now: () => t });
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await fetch(`${b}/r/${room(i)}/data`, { method: 'PUT', body: 'x' })).status);
    expect(codes).toEqual([200, 200, 200, 429, 429]);
    // a room that exists is written to as often as needed, and an hour later new ones may be opened again
    expect((await fetch(`${b}/r/${room(0)}/snap`, { method: 'PUT', body: 'y' })).status).toBe(200);
    t = 3_700_000;
    expect((await fetch(`${b}/r/${room(9)}/data`, { method: 'PUT', body: 'x' })).status).toBe(200);
    await stop();
  });
  it('a room that exists is not refused when the relay is full of rooms (it only gets its second blob)', async () => {
    const { b, stop } = await start({ maxRooms: 2, newRoomsPerHour: 100 });
    await fetch(`${b}/r/${room(1)}/data`, { method: 'PUT', body: 'x' });
    await fetch(`${b}/r/${room(2)}/data`, { method: 'PUT', body: 'x' });
    expect((await fetch(`${b}/r/${room(3)}/data`, { method: 'PUT', body: 'x' })).status).toBe(507);
    expect((await fetch(`${b}/r/${room(1)}/snap`, { method: 'PUT', body: 'x' })).status).toBe(200);
    await stop();
  });
  it('everything stored together is capped, not only each blob', async () => {
    const { b, stop } = await start({ maxBytes: 1000, maxTotalBytes: 2500, newRoomsPerHour: 100 });
    const big = 'x'.repeat(900);
    const codes: number[] = [];
    for (let i = 0; i < 4; i++) codes.push((await fetch(`${b}/r/${room(i)}/data`, { method: 'PUT', body: big })).status);
    expect(codes).toEqual([200, 200, 507, 507]);
    expect((await fetch(`${b}/r/${room(0)}/data`, { method: 'PUT', body: big, headers: { 'If-Match': (await fetch(`${b}/r/${room(0)}/data`)).headers.get('ETag')! } })).status).toBe(200);   // replacing a blob is not growth
    // a blob over its own limit is refused (the relay may close the connection instead of answering)
    expect(await fetch(`${b}/r/${room(5)}/data`, { method: 'PUT', body: 'z'.repeat(1001) }).then(r => r.status, () => 413)).toBe(413);
    await stop();
  });
});

describe('relay behind a reverse proxy', () => {
  it('with trustProxy the address of the client is the one the proxy added, so two users are two buckets', async () => {
    const srv = createRelay({ newRoomsPerHour: 1, trustProxy: true });
    await new Promise<void>(r => srv.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    const put = (room: string, ip: string) => fetch(`${base}/r/${room}/data`, { method: 'PUT', body: new Uint8Array([1, 2, 3]), headers: { 'X-Forwarded-For': `1.1.1.1, ${ip}` } });
    expect((await put('a'.repeat(64), '10.0.0.1')).status).toBe(200);
    expect((await put('b'.repeat(64), '10.0.0.1')).status).toBe(429);
    expect((await put('c'.repeat(64), '10.0.0.2')).status).toBe(200);
    await new Promise<void>(r => srv.close(() => r()));
  });
});
