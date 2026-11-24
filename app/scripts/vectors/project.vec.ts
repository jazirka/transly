import { test } from 'vitest';
import type { Entry, Translations } from '../../src/core/model';
import { DEFAULT_SETTINGS, deserializeChecked, emptyProject, looksLikeProject, mergeProjects, serialize, snapshotOf, statsOf, viewsFromSnapshot } from '../../src/core/project';
import type { SavedProject } from '../../src/core/project';
import { branchNames, checkoutBranch, createBranch, deleteBranch, nameProblem, renameBranch, rowsIn, switchBranch } from '../../src/core/branches';
import { clampClock, repairProject } from '../../src/core/validate';
import { pct, progressOf, rowState, sumProgress } from '../../src/core/progress';
import { genEntry, time } from './entrygen';
import { rng, text, writeVectors } from './util';
import type { Rng } from './util';

const FILES = ['F0.json', 'Map1.json'], KEYS = ['k0', 'k1', 'k2', 'k3'];
const NAMES = ['Гра', 'game', 'Гра ', 'Ґ'];
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const tryRun = <T>(f: () => T): { ok: T } | { error: string } => { try { return { ok: f() }; } catch (e) { return { error: (e as Error).message }; } };

function genTranslations(r: Rng): Translations {
  const t: Translations = {};
  for (const k of KEYS) if (r.chance(0.6)) t[k] = genEntry(r);
  return t;
}
function genFiles(r: Rng): Record<string, Translations> {
  const f: Record<string, Translations> = {};
  for (const n of FILES) if (r.chance(0.8)) f[n] = genTranslations(r);
  return f;
}
const mtRec = (r: Rng, mk: (i: number) => object) => Object.fromEntries(Array.from({ length: r.int(4) }, (_, i) => [`${r.pick(['a', 'b', 'c'])}${i % 2}`, { ...mk(i), mt: time(r) }]));

function genProject(r: Rng): SavedProject {
  const p: Record<string, unknown> = {
    version: 1, ...(r.chance(0.8) ? { schema: r.pick([1, 2, 3]) } : {}), name: r.pick(NAMES), sourceLang: 'en', targetLang: 'uk', resetEpoch: r.pick([0, 0, 0, 2, 50, 500, 1000]), files: genFiles(r),
    memory: Array.from({ length: r.int(4) }, () => ({ s: r.pick(['a', 'b', text(r)]), t: r.pick(['x', 'y']), mt: time(r) })),
    terms: Array.from({ length: r.int(4) }, () => ({ en: r.pick(['Sword', 'sword', 'Hero', 'x']), uk: r.pick(['меч', 'герой']), mt: time(r), ...(r.chance(0.3) ? { alt: ['a'] } : {}) })),
    settings: { ...(r.chance(0.7) ? DEFAULT_SETTINGS : {}), ...(r.chance(0.4) ? { who: r.pick(['A', 'B']) } : {}), pluginsAsked: r.chance(0.3), ...(r.chance(0.2) ? { hue: 100 } : {}) },
  };
  if (r.chance(0.5)) p.settingsAt = time(r);
  if (r.chance(0.5)) p.snapshot = { F0: [{ key: 'k0', source: r.pick(['a', 'b']), speaker: '', kind: 'dialogue', context: '' }] };
  if (r.chance(0.3)) p.reference = { name: r.pick(['x', 'y']), files: {} };
  if (r.chance(0.4)) p.labels = Object.fromEntries(FILES.filter(() => r.chance(0.7)).map(f => [f, r.pick(['Лес', 'Дім', 'Ґанок'])]));
  if (r.chance(0.3)) p.sysNames = { switches: [r.pick(['a', 'b'])], currency: r.pick(['G', 'g']) };
  if (r.chance(0.4)) p.speakers = mtRec(r, () => ({ name: r.pick(['Ann', 'Bob']) }));
  if (r.chance(0.5)) p.assetsRev = r.pick([0, 1, 2, 5]);
  if (r.chance(0.3)) p.deletedTerms = { sword: time(r), hero: time(r) };
  if (r.chance(0.3)) p.groups = mtRec(r, i => ({ id: `g${i}`, name: r.pick(['G1', 'G2']), at: 1 }));
  if (r.chance(0.3)) p.members = mtRec(r, () => ({ g: r.pick(['g0', 'g1', '']) }));
  if (r.chance(0.3)) p.links = mtRec(r, () => ({ k: r.pick(['u', 'm']), ref: 'r', h: 'h' }));
  if (r.chance(0.3)) p.stamps = { copy: { mt: time(r), how: 'x' } };
  if (r.chance(0.3)) p.futureField = r.pick([mtRec(r, () => ({ v: r.int(9) })), { plain: r.int(5) }, 7, 'str']);
  if (r.chance(0.35)) {
    p.branch = r.pick(['dev', 'alt']);
    p.branches = { main: { at: 0, files: genFiles(r), ...(r.chance(0.5) ? { base: genFiles(r) } : {}) }, [r.pick(['dev', 'alt', 'x'])]: { from: 'main', at: time(r) + 1, ...(r.chance(0.5) ? { base: genFiles(r) } : {}), ...(r.chance(0.5) ? { files: genFiles(r) } : {}) } };
    if (r.chance(0.3)) p.goneBranches = { [r.pick(['dev', 'alt', 'x'])]: time(r) };
  } else if (r.chance(0.2)) p.branches = { dev: { from: 'main', at: time(r) + 1, files: genFiles(r), base: genFiles(r) } };
  return p as unknown as SavedProject;
}
/** Копія з правками: зі спільним і різним, щоб злиття мало що зливати. */
function sibling(r: Rng, a: SavedProject): SavedProject {
  const b = clone(a) as unknown as Record<string, unknown>;
  const q = genProject(r) as unknown as Record<string, unknown>;
  for (const k of Object.keys(q)) if (r.chance(0.35) && k !== 'version') b[k] = q[k];
  if (r.chance(0.6)) b.files = Object.fromEntries(Object.entries(a.files).map(([n, t]) => [n, Object.fromEntries(Object.entries(t).map(([k, e]) => [k, r.chance(0.5) ? genEntry(r) : { ...(e as Entry), mt: time(r) }]))]));
  return b as unknown as SavedProject;
}

function damage(r: Rng, raw: Record<string, unknown>): void {
  const bad = (): unknown => r.pick([5, 'x', null, true, [], {}, -1, 7]);
  const files = raw.files as Record<string, Record<string, Record<string, unknown>>>;
  const fn = Object.keys(files);
  for (let n = 1 + r.int(4); n > 0; n--) {
    const roll = r.int(14);
    const f = fn.length ? files[r.pick(fn)] : undefined;
    const ks = f ? Object.keys(f) : [];
    const e0 = f && ks.length ? f[r.pick(ks)] : undefined;
    const e = e0 && typeof e0 === 'object' && !Array.isArray(e0) ? e0 : undefined;
    if (roll === 0 && e) e.target = bad();
    else if (roll === 1 && e) e.status = bad();
    else if (roll === 2 && e) e.mt = bad();
    else if (roll === 3 && e) e.comments = r.pick([bad(), [bad(), { at: 1, text: 'x' }, { at: 1, text: 2 }], [{ at: 1, text: 'x', who: 5, id: 7, res: 3, ed: 'x', del: 1 }]]);
    else if (roll === 4 && e) e.votes = r.pick([bad(), [{ at: 1, who: 'a', on: 'p', v: 2 }, { at: 1, who: 'a', on: 'p', v: 1 }]]);
    else if (roll === 5 && e) e.history = r.pick([bad(), [{ at: 1, what: 'x', text: 'y', who: 5, batch: 3, prev: { target: 5 } }, { at: 1, what: 'x', text: 'y', prev: { target: 'a', status: 'zz', returned: 4 } }, bad()]]);
    else if (roll === 6 && f) f[r.pick(['kx', 'ky'])] = bad() as never;
    else if (roll === 7) raw.settings = r.pick([bad(), { tolerancePct: 'x', who: 5, hue: 400, nameFrom: 'z', title: 'x'.repeat(100), pluginSettings: { p: { a: {} } }, linkMode: 'q', wrap: 5, qa: [] }]);
    else if (roll === 8) raw.memory = r.pick([bad(), [{ s: 'a', t: 'b' }, { s: 1, t: 'b' }, bad()]]);
    else if (roll === 9) raw.terms = r.pick([bad(), [{ en: 'a', uk: 'b', alt: 5, qa: 1, gender: 'z' }, { en: 1, uk: 'b' }, bad()]]);
    else if (roll === 10) raw.groups = r.pick([bad(), { g: { name: 'a', mt: 1, color: 'red' }, h: { name: 5, mt: 1 }, i: { name: 'a', mt: 1, color: '#abc' } }]);
    else if (roll === 11) raw.branches = r.pick([bad(), { a: { at: 'x' }, b: { at: 1, from: 5, files: 5, base: { F: { k: { target: 5 } } } } }]);
    else if (roll === 12) raw.snapshot = r.pick([bad(), { a: 5, b: [{ key: 'k', source: 's' }, { key: 1 }] }]);
    else raw.resetEpoch = bad();
  }
}

test('export project vectors', () => {
  const r = rng(606);
  const out: Record<string, { input: unknown; output: unknown }[]> = {};
  const add = (name: string, input: unknown, output: unknown) => (out[name] ??= []).push({ input, output });

  add('empty', null, emptyProject('Гра'));
  add('empty', null, emptyProject('x', 'ja', 'de'));
  add('defaults', null, DEFAULT_SETTINGS);

  // розбір: правильні, пошкоджені й безнадійні тексти
  for (const t of ['', 'x', '[]', 'null', '5', '{}', '{"version":2}', '{"version":"x"}', '{"version":1}', '{"version":1,"name":5,"files":{}}', '{"version":1,"name":"a","files":[]}', '{"version":1,"name":"a","files":null}', '{"version":1,"name":"a","files":{}}']) {
    add('deserialize', { text: t, now: null }, tryRun(() => deserializeChecked(t)));
  }
  for (let i = 0; i < 90; i++) {
    const p = genProject(r) as unknown as Record<string, unknown>;
    if (r.chance(0.5)) damage(r, p);
    if (r.chance(0.2)) delete p.sourceLang;
    if (r.chance(0.2)) p.settingsAt = 0;
    const now = r.chance(0.5) ? r.pick([100, 1000, 1700000000000]) : undefined;
    if (now && r.chance(0.6)) { p.resetEpoch = now + 10 * 24 * 3600 * 1000; (p.files as Record<string, Translations>)[FILES[0]!] = { k0: { ...genEntry(r), mt: now + 5 * 24 * 3600 * 1000, ignAt: now + 3e9, comments: [{ who: 'a', at: now + 9e9, text: 'x', ed: now + 9e9, res: { who: 'a', at: now + 9e9 } }], votes: [{ who: 'a', on: 'p', v: 1, at: now + 9e9 }], drops: [{ who: 'a', on: 'p', at: now + 9e9 }], history: [{ at: now + 9e9, who: 'a', what: 'x', text: 'y' }] } }; }
    const text = JSON.stringify(p);
    add('deserialize', { text, now: now ?? null }, tryRun(() => deserializeChecked(text, now)));
  }
  for (let i = 0; i < 60; i++) {
    const p = genProject(r) as unknown as Record<string, unknown>;
    damage(r, p);
    const raw = clone(p), now = r.pick([100, 1700000000000]);
    const notes = repairProject(raw);
    const raw2 = clone(raw), n = clampClock(raw2, now);
    add('repair', { raw: p, now }, { notes, raw, clamped: n, raw2 });
  }

  for (const t of ['{"version":1,"sourceLang":"en"}', '  {"a":1}', '[]', '{"x":1,"sourceLang":"a","targetLang":"b","resetEpoch":0,"files":{}}', '{"version":1 ,"sourceLang" :"en"}', '{"version":10,"sourceLang":"en"}', '{"version":1я,"sourceLang":"en"}', ' {"version":1,"sourceLang":"u"}', '']) add('looks', t, looksLikeProject(t));
  for (let i = 0; i < 20; i++) { const t = serialize(genProject(r)); add('looks', t, looksLikeProject(t)); }

  // допоміжне
  for (let i = 0; i < 60; i++) {
    const p = genProject(r), views = viewsFromSnapshot(p);
    add('snapshot', p, { views, snap: snapshotOf(views), serialized: serialize(p) });
  }
  for (let i = 0; i < 80; i++) {
    const units = KEYS.map(key => ({ key, source: 's', speaker: '', kind: 'dialogue' as const, context: '' })), entries = genTranslations(r);
    for (const e of Object.values(entries)) if (r.chance(0.2)) e.target = r.pick([' ', ' ', '']);
    add('stats', { units, entries }, { stats: statsOf(units, entries), progress: progressOf(units, entries), states: KEYS.map(k => rowState(entries[k])) });
  }
  for (const [n, t] of [[0, 0], [0, 5], [1, 1000], [995, 1000], [1000, 1000], [3, 3], [50, 100], [7, 9], [1, 0]] as const) add('pct', { n, t }, pct(n, t));
  add('sum', null, sumProgress([progressOf([], {}), { total: 3, untranslated: 1, draft: 1, sent: 1, approved: 0, translated: 2 }, { total: 2, untranslated: 0, draft: 0, sent: 1, approved: 1, translated: 2 }]));

  // злиття проєктів
  for (let i = 0; i < 45; i++) {
    const a = genProject(r), b = r.chance(0.8) ? sibling(r, a) : genProject(r), since = r.pick([0, 1, 100]);
    add('mergeProjects', { a, b, since }, mergeProjects(a, b, since));
  }

  // гілки
  for (let i = 0; i < 40; i++) {
    const p = genProject(r), name = r.pick(['dev', ' alt ', 'main', 'Main', 'x'.repeat(41), '', 'a\u0001b', 'new', 'alt']), now = time(r) + 1, from = r.pick(['dev', 'main', 'alt']);
    add('branches', { p, name, now, from }, {
      names: branchNames(p), problem: nameProblem(p, name), problemExcept: nameProblem(p, name, 'dev'), rows: ['main', 'dev', 'alt'].map(n => rowsIn(p, n)),
      create: tryRun(() => createBranch(p, name, now)), switch: tryRun(() => switchBranch(p, name)), checkout: checkoutBranch(p, name),
      rename: tryRun(() => renameBranch(p, from, name)), remove: tryRun(() => deleteBranch(p, name, now)),
    });
  }
  writeVectors('project', out);
});
