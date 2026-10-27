import { displayLength } from './controlCodes';

export interface TmEntry { s: string; t: string; /** where it came from, e.g. file name or "Імпорт" */ src: string }
export interface TmMatch extends TmEntry { score: number }

const norm = (t: string) => t.toLowerCase().replace(/\\[A-Za-z]+\[\d+\]|\\[{}.|!><^$]/g, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const words = (t: string): string[] => norm(t).split(' ').filter(Boolean);

/** Levenshtein similarity in percent (0–100) between two short strings. */
export function similarity(a: string, b: string): number {
  if (a === b) return 100;
  const x = [...a], y = [...b];
  if (!x.length || !y.length) return 0;
  let prev = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (x[i - 1] === y[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return Math.round((1 - prev[y.length]! / Math.max(x.length, y.length)) * 100);
}

interface Indexed extends TmEntry { w: Set<string>; len: number }

/** Search index over translated pairs. Built once; query per selected unit. */
export class TmIndex {
  private items: Indexed[] = [];
  private byWord = new Map<string, number[]>();

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
    for (const [id, overlap] of cands) {
      const it = this.items[id]!;
      if (opts.exclude?.(it)) continue;
      const union = qw.size + it.w.size - overlap;
      if (overlap / union < 0.3) continue;
      if (Math.abs(it.len - ql) > Math.max(ql, it.len) * 0.6) continue;
      const score = similarity(qn, norm(it.s));
      if (score >= min) out.push({ s: it.s, t: it.t, src: it.src, score });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, limit);
  }
}
