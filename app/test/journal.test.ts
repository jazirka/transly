import { describe, expect, it } from 'vitest';
import { autoBatches, batchTitle, batchUndoLabel, commitRows, edit, emptyProject, journalBatches, kindOfBatch, newBatch, recordChange, sendBatches, submit, undoJournal, undoReport } from '../src/core';
import type { Entry, FileView, SavedProject, Unit } from '../src/core';

const u = (key: string, source: string): Unit => ({ key, source, speaker: '', kind: 'dialogue', context: 'c' });
const views: FileView[] = [{ name: 'A.json', units: [u('1', 'One'), u('2', 'Two'), u('3', 'Three')] }, { name: 'B.json', units: [u('1', 'One')] }];
const fresh = (): SavedProject => ({ ...emptyProject('T'), files: {
  'A.json': { '1': { target: 'Раз', status: 'draft', mt: 1 }, '2': { target: 'Два', status: 'draft', mt: 1 }, '3': { target: 'Три', status: 'draft', mt: 1 } },
  'B.json': {},
} });
const send = (saved: SavedProject, keys: string[], now: number): string => {
  const changes = keys.map(k => { const r = submit(saved.files['A.json']![k], views[0]!.units.find(x => x.key === k)!, 'translate', now); if (!r.ok) throw new Error(r.reason); return { file: 'A.json', key: k, next: r.entry, text: r.entry.target }; });
  return commitRows(f => (saved.files[f] ??= {}), changes, 'send', 'Я', now);
};

describe('journal', () => {
  it('batch ids carry the kind', () => {
    const id = newBatch('replace', 1000);
    expect(kindOfBatch(id)).toBe('replace');
    expect(newBatch('replace', 1000)).not.toBe(id === newBatch('replace', 1000) ? '' : id);
  });

  it('a record keeps what the row was before, and the history stays capped', () => {
    const before: Entry = { target: 'старе', status: 'done', mt: 1, returned: true };
    const after = recordChange(before, { ...before, target: 'нове', status: 'draft' }, 'правка', 'нове', 'Я', 5, 'replace:x');
    expect(after.history!.at(-1)).toEqual({ at: 5, who: 'Я', what: 'правка', text: 'нове', prev: { target: 'старе', status: 'done', returned: true }, batch: 'replace:x' });
    let e: Entry = { target: 'x', status: 'draft', mt: 1 };
    for (let i = 0; i < 70; i++) e = recordChange(e, e, 'крок', String(i), 'Я', i);
    expect(e.history).toHaveLength(50);
  });

  it('lists an action with its rows, and a later edit takes a row out of it', () => {
    const saved = fresh();
    const id = send(saved, ['1', '2'], 100);
    let list = journalBatches(views, saved);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id, kind: 'send', total: 2 });
    expect(list[0]!.items.map(i => i.key)).toEqual(['1', '2']);
    saved.files['A.json']!['2'] = edit(saved.files['A.json']!['2'], views[0]!.units[1]!, 'Два!', 'translate', 200);
    list = journalBatches(views, saved);
    expect(list[0]!.items.map(i => i.key)).toEqual(['1']);
    expect(list[0]!.total).toBe(2);
    expect(batchTitle(list[0]!)).toBe('Надіслано: 1 рядок');
  });

  it('undo returns the rows, reports the ones changed since, and can be repeated', () => {
    const saved = fresh();
    const id = send(saved, ['1', '2', '3'], 100);
    saved.files['A.json']!['3'] = edit(saved.files['A.json']!['3'], views[0]!.units[2]!, 'Три!', 'translate', 150);
    const r = undoJournal(saved, id, 'Я', 200);
    expect(r).toMatchObject({ done: 2, skipped: 1, kind: 'send' });
    expect(undoReport(r)).toBe('Скасовано «надіслано»: 2 рядки. Ще 1 рядок змінено після дії, їх не чіпав');
    expect(saved.files['A.json']!['1']).toMatchObject({ status: 'draft', target: 'Раз', mt: 200 });
    expect(saved.files['A.json']!['3']!.target).toBe('Три!');
    // the undo is an action itself: it is listed and can be repeated
    const list = journalBatches(views, saved);
    const undo = list.find(b => b.kind === 'undo')!;
    expect(undo.items).toHaveLength(2);
    expect(batchUndoLabel(undo)).toBe('Повторити');
    expect(batchTitle(undo)).toBe('Скасовано «надіслано»: 2 рядки');
    const again = undoJournal(saved, undo.id, 'Я', 300);
    expect(again).toMatchObject({ done: 2, kind: 'undo' });
    expect(undoReport(again)).toBe('Повторено: 2 рядки');
    expect(saved.files['A.json']!['1']!.status).toBe('done');
    expect(journalBatches(views, saved).find(b => b.kind === 'redo')).toBeDefined();
  });

  it('clearing is undone with the old text back', () => {
    const saved = fresh();
    const id = commitRows(f => (saved.files[f] ??= {}), [{ file: 'A.json', key: '1', next: edit(saved.files['A.json']!['1'], views[0]!.units[0]!, '', 'translate', 50), text: '' }], 'clear', 'Я', 50);
    expect(saved.files['A.json']!['1']).toMatchObject({ target: '', status: 'new' });
    expect(undoJournal(saved, id, 'Я', 60).done).toBe(1);
    expect(saved.files['A.json']!['1']).toMatchObject({ target: 'Раз', status: 'draft' });
  });

  it('copies to identical rows form one action, and the older lists do not show journal rows again', () => {
    const saved = fresh();
    saved.files['A.json']!['1'] = { target: 'Раз', status: 'done', mt: 10 };
    const id = commitRows(f => (saved.files[f] ??= {}), [{ file: 'B.json', key: '1', next: { target: 'Раз', status: 'done', mt: 10, src: 'One' }, text: 'Раз' }], 'twin', 'Я', 10);
    expect(saved.files['B.json']!['1']).toMatchObject({ target: 'Раз', status: 'done' });
    expect(saved.files['B.json']!['1']!.history!.at(-1)).toMatchObject({ batch: id, prev: { target: '', status: 'new' } });
    expect(journalBatches(views, saved)[0]).toMatchObject({ id, kind: 'twin' });
    expect(autoBatches(views, saved)).toEqual([]);
    expect(sendBatches(views, saved).filter(b => b.items.some(i => i.file === 'B.json'))).toEqual([]);
    expect(undoJournal(saved, id, 'Я', 20).done).toBe(1);
    expect(saved.files['B.json']!['1']).toMatchObject({ target: '', status: 'new' });
  });

  it('rows of the older lists (without an action id) are still found there', () => {
    const saved = fresh();
    saved.files['A.json']!['1'] = { target: 'Раз', status: 'done', mt: 10, history: [{ at: 10, who: 'Я', what: 'надіслано на вичитування', text: 'Раз' }] };
    expect(journalBatches(views, saved)).toEqual([]);
    expect(sendBatches(views, saved)[0]!.items.map(i => i.key)).toEqual(['1']);
  });

  it('a row typed in after an older automatic fill or send is not taken back (it would wipe what was typed)', () => {
    const saved = fresh();
    saved.files['A.json']!['1'] = { target: 'Раз', status: 'draft', mt: 10, history: [{ at: 10, who: 'Я', what: 'автозаповнено за словами', text: 'Раз' }] };
    saved.files['A.json']!['2'] = { target: 'Два', status: 'done', mt: 10, history: [{ at: 10, who: 'Я', what: 'надіслано на вичитування', text: 'Два' }] };
    const [b] = autoBatches(views, saved), [sb] = sendBatches(views, saved);
    expect(b!.items.map(i => i.key)).toEqual(['1']);
    expect(sb!.items.map(i => i.key)).toEqual(['2']);
    saved.files['A.json']!['1'] = edit(saved.files['A.json']!['1'], views[0]!.units[0]!, 'Раз, раз', 'translate', 99);
    expect(autoBatches(views, saved)).toEqual([]);
    saved.files['A.json']!['2'] = { ...saved.files['A.json']!['2']!, mt: 99 };
    expect(sendBatches(views, saved).filter(x => !x.guessed)).toEqual([]);
    expect(saved.files['A.json']!['1']!.target).toBe('Раз, раз');
  });
});

describe('a single send is an action of the journal', () => {
  it('commitRows with kind send can be listed and taken back like a bulk action', () => {
    const p = emptyProject('P');
    const entries = (_f: string): Record<string, Entry> => (p.files['M.json'] ??= {});
    p.files['M.json'] = { a: { target: 'text', status: 'draft', mt: 1 } };
    const views = [{ name: 'M.json', units: [{ key: 'a', source: 'src', speaker: '', kind: 'dialogue', context: '' } as never] }];
    const next = { ...p.files['M.json']!.a!, status: 'done' as const, mt: 5 };
    const id = commitRows(entries, [{ file: 'M.json', key: 'a', next, text: 'text' }], 'send', 'Ви', 5);
    expect(journalBatches(views, p).map(b => b.id)).toEqual([id]);
    expect(p.files['M.json']!.a!.status).toBe('done');
    const r = undoJournal(p, id, 'Ви', 9);
    expect(r.done).toBe(1);
    expect(p.files['M.json']!.a!.status).toBe('draft');
    expect(undoReport(r)).toBe('Скасовано «надіслано»: 1 рядок');
  });
});
