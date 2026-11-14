import { describe, expect, it } from 'vitest';
import { emptyProject, mergeProjects } from '../src/core';
import type { Entry, SavedProject } from '../src/core';

// Oracle: after one device resets the project (resetEpoch), nothing older than the reset may come back from another device,
// and everything written after it must survive, whichever replica is merged into which.
const row = (target: string, mt: number, extra: Partial<Entry> = {}): Entry => ({ target, status: 'done', mt, ...extra });
const m = (a: SavedProject, b: SavedProject): SavedProject => mergeProjects(a, b).project;

describe('reset epoch', () => {
  const resetSide = (): SavedProject => { const p = emptyProject('P'); p.resetEpoch = 100; p.files['M.json'] = { fresh: row('нове', 150) }; return p; };
  const staleSide = (): SavedProject => {
    const p = emptyProject('P');
    p.files['M.json'] = {
      old: row('старе', 50), kept: row('набране після скидання', 120),
      mixed: row('t', 60, { comments: [{ who: 'x', at: 40, text: 'old comment' }, { who: 'x', at: 130, text: 'new comment' }], history: [{ at: 40, who: 'x', what: 'w', text: 'o' }, { at: 130, who: 'x', what: 'w', text: 'n' }] }),
      onlyOldComment: row('t', 60, { comments: [{ who: 'x', at: 40, text: 'old comment' }] }),
    };
    p.terms = [{ en: 'Old', uk: 'старий', mt: 50 }, { en: 'New', uk: 'новий', mt: 130 }];
    p.memory = [{ s: 'a', t: 'b', mt: 50 }, { s: 'c', t: 'd', mt: 130 }];
    p.speakers = { o: { name: 'o', mt: 50 }, n: { name: 'n', mt: 130 } };
    p.deletedTerms = { gone: 50, recent: 130 };
    return p;
  };

  for (const [name, merged] of [['reset side first', () => m(resetSide(), staleSide())], ['stale side first', () => m(staleSide(), resetSide())]] as const) {
    it(`nothing older than the reset comes back (${name})`, () => {
      const p = merged();
      expect(p.resetEpoch).toBe(100);
      // rows older than the reset come back empty (a reset within a day before may have been made by a clock that ran ahead: the
      // text stays in the row's history, see `RESET_WHAT`); rows written after it, and the newer parts of mixed rows, survive
      const rows = p.files['M.json']!;
      expect(Object.keys(rows).sort()).toEqual(['fresh', 'kept', 'mixed', 'old', 'onlyOldComment']);
      expect(rows.old).toMatchObject({ target: '', status: 'new' });
      expect(rows.old!.history!.map(h => h.text)).toEqual(['старе']);
      expect(rows.onlyOldComment!.target).toBe('');
      expect(rows.fresh!.target).toBe('нове');
      expect(rows.kept!.target).toBe('набране після скидання');
      expect(p.files['M.json']!.mixed!.comments!.map(c => c.text)).toEqual(['new comment']);
      expect(p.files['M.json']!.mixed!.history!.map(h => h.text)).toEqual(['n']);
      expect(p.terms.map(t => t.en)).toEqual(['New']);
      expect(p.memory.map(x => x.s)).toEqual(['c']);
      expect(Object.keys(p.speakers!)).toEqual(['n']);
      expect(p.deletedTerms).toEqual({ recent: 130 });
    });
  }

  it('rows older than a day before the reset are gone, not kept', () => {
    const day = 24 * 3600 * 1000;
    const a = emptyProject('P'); a.resetEpoch = 10 * day;
    const b = emptyProject('P'); b.files['M.json'] = { ancient: row('давнє', 2 * day), recent: row('за годину до скидання', 10 * day - 3600_000) };
    const rows = m(a, b).files['M.json']!;
    expect(Object.keys(rows)).toEqual(['recent']);
    expect(rows.recent).toMatchObject({ target: '', status: 'new' });
    expect(rows.recent!.history!.map(h => h.text)).toEqual(['за годину до скидання']);
  });

  it('without a reset nothing is filtered by age', () => {
    const p = m(emptyProject('P'), staleSide());
    expect(Object.keys(p.files['M.json']!).sort()).toEqual(['kept', 'mixed', 'old', 'onlyOldComment']);
    expect(p.files['M.json']!.mixed!.comments).toHaveLength(2);
    expect(p.terms).toHaveLength(2);
  });
});
