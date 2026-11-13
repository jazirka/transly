import { describe, expect, it } from 'vitest';
import { GONE, alignSources, commitRows, emptyProject, ingestNote, isParked, journalBatches, planIngest, reconcileChanges, undoJournal } from '../src/core';
import type { Entry, SavedProject, Unit } from '../src/core';

const u = (key: string, source: string): Unit => ({ key, source, speaker: '', kind: 'dialogue', context: '' });
const units = (...sources: string[]): Unit[] => sources.map((s, i) => u('k' + i, s));
const ent = (target: string, src: string, status: Entry['status'] = 'draft', mt = 10): Entry => ({ target, status, mt, src });

/** The new version is read: the plan is applied as one action of the journal, exactly as the app does. */
function ingest(saved: SavedProject, file: string, next: Unit[], now = 100): { batch: string | undefined; report: ReturnType<typeof planIngest>['report'] } {
  const old = saved.snapshot;
  const plan = planIngest(old, [{ name: file, units: next }], saved.files, now);
  const batch = plan.changes.length ? commitRows(f => (saved.files[f] ??= {}), plan.changes, 'rekey', 'Я', now) : undefined;
  saved.snapshot = { ...(old ?? {}), [file]: next };
  return { batch, report: plan.report };
}
const project = (old: Unit[], entries: Record<string, Entry>): SavedProject => ({ ...emptyProject('T'), files: { 'Map.json': entries }, snapshot: { 'Map.json': old } });

describe('alignSources', () => {
  it('matches a line put in at the start, and finds nothing for unrelated lists', () => {
    expect(alignSources(['a', 'b', 'c'], ['new', 'a', 'b', 'c'])).toEqual([[0, 1], [1, 2], [2, 3]]);
    expect(alignSources(['a', 'b'], ['x', 'y'])).toEqual([]);
  });
  it('keeps the order with repeated lines', () => {
    const m = alignSources(['Yes', 'No', 'Yes'], ['Yes', 'Yes', 'No', 'Yes'])!;
    expect(m.length).toBe(3);
    for (let k = 1; k < m.length; k++) { expect(m[k]![0]).toBeGreaterThan(m[k - 1]![0]); expect(m[k]![1]).toBeGreaterThan(m[k - 1]![1]); }
  });
  it('gives up (null) when the lists differ by more than the limit', () => {
    const a = Array.from({ length: 50 }, (_, i) => 'a' + i), b = Array.from({ length: 50 }, (_, i) => 'b' + i);
    expect(alignSources(a, b, 20)).toBeNull();
    expect(alignSources(a, b, 200)).toEqual([]);
  });
  it('is a common subsequence for random edits', () => {
    let seed = 7; const rnd = (n: number): number => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
    for (let t = 0; t < 200; t++) {
      const a = Array.from({ length: rnd(40) }, () => 's' + rnd(8));
      const b = a.filter(() => rnd(4) !== 0);
      for (let k = rnd(5); k > 0; k--) b.splice(rnd(b.length + 1), 0, 's' + rnd(8));
      const m = alignSources(a, b, 1000)!;
      expect(m).not.toBeNull();
      for (let k = 0; k < m.length; k++) {
        expect(a[m[k]![0]]).toBe(b[m[k]![1]]);
        if (k) { expect(m[k]![0]).toBeGreaterThan(m[k - 1]![0]); expect(m[k]![1]).toBeGreaterThan(m[k - 1]![1]); }
      }
    }
  });
});

describe('planIngest: a new version of the game', () => {
  it('a message put in at the start does not shift the translations (the case that misattached them)', () => {
    const old = units('The road north', 'The river runs red', 'Farewell');
    const saved = project(old, { k0: ent('Дорога на північ', 'The road north', 'done'), k1: ent('Річка червона', 'The river runs red', 'appr') });
    const { report } = ingest(saved, 'Map.json', units('Welcome, traveler.', 'The road north', 'The river runs red', 'Farewell'));
    const f = saved.files['Map.json']!;
    expect(f.k0).toMatchObject({ target: '', status: 'new' });            // the new line has no translation
    expect(f.k1).toMatchObject({ target: 'Дорога на північ', status: 'done' });
    expect(f.k2).toMatchObject({ target: 'Річка червона', status: 'appr' });
    expect(report).toMatchObject({ moved: 2, edited: 0, adopted: 0, gone: [] });
    expect(report.added.map(a => a.source)).toEqual(['Welcome, traveler.']);
    expect(reconcileChanges([{ name: 'Map.json', units: units('Welcome, traveler.', 'The road north', 'The river runs red', 'Farewell') }], saved.files, 200).changed).toBe(0);
  });

  it('a removed line keeps its translation, parked, and gets it back when the same line comes again', () => {
    const old = units('One', 'Two', 'Three');
    const saved = project(old, { k0: ent('Один', 'One'), k1: ent('Два', 'Two', 'appr'), k2: ent('Три', 'Three') });
    const first = ingest(saved, 'Map.json', units('One', 'Three'));
    expect(first.report.gone.map(g => [g.source, g.target])).toEqual([['Two', 'Два']]);
    const f = saved.files['Map.json']!;
    expect(f.k0!.target).toBe('Один'); expect(f.k1!.target).toBe('Три'); expect(f.k2).toMatchObject({ target: '', status: 'new' });
    const parked = Object.keys(f).filter(isParked);
    expect(parked).toEqual(['k1' + GONE]);
    expect(f[parked[0]!]).toMatchObject({ target: 'Два', status: 'appr' });
    const second = ingest(saved, 'Map.json', units('One', 'Two', 'Three'), 200);       // the old version again
    expect(second.report.adopted).toBe(1);
    expect(saved.files['Map.json']!.k1).toMatchObject({ target: 'Два', status: 'appr' });
    expect(saved.files['Map.json']!.k2!.target).toBe('Три');
    expect(saved.files['Map.json']![parked[0]!]!.target).toBe('');
  });

  it('a line edited in place keeps its translation (the original-changed handling follows)', () => {
    const saved = project(units('Hello there', 'Bye'), { k0: ent('Привіт', 'Hello there', 'done'), k1: ent('Бувай', 'Bye') });
    const { report } = ingest(saved, 'Map.json', units('Hello there!', 'Bye'));
    expect(saved.files['Map.json']!.k0).toMatchObject({ target: 'Привіт', status: 'done' });
    expect(report.edited + report.moved).toBe(0);
    const rec = reconcileChanges([{ name: 'Map.json', units: units('Hello there!', 'Bye') }], saved.files, 200);
    expect(rec.changed).toBe(1);
  });

  it('a whole action can be taken back, and takes the translations to their old places', () => {
    const old = units('A', 'B', 'C');
    const saved = project(old, { k0: ent('а', 'A'), k1: ent('б', 'B'), k2: ent('в', 'C') });
    const { batch } = ingest(saved, 'Map.json', units('X', 'A', 'B', 'C'));
    expect(batch).toBeDefined();
    expect(journalBatches([{ name: 'Map.json', units: units('X', 'A', 'B', 'C') }], saved)[0]).toMatchObject({ id: batch, kind: 'rekey' });
    expect(undoJournal(saved, batch!, 'Я', 300).done).toBeGreaterThan(0);
    const f = saved.files['Map.json']!;
    expect([f.k0!.target, f.k1!.target, f.k2!.target]).toEqual(['а', 'б', 'в']);
  });

  it('nothing changes when the game is the same, and no snapshot means nothing to line up', () => {
    const old = units('A', 'B');
    const saved = project(old, { k0: ent('а', 'A') });
    expect(planIngest(saved.snapshot, [{ name: 'Map.json', units: units('A', 'B') }], saved.files, 1).changes).toEqual([]);
    expect(planIngest(undefined, [{ name: 'Map.json', units: units('Z') }], saved.files, 1).changes).toEqual([]);
  });

  it('files that differ too much are left as they were and named', () => {
    const a = Array.from({ length: 800 }, (_, i) => 'old ' + i), b = Array.from({ length: 800 }, (_, i) => 'new ' + i);
    const saved = project(units(...a), { k0: ent('x', 'old 0') });
    const plan = planIngest(saved.snapshot, [{ name: 'Map.json', units: units(...b) }], saved.files, 1);
    expect(plan.changes).toEqual([]);
    expect(plan.report.unaligned).toEqual(['Map.json']);
    expect(ingestNote(plan.report)).toMatch(/не зіставлено/);
  });

  it('parked translations never count as rows and survive another update', () => {
    const saved = project(units('One', 'Two'), { k0: ent('Один', 'One'), k1: ent('Два', 'Two') });
    ingest(saved, 'Map.json', units('One'));
    const again = ingest(saved, 'Map.json', units('One', 'Extra'), 200);
    expect(again.report.added.map(a => a.source)).toEqual(['Extra']);
    expect(Object.keys(saved.files['Map.json']!).filter(isParked).length).toBe(1);
  });
});
