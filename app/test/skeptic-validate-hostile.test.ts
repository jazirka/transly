import { describe, expect, it } from 'vitest';
import { clampClock, deserialize, deserializeChecked, emptyProject, looksLikeProject, repairProject, serialize } from '../src/core';

const base = (): Record<string, unknown> => JSON.parse(serialize(emptyProject('P')));
const load = (raw: Record<string, unknown>) => deserializeChecked(JSON.stringify(raw));

describe('a project file from outside: shapes the existing tests never feed in', () => {
  it('comments with wrong shapes are dropped or repaired field by field', () => {
    const raw = base();
    raw.files = { 'M.json': { a: { target: 't', status: 'draft', mt: 1, comments: [
      { who: 'x', at: 1, text: 'ok' }, 5, { who: 'y', at: 'late', text: 'bad at' }, { who: 'z', at: 2, text: 7 },
      { at: 3, text: 'no who', id: 5, re: 6, ed: 'x', del: 'yes', res: { who: 1, at: 2 } },
      { who: 'k', at: 4, text: 'keeps', id: 'c1', re: 'c0', ed: 9, del: true, res: { who: 'r', at: 5, open: true } },
    ] } } };
    const { project, notes } = load(raw);
    const c = project.files['M.json']!.a!.comments!;
    expect(c.map(x => x.text)).toEqual(['ok', 'no who', 'keeps']);
    expect(c[1]).toEqual({ who: '', at: 3, text: 'no who' });
    expect(c[2]).toEqual({ who: 'k', at: 4, text: 'keeps', id: 'c1', re: 'c0', ed: 9, del: true, res: { who: 'r', at: 5, open: true } });
    expect(notes.join(' ')).toMatch(/відкинуто непридатних записів/);
  });

  it('history items with wrong shapes are dropped or repaired field by field', () => {
    const raw = base();
    raw.files = { 'M.json': { a: { target: 't', status: 'draft', mt: 1, history: [
      { at: 1, who: 'a', what: 'w', text: 't' }, { at: 1, who: 'a', what: 'w' }, { at: 'x', who: 'a', what: 'w', text: 't' }, { at: 1, who: 'a', text: 't' },
      { at: 2, who: 9, what: 'w', text: 't', batch: 5, prev: { target: 3 } },
      { at: 3, who: 'a', what: 'w', text: 't', batch: 'b:1', prev: { target: 'old', status: 'weird', returned: 'yes' } },
    ] } } };
    const h = load(raw).project.files['M.json']!.a!.history!;
    expect(h).toHaveLength(3);
    expect(h[1]).toEqual({ at: 2, who: '', what: 'w', text: 't' });
    expect(h[2]).toEqual({ at: 3, who: 'a', what: 'w', text: 't', batch: 'b:1', prev: { target: 'old', status: 'new' } });
  });

  it('row fields of the wrong type are removed and the row is counted as repaired', () => {
    const raw = base();
    raw.files = { 'M.json': { a: { target: 't', status: 'done', mt: 1, src: 5, orig: {}, returned: 'yes', ign: 'len', ignAt: 'now' } } };
    const { project, notes } = load(raw);
    expect(project.files['M.json']!.a).toEqual({ target: 't', status: 'done', mt: 1 });
    expect(notes.join(' ')).toMatch(/виправлено рядків із неправильними даними: 1/);
  });

  it('top-level fields of the wrong type are reset or removed', () => {
    const raw = base();
    Object.assign(raw, { resetEpoch: 'x', settingsAt: 'x', assetsRev: 'x', memory: 'x', terms: { en: 'a' }, deletedTerms: { a: 'x', b: 5 }, speakers: { s1: { name: 5, mt: 1 }, s2: { name: 'ok', mt: 1 } },
      snapshot: { 'M.json': 'x', 'N.json': [{ key: 'k', source: 's' }, 5, { key: 1, source: 's' }] } });
    const p = load(raw).project;
    expect(p.resetEpoch).toBe(0);
    expect(p.settingsAt).toBeUndefined();
    expect(p.assetsRev).toBeUndefined();
    expect(p.memory).toEqual([]);
    expect(p.terms).toEqual([]);
    expect(p.deletedTerms).toEqual({ b: 5 });
    expect(Object.keys(p.speakers!)).toEqual(['s2']);
    expect(Object.keys(p.snapshot!)).toEqual(['N.json']);
    expect(p.snapshot!['N.json']).toHaveLength(1);
    raw.snapshot = 'x';
    expect(load(raw).project.snapshot).toBeUndefined();
  });

  it('terms keep only well-typed optional fields, and every kind of dropped record is counted', () => {
    const raw = base();
    raw.terms = [{ en: 'a', uk: 'б', mt: 'x', alt: [1], qa: 'no' }, { en: 'c' }];
    raw.memory = [{ s: 'a', t: 'b' }, { s: 1 }, 'x', null];
    const { project, notes } = load(raw);
    expect(project.terms).toEqual([{ en: 'a', uk: 'б', mt: 0 }]);
    expect(project.memory).toEqual([{ s: 'a', t: 'b', mt: 0 }]);
    expect(notes.join(' ')).toMatch(/відкинуто непридатних записів/);
  });

  it('whatever is not a project at all is refused with a clear message, never half-loaded', () => {
    for (const text of ['null', '[]', '5', '"x"']) expect(() => deserialize(text), text).toThrow(/пошкоджено/);
    expect(() => deserialize('{not json')).toThrow(/не JSON/);
    expect(() => deserialize(JSON.stringify({ ...base(), version: 2 }))).toThrow(/Непідтримувана версія/);
    for (const files of [[], null, 'x', 5]) expect(() => deserialize(JSON.stringify({ ...base(), files })), JSON.stringify(files)).toThrow(/пошкоджено/);
    const noName = base(); delete noName.name;
    expect(() => deserialize(JSON.stringify(noName))).toThrow(/пошкоджено/);
  });

  it('a file is recognised as a project only when it really is one', () => {
    expect(looksLikeProject(serialize(emptyProject('P')))).toBe(true);
    expect(looksLikeProject('  \n' + serialize(emptyProject('P')))).toBe(true);
    expect(looksLikeProject(JSON.stringify([null, { id: 1, name: 'Potion', description: 'x' }]))).toBe(false);
    expect(looksLikeProject(JSON.stringify({ version: 1, name: 'x' }))).toBe(false);
    expect(looksLikeProject(JSON.stringify({ displayName: 'Map', events: [] }))).toBe(false);
    expect(looksLikeProject('x'.repeat(100) + '{"version":1,"sourceLang":"en"}')).toBe(false);
    const late = '{"files":{},"targetLang":"uk","sourceLang":"en","resetEpoch":0,"name":"P","version":2}';
    expect(looksLikeProject(late)).toBe(true);
    expect(looksLikeProject('{"files":{},"targetLang":"uk","resetEpoch":0}')).toBe(false);
  });

  it('repairProject on an already clean project changes nothing and reports nothing', () => {
    const o = base();
    expect(repairProject(o)).toEqual([]);
    expect(o).toEqual(base());
  });
});

describe('future clocks are pulled back everywhere a stamp lives', () => {
  const NOW = 1_700_000_000_000, FUT = NOW + 400 * 24 * 3600 * 1000;
  it('history, comment edits and resolutions, ignore stamps, memory, terms, speakers, groups, members and deleted terms', () => {
    const o: Record<string, unknown> = {
      resetEpoch: FUT, settingsAt: FUT, assetsRev: FUT,
      files: { 'M.json': { a: { target: 't', status: 'done', mt: FUT, ignAt: FUT,
        comments: [{ who: 'a', at: FUT, ed: FUT, text: 'c', res: { who: 'a', at: FUT } }], history: [{ at: FUT, who: 'a', what: 'w', text: 't' }] } } },
      memory: [{ s: 'a', t: 'b', mt: FUT }], terms: [{ en: 'a', uk: 'б', mt: FUT }],
      speakers: { s: { name: 'n', mt: FUT } }, groups: { g: { id: 'g', name: 'G', at: FUT, mt: FUT } }, members: { m: { g: 'g', mt: FUT } }, deletedTerms: { a: FUT, b: NOW - 5 },
    };
    expect(clampClock(o, NOW)).toBe(16);
    const a = (o.files as any)['M.json'].a;
    expect([a.mt, a.ignAt, a.comments[0].at, a.comments[0].ed, a.comments[0].res.at, a.history[0].at]).toEqual(Array(6).fill(NOW));
    expect([o.resetEpoch, o.settingsAt, o.assetsRev]).toEqual([NOW, NOW, NOW]);
    expect((o.memory as any)[0].mt).toBe(NOW);
    expect((o.terms as any)[0].mt).toBe(NOW);
    expect((o.speakers as any).s.mt).toBe(NOW);
    expect((o.groups as any).g).toMatchObject({ at: NOW, mt: NOW });
    expect((o.members as any).m.mt).toBe(NOW);
    expect(o.deletedTerms).toEqual({ a: NOW, b: NOW - 5 });
  });
  it('a stamp exactly one day ahead is honest; one millisecond more is not', () => {
    const DAY = 24 * 3600 * 1000;
    const o: Record<string, unknown> = { files: { 'M.json': { a: { target: 't', status: 'done', mt: NOW + DAY }, b: { target: 't', status: 'done', mt: NOW + DAY + 1 } } } };
    expect(clampClock(o, NOW)).toBe(1);
    expect((o.files as any)['M.json'].a.mt).toBe(NOW + DAY);
    expect((o.files as any)['M.json'].b.mt).toBe(NOW);
  });
});
