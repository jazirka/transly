import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Autosave, MemoryStore, emptyProject } from '../src/core';
import type { ProjectStore, SavedProject } from '../src/core';

class CountingStore implements ProjectStore {
  saved: (SavedProject | null)[] = [];
  fail = 0;
  async load(): Promise<SavedProject | null> { return null; }
  async save(p: SavedProject): Promise<void> {
    if (this.fail > 0) { this.fail--; throw new Error('disk full'); }
    this.saved.push(p);
  }
}
const proj = (name: string): SavedProject => emptyProject(name);

describe('Autosave: behaviour the existing tests never check', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('flush() with nothing queued writes nothing (it must never save "null" over the project)', async () => {
    const store = new CountingStore();
    const a = new Autosave(store, 10);
    await a.flush();
    await a.flush();
    expect(store.saved).toEqual([]);
    const mem = new MemoryStore();
    await mem.save(proj('Keep'));
    const b = new Autosave(mem, 10);
    await b.flush();
    expect((await mem.load())?.name).toBe('Keep');
  });

  it('a burst of edits is debounced into one write after the last edit', async () => {
    const store = new CountingStore();
    const a = new Autosave(store, 400);
    for (let i = 0; i < 5; i++) { a.queue(proj('v' + i)); await vi.advanceTimersByTimeAsync(300); }
    expect(store.saved).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(400);
    expect(store.saved.map(p => p!.name)).toEqual(['v4']);
  });

  it('the default retry pauses grow 2 s, 4 s, 8 s ... and stop growing at 30 s', async () => {
    const store = new CountingStore();
    store.fail = 7;
    const a = new Autosave(store, 10);
    a.queue(proj('A'));
    await vi.advanceTimersByTimeAsync(10);
    expect(a.failures).toBe(1);
    const pauses = [2000, 4000, 8000, 16000, 30000, 30000];
    for (const [i, pause] of pauses.entries()) {
      await vi.advanceTimersByTimeAsync(pause - 1);
      expect(a.failures, `before the pause #${i + 1} ends`).toBe(i + 1);
      await vi.advanceTimersByTimeAsync(1);
      expect(a.failures, `after the pause #${i + 1} ends`).toBe(i + 2);
    }
    store.fail = 0;
    await vi.advanceTimersByTimeAsync(30000);
    expect(store.saved.map(p => p!.name)).toEqual(['A']);
  });
});
