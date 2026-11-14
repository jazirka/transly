import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRelay } from '../server/relay.ts';
import { adoptSynced, deriveKeys, emptyProject, httpTransport, mergeProjects, syncOnce } from '../src/core';
import type { Entry, SavedProject, Transport } from '../src/core';

const entry = (target: string, mt: number): Entry => ({ target, status: 'draft', mt });
const project = (rows: Record<string, Entry>, name = 'T'): SavedProject => ({ ...emptyProject(name), files: { 'Map001.json': rows } });

describe('adoptSynced: what was typed during a sync is not lost', () => {
  it('a row typed while the request ran wins over what the request started from, rows from other devices stay', () => {
    const live = project({ a: entry('old', 1) });
    const remote = project({ b: entry('чужий', 2) });
    const synced = mergeProjects(live, remote).project;       // computed when the request started
    live.files['Map001.json']!.a = entry('набрано під час запиту', 5);   // typed meanwhile, into the object that is still in use
    const adopted = adoptSynced(live, synced);
    expect(adopted.files['Map001.json']!.a!.target).toBe('набрано під час запиту');
    expect(adopted.files['Map001.json']!.b!.target).toBe('чужий');
  });

  it('a reset made during the request is not undone by the answer', () => {
    const live = project({ a: entry('old', 1) });
    const synced = mergeProjects(live, project({ b: entry('чужий', 2) })).project;
    live.resetEpoch = 10;                                      // the translator pressed "reset" meanwhile
    const adopted = adoptSynced(live, synced);
    expect(adopted.resetEpoch).toBe(10);
    expect(adopted.files['Map001.json']).toEqual({});
  });

  it('with nothing typed meanwhile the result is the same project', () => {
    const live = project({ a: entry('old', 1) });
    const synced = mergeProjects(live, project({ b: entry('чужий', 2) })).project;
    expect(adoptSynced(synced, synced)).toBe(synced);
    expect(Object.keys(adoptSynced(live, synced).files['Map001.json']!).sort()).toEqual(['a', 'b']);
  });
});

describe('a real sync with a slow answer', () => {
  let server: ReturnType<typeof createRelay>;
  let base = '';
  beforeAll(async () => {
    server = createRelay({ rateLimit: 10_000 });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>(r => server.close(() => r())));

  it('text typed while syncOnce waits for the relay is still there afterwards', async () => {
    const keys = await deriveKeys('shared secret phrase');
    const real = httpTransport(base);
    // the other device has put its work on the relay
    await syncOnce(real, keys, project({ b: entry('з іншого пристрою', 3) }, 'T'));
    const slow: Transport = { ...real, get: async (room, kind) => { const r = await real.get(room, kind); await new Promise(res => setTimeout(res, 50)); return r; } } as Transport;
    const state = { saved: project({ a: entry('перше', 1) }) };
    const request = syncOnce(slow, keys, state.saved).then(report => { state.saved = adoptSynced(state.saved, report.project); });
    await new Promise(res => setTimeout(res, 10));
    state.saved.files['Map001.json']!.a = entry('друге, набране під час синхронізації', Date.now() + 1000);
    await request;
    expect(state.saved.files['Map001.json']!.a!.target).toBe('друге, набране під час синхронізації');
    expect(state.saved.files['Map001.json']!.b!.target).toBe('з іншого пристрою');
  }, 30_000);
});
