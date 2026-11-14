import { describe, expect, it } from 'vitest';
import { GONE, alignSources, commitRows, emptyProject, ingestCount, ingestNote, ingestQuiet, isParked, planIngest } from '../src/core';
import type { Entry, SavedProject, Unit } from '../src/core';

const u = (key: string, source: string): Unit => ({ key, source, speaker: '', kind: 'dialogue', context: '' });
const units = (...sources: string[]): Unit[] => sources.map((s, i) => u('k' + i, s));
const ent = (target: string, src: string, status: Entry['status'] = 'draft', mt = 10): Entry => ({ target, status, mt, src });
const project = (old: Unit[], entries: Record<string, Entry>): SavedProject => ({ ...emptyProject('T'), files: { 'Map.json': entries }, snapshot: { 'Map.json': old } });
function ingest(saved: SavedProject, next: Unit[], now = 100) {
  const plan = planIngest(saved.snapshot, [{ name: 'Map.json', units: next }], saved.files, now);
  if (plan.changes.length) commitRows(f => (saved.files[f] ??= {}), plan.changes, 'rekey', 'Я', now);
  saved.snapshot = { 'Map.json': next };
  return plan.report;
}

// an independent oracle: the length of the longest common subsequence, by dynamic programming
const lcs = (a: string[], b: string[]): number => {
  const t = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) t[i]![j] = a[i - 1] === b[j - 1] ? t[i - 1]![j - 1]! + 1 : Math.max(t[i - 1]![j]!, t[i]![j - 1]!);
  return t[a.length]![b.length]!;
};
const mulberry32 = (seed: number) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

describe('alignSources finds the best alignment, not just a valid one', () => {
  it('matches as many lines as the longest common subsequence, in order, for random edits', () => {
    const r = mulberry32(42), rnd = (n: number): number => Math.floor(r() * n);
    let nonTrivial = 0;
    for (let t = 0; t < 300; t++) {
      const a = Array.from({ length: rnd(30) }, () => 's' + rnd(6));
      const b = a.filter(() => rnd(3) !== 0);
      for (let k = rnd(6); k > 0; k--) b.splice(rnd(b.length + 1), 0, 's' + rnd(6));
      const m = alignSources(a, b, 1000)!;
      expect(m).not.toBeNull();
      for (let k = 0; k < m.length; k++) {
        expect(a[m[k]![0]]).toBe(b[m[k]![1]]);
        if (k) { expect(m[k]![0]).toBeGreaterThan(m[k - 1]![0]); expect(m[k]![1]).toBeGreaterThan(m[k - 1]![1]); }
      }
      expect(m.length, JSON.stringify([a, b])).toBe(lcs(a, b));
      if (m.length > 1 && m.length < Math.min(a.length, b.length)) nonTrivial++;
    }
    expect(nonTrivial).toBeGreaterThan(100);
  });
});

describe('planIngest: guards the existing tests never exercise', () => {
  it('a translation follows an edited line into its new place and is counted as edited, not moved', () => {
    const saved = project(units('A', 'B', 'C'), { k0: ent('а', 'A'), k1: ent('б', 'B'), k2: ent('в', 'C') });
    const report = ingest(saved, units('NEW', 'A', 'B2', 'C'));
    const f = saved.files['Map.json']!;
    expect([f.k0!.target, f.k1!.target, f.k2!.target, f.k3!.target]).toEqual(['', 'а', 'б', 'в']);
    expect(report).toMatchObject({ moved: 2, edited: 1, adopted: 0 });
    expect(report.added.map(a => a.source)).toEqual(['NEW']);
    expect(ingestCount(report)).toBe(3);
    expect(ingestQuiet(report)).toBe(false);
    expect(ingestNote(report)).toBe('перенесено за текстом оригіналу: 3 · нових рядків: 1');
  });

  it('a moved translation never overwrites text already sitting in the destination row', () => {
    const saved = project(units('A', 'B'), { k0: ent('а', 'A'), k1: ent('б', 'B'), k2: ent('чужий переклад', 'Z') });
    const report = ingest(saved, units('N', 'A', 'B'));
    const f = saved.files['Map.json']!;
    expect(f.k2!.target).toBe('чужий переклад');
    expect(f.k1!.target).toBe('а');
    const parked = Object.keys(f).filter(isParked);
    expect(parked).toEqual(['k1' + GONE]);
    expect(f[parked[0]!]!.target).toBe('б');
    expect(report.gone.map(g => g.target)).toEqual(['б']);
  });

  it('files that differ by length and share fewer than a fifth of their lines are left alone; at a fifth they are lined up', () => {
    const old = Array.from({ length: 10 }, (_, i) => 's' + i);
    const mk = (keep: number[]): Unit[] => [...Array.from({ length: 11 }, (_, i) => (keep.includes(i) ? 's' + i : 'x' + i))].map((s, i) => u('k' + i, s));
    const entries = Object.fromEntries(old.map((s, i) => ['k' + i, ent('т' + i, s)]));
    const few = project(units(...old), structuredClone(entries));
    const rFew = planIngest(few.snapshot, [{ name: 'Map.json', units: mk([3]) }], few.files, 1);
    expect(rFew.report.unaligned).toEqual(['Map.json']);
    expect(rFew.changes).toEqual([]);
    const enough = project(units(...old), structuredClone(entries));
    const rEnough = planIngest(enough.snapshot, [{ name: 'Map.json', units: mk([3, 7]) }], enough.files, 1);
    expect(rEnough.report.unaligned).toEqual([]);
  });

  it('a row holding only spaces is not a translation to carry along', () => {
    const saved = project(units('A', 'B'), { k0: ent('   ', 'A'), k1: ent('б', 'B') });
    const report = ingest(saved, units('N', 'A', 'B'));
    expect(report.moved).toBe(1);
    expect(saved.files['Map.json']!.k2!.target).toBe('б');
    expect(saved.files['Map.json']!.k1!.target).toBe('');
  });

  it('a translation that leaves and returns in the same update is adopted, and no longer listed as gone', () => {
    const saved = project(units('A', 'X', 'B'), { k0: ent('а', 'A'), k1: ent('ікс', 'X'), k2: ent('бе', 'B') });
    const report = ingest(saved, units('B', 'A', 'Y'));
    const f = saved.files['Map.json']!;
    expect(f.k0!.target).toBe('бе');
    expect(f.k1!.target).toBe('а');
    expect(report.adopted).toBe(1);
    expect(report.gone.map(g => g.source)).toEqual(['X']);
  });

  it('the summary names every part, and says "файл" for one file and "файлів" for several', () => {
    const row = { file: 'M', key: 'k', source: 's', target: 't' };
    const full = { moved: 1, edited: 1, adopted: 1, gone: [row], added: [row, row], unaligned: ['A.json'] };
    expect(ingestNote(full)).toBe('перенесено за текстом оригіналу: 3 · нових рядків: 2 · зникло з гри (переклад збережено): 1 · надто змінені, не зіставлено: 1 файл');
    expect(ingestNote({ ...full, unaligned: ['A.json', 'B.json'] })).toMatch(/2 файлів$/);
    const none = { moved: 0, edited: 0, adopted: 0, gone: [], added: [], unaligned: [] };
    expect(ingestNote(none)).toBe('');
    expect(ingestQuiet(none)).toBe(true);
    expect(ingestQuiet({ ...none, added: [row] })).toBe(false);
    expect(ingestQuiet({ ...none, unaligned: ['A.json'] })).toBe(false);
    expect(ingestQuiet({ ...none, gone: [row] })).toBe(false);
    expect(ingestCount({ ...none, moved: 1, edited: 2, adopted: 4, gone: [row] })).toBe(8);
  });
});
