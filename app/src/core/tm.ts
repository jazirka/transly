import { displayLength } from './controlCodes';
import { unwrap } from './wrap';

export interface TmEntry { s: string; t: string; /** where it came from, e.g. file name or "Імпорт" */ src: string }
export interface TmMatch extends TmEntry { score: number }

const norm = (t: string) => t.toLowerCase().replace(/\\[A-Za-z]+\[\d+\]|\\[{}.|!><^$]/g, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const words = (t: string): string[] => norm(t).split(' ').filter(Boolean);

/** Words as numbers (one table for all lookups): long texts are compared word by word, which is a few hundred times less work than letter by letter. */
const wordIds = new Map<string, number>();
const wordCodes = (norm1: string): Int32Array => { const out: number[] = []; for (const w of norm1.split(' ')) { if (!w) continue; let id = wordIds.get(w); if (id === undefined) { id = wordIds.size + 1; wordIds.set(w, id); } out.push(id); } return Int32Array.from(out); };
/** From this many letters (in the longer of two texts) the match is counted in words. */
const LONG_TEXT = 240;

const codes = (t: string): Int32Array => { const out: number[] = []; for (const ch of t) out.push(ch.codePointAt(0)!); return Int32Array.from(out); };
/** Two rows of the distance table, reused by every call (a lookup scores hundreds of candidates). */
let rowA = new Int32Array(256), rowB = new Int32Array(256);

/** Similarity of two texts given as code points; see `similarity`. */
function scoreCodes(x: Int32Array, y: Int32Array, min: number): number {
  const n = x.length, m = y.length;
  if (!n || !m) return 0;
  const longest = Math.max(n, m);
  // the score is rounded, so a pair half a point under `min` can still round up to it: the room is measured from there (and a hair of slack for floating point)
  const room = min > 0 ? Math.floor(longest * (1 - (min - 0.5) / 100) + 1e-9) : longest;
  if (Math.abs(n - m) > room) return 0;
  if (rowA.length < m + 2) { rowA = new Int32Array(m + 2); rowB = new Int32Array(m + 2); }
  const FAR = 1 << 20;
  let prev = rowA, cur = rowB;
  // only the band of cells within `room` of the diagonal can hold a distance of at most `room`: the rest is left out
  for (let j = 0; j <= m; j++) prev[j] = j <= room ? j : FAR;
  prev[m + 1] = FAR;
  for (let i = 1; i <= n; i++) {
    const lo = Math.max(1, i - room), hi = Math.min(m, i + room);
    cur[lo - 1] = lo === 1 ? i : FAR;
    let best = FAR;
    const xi = x[i - 1]!;
    for (let j = lo; j <= hi; j++) {
      let v = prev[j - 1]! + (xi === y[j - 1] ? 0 : 1);
      const del = prev[j]! + 1, ins = cur[j - 1]! + 1;
      if (del < v) v = del;
      if (ins < v) v = ins;
      cur[j] = v;
      if (v < best) best = v;
    }
    cur[hi + 1] = FAR;
    // every way through the next rows passes a cell of this row: when all of them are past the room, the pair is too far apart
    if (best > room) return 0;
    const t = prev; prev = cur; cur = t;
  }
  const d = prev[m]!;
  if (d > room) return 0;
  return Math.round((1 - d / longest) * 100);
}

/**
 * Levenshtein similarity in percent (0–100) between two short strings. With `min` the work stops as soon as the pair cannot reach
 * that score: the answer is then 0, and it is exact whenever it is at least `min`.
 */
export function similarity(a: string, b: string, min = 0): number {
  if (a === b) return 100;
  return scoreCodes(codes(a), codes(b), min);
}

interface Indexed extends TmEntry { w: Set<string>; len: number; /** the normalised source as code points, made on the first lookup that needs it */ nc?: Int32Array; ns?: string; nw?: Int32Array }

/** Search index over translated pairs. Built once; query per selected unit. */
export class TmIndex {
  private items: Indexed[] = [];
  private byWord = new Map<string, number[]>();
  /** `flow`: the translations carry line breaks put in for the game window (wrapping «in the text»); matches give them back as one flowing text, which is wrapped again when it is sent. */
  constructor(private readonly opts: { flow?: boolean } = {}) {}

  add(e: TmEntry): void {
    if (!e.s.trim() || !e.t.trim()) return;
    const w = new Set(words(e.s));
    const id = this.items.length;
    this.items.push({ ...e, w, len: displayLength(e.s) });
    for (const x of w) { let l = this.byWord.get(x); if (!l) this.byWord.set(x, l = []); l.push(id); }
  }

  get size(): number { return this.items.length; }

  /** Best matches for `source`, highest score first. A unit never suggests itself (same text and same target). */
  find(source: string, opts: { min?: number; limit?: number; exclude?: (e: TmEntry) => boolean } = {}): TmMatch[] {
    const min = opts.min ?? 60, limit = opts.limit ?? 5;
    const qw = new Set(words(source));
    if (!qw.size) return [];
    // Candidate pre-filter: share at least one word, rank by overlap, then score only the best few hundred.
    const hits = new Map<number, number>();
    for (const x of qw) for (const id of this.byWord.get(x) ?? []) hits.set(id, (hits.get(id) ?? 0) + 1);
    const cands = [...hits].sort((a, b) => b[1] - a[1]).slice(0, 300);
    const qn = norm(source), out: TmMatch[] = [];
    const ql = displayLength(source);
    const qc = codes(qn);
    let qw2: Int32Array | undefined;
    // Once `limit` matches are in hand, a candidate only matters if it scores as well as the weakest of them: the scoring gives up on the rest early.
    let floor = min;
    for (const [id, overlap] of cands) {
      const it = this.items[id]!;
      if (opts.exclude?.(it)) continue;
      const union = qw.size + it.w.size - overlap;
      if (overlap / union < 0.3) continue;
      if (Math.abs(it.len - ql) > Math.max(ql, it.len) * 0.6) continue;
      const ns = it.ns ??= norm(it.s);
      let score: number;
      if (qn === ns) score = 100;
      else if (Math.max(qn.length, ns.length) > LONG_TEXT) { qw2 ??= wordCodes(qn); score = scoreCodes(qw2, it.nw ??= wordCodes(ns), floor); }
      else score = scoreCodes(qc, it.nc ??= codes(ns), floor);
      if (score >= min) {
        out.push({ s: it.s, t: this.opts.flow ? unwrap(it.t) : it.t, src: it.src, score });
        if (out.length >= limit) { const kth = [...out].sort((a, b) => b.score - a.score)[limit - 1]!.score; if (kth > floor) floor = kth; }
      }
    }
    return out.sort((a, b) => b.score - a.score).slice(0, limit);
  }
}
