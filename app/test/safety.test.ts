import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Autosave, activeIssues, emptyProject, groupColor, knownStatus, wrapOf } from '../src/core';
import type { Entry, ProjectStore, QaOptions, SavedProject, WrapPlan } from '../src/core';

/** A store whose writes can be made slow or failing, and that remembers the order in which they finished. */
class ScriptedStore implements ProjectStore {
  done: string[] = [];
  /** How each next write behaves: a number = takes that many ms, 'fail' = rejects. */
  script: (number | 'fail')[] = [];
  async load(): Promise<SavedProject | null> { return null; }
  async save(p: SavedProject): Promise<void> {
    const step = this.script.shift() ?? 0;
    if (step !== 0) await new Promise<void>(r => setTimeout(r, step === 'fail' ? 1 : step));
    if (step === 'fail') throw new Error('disk full');
    this.done.push(p.name);
  }
}
const proj = (name: string): SavedProject => ({ ...emptyProject(name) });

describe('Autosave', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('after a failed write the newest state is kept, never the older one that failed', async () => {
    const store = new ScriptedStore();
    store.script = ['fail'];
    const a = new Autosave(store, 10, () => {}, () => 1000);
    a.queue(proj('A-old'));
    const first = a.flush();               // starts writing A-old, which will fail
    await vi.advanceTimersByTimeAsync(0);
    a.queue(proj('B-new'));                // typed while the write is in flight
    await vi.advanceTimersByTimeAsync(50);
    await first;
    await a.flush();
    expect(store.done).toEqual(['B-new']);
  });

  it('writes one after another: a slow older write cannot land after a newer one', async () => {
    const store = new ScriptedStore();
    store.script = [200, 0];
    const a = new Autosave(store, 10);
    a.queue(proj('A'));
    const f1 = a.flush();
    await vi.advanceTimersByTimeAsync(1);   // A is being written now (it takes 200 ms)
    a.queue(proj('B'));
    const f2 = a.flush();
    await vi.advanceTimersByTimeAsync(300);
    await Promise.all([f1, f2]);
    expect(store.done).toEqual(['A', 'B']);
  });

  it('flush waits for the write that is already running', async () => {
    const store = new ScriptedStore();
    store.script = [100];
    const a = new Autosave(store, 10);
    a.queue(proj('A'));
    const f1 = a.flush();
    let second = false;
    const f2 = a.flush().then(() => { second = true; });
    await vi.advanceTimersByTimeAsync(50);
    expect(second).toBe(false);
    await vi.advanceTimersByTimeAsync(100);
    await Promise.all([f1, f2]);
    expect(store.done).toEqual(['A']);
  });

  it('retries a failed write by itself, with growing pauses, and reports the status', async () => {
    const store = new ScriptedStore();
    store.script = ['fail', 'fail', 0];
    const status: boolean[] = [];
    const a = new Autosave(store, 10, ok => status.push(ok), n => 100 * n);
    a.queue(proj('A'));
    await vi.advanceTimersByTimeAsync(20);     // the first write fails
    expect(a.failures).toBe(1);
    expect(store.done).toEqual([]);
    await vi.advanceTimersByTimeAsync(150);    // retry after 100 ms fails again
    expect(a.failures).toBe(2);
    await vi.advanceTimersByTimeAsync(250);    // retry after 200 ms goes through
    expect(store.done).toEqual(['A']);
    expect(a.failures).toBe(0);
    expect(a.lastError).toBeNull();
    expect(status).toEqual([false, false, true]);
  });

  it('a new edit cancels the pending retry and is written by the normal timer', async () => {
    const store = new ScriptedStore();
    store.script = ['fail', 0];
    const a = new Autosave(store, 10, () => {}, () => 5000);
    a.queue(proj('A'));
    await vi.advanceTimersByTimeAsync(20);
    a.queue(proj('B'));
    await vi.advanceTimersByTimeAsync(30);
    expect(store.done).toEqual(['B']);
  });
});

describe('the QA memo knows the row key', () => {
  const plan: WrapPlan = { settings: wrapOf({ wrap: { mode: 'off', unit: 'chars' } }), limit: 10 };
  const qa: QaOptions = { tolerancePct: 1000, terms: [], wrap: plan };
  const entry: Entry = { target: 'один дуже довгий рядок тексту без розривів', status: 'draft', mt: 1 };

  it('the same Entry gets the wrap check as a dialogue row and not as a Ren\'Py line', () => {
    const dialogue = { source: 'x', kind: 'dialogue' as const, key: 'events[1].pages[0].list[2]' };
    const renpy = { source: 'x', kind: 'dialogue' as const, key: 'L12' };
    const first = activeIssues(dialogue, entry, qa).map(i => i.key);
    const second = activeIssues(renpy, entry, qa).map(i => i.key);
    expect(first).toContain('wrap');
    expect(second).not.toContain('wrap');
    // and back again: the answer follows the key, not the order of the calls
    expect(activeIssues(dialogue, entry, qa).map(i => i.key)).toContain('wrap');
  });
});

describe('values from a foreign project', () => {
  it('a group colour is drawn only when it is a plain hex colour', () => {
    expect(groupColor({ color: '#4aa3df' })).toBe('#4aa3df');
    expect(groupColor({ color: '#FFF' })).toBe('#FFF');
    expect(groupColor({ color: 'red; background-image:url(http://x/leak)' })).toBe('#8b72e8');
    expect(groupColor({ color: 'url(http://x)' })).toBe('#8b72e8');
    expect(groupColor({ color: 5 as unknown as string })).toBe('#8b72e8');
    expect(groupColor({})).toBe('#8b72e8');
    expect(groupColor(null)).toBe('#8b72e8');
  });

  it('an unknown status becomes "new"', () => {
    expect(knownStatus('appr')).toBe('appr');
    expect(knownStatus('done')).toBe('done');
    expect(knownStatus('draft')).toBe('draft');
    expect(knownStatus('x" onmouseover="alert(1)')).toBe('new');
    expect(knownStatus(undefined)).toBe('new');
    expect(knownStatus(7)).toBe('new');
  });
});
