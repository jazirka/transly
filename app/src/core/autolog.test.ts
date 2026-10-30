import { describe, expect, it } from 'vitest';
import { autoBatches, autoUndone, undoAuto } from './autolog';
import { sendBatches } from './undosend';
import type { FileView, SavedProject } from './project';

const unit = (key: string) => ({ key, source: 'S' + key, speaker: '', kind: 'name' as const, context: '' });
const views = [{ name: 'A.json', units: ['1', '2', '3', '4'].map(unit) } as unknown as FileView];
const row = (at: number, what: string, status = 'draft') => ({ target: 'T', status, mt: at, history: [{ at, who: 'я', what, text: 'T' }] });
const saved = (files: Record<string, unknown>): SavedProject => ({ files: { 'A.json': files } } as unknown as SavedProject);
const t0 = 5_000_000;

describe('activity of automatic fills', () => {
  const s = () => saved({ 1: row(t0, 'автозаповнено за словами'), 2: row(t0 + 1000, 'автозаповнено за словами'), 3: row(t0 + 60 * 60_000, 'підставлено з однакового рядка', 'done'), 4: row(5, 'правка') });
  it('groups by kind and time, ignores other rows', () => {
    const b = autoBatches(views, s());
    expect(b.map(x => [x.kind, x.items.length])).toEqual([['twin', 1], ['words', 2]]);
  });
  it('a row changed afterwards leaves the batch', () => {
    const sv = s(); (sv.files['A.json']!['1'] as { history: unknown[] }).history.push({ at: t0 + 5, who: 'я', what: 'правка', text: 'z' });
    expect(autoBatches(views, sv).map(x => x.items.length)).toEqual([1, 1]);
  });
  it('undo empties the rows and is logged', () => {
    const sv = s(); const b = autoBatches(views, sv).find(x => x.kind === 'words')!;
    expect(undoAuto(sv, b, 'я', t0 + 9)).toBe(2);
    const e = sv.files['A.json']!['1']!;
    expect([e.target, e.status, e.history!.at(-1)!.what]).toEqual(['', 'new', 'автозаповнення скасовано']);
    expect(autoUndone(views, sv).map(x => [x.kind, x.count])).toEqual([['words', 2]]);
    expect(autoBatches(views, sv).map(x => x.kind)).toEqual(['twin']);
  });
  it('twin rows waiting for review are not listed twice (not as a «guessed» send)', () => {
    expect(sendBatches(views, s()).some(x => x.items.some(i => i.key === '3'))).toBe(false);
  });
});
