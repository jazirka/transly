import { test } from 'vitest';
import type { Entry, Translations } from '../../src/core/model';
import { BATCH_INFO, batchTitle, batchUndoLabel, commitRows, journalBatches, newBatch, prevOf, recordChange, undoJournal, undoReport } from '../../src/core/journal';
import type { BatchKind, JournalBatch, RowChange } from '../../src/core/journal';
import { planMessage, planNote, planOf, reconcileChanges } from '../../src/core/plan';
import type { FileView } from '../../src/core/project';
import { genEntry, time } from './entrygen';
import { rng, text, writeVectors } from './util';
import type { Rng } from './util';

const KINDS = Object.keys(BATCH_INFO) as BatchKind[];
const BATCHES = ['send:a1', 'edit:b2', 'undo:c3', 'redo:d4', 'approve:e5', 'weird:x', 'nocolon'];
const FILES = ['F0.json', 'F1.json'];
const KEYS = ['k0', 'k1', 'k2', 'k3', 'k4', 'k5'];

/** Підміняє Math.random заданою послідовністю цілих 0..46655 на час виклику `f`. */
function withRands<T>(rands: number[], f: () => T): T {
  const orig = Math.random;
  let i = 0;
  Math.random = () => ((rands[i++] ?? 0) + 0.5) / 46656;
  try { return f(); } finally { Math.random = orig; }
}
const rands = (r: Rng, n = 3): number[] => Array.from({ length: n }, () => r.int(46656));

/** Рядок із історією, де записи мають id дій і `prev`; `mt` то в межах часу останнього запису, то пізніше. */
function genJournalEntry(r: Rng): Entry {
  const e = genEntry(r);
  const n = r.int(6);
  e.history = Array.from({ length: n }, (_, i) => {
    const batch = r.chance(0.8) ? r.pick(BATCHES) : undefined;
    return { at: 10 + i * 5 + r.int(3), who: r.pick(['Анна', 'Богдан']), what: r.pick(['надіслано', 'скасовано: надіслано', 'повторено: вичитано', 'змінено переклад', 'x: y: z']), text: r.pick(['', 'a', text(r)]), ...(batch ? { batch } : {}), ...(r.chance(0.85) ? { prev: { target: r.pick(['', 'old', text(r)]), status: r.pick(['new', 'draft', 'done', 'appr'] as const), ...(r.chance(0.3) ? { returned: true } : {}) } } : {}) };
  });
  if (!n) delete e.history;
  const lastAt = e.history?.[e.history.length - 1]?.at ?? 0;
  e.mt = r.chance(0.75) ? r.int(lastAt + 1) : lastAt + 1 + r.int(5);
  if (r.chance(0.3)) e.orig = 'orig';
  return e;
}
function genProject(r: Rng) {
  const views: FileView[] = FILES.map(name => ({ name, units: KEYS.filter(() => r.chance(0.85)).map(key => ({ key, source: r.pick(['s', 't', text(r)]), speaker: '', kind: 'dialogue' as const, context: '' })) })) as FileView[];
  const files: Record<string, Translations> = {};
  for (const f of FILES) { if (r.chance(0.1)) continue; files[f] = {}; for (const k of KEYS) if (r.chance(0.75)) files[f]![k] = genJournalEntry(r); }
  return { views, files };
}
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

test('export journal vectors', () => {
  const r = rng(555);
  const out: Record<string, { input: unknown; output: unknown }[]> = {};
  const add = (name: string, input: unknown, output: unknown) => (out[name] ??= []).push({ input, output });

  add('kinds', null, { kinds: KINDS, info: Object.fromEntries(KINDS.map(k => [k, { what: BATCH_INFO[k].what, title: BATCH_INFO[k].title('N') }])) });
  for (let i = 0; i < 100; i++) { const e = r.chance(0.85) ? genEntry(r) : undefined; add('prevOf', e ?? null, prevOf(e)); }
  for (let i = 0; i < 100; i++) { const kind = r.pick(KINDS), now = r.pick([0, 1, 35, 1700000000000, 1700000000123]), rs = rands(r, 1); add('newBatch', { kind, now, rands: rs }, withRands(rs, () => newBatch(kind, now))); }

  for (let i = 0; i < 300; i++) {
    const before = r.chance(0.85) ? genEntry(r) : undefined, after = genEntry(r);
    if (before && r.chance(0.4)) after.mt = before.mt - r.int(3);
    if (before && r.chance(0.3)) delete after.history;
    const what = r.pick(['надіслано', 'x']), t = text(r), who = r.pick(['Анна', 'Б']), now = time(r), batch = r.chance(0.7) ? r.pick(BATCHES) : undefined;
    add('recordChange', { before: before ?? null, after, what, text: t, who, now, batch: batch ?? null }, recordChange(before, after, what, t, who, now, batch));
  }

  for (let i = 0; i < 50; i++) {
    const { views, files } = genProject(r);
    const limit = r.pick([30, 30, 1, 2]);
    add('journalBatches', { views, files, limit }, journalBatches(views, { files } as never, limit));
  }

  for (let i = 0; i < 90; i++) {
    const { views, files } = genProject(r);
    const batches = journalBatches(views, { files } as never, 100);
    const id = batches.length && r.chance(0.85) ? r.pick(batches).id : r.pick(BATCHES);
    const who = r.pick(['Анна', 'Б']), now = r.pick([5, 100, 1000, 1700000000000]), rs = rands(r, 1);
    const saved = { files: clone(files) };
    const res = withRands(rs, () => undoJournal(saved as never, id, who, now));
    add('undoJournal', { files, id, who, now, rands: rs }, { res, files: saved.files, report: undoReport(res) });
  }

  for (let i = 0; i < 60; i++) {
    const { files } = genProject(r);
    const changes: RowChange[] = Array.from({ length: r.int(6) }, () => ({ file: r.pick(FILES), key: r.pick(KEYS), next: genEntry(r), text: text(r), ...(r.chance(0.3) ? { what: 'своє' } : {}) }));
    for (const f of FILES) files[f] ??= {};
    const kind = r.pick(KINDS), who = r.pick(['Анна', 'Б']), now = time(r) + 1, what = r.chance(0.3) ? 'власне' : undefined, rs = rands(r, 1);
    const copy = clone(files);
    const batch = withRands(rs, () => commitRows(f => copy[f]!, changes, kind, who, now, what));
    add('commitRows', { files, changes, kind, who, now, what: what ?? null, rands: rs }, { batch, files: copy });
  }

  for (let i = 0; i < 300; i++) {
    const kind = r.pick([...KINDS, 'strange']), what = r.pick(['надіслано', 'скасовано: надіслано', 'повторено: x: y', 'x', '']);
    const b: JournalBatch = { id: `${kind}:1`, kind, at: 1, items: Array.from({ length: r.int(30) }, () => ({ file: 'f', key: 'k', source: '', target: '', at: 1 })), total: 3, what };
    add('batchTitle', b, { title: batchTitle(b), label: batchUndoLabel(b) });
  }
  for (let i = 0; i < 100; i++) {
    const res = { done: r.pick([0, 1, 2, 5, 21, 1000]), skipped: r.pick([0, 0, 1, 3]), kind: r.pick([...KINDS, 'strange']), batch: 'x' };
    add('undoReport', res, undoReport(res));
  }

  for (let i = 0; i < 120; i++) {
    const { files } = genProject(r);
    for (const f of FILES) files[f] ??= {};
    const changes: RowChange[] = Array.from({ length: r.int(8) }, () => {
      const file = r.pick(FILES), key = r.pick(KEYS), base = files[file]![key];
      const next = base && r.chance(0.5) ? { ...base, status: r.pick(['new', 'draft', 'done', 'appr'] as const), ...(r.chance(0.5) ? { target: base.target + 'x' } : {}) } : genEntry(r);
      return { file, key, next, text: next.target };
    });
    const kind = r.pick(KINDS), protect = r.pick(['skip', 'include'] as const);
    const plan = planOf(f => files[f]!, changes, kind, protect);
    add('planOf', { files, changes, kind, protect }, { plan, note: planNote(plan), messages: [0, 1, 5, 12].map(n => planMessage(plan, n)) });
  }

  for (let i = 0; i < 50; i++) {
    const { views, files } = genProject(r), now = r.pick([5, 1000]);
    add('reconcileChanges', { views, files, now }, reconcileChanges(views, files, now));
  }
  writeVectors('journal', out);
});
