import { describe, expect, it } from 'vitest';
import { DEFAULT_QA, emptyProject, nextIn, planOf, positionOf, queueRows } from '../src/core';
import type { Entry, FileView, RowChange, Unit } from '../src/core';

const unit = (key: string, source: string): Unit => ({ key, source, speaker: '', kind: 'dialogue', context: '' });
const e = (target: string, status: Entry['status'], mt = 1): Entry => ({ target, status, mt });

describe('queue: the error and advice kinds', () => {
  const views: FileView[] = [
    { name: 'A.json', units: [unit('a1', 'Take \\C[2]this\\C[0]'), unit('a2', 'The Sword.'), unit('a3', 'Hello world'), unit('a4', 'Take \\C[2]that\\C[0]'), unit('a5', 'Take \\C[1]x\\C[0]')] },
    { name: 'B.json', units: [unit('b1', 'One'), unit('b2', 'Two')] },
  ];
  const p = emptyProject('P');
  p.files['A.json'] = { a1: e('Візьми це', 'draft'), a2: e('Клинок.', 'draft'), a3: e('Привіт, дуже довгий переклад короткого рядка', 'draft'), a4: e('Візьми те', 'new'), a5: e('', 'draft') };
  const qa = { ...DEFAULT_QA, tolerancePct: 1000, terms: [{ en: 'Sword', uk: 'меч' }] };

  it('an error is a blocking QA problem in a row that has text and is not new', () => {
    expect(queueRows(views, p, 'error', qa).map(r => r.key)).toEqual(['a1']);
  });
  it('advice is a warning other than length, in a row that has text', () => {
    expect(queueRows(views, p, 'advice', qa).map(r => r.key)).toEqual(['a2']);
    const strict = { ...qa, tolerancePct: 1 };
    expect(queueRows(views, p, 'advice', strict).map(r => r.key)).toEqual(['a2']);
  });
  it('the position of a row counts the rows of all earlier files', () => {
    expect(positionOf(views, { file: 'B.json', key: 'b2' })).toBe(6);
    expect(positionOf(views, { file: 'A.json', key: 'a3' })).toBe(2);
    expect(positionOf(views, { file: 'C.json', key: 'x' })).toBe(-1);
  });
  it('next/previous wrap around the ends of the queue', () => {
    const rows = [{ file: 'A', key: 'x', at: 2 }, { file: 'A', key: 'y', at: 5 }, { file: 'A', key: 'z', at: 9 }];
    expect(nextIn(rows, 9, 1)).toMatchObject({ row: { key: 'x' }, place: 1 });
    expect(nextIn(rows, 2, -1)).toMatchObject({ row: { key: 'z' }, place: 3 });
    expect(nextIn(rows, 5, 1)).toMatchObject({ row: { key: 'z' }, place: 3 });
    expect(nextIn(rows, 5, -1)).toMatchObject({ row: { key: 'x' }, place: 1 });
    expect(nextIn(rows, 100, -1)).toMatchObject({ row: { key: 'z' } });
  });
});

describe('plan: which rows fall back to drafts', () => {
  const change = (key: string, next: Entry): RowChange => ({ file: 'M.json', key, next, text: next.target });
  const setup = () => { const p = emptyProject('P'); p.files['M.json'] = { s1: e('a', 'done'), s2: e('a', 'done'), s3: e('a', 'done'), s4: e('a', 'done'), s5: e('a', 'draft') }; return (f: string) => p.files[f]!; };
  it('only a sent row changed to a lower status counts as «will become a draft»', () => {
    const plan = planOf(setup(), [
      change('s1', e('b', 'done')), change('s2', e('b', 'appr')), change('s3', e('b', 'draft')), change('s4', e('', 'new')), change('s5', e('b', 'draft')),
    ], 'replace');
    expect(plan.demotes).toEqual({ appr: 0, done: 2 });
    expect(plan.changes).toHaveLength(5);
  });
});
