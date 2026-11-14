import { describe, expect, it } from 'vitest';
import { Autosave, MemoryStore, changedSince, clearOutbox, emptyProject, outboxRescue, takeOutbox, writeOutbox } from '../src/core';
import type { Entry, KeyValue, ProjectStore, SavedProject } from '../src/core';

// A page that is closed a moment after the last keystroke cannot finish an asynchronous write. The rows changed since the
// last confirmed save are put into a synchronous outbox at that moment and merged back at the next start.

class Kv implements KeyValue {
  data = new Map<string, string>();
  getItem(k: string): string | null { return this.data.get(k) ?? null; }
  setItem(k: string, v: string): void { this.data.set(k, v); }
  removeItem(k: string): void { this.data.delete(k); }
}
const ent = (target: string, mt: number): Entry => ({ target, status: 'draft', mt });
const proj = (rows: Record<string, Entry>, name = 'P'): SavedProject => { const p = emptyProject(name); p.files['Map001.json'] = rows; return p; };
/** A store whose writes finish only when told to (the page is gone before they do). */
class SlowStore implements ProjectStore {
  written: SavedProject[] = [];
  release: (() => void) | null = null;
  async load(): Promise<SavedProject | null> { return null; }
  save(p: SavedProject): Promise<void> { return new Promise<void>(res => { this.release = () => { this.written.push(p); res(); }; }); }
}

describe('changedSince', () => {
  it('keeps only the rows marked at or after the time, and no snapshot', () => {
    const p = proj({ a: ent('old', 100), b: ent('new', 5000) });
    p.snapshot = { 'Map001.json': [{ key: 'a', source: 'x', speaker: '', kind: 'dialogue', context: '' }] };
    p.memory = [{ s: 'a', t: 'b', mt: 10 }, { s: 'c', t: 'd', mt: 6000 }];
    const c = changedSince(p, 1000);
    expect(Object.keys(c.files['Map001.json']!)).toEqual(['b']);
    expect(c.snapshot).toBeUndefined();
    expect(c.memory).toEqual([{ s: 'c', t: 'd', mt: 6000 }]);
  });
  it('drops a file with no changed row', () => {
    expect(Object.keys(changedSince(proj({ a: ent('old', 100) }), 1000).files)).toEqual([]);
  });
});

describe('the outbox', () => {
  it('a row typed just before the page went away comes back at the next start', () => {
    const kv = new Kv();
    const stored = proj({ a: ent('перше', 100) });
    const latest = proj({ a: ent('перше', 100), b: ent('набране в останню мить', 9000) });
    expect(writeOutbox(kv, 'default', latest, 1000)).toBe(true);
    const back = takeOutbox(kv, 'default', stored, 10_000)!;
    expect(back.rows).toBe(1);
    expect(back.project.files['Map001.json']!.b!.target).toBe('набране в останню мить');
    expect(back.project.files['Map001.json']!.a!.target).toBe('перше');
  });
  it('the later mark wins, as in any merge: a newer stored row is not overwritten by an older outbox row', () => {
    const kv = new Kv();
    writeOutbox(kv, 'default', proj({ a: ent('з черги', 2000) }), 0);
    const stored = proj({ a: ent('з іншого пристрою, пізніше', 3000) });
    expect(takeOutbox(kv, 'default', stored, 10_000)).toBeNull();     // nothing the store does not have: cleared
    expect(kv.getItem('transly:outbox:default')).toBeNull();
  });
  it('rows that are in the store already do not come back, and the outbox is cleared', () => {
    const kv = new Kv();
    const same = proj({ a: ent('вже є', 5000) });
    writeOutbox(kv, 'default', same, 0);
    expect(takeOutbox(kv, 'default', same, 10_000)).toBeNull();
    expect(kv.getItem('transly:outbox:default')).toBeNull();
  });
  it('an empty or damaged outbox changes nothing', () => {
    const kv = new Kv();
    expect(takeOutbox(kv, 'default', proj({}), 1)).toBeNull();
    kv.setItem('transly:outbox:default', '{"version":');
    expect(takeOutbox(kv, 'default', proj({}), 1)).toBeNull();
  });
  it('a browser that refuses the write is reported, not thrown', () => {
    const kv: KeyValue = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); }, removeItem: () => {} };
    expect(writeOutbox(kv, 'default', proj({ a: ent('x', 5000) }), 0)).toBe(false);
    clearOutbox(kv, 'default');
    expect(takeOutbox(kv, 'default', proj({}), 1)).toBeNull();
  });
});

describe('Autosave and the outbox', () => {
  it('rescueNow keeps the newest state while the write is still waiting for its delay', async () => {
    const kv = new Kv(), store = new MemoryStore();
    const a = new Autosave(store, 60_000, () => {}, undefined, outboxRescue(kv, 'default'));
    a.queue(proj({ a: ent('перший', Date.now()) }));
    a.queue(proj({ a: ent('останній', Date.now() + 1) }));
    expect(a.unsaved).toBe(true);
    expect(a.rescueNow()).toBe(true);
    const back = takeOutbox(kv, 'default', proj({}), Date.now())!;
    expect(back.project.files['Map001.json']!.a!.target).toBe('останній');
    await a.flush();
    expect(kv.getItem('transly:outbox:default')).toBeNull();          // the confirmed save cleared it
    expect(a.unsaved).toBe(false);
  });
  it('rescueNow also keeps work while the write has been started and has not finished', async () => {
    const kv = new Kv(), store = new SlowStore();
    const a = new Autosave(store, 0, () => {}, undefined, outboxRescue(kv, 'default'));
    a.queue(proj({ a: ent('у польоті', Date.now()) }));
    const writing = a.flush();
    await Promise.resolve(); await Promise.resolve();
    expect(a.unsaved).toBe(true);
    expect(a.rescueNow()).toBe(true);
    expect(kv.getItem('transly:outbox:default')).toContain('у польоті');
    store.release!(); await writing;
    expect(kv.getItem('transly:outbox:default')).toBeNull();
  });
  it('nothing is written when everything is saved', async () => {
    const kv = new Kv();
    const a = new Autosave(new MemoryStore(), 0, () => {}, undefined, outboxRescue(kv, 'default'));
    a.queue(proj({ a: ent('x', Date.now()) }));
    await a.flush();
    expect(a.rescueNow()).toBe(false);
    expect(kv.data.size).toBe(0);
  });
  it('an outbox from before the first save of this page is kept whole until that save is confirmed (keepAll)', async () => {
    const kv = new Kv(), store = new SlowStore();
    const a = new Autosave(store, 0, () => {}, undefined, outboxRescue(kv, 'default'));
    a.keepAll();
    a.queue(proj({ old: ent('з минулого сеансу', 5) }));   // far older than the usual slack
    expect(a.rescueNow()).toBe(true);
    expect(kv.getItem('transly:outbox:default')).toContain('з минулого сеансу');
  });
  it('a failing store leaves the work in the outbox and a retry clears it when it goes through', async () => {
    const kv = new Kv();
    let failing = true;
    const store: ProjectStore = { load: async () => null, save: async () => { if (failing) throw new Error('quota'); } };
    const a = new Autosave(store, 0, () => {}, () => 60_000, outboxRescue(kv, 'default'));
    a.queue(proj({ a: ent('не лізе', Date.now()) }));
    await a.flush();
    expect(a.failures).toBe(1);
    expect(a.unsaved).toBe(true);
    expect(a.rescueNow()).toBe(true);
    failing = false;
    await a.flush();
    expect(a.failures).toBe(0);
    expect(kv.getItem('transly:outbox:default')).toBeNull();
  });
});
