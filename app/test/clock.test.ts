import { describe, expect, it } from 'vitest';
import { commitRows, edit, emptyProject, mergeProjects, nextMt, submit, undoJournal, journalBatches, approveEntry, sendBack } from '../src/core';
import type { Entry, SavedProject, Unit } from '../src/core';

const unit: Unit = { key: 'a', source: 'Hello', speaker: '', kind: 'dialogue', context: '' };
const project = (e: Entry): SavedProject => ({ ...emptyProject('T'), files: { 'Map001.json': { a: e } } });

describe('hybrid clock: an edit is newer than the edit it replaces, whatever this device\'s clock says', () => {
  it('nextMt keeps the clock when it is ahead and steps past the earlier stamp when it is behind', () => {
    expect(nextMt(undefined, 100)).toBe(100);
    expect(nextMt(50, 100)).toBe(100);
    expect(nextMt(100, 100)).toBe(101);
    expect(nextMt(5000, 100)).toBe(5001);
  });

  it('typing, sending, approving and returning a row never go back in time', () => {
    const base: Entry = { target: 'Привіт', status: 'draft', mt: 9000 };
    expect(edit(base, unit, 'Привіт!', 'translate', 100).mt).toBe(9001);
    const sent = submit(base, unit, 'translate', 100);
    expect(sent.ok && sent.entry.mt).toBe(9001);
    const appr = approveEntry(base, unit, 100);
    expect(appr.ok && appr.entry.mt).toBeGreaterThan(9000);
    expect(sendBack({ ...base, status: 'done' }, 100).mt).toBe(9001);
  });

  it('a device with a slow clock still wins the merge for text it typed after receiving the other device\'s edit', () => {
    const other = project({ target: 'з іншого пристрою', status: 'draft', mt: 10_000 });
    const mine = project({ target: 'з іншого пристрою', status: 'draft', mt: 10_000 });
    mine.files['Map001.json']!.a = edit(mine.files['Map001.json']!.a, unit, 'моя нова правка', 'translate', 4_000);   // clock is behind
    const merged = mergeProjects(mine, other).project;
    expect(merged.files['Map001.json']!.a!.target).toBe('моя нова правка');
    expect(mergeProjects(other, mine).project.files['Map001.json']!.a!.target).toBe('моя нова правка');
  });

  it('a recorded action on a device with a slow clock can still be taken back', () => {
    const saved = project({ target: 'Привіт', status: 'draft', mt: 10_000 });
    const files = saved.files;
    const sent = submit(files['Map001.json']!.a, unit, 'translate', 4_000);
    if (!sent.ok) throw new Error('send refused');
    const batch = commitRows(f => files[f] ?? (files[f] = {}), [{ file: 'Map001.json', key: 'a', next: sent.entry, text: sent.entry.target }], 'send', 'Ви', 4_000);
    const e = files['Map001.json']!.a!;
    expect(e.mt).toBeGreaterThan(10_000);
    expect(e.history!.at(-1)!.at).toBeGreaterThanOrEqual(e.mt);
    expect(journalBatches([{ name: 'Map001.json', units: [unit] }], saved).some(b => b.id === batch && b.items.length === 1)).toBe(true);
    const r = undoJournal(saved, batch, 'Ви', 4_000);
    expect(r.done).toBe(1);
    expect(files['Map001.json']!.a!.status).toBe('draft');
  });
});
