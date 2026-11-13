import { describe, expect, it } from 'vitest';
import { clampClock, deserialize, deserializeChecked, emptyProject, mergeEntry, mergeProjects, repairProject, serialize, statsOf } from '../src/core';
import type { Entry, SavedProject } from '../src/core';

const base = (): Record<string, unknown> => JSON.parse(serialize(emptyProject('P')));

describe('a project from outside is repaired, not trusted', () => {
  it('one row with a number as text no longer poisons the project (it used to fail every launch)', () => {
    const raw = base();
    raw.files = { 'Map001.json': { a: { target: 5, status: 'draft', mt: 1 }, b: { target: 'ok', status: 'draft', mt: 2 } } };
    const { project, notes } = deserializeChecked(JSON.stringify(raw));
    expect(project.files['Map001.json']!.a!.target).toBe('5');
    expect(notes.join(' ')).toMatch(/виправлено рядків/);
    // what used to throw "t.trim is not a function"
    expect(() => statsOf([{ key: 'a', source: 'x', kind: 'dialogue' } as never], project.files['Map001.json']!)).not.toThrow();
    expect(project.files['Map001.json']!.a!.target.trim()).toBe('5');
  });

  it('rows that cannot mean anything are dropped, with a note', () => {
    const raw = base();
    raw.files = { 'M.json': { a: 7, b: null, c: { target: { x: 1 }, status: 'draft', mt: 1 }, d: { target: 'ok', status: 'draft', mt: 1 } }, 'Bad.json': 'x' };
    const { project, notes } = deserializeChecked(JSON.stringify(raw));
    expect(Object.keys(project.files['M.json']!)).toEqual(['d']);
    expect(project.files['Bad.json']).toBeUndefined();
    expect(notes.join(' ')).toMatch(/відкинуто/);
  });

  it('an unknown status becomes a draft (or "new" when there is no text), a bad clock becomes 0', () => {
    const raw = base();
    raw.files = { 'M.json': { a: { target: 'text', status: 'x" onmouseover="1', mt: 'soon' }, b: { target: '', status: 7, mt: 1 } } };
    const p = deserialize(JSON.stringify(raw));
    expect(p.files['M.json']!.a).toMatchObject({ status: 'draft', mt: 0 });
    expect(p.files['M.json']!.b!.status).toBe('new');
  });

  it('settings with wrong types fall back to the defaults', () => {
    const raw = base();
    raw.settings = { tolerancePct: '25"><img>', who: 5, blockErrors: 'yes', pluginCommands: 'GabText', lineLimit: NaN, linkMode: 'sometimes' };
    const p = deserialize(JSON.stringify(raw));
    expect(p.settings.tolerancePct).toBe(25);
    expect(p.settings.who).toBe('Ви');
    expect(p.settings.blockErrors).toBe(true);
    expect(p.settings.pluginCommands).toEqual([]);
    expect(p.settings.linkMode).toBeUndefined();
    raw.settings = 'text';
    expect(deserialize(JSON.stringify(raw)).settings.who).toBe('Ви');
  });

  it('a group colour that is not a plain hex colour is dropped', () => {
    const raw = base();
    raw.groups = { g1: { id: 'g1', name: 'G', color: 'red;background:url(http://x)', at: 1, mt: 1 }, g2: { id: 'g2', name: 'H', color: '#aabbcc', at: 1, mt: 1 }, g3: 'x' };
    const p = deserialize(JSON.stringify(raw));
    expect(p.groups!.g1!.color).toBeUndefined();
    expect(p.groups!.g2!.color).toBe('#aabbcc');
    expect(p.groups!.g3).toBeUndefined();
  });

  it('comments, history, memory and terms with wrong shapes are cleaned', () => {
    const raw = base();
    raw.files = { 'M.json': { a: { target: 't', status: 'draft', mt: 1, comments: 'x', history: [{ at: 1, who: 'a', what: 'w', text: 't' }, 5], ign: [1, 2] } } };
    raw.memory = [{ s: 'a', t: 'b', mt: 1 }, { s: 1, t: 'b' }, 'x'];
    raw.terms = [{ en: 'storm', uk: 'буря', mt: 2 }, { en: 'x' }, null];
    const p = deserialize(JSON.stringify(raw));
    const e = p.files['M.json']!.a!;
    expect(e.comments).toBeUndefined();
    expect(e.history).toHaveLength(1);
    expect(e.ign).toBeUndefined();
    expect(p.memory).toHaveLength(1);
    expect(p.terms).toHaveLength(1);
  });

  it('a clean project passes through unchanged and with no notes', () => {
    const p = emptyProject('P'); p.files['M.json'] = { a: { target: 'ok', status: 'done', mt: 3, ign: ['len'], ignAt: 4 } };
    const r = deserializeChecked(serialize(p), 10_000);
    expect(r.notes).toEqual([]);
    expect(r.project).toEqual(p);
  });

  it('repairProject reports nothing for data that is fine', () => {
    expect(repairProject(base())).toEqual([]);
  });
});

describe('clocks from the future', () => {
  const NOW = 1_700_000_000_000, YEAR = 365 * 24 * 3600 * 1000;

  it('stamps more than a day ahead are pulled back to now, honest ones stay', () => {
    const raw = base();
    raw.resetEpoch = NOW + YEAR;
    raw.files = { 'M.json': { a: { target: 't', status: 'draft', mt: NOW + YEAR, comments: [{ who: 'x', at: NOW + YEAR, text: 'c' }] }, b: { target: 't', status: 'draft', mt: NOW + 1000 } } };
    const n = clampClock(raw, NOW);
    expect(n).toBe(3);
    const f = raw.files as Record<string, Record<string, Entry>>;
    expect(f['M.json']!.a!.mt).toBe(NOW);
    expect(f['M.json']!.b!.mt).toBe(NOW + 1000);
    expect(raw.resetEpoch).toBe(NOW);
  });

  it('a device with a fast clock cannot erase what another device wrote after its reset', () => {
    // device F (clock a year ahead) resets; device N (honest clock) writes a minute later
    const f = emptyProject('P'); f.resetEpoch = NOW + YEAR;
    const n = emptyProject('P'); n.files['M.json'] = { a: { target: 'мій текст', status: 'draft', mt: NOW + 60_000 } };
    const fromF = deserialize(serialize(f), NOW);           // as it arrives at N
    const merged = mergeProjects(n, fromF).project;
    expect(merged.files['M.json']!.a!.target).toBe('мій текст');
  });
});

/* ---------- the laws of the merge, on random data with many equal clocks ---------- */

const rng = (seed: number): (() => number) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = <T>(r: () => number, xs: T[]): T => xs[Math.floor(r() * xs.length)]!;

function randomEntry(r: () => number): Entry {
  const e: Entry = { target: pick(r, ['', 'раз', 'два', 'три']), status: pick(r, ['new', 'draft', 'done', 'appr'] as const), mt: pick(r, [1, 2, 3]) };
  if (r() < 0.3) e.returned = true;
  if (r() < 0.4) { e.ign = ['len', 'term', 'wrap'].filter(() => r() < 0.5); e.ignAt = pick(r, [0, 1, 2]); if (!e.ign.length) delete e.ign; if (!e.ignAt) delete e.ignAt; }
  if (r() < 0.4) e.comments = [{ who: 'a', at: pick(r, [1, 2]), text: pick(r, ['x', 'y']) }];
  if (r() < 0.4) e.history = [{ at: pick(r, [1, 2, 3]), who: 'a', what: pick(r, ['send', 'edit']), text: pick(r, ['x', 'y']) }];
  return e;
}

/** JSON with the keys of every object in order, so that the order a record was built in does not count. */
const stable = (v: unknown): string => JSON.stringify(v, (_k, x: unknown) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) : x));

/** The same row with the lists that are sets sorted, so that the order they happened to be built in does not count. */
const canon = (e: Entry): string => stable({
  ...e, ign: e.ign ? [...e.ign].sort() : undefined,
  comments: e.comments ? [...e.comments].sort((x, y) => stable(x).localeCompare(stable(y))) : undefined,
  history: e.history ? [...e.history].sort((x, y) => stable(x).localeCompare(stable(y))) : undefined,
});

describe('merge laws', () => {
  it('mergeEntry is commutative, also when both sides were changed in the same millisecond', () => {
    const r = rng(1);
    for (let i = 0; i < 3000; i++) {
      const a = randomEntry(r), b = randomEntry(r);
      expect(canon(mergeEntry(a, b))).toBe(canon(mergeEntry(b, a)));
    }
  });

  it('mergeEntry is idempotent', () => {
    const r = rng(2);
    for (let i = 0; i < 2000; i++) { const a = randomEntry(r); expect(canon(mergeEntry(a, a))).toBe(canon(a)); }
  });

  it('mergeEntry is associative', () => {
    const r = rng(3);
    for (let i = 0; i < 3000; i++) {
      const a = randomEntry(r), b = randomEntry(r), c = randomEntry(r);
      expect(canon(mergeEntry(mergeEntry(a, b), c))).toBe(canon(mergeEntry(a, mergeEntry(b, c))));
    }
  });

  const randomProject = (r: () => number): SavedProject => {
    const p = emptyProject('P');
    p.files['M.json'] = Object.fromEntries(['a', 'b', 'c'].filter(() => r() < 0.8).map(k => [k, randomEntry(r)]));
    p.terms = ['storm', 'harbour'].filter(() => r() < 0.7).map(en => ({ en, uk: pick(r, ['буря', 'шторм']), mt: pick(r, [1, 2, 3]) }));
    p.memory = ['x', 'y'].filter(() => r() < 0.5).map(s => ({ s, t: pick(r, ['а', 'б']), mt: pick(r, [1, 2]) }));
    p.speakers = { 'face:A#1': { name: pick(r, ['Ліа', 'Нік']), mt: pick(r, [1, 2]) } };
    if (r() < 0.5) { p.settings = { ...p.settings, who: pick(r, ['Ви', 'Я']) }; p.settingsAt = pick(r, [0, 1, 1]); }
    return p;
  };
  const view = (p: SavedProject): string => stable({
    files: Object.fromEntries(Object.entries(p.files).map(([f, t]) => [f, Object.fromEntries(Object.entries(t).map(([k, e]) => [k, canon(e)]))])),
    terms: [...p.terms].sort((x, y) => x.en.localeCompare(y.en)), memory: [...p.memory].sort((x, y) => (x.s + x.t).localeCompare(y.s + y.t)),
    speakers: p.speakers, settings: p.settings,
  });

  it('mergeProjects is commutative, associative and idempotent on rows, terms, memory, speakers and settings', () => {
    const r = rng(4);
    for (let i = 0; i < 400; i++) {
      const a = randomProject(r), b = randomProject(r), c = randomProject(r);
      const m = (x: SavedProject, y: SavedProject): SavedProject => mergeProjects(x, y).project;
      expect(view(m(a, b))).toBe(view(m(b, a)));
      expect(view(m(m(a, b), c))).toBe(view(m(a, m(b, c))));
      expect(view(m(a, a))).toBe(view(a));
    }
  });
});
