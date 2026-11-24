import { test } from 'vitest';
import type { Entry, Unit } from '../../src/core/model';
import type { FileView, SavedProject } from '../../src/core/project';
import { rowsWithTerm, termRowsNote } from '../../src/core/followups';
import { clampPage, DEFAULT_PAGES, normalizePages, normalizePlaces, pageCount, pageOfIndex, pageOfKey, pageRange, rememberPlace } from '../../src/core/pages';
import type { Place } from '../../src/core/pages';
import { preflight, preflightLines } from '../../src/core/preflight';
import { contrastOf, hueOfName, oklchRgb, themeHue, themeTokens } from '../../src/core/theme';
import { rng, writeVectors } from './util';
import type { Rng } from './util';

const TARGETS = ['', ' ', 'Привіт', 'Привіт!', '\\C[2]Привіт', 'Hello', 'Меч у піхвах', 'мечі', 'x', 'Це дуже довгий переклад, що значно перевищує довжину оригіналу, щоб викликати примітку про довжину'];
const SOURCES = ['Hello', 'Hello!', '\\C[2]Hello\\C[0]', 'Take the sword', 'The swords are here', 'Long text here to be translated now', 'Sword', 'ab'];

function genEntry(r: Rng, src: string): Entry {
  return { target: r.pick(TARGETS), status: r.pick(['new', 'draft', 'done', 'appr', 'weird'] as never[]), mt: 1000, ...(r.chance(0.5) ? { src: r.chance(0.7) ? src : 'other' } : {}), ...(r.chance(0.1) ? { ign: ['len'] } : {}) };
}

test('export misc3 vectors', () => {
  const r = rng(112233);
  const out: Record<string, { input: unknown; output: unknown }[]> = {};
  const add = (name: string, input: unknown, output: unknown) => (out[name] ??= []).push({ input, output });

  for (let i = 0; i < 150; i++) {
    const views: FileView[] = [];
    const files: SavedProject['files'] = {};
    for (const name of ['a.json', 'b.json']) {
      const units: Unit[] = Array.from({ length: r.int(8) }, (_, k) => ({ key: `${name}:${k}`, source: r.pick(SOURCES), speaker: '', kind: r.pick(['dialogue', 'name'] as const), context: '' }));
      views.push({ name, units });
      if (r.chance(0.9)) { const rows: Record<string, Entry> = {}; for (const u of units) if (r.chance(0.8)) rows[u.key] = genEntry(r, u.source); files[name] = rows; }
    }
    const terms = r.chance(0.5) ? [{ en: 'Sword', uk: 'Меч', mt: 1 }] : [];
    const qa = { tolerancePct: 25, terms, ...(r.chance(0.3) ? { lineLimit: 30 } : {}) };
    const saved = { files } as unknown as SavedProject;
    const p = preflight(views, saved, qa);
    add('preflight', { views, files, qa }, { p, lines: preflightLines(p), linesDrafts: preflightLines(p, true) });
    const term = r.pick([{ en: 'sword', uk: 'меч', alt: ['клинок'] }, { en: ' ', uk: 'x' }, { en: 'sword', uk: ' ' }, { en: 'Take the sword', uk: 'Бери меч' }, { en: 'hello', uk: 'привіт' }]);
    const tr = rowsWithTerm(views, saved, term);
    add('followups', { views, files, term }, { tr, note: termRowsNote(term.en, tr), empty: termRowsNote('x', { lacking: [], waiting: [] }) });
  }

  // pages
  for (let i = 0; i < 300; i++) {
    const raw = r.pick([null, undefined, 5, 'x', {}, { mode: 'flow' }, { mode: 'bad', size: 100 }, { size: 50.5 }, { size: 200, remember: false }, { mode: 'off', size: '25', remember: 'yes' }, [1]]);
    add('normalizePages', raw ?? null, normalizePages(raw));
    const total = r.pick([0, 1, 49, 50, 51, 100, 1000, -5]), size = r.pick([1, 25, 50, 100, 0, -3, 200]), page = r.pick([0, 1, 2, -1, 99, 1.7, 1e9]);
    add('pageMath', { total, size, page }, { count: pageCount(total, size), clamp: clampPage(page, total, size), ofIndex: pageOfIndex(page, size), range: pageRange(page, total, size) });
    const keys = Array.from({ length: r.int(150) }, (_, k) => `k${k}`);
    const key = r.pick([null, undefined, '', 'k0', 'k49', 'k50', 'k149', 'zz']);
    add('pageOfKey', { keys, key: key ?? null, size }, pageOfKey(keys, key, size));
  }
  DEFAULT_PAGES.size;
  for (let i = 0; i < 100; i++) {
    let places: Record<string, Place> = {};
    const n = r.pick([0, 5, 130, 200]);
    const ops: { id: string; place: Place }[] = [];
    for (let k = 0; k < n; k++) { const o = { id: `f${r.int(150)}:all`, place: { page: r.int(20), ...(r.chance(0.5) ? { key: `k${r.int(9)}` } : {}), ...(r.chance(0.5) ? { top: r.int(500) } : {}) } }; ops.push(o); places = rememberPlace(places, o.id, o.place); }
    add('places', ops, { places, order: Object.keys(places) });
    const raw = { a: { page: 2.7, key: 'k', top: 5 }, b: { page: -1 }, c: { page: 'x' }, d: null, e: 5, f: { page: 0, top: -3, key: 5 }, g: { page: 1e3, top: 1.5 }, h: { page: NaN } };
    if (i === 0) add('normalizePlaces', JSON.parse(JSON.stringify(raw)), normalizePlaces(raw));
  }
  add('normalizePlaces', null, normalizePlaces(null));
  add('normalizePlaces', [1], normalizePlaces([1]));

  // theme
  for (let h = 0; h < 360; h += 1) add('theme', h, { tokens: themeTokens(h), rgb: oklchRgb(0.6, 0.2, h) });
  for (const n of ['', 'a', 'Моя гра', ' My Game ', 'The Lord of the Rings', '😀', 'x'.repeat(200), 'Ґанок', 'ß', 'İ']) add('hueOfName', n, hueOfName(n));
  for (const [n, c] of [['x', undefined], ['x', 200], ['x', 200.5], ['x', 359.6], ['x', 360], ['x', -1], ['x', 'red'], ['x', NaN], ['x', null], ['x', 0]] as const) add('themeHue', { n, c: c === undefined ? null : Number.isNaN(c) ? 'nan' : c }, themeHue(n, c));
  for (const [a, b] of [['#ffffff', '#000000'], ['#123456', '#ffffff'], ['#abcdef', '#fedcba'], ['#000000', '#000000']]) add('contrast', [a, b], contrastOf(a!, b!));
  writeVectors('misc3', out);
});
