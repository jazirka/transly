/**
 * Difference between two versions of a text, word by word: what stayed, what was added, what was taken out. Used to
 * compare versions in the history of a row. Spaces and punctuation are tokens too, so the segments put together give
 * either text back exactly.
 */
export interface DiffSeg { t: 'same' | 'add' | 'del'; text: string }

const TOKEN = /\s+|[\p{L}\p{N}]+(?:['’ʼ-][\p{L}\p{N}]+)*|[^\s\p{L}\p{N}]/gu;
const tokens = (s: string): string[] => s.match(TOKEN) ?? [];

/** Above this many cells the table of the longest common part is not built: the middle is shown as replaced. */
const MAX_CELLS = 2_000_000;

function push(out: DiffSeg[], t: DiffSeg['t'], text: string): void {
  if (!text) return;
  const last = out[out.length - 1];
  if (last && last.t === t) last.text += text; else out.push({ t, text });
}

export function diffWords(before: string, after: string): DiffSeg[] {
  if (before === after) return before ? [{ t: 'same', text: before }] : [];
  const a = tokens(before), b = tokens(after);
  let lo = 0;
  while (lo < a.length && lo < b.length && a[lo] === b[lo]) lo++;
  let ea = a.length, eb = b.length;
  while (ea > lo && eb > lo && a[ea - 1] === b[eb - 1]) { ea--; eb--; }
  const out: DiffSeg[] = [];
  push(out, 'same', a.slice(0, lo).join(''));
  const x = a.slice(lo, ea), y = b.slice(lo, eb);
  if (!x.length || !y.length || (x.length + 1) * (y.length + 1) > MAX_CELLS) {
    push(out, 'del', x.join(''));
    push(out, 'add', y.join(''));
  } else {
    // Longest common subsequence of the middle parts, from the back so the walk below goes forward.
    const w = y.length + 1;
    const lcs = new Uint16Array((x.length + 1) * w);
    for (let i = x.length - 1; i >= 0; i--) {
      for (let j = y.length - 1; j >= 0; j--) {
        lcs[i * w + j] = x[i] === y[j] ? lcs[(i + 1) * w + j + 1]! + 1 : Math.max(lcs[(i + 1) * w + j]!, lcs[i * w + j + 1]!);
      }
    }
    let i = 0, j = 0;
    while (i < x.length && j < y.length) {
      if (x[i] === y[j]) { push(out, 'same', x[i]!); i++; j++; }
      else if (lcs[(i + 1) * w + j]! >= lcs[i * w + j + 1]!) { push(out, 'del', x[i]!); i++; }
      else { push(out, 'add', y[j]!); j++; }
    }
    while (i < x.length) push(out, 'del', x[i++]!);
    while (j < y.length) push(out, 'add', y[j++]!);
  }
  push(out, 'same', a.slice(ea).join(''));
  return out;
}

/** The text of one side of a diff: `before` leaves out what was added, `after` leaves out what was taken out. */
export const sideOf = (segs: DiffSeg[], side: 'before' | 'after'): string => segs.filter(s => s.t === 'same' || s.t === (side === 'before' ? 'del' : 'add')).map(s => s.text).join('');

/** How many words were added and taken out (a replaced word counts once in each). */
export function diffCounts(segs: DiffSeg[]): { added: number; removed: number } {
  const words = (s: string): number => (s.match(/[\p{L}\p{N}]+/gu) ?? []).length;
  let added = 0, removed = 0;
  for (const s of segs) { if (s.t === 'add') added += words(s.text); else if (s.t === 'del') removed += words(s.text); }
  return { added, removed };
}
