import { describe, expect, it } from 'vitest';
import { QUEUE_LABEL, emptyProject, nextIn, positionOf, queueRows } from '../src/core';
import type { Entry, FileView, Unit } from '../src/core';

const unit = (key: string, source = 'x ' + key): Unit => ({ key, source, speaker: '', kind: 'dialogue', context: '' });
const e = (target: string, status: Entry['status'], extra: Partial<Entry> = {}): Entry => ({ target, status, mt: 1, ...extra });
const views: FileView[] = [
  { name: 'A.json', units: [unit('a1'), unit('a2'), unit('a3')] },
  { name: 'B.json', units: [unit('b1'), unit('b2')] },
];
const saved = () => {
  const p = emptyProject('P');
  p.files['A.json'] = { a1: e('т', 'appr'), a2: e('', 'new'), a3: e('т3', 'done') };
  p.files['B.json'] = { b2: e('т4', 'done', { src: 'old original' }) };
  return p;
};
const qa = { tolerancePct: 1000, terms: [] };

describe('queue: what waits for the translator, across the whole project', () => {
  it('lists each kind in the order of the project, over all files', () => {
    const p = saved();
    expect(queueRows(views, p, 'untranslated', qa).map(r => r.key)).toEqual(['a2', 'b1']);
    expect(queueRows(views, p, 'unreviewed', qa).map(r => r.key)).toEqual(['a3', 'b2']);
    expect(queueRows(views, p, 'sourceChanged', qa).map(r => r.key)).toEqual(['b2']);
    expect(queueRows(views, p, 'untranslated', qa).map(r => r.at)).toEqual([1, 3]);
  });

  it('an error is a blocking QA problem in a row that has text', () => {
    const p = saved();
    p.files['A.json']!.a1 = e('Він сказав \\N[1] і пішов', 'draft');           // a code the original does not have is not an error, a missing one is
    const withCode: Unit = { ...unit('b1', 'Hello \\N[1]'), kind: 'dialogue' };
    const v2: FileView[] = [views[0]!, { name: 'B.json', units: [withCode, unit('b2')] }];
    p.files['B.json']!.b1 = e('Привіт', 'draft');                              // lost the code \N[1]
    expect(queueRows(v2, p, 'error', qa).map(r => r.key)).toEqual(['b1']);
  });

  it('next and previous go round the project, from any position, and skip the row we are on', () => {
    const rows = queueRows(views, saved(), 'untranslated', qa);               // positions 1 and 3
    expect(nextIn(rows, -1, 1)).toMatchObject({ row: { key: 'a2' }, place: 1 });
    expect(nextIn(rows, 1, 1)).toMatchObject({ row: { key: 'b1' }, place: 2 });
    expect(nextIn(rows, 3, 1)).toMatchObject({ row: { key: 'a2' }, place: 1 }); // round the end
    expect(nextIn(rows, 3, -1)).toMatchObject({ row: { key: 'a2' } });
    expect(nextIn(rows, 1, -1)).toMatchObject({ row: { key: 'b1' } });          // round the start
    expect(nextIn(rows, 0, 1)).toMatchObject({ row: { key: 'a2' } });           // from a row that is not in the queue
    expect(nextIn([], 0, 1)).toBeNull();
  });

  it('positionOf finds a row in the whole project', () => {
    expect(positionOf(views, { file: 'B.json', key: 'b1' })).toBe(3);
    expect(positionOf(views, { file: 'B.json', key: 'zz' })).toBe(-1);
    expect(positionOf(views, null)).toBe(-1);
  });

  it('every kind has its words', () => {
    for (const k of ['untranslated', 'error', 'advice', 'unreviewed', 'sourceChanged'] as const) expect(QUEUE_LABEL[k].empty.length).toBeGreaterThan(5);
  });
});
