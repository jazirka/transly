import { test } from 'vitest';
import type { Comment, Drop, Entry, HistoryItem, Status, Translations, Vote } from '../../src/core/model';
import { knownStatus, nextMt } from '../../src/core/model';
import { OTHER_DEVICE, REPLACED_WHAT, RESET_WHAT, merge, mergeEntry } from '../../src/core/merge';
import { castVote, sentVariants, setDropped, tallyOf, variantId, voteId } from '../../src/core/variants';
import { HISTORY_LIMIT, addComment, commentId, edit, note, reconcile, sendBack, setIgnored, sourceChanged } from '../../src/core/workflow';
import { rng, text, writeVectors } from './util';
import type { Rng } from './util';

const STATUSES: Status[] = ['new', 'draft', 'done', 'appr'];
const WHOS = ['Анна', 'Богдан', 'a', OTHER_DEVICE];
const WHATS = ['надіслано', 'send', 'правка', REPLACED_WHAT, RESET_WHAT, 'x'];
// Малий набір часу, щоб часто траплялися однакові штампи (рівні mt, однакові записи).
const time = (r: Rng): number => r.pick([0, 1, 2, 3, 5, 100, 1000, 1700000000000]);

// Поля будуються в тому ж порядку, що й у core (від нього залежить порівняння JSON.stringify у нічиїх).
const genComment = (r: Rng): Comment => {
  const c: Comment = { who: r.pick(WHOS), at: time(r), text: text(r) };
  if (r.chance(0.7)) c.id = r.pick(['i1', 'i2', 'i3']);
  if (r.chance(0.2)) c.re = 'i1';
  if (r.chance(0.3)) c.res = r.chance(0.5) ? { who: r.pick(WHOS), at: time(r) } : { who: r.pick(WHOS), at: time(r), open: true };
  if (r.chance(0.2)) c.ed = time(r);
  if (r.chance(0.1)) c.del = true;
  return c;
};
const genVote = (r: Rng): Vote => ({ who: r.pick(WHOS), on: r.pick(['p', 'q', 'r']), v: r.pick([-1, 0, 1] as const), at: time(r) });
const genDrop = (r: Rng): Drop => ({ who: r.pick(WHOS), on: r.pick(['p', 'q', 'r']), at: time(r), ...(r.chance(0.5) ? { off: true } : {}) });
const genHist = (r: Rng): HistoryItem => {
  const h: HistoryItem = { at: time(r), who: r.pick(WHOS), what: r.pick(WHATS), text: r.pick(['', 'a', 'b', 'я', ' ', '😀', text(r)]) };
  if (r.chance(0.2)) h.batch = 'b1';
  if (r.chance(0.2)) h.prev = { target: text(r), status: r.pick(STATUSES), ...(r.chance(0.5) ? { returned: r.chance(0.5) } : {}) };
  return h;
};
const arr = <T>(r: Rng, g: (r: Rng) => T, max: number, p = 0.5): T[] | undefined => (r.chance(p) ? Array.from({ length: r.int(max + 1) }, () => g(r)) : undefined);

function genEntry(r: Rng): Entry {
  const e: Entry = { target: r.pick(['', 'a', 'b', 'я', text(r)]), status: r.pick(STATUSES), mt: time(r) };
  if (r.chance(0.5)) e.src = r.pick(['', 's', 't', text(r)]);
  if (r.chance(0.3)) e.orig = r.pick(['', 'o', text(r)]);
  if (r.chance(0.3)) e.returned = r.chance(0.5);
  if (r.chance(0.3)) { e.ign = Array.from({ length: r.int(3) }, () => r.pick(['k1', 'k2', 'k3'])); if (r.chance(0.7)) e.ignAt = time(r); }
  const c = arr(r, genComment, 4); if (c) e.comments = c;
  const v = arr(r, genVote, 4, 0.3); if (v) e.votes = v;
  const d = arr(r, genDrop, 3, 0.3); if (d) e.drops = d;
  const h = arr(r, genHist, 5, 0.6); if (h) e.history = h;
  return e;
}
// Близька «версія» запису — щоб злиття мало і спільне, і різне.
function sibling(r: Rng, e: Entry): Entry {
  const o = genEntry(r);
  if (r.chance(0.5)) { o.target = e.target; o.mt = e.mt; }
  if (r.chance(0.4) && e.history) o.history = [...e.history.slice(0, r.int(e.history.length + 1)), ...(o.history ?? [])];
  if (r.chance(0.4) && e.comments) o.comments = [...e.comments.map(c => ({ ...c })), ...(o.comments ?? [])];
  return o;
}
const KEYS = ['k1', 'k2', 'k3', 'k4', 'ev[1]', 'ев[2]'];
function genSet(r: Rng): Translations {
  const t: Translations = {};
  for (const k of KEYS) if (r.chance(0.6)) t[k] = genEntry(r);
  return t;
}
const unitOf = (key: string, source: string) => ({ key, source, speaker: '', kind: 'dialogue' as const, context: '' });

test('export merge vectors', () => {
  const r = rng(20261124);
  const N = 150;
  const out: Record<string, { input: unknown; output: unknown }[]> = {};
  const add = (name: string, input: unknown, output: unknown) => (out[name] ??= []).push({ input, output });

  for (let i = 0; i < 200; i++) {
    const prev = r.chance(0.8) ? r.pick([0, 1, 5, 1000]) : undefined, now = r.pick([0, 1, 5, 6, 1000, 1001]);
    add('nextMt', { prev: prev ?? null, now }, nextMt(prev, now));
  }
  for (const s of ['new', 'draft', 'done', 'appr', '', 'x', 'DONE']) add('knownStatus', s, knownStatus(s));
  for (let i = 0; i < 100; i++) { const s = text(r); add('variantId', s, variantId(s)); }
  add('constants', null, { HISTORY_LIMIT });

  for (let i = 0; i < N; i++) { const c = genComment(r); add('commentId', c, commentId(c)); }
  for (let i = 0; i < N; i++) { const v = genVote(r); add('voteId', v, voteId(v)); }

  for (let i = 0; i < N; i++) {
    const e = genEntry(r);
    // Історія й чинний переклад перетинаються частіше, щоб картки варіантів не були порожні.
    if (e.history && r.chance(0.6)) for (const h of e.history) if (r.chance(0.5)) h.text = e.target;
    add('sentVariants', e, sentVariants(e));
  }
  add('sentVariants', null, sentVariants(undefined));
  for (let i = 0; i < N; i++) { const e = genEntry(r), id = r.pick(['p', 'q', 'r']), who = r.pick(WHOS); add('tallyOf', { e, id, who }, tallyOf(e, id, who)); }
  for (let i = 0; i < N; i++) {
    const e = genEntry(r), id = r.pick(['p', 'q', 'r']), who = r.pick(WHOS), v = r.pick([1, -1] as const), now = time(r);
    add('castVote', { e, id, who, v, now }, castVote(e, id, who, v, now));
  }
  for (let i = 0; i < N; i++) {
    const e = genEntry(r), id = r.pick(['p', 'q', 'r']), who = r.pick(WHOS), off = r.chance(0.5), now = time(r);
    add('setDropped', { e, id, who, off, now }, setDropped(e, id, who, off, now));
  }
  {
    // ліміт голосів: 320 різних голосів поспіль
    let e: Entry = { target: '', status: 'new', mt: 0 };
    for (let i = 0; i < 320; i++) e = castVote(e, 'p' + i, 'u', 1, i);
    add('castVoteMany', 320, e);
  }

  for (let i = 0; i < N; i++) {
    const e = r.chance(0.8) ? genEntry(r) : { target: '', status: 'new' as const, mt: 0 }, what = r.pick(WHATS), t = text(r), who = r.pick(WHOS), now = time(r);
    add('note', { e, what, text: t, who, now }, note(e, what, t, who, now));
  }
  {
    // понад HISTORY_LIMIT записів: працює обрізання
    let e: Entry = { target: '', status: 'new', mt: 0 };
    for (let i = 0; i < HISTORY_LIMIT + 7; i++) e = note(e, 'w', 't' + i, 'u', i);
    add('noteMany', HISTORY_LIMIT + 7, e);
  }
  for (let i = 0; i < N; i++) {
    const e = r.chance(0.7) ? genEntry(r) : undefined, who = r.pick(WHOS), t = text(r), now = time(r), re = r.chance(0.3) ? 'i1' : undefined;
    add('addComment', { e: e ?? null, who, text: t, now, re: re ?? null }, addComment(e, who, t, now, re));
  }
  for (let i = 0; i < N; i++) {
    const e = genEntry(r), key = r.pick(['k1', 'k2', 'k9']), on = r.chance(0.5), now = time(r);
    add('setIgnored', { e, key, on, now }, setIgnored(e, key, on, now));
  }
  for (let i = 0; i < N; i++) {
    const prev = r.chance(0.8) ? genEntry(r) : undefined, source = text(r), t = r.pick(['', 'a', text(r)]), stage = r.pick(['translate', 'review'] as const), now = r.pick([0, 1, 5, 1000, 1700000000001]);
    add('edit', { prev: prev ?? null, source, text: t, stage, now }, edit(prev, unitOf('k', source), t, stage, now));
  }
  for (let i = 0; i < N; i++) { const e = genEntry(r), now = time(r); add('sendBack', { e, now }, sendBack(e, now)); }
  for (let i = 0; i < N; i++) {
    const e = r.chance(0.8) ? genEntry(r) : undefined, source = r.pick(['', 's', 't']);
    add('sourceChanged', { e: e ?? null, source }, sourceChanged(e, unitOf('k', source)));
  }
  for (let i = 0; i < 150; i++) {
    const entries = genSet(r), now = time(r);
    const units = KEYS.filter(() => r.chance(0.7)).map(key => unitOf(key, r.pick(['', 's', 't'])));
    const copy: Record<string, Entry> = JSON.parse(JSON.stringify(entries));
    const changed = reconcile(units, copy, now);
    add('reconcile', { units, entries, now }, { changed, entries: copy });
  }

  for (let i = 0; i < 250; i++) {
    const a = genEntry(r), b = r.chance(0.6) ? sibling(r, a) : genEntry(r);
    add('mergeEntry', { a, b }, mergeEntry(a, b));
  }
  for (let i = 0; i < 120; i++) {
    const a = genSet(r), b = r.chance(0.5) ? Object.fromEntries(Object.entries(a).map(([k, e]) => [k, sibling(r, e)])) : genSet(r);
    const since = r.pick([0, 1, 2, 100, 1000]);
    for (const k of KEYS) if (r.chance(0.2)) delete b[k];
    add('merge', { a, b, since }, merge(a, b, since));
  }
  writeVectors('merge', out);
});
