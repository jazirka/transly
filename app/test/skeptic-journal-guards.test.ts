import { describe, expect, it, vi } from 'vitest';
import { batchUndoLabel, commitRows, edit, emptyProject, journalBatches, newBatch, recordChange, submit, undoJournal } from '../src/core';
import type { Entry, FileView, SavedProject, Unit } from '../src/core';

const u = (key: string, source: string): Unit => ({ key, source, speaker: '', kind: 'dialogue', context: 'c' });
const views: FileView[] = [{ name: 'A.json', units: [u('1', 'One'), u('2', 'Two'), u('3', 'Three')] }];
const fresh = (): SavedProject => ({ ...emptyProject('T'), files: { 'A.json': {
  '1': { target: 'Раз', status: 'draft', mt: 1 }, '2': { target: 'Два', status: 'draft', mt: 1 }, '3': { target: 'Три', status: 'draft', mt: 1 },
} } });
const entries = (saved: SavedProject) => (f: string): Record<string, Entry> => (saved.files[f] ??= {});
const send = (saved: SavedProject, key: string, now: number): string => {
  const r = submit(saved.files['A.json']![key], views[0]!.units.find(x => x.key === key)!, 'translate', now);
  if (!r.ok) throw new Error(r.reason);
  return commitRows(entries(saved), [{ file: 'A.json', key, next: r.entry, text: r.entry.target }], 'send', 'Я', now);
};

describe('journal: what the existing suite does not pin down', () => {
  it('a recorded change never moves the row clock backwards (merge decides by mt)', () => {
    const before: Entry = { target: 'a', status: 'draft', mt: 100 };
    const after = recordChange(before, { ...before, target: 'b', mt: 50 }, 'правка', 'b', 'Я', 60);
    expect(after.mt).toBe(101);
  });

  it('the first record of a row has exactly one history item, and an `after` without history keeps the old one', () => {
    const first = recordChange(undefined, { target: 'x', status: 'draft', mt: 1 }, 'правка', 'x', 'Я', 5);
    expect(first.history).toHaveLength(1);
    expect(first.history![0]).toMatchObject({ what: 'правка', text: 'x' });
    const old = { at: 1, who: 'Я', what: 'старе', text: 'a' };
    const before: Entry = { target: 'a', status: 'draft', mt: 1, history: [old] };
    const cleared = recordChange(before, { target: '', status: 'new', mt: 2 }, 'очищено', '', 'Я', 6);
    expect(cleared.history).toHaveLength(2);
    expect(cleared.history![0]).toEqual(old);
  });

  it('undoing an older action never reverts what a newer action did to the same row', () => {
    const saved = fresh();
    const x = send(saved, '1', 100);
    const row = saved.files['A.json']!['1']!;
    commitRows(entries(saved), [{ file: 'A.json', key: '1', next: { ...row, target: 'Раз!', mt: 200 }, text: 'Раз!' }], 'replace', 'Я', 200);
    const r = undoJournal(saved, x, 'Я', 300);
    expect(r).toMatchObject({ done: 0, skipped: 1 });
    expect(saved.files['A.json']!['1']).toMatchObject({ target: 'Раз!', status: 'done' });
  });

  it('actions are listed newest first, limited, and an action with no rows left is not listed', () => {
    const saved = fresh();
    const b1 = send(saved, '1', 100), b3 = send(saved, '3', 200), b2 = send(saved, '2', 300);
    expect(journalBatches(views, saved).map(b => b.id)).toEqual([b2, b3, b1]);
    expect(journalBatches(views, saved, 2).map(b => b.id)).toEqual([b2, b3]);
    saved.files['A.json']!['1'] = edit(saved.files['A.json']!['1'], views[0]!.units[0]!, 'Раз!', 'translate', 400);
    expect(journalBatches(views, saved).map(b => b.id)).toEqual([b2, b3]);
  });

  it('a send is offered as "Скасувати", only an undo as "Повторити"', () => {
    const saved = fresh();
    const id = send(saved, '1', 100);
    const sendBatch = journalBatches(views, saved).find(b => b.id === id)!;
    expect(batchUndoLabel(sendBatch)).toBe('Скасувати');
  });

  it('undoing a row back to an empty translation also forgets the saved original', () => {
    const saved = fresh();
    saved.files['A.json']!['1'] = { target: '', status: 'new', mt: 1 };
    const id = commitRows(entries(saved), [{ file: 'A.json', key: '1', next: { target: 'Раз', status: 'done', mt: 5, orig: 'Раз' }, text: 'Раз' }], 'memory', 'Я', 5);
    expect(undoJournal(saved, id, 'Я', 9).done).toBe(1);
    expect(saved.files['A.json']!['1']).toMatchObject({ target: '', status: 'new' });
    expect(saved.files['A.json']!['1']!.orig).toBeUndefined();
  });

  it('two actions made in the same millisecond get different ids (the random part is really used)', () => {
    const rnd = vi.spyOn(Math, 'random').mockReturnValueOnce(0.25).mockReturnValueOnce(0.75);
    const a = newBatch('send', 5), b = newBatch('send', 5);
    rnd.mockRestore();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^send:5[0-9a-z]{3}$/);
    const z = vi.spyOn(Math, 'random').mockReturnValue(0);
    expect(newBatch('send', 5)).toBe('send:5000');
    z.mockRestore();
  });
});
