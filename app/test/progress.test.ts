import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { emptyProject, pct, progressOf, rowState, rowsProgress, statsOf, sumProgress } from '../src/core';
import type { Entry, Unit } from '../src/core';

const unit = (key: string): Unit => ({ key, source: 'x ' + key, speaker: '', kind: 'dialogue', context: '' });
const e = (target: string, status: Entry['status']): Entry => ({ target, status, mt: 1 });

describe('progress: one set of definitions', () => {
  it('a row is in exactly one of four states; a row with only spaces has no translation', () => {
    expect(rowState(undefined)).toBe('untranslated');
    expect(rowState(e('', 'draft'))).toBe('untranslated');
    expect(rowState(e('   ', 'done'))).toBe('untranslated');
    expect(rowState(e('т', 'new'))).toBe('draft');
    expect(rowState(e('т', 'draft'))).toBe('draft');
    expect(rowState(e('т', 'done'))).toBe('sent');
    expect(rowState(e('т', 'appr'))).toBe('approved');
  });

  it('the file count, the group count and the sum of files agree', () => {
    const units = ['a', 'b', 'c', 'd', 'e'].map(unit);
    const files = { a: e('1', 'appr'), b: e('2', 'done'), c: e('3', 'draft'), d: e('', 'draft') } as Record<string, Entry>;
    const p = progressOf(units, files);
    expect(p).toEqual({ total: 5, untranslated: 2, draft: 1, sent: 1, approved: 1, translated: 3 });
    expect(p.untranslated + p.draft + p.sent + p.approved).toBe(p.total);
    expect(statsOf(units, files)).toEqual({ total: 5, translated: 3, done: 1, approved: 1 });
    expect(rowsProgress(units.map(u => ({ file: 'F', key: u.key })), () => files)).toEqual({ total: 5, translated: 3, done: 1, approved: 1 });
    expect(sumProgress([p, p])).toEqual({ total: 10, untranslated: 4, draft: 2, sent: 2, approved: 2, translated: 6 });
  });

  it('a percentage never shows 100 before the work is complete, nor 0 once it has begun', () => {
    expect(pct(0, 0)).toBe(0);
    expect(pct(0, 1000)).toBe(0);
    expect(pct(1, 1000)).toBe(1);
    expect(pct(995, 1000)).toBe(99);
    expect(pct(999, 1000)).toBe(99);
    expect(pct(1000, 1000)).toBe(100);
    expect(pct(1, 3)).toBe(33);
    expect(pct(2, 3)).toBe(66);
  });
});

/** Counting rows into states or percentages anywhere but `core/progress.ts` is how the numbers drifted apart before. */
describe('the numbers are made in one place', () => {
  const files = (dir: string): string[] => readdirSync(dir).flatMap(n => { const p = join(dir, n); return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : []; });
  const src = files(join(__dirname, '..', 'src')).filter(f => !f.endsWith(join('core', 'progress.ts')));
  it('no `translated++` and no hand-made percentage of rows outside progress.ts', () => {
    const bad: string[] = [];
    for (const f of src) {
      const text = readFileSync(f, 'utf8');
      if (/\btranslated\+\+/.test(text)) bad.push(`${f}: translated++`);
      if (/Math\.(round|floor)\(\s*\(?\s*100\s*\*\s*(st|p|t|tot|f|cf)\.(translated|approved|tr|done)\b/.test(text)) bad.push(`${f}: percentage of rows`);
    }
    expect(bad).toEqual([]);
  });
});
