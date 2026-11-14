import { describe, expect, it } from 'vitest';
import { emptyProject, mergeEntry, mergeProjects } from '../src/core';
import type { Entry, HistoryItem, SavedProject, Unit } from '../src/core';

const unit = (source: string): Unit => ({ key: 'a', source, speaker: '', kind: 'dialogue', context: '' });
const m = (a: SavedProject, b: SavedProject): SavedProject => mergeProjects(a, b).project;

describe('mergeEntry: things the law tests cannot see because they sort before comparing', () => {
  const c = (at: number, text: string) => ({ who: 'x', at, text });
  it('merged comments are in time order, whichever replica comes first', () => {
    const a: Entry = { target: 't', status: 'draft', mt: 1, comments: [c(20, 'second'), c(30, 'third')] };
    const b: Entry = { target: 't', status: 'draft', mt: 1, comments: [c(10, 'first')] };
    expect(mergeEntry(a, b).comments!.map(x => x.text)).toEqual(['first', 'second', 'third']);
    expect(mergeEntry(b, a).comments!.map(x => x.text)).toEqual(['first', 'second', 'third']);
  });
  it('merged history is in time order and keeps only the newest 50 items', () => {
    const h = (at: number): HistoryItem => ({ at, who: 'x', what: 'w', text: String(at) });
    const a: Entry = { target: 't', status: 'draft', mt: 1, history: Array.from({ length: 40 }, (_, i) => h(2 * i + 1)) };
    const b: Entry = { target: 't', status: 'draft', mt: 1, history: Array.from({ length: 30 }, (_, i) => h(2 * i + 2)) };
    for (const out of [mergeEntry(a, b), mergeEntry(b, a)]) {
      const ats = out.history!.map(x => x.at);
      expect(ats).toHaveLength(50);
      expect(ats).toEqual([...ats].sort((x, y) => x - y));
      const expected = [...a.history!, ...b.history!].map(x => x.at).sort((x, y) => x - y).slice(-50);
      expect(ats).toEqual(expected);
    }
  });
});

describe('mergeProjects: which side wins, in both orders', () => {
  const withSnap = (name: string, rev: number | undefined, source: string): SavedProject => {
    const p = emptyProject(name);
    p.snapshot = { 'M.json': [unit(source)] };
    if (rev !== undefined) p.assetsRev = rev;
    return p;
  };
  it('the replica with the newer game files (higher assetsRev) supplies the snapshot, in either order', () => {
    const a = withSnap('P', 1, 'v1'), b = withSnap('P', 2, 'v2');
    expect(m(a, b).snapshot!['M.json']![0]!.source).toBe('v2');
    expect(m(b, a).snapshot!['M.json']![0]!.source).toBe('v2');
    expect(m(a, b).assetsRev).toBe(2);
  });
  it('a newer revision without any game files does not wipe the snapshot of the other side', () => {
    const a = withSnap('P', 1, 'v1'), b = emptyProject('P'); b.assetsRev = 5;
    expect(m(a, b).snapshot!['M.json']![0]!.source).toBe('v1');
    expect(m(b, a).snapshot!['M.json']![0]!.source).toBe('v1');
  });
  it('the project name and languages come from the side with the later reset epoch', () => {
    const a = emptyProject('Old'); a.resetEpoch = 3;
    const b = emptyProject('New'); b.resetEpoch = 9; b.targetLang = 'pl';
    for (const out of [m(a, b), m(b, a)]) { expect(out.name).toBe('New'); expect(out.targetLang).toBe('pl'); expect(out.resetEpoch).toBe(9); }
  });
  it('the settings of the later settingsAt win, in either order', () => {
    const a = emptyProject('P'); a.settings = { ...a.settings, who: 'А' }; a.settingsAt = 5;
    const b = emptyProject('P'); b.settings = { ...b.settings, who: 'Б' }; b.settingsAt = 8;
    expect(m(a, b).settings.who).toBe('Б');
    expect(m(b, a).settings.who).toBe('Б');
    expect(m(a, b).settingsAt).toBe(8);
  });
  it('a term deleted after it was last edited stays deleted; edited after the deletion it comes back', () => {
    const a = emptyProject('P'); a.terms = [{ en: 'Storm', uk: 'буря', mt: 5 }];
    const b = emptyProject('P'); b.deletedTerms = { storm: 9 };
    expect(m(a, b).terms).toEqual([]);
    expect(m(b, a).terms).toEqual([]);
    a.terms = [{ en: 'Storm', uk: 'шторм', mt: 12 }];
    expect(m(a, b).terms.map(t => t.uk)).toEqual(['шторм']);
  });
});
