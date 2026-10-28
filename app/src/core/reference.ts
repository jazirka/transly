import { codesOf } from './controlCodes';
import type { Unit } from './model';

/** Reference-language text per unit key of the working language. */
export type Reference = Record<string, string>;

/** One reference language: its texts per file. */
export interface ReferenceSet { lang: string; texts: Record<string, Reference> }
/** The first reference language plus any others; everything travels as one blob, so sync and storage stay as they were. */
export interface ReferenceBundle extends ReferenceSet { extra?: ReferenceSet[] }

export const referenceSets = (b: ReferenceBundle | undefined): ReferenceSet[] => (b ? [{ lang: b.lang, texts: b.texts }, ...(b.extra ?? [])] : []);

/** Add a reference language, or replace the one with the same code. Returns a new bundle. */
export function withReference(b: ReferenceBundle | undefined, set: ReferenceSet): ReferenceBundle {
  const cur = referenceSets(b);
  const merged = cur.some(x => x.lang === set.lang) ? cur.map(x => (x.lang === set.lang ? set : x)) : [...cur, set];
  const [first, ...rest] = merged as [ReferenceSet, ...ReferenceSet[]];
  return { lang: first.lang, texts: first.texts, ...(rest.length ? { extra: rest } : {}) };
}

/** Drop one reference language; undefined when none is left. */
export function withoutReference(b: ReferenceBundle | undefined, lang: string): ReferenceBundle | undefined {
  const rest = referenceSets(b).filter(x => x.lang !== lang);
  const [first, ...others] = rest;
  return first ? { lang: first.lang, texts: first.texts, ...(others.length ? { extra: others } : {}) } : undefined;
}

const LIST = /^(.*\.list)\[\d+\]/;
const prefixOf = (key: string): string | null => LIST.exec(key)?.[1] ?? null;

const codeSig = (t: string) => codesOf(t).map(c => c.toLowerCase()).sort().join('');

/** How well two units look like the same line of the game. -Infinity = must not be paired. */
function score(a: Unit, b: Unit): number {
  if (a.kind !== b.kind) return -Infinity;
  let s = 3;
  if (codeSig(a.source) === codeSig(b.source)) s += 2;
  const la = a.source.length || 1, lb = b.source.length || 1;
  const ratio = Math.max(la, lb) / Math.min(la, lb);
  s += ratio <= 1.6 ? 1 : ratio <= 3 ? 0 : -1;
  // A choice option sits at the same index inside its command: prefer pairs whose key tails agree.
  const ta = /\.choice\[\d+\]$/.exec(a.key)?.[0], tb = /\.choice\[\d+\]$/.exec(b.key)?.[0];
  if (ta && tb && ta === tb) s += 1;
  return s;
}

/** Global alignment (Needleman–Wunsch) of two ordered lists of units; returns index pairs. */
function align(a: Unit[], b: Unit[]): [number, number][] {
  const n = a.length, m = b.length, GAP = -1;
  const w = m + 1;
  const dp = new Float32Array((n + 1) * w);
  const from = new Uint8Array((n + 1) * w); // 1 diag, 2 up (skip a), 3 left (skip b)
  for (let i = 1; i <= n; i++) { dp[i * w] = i * GAP; from[i * w] = 2; }
  for (let j = 1; j <= m; j++) { dp[j] = j * GAP; from[j] = 3; }
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const sc = score(a[i - 1]!, b[j - 1]!);
      let best = dp[(i - 1) * w + j]! + GAP, f = 2;
      const left = dp[i * w + j - 1]! + GAP;
      if (left > best) { best = left; f = 3; }
      if (sc !== -Infinity) { const d = dp[(i - 1) * w + j - 1]! + sc; if (d >= best) { best = d; f = 1; } }
      dp[i * w + j] = best; from[i * w + j] = f;
    }
  }
  const out: [number, number][] = [];
  let i = n, j = m;
  while (i > 0 || j > 0) {
    const f = from[i * w + j];
    if (f === 1) { out.push([i - 1, j - 1]); i--; j--; }
    else if (f === 2) i--;
    else j--;
  }
  return out.reverse();
}

/**
 * Pair every unit of the working language with the same line in a reference-language copy of the game.
 * Database entries pair by key. Event text pairs inside the same command list by alignment, because translators
 * of other versions add and remove lines, which shifts command indices.
 */
export function alignReference(units: Unit[], ref: Unit[]): Reference {
  const out: Reference = {};
  const byKey = new Map(ref.map(u => [u.key, u]));
  const groups = new Map<string, { a: Unit[]; b: Unit[] }>();
  const add = (u: Unit, side: 'a' | 'b', p: string) => { let g = groups.get(p); if (!g) groups.set(p, g = { a: [], b: [] }); g[side].push(u); };
  for (const u of units) { const p = prefixOf(u.key); if (p === null) { const r = byKey.get(u.key); if (r && r.kind === u.kind) out[u.key] = r.source; } else add(u, 'a', p); }
  for (const u of ref) { const p = prefixOf(u.key); if (p !== null) add(u, 'b', p); }
  for (const { a, b } of groups.values()) {
    if (!a.length || !b.length) continue;
    // Identical command layout (same indices, same kinds): pair in order without searching.
    if (a.length === b.length && a.every((u, i) => u.key === b[i]!.key && u.kind === b[i]!.kind)) { a.forEach((u, i) => { out[u.key] = b[i]!.source; }); continue; }
    for (const [i, j] of align(a, b)) out[a[i]!.key] = b[j]!.source;
  }
  return out;
}
