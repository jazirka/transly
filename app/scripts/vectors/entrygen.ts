import type { Comment, Drop, Entry, HistoryItem, Status, Translations, Vote } from '../../src/core/model';
import { OTHER_DEVICE, REPLACED_WHAT, RESET_WHAT } from '../../src/core/merge';
import { text } from './util';
import type { Rng } from './util';

export const STATUSES: Status[] = ['new', 'draft', 'done', 'appr'];
export const WHOS = ['Анна', 'Богдан', 'a', OTHER_DEVICE];
export const WHATS = ['надіслано', 'send', 'правка', REPLACED_WHAT, RESET_WHAT, 'x'];
// Малий набір часу, щоб часто траплялися однакові штампи (рівні mt, однакові записи).
export const time = (r: Rng): number => r.pick([0, 1, 2, 3, 5, 100, 1000, 1700000000000]);

// Поля будуються в тому ж порядку, що й у core (від нього залежить порівняння JSON.stringify у нічиїх).
export const genComment = (r: Rng): Comment => {
  const c: Comment = { who: r.pick(WHOS), at: time(r), text: text(r) };
  if (r.chance(0.7)) c.id = r.pick(['i1', 'i2', 'i3']);
  if (r.chance(0.2)) c.re = 'i1';
  if (r.chance(0.3)) c.res = r.chance(0.5) ? { who: r.pick(WHOS), at: time(r) } : { who: r.pick(WHOS), at: time(r), open: true };
  if (r.chance(0.2)) c.ed = time(r);
  if (r.chance(0.1)) c.del = true;
  return c;
};
export const genVote = (r: Rng): Vote => ({ who: r.pick(WHOS), on: r.pick(['p', 'q', 'r']), v: r.pick([-1, 0, 1] as const), at: time(r) });
export const genDrop = (r: Rng): Drop => ({ who: r.pick(WHOS), on: r.pick(['p', 'q', 'r']), at: time(r), ...(r.chance(0.5) ? { off: true } : {}) });
export const genHist = (r: Rng): HistoryItem => {
  const h: HistoryItem = { at: time(r), who: r.pick(WHOS), what: r.pick(WHATS), text: r.pick(['', 'a', 'b', 'я', ' ', '😀', text(r)]) };
  if (r.chance(0.2)) h.batch = 'b1';
  if (r.chance(0.2)) h.prev = { target: text(r), status: r.pick(STATUSES), ...(r.chance(0.5) ? { returned: r.chance(0.5) } : {}) };
  return h;
};
export const arr = <T>(r: Rng, g: (r: Rng) => T, max: number, p = 0.5): T[] | undefined => (r.chance(p) ? Array.from({ length: r.int(max + 1) }, () => g(r)) : undefined);

export function genEntry(r: Rng): Entry {
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
export function sibling(r: Rng, e: Entry): Entry {
  const o = genEntry(r);
  if (r.chance(0.5)) { o.target = e.target; o.mt = e.mt; }
  if (r.chance(0.4) && e.history) o.history = [...e.history.slice(0, r.int(e.history.length + 1)), ...(o.history ?? [])];
  if (r.chance(0.4) && e.comments) o.comments = [...e.comments.map(c => ({ ...c })), ...(o.comments ?? [])];
  return o;
}
export const KEYS = ['k1', 'k2', 'k3', 'k4', 'ev[1]', 'ев[2]'];
export function genSet(r: Rng): Translations {
  const t: Translations = {};
  for (const k of KEYS) if (r.chance(0.6)) t[k] = genEntry(r);
  return t;
}
