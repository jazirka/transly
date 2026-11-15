import type { Entry } from './model';
import type { FileView, SavedProject } from './project';
import { GAP, normalizeGap, prepareText, wordTokens } from './glossary';
import type { GlossaryTerm } from './glossary';

/**
 * Constructions the translator has already been rendering the same way, found in the translated rows: a verb and a particle
 * with other words between them («take your hat off», «take the ring off»), always rendered with the same Ukrainian word. They
 * are only proposed: nothing is added until the translator confirms the entry in the form.
 */

export interface MineRef { file: string; key: string }
export interface ConstructionSuggestion {
  /** The pattern as it would be written in the glossary: «take … off». */
  en: string;
  /** The Ukrainian word the rows render it with (the most frequent form): a starting point for the entry. */
  uk: string;
  /** The translated rows it was found in. */
  rows: MineRef[];
}

/** A pattern is proposed from this many rows, of which this share render it with the same word. */
const MIN_ROWS = 3;
const SAME_SHARE = 0.8;
/** The words that may stand between the verb and the particle. */
const MAX_GAP = 3;
/** A Ukrainian word that stands in more than this share of all translated rows says nothing about one construction. */
const COMMON_SHARE = 0.2;
/** The share of rows says something only about a corpus of some size. */
const MIN_FOR_COMMON = 50;
/** Where the rows with the verb but without the particle render the same word this often, the particle changes nothing: the entry would be the verb's. */
const CONTROL_SHARE = 0.3;
const MAX_SUGGESTIONS = 30;

const PARTICLES = new Set(['up', 'off', 'on', 'out', 'in', 'down', 'away', 'back', 'over', 'through', 'around', 'apart', 'along', 'aside', 'ahead', 'into', 'onto', 'to', 'for', 'from', 'with', 'about', 'at']);
const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'at', 'by', 'for', 'with', 'from', 'it', 'its', 'he', 'she', 'we', 'you', 'they', 'i', 'me', 'him', 'her', 'us', 'them', 'my', 'your', 'his', 'our', 'their', 'this', 'that', 'these', 'those', 'is', 'are', 'was', 'were', 'be', 'been', 'am', 'do', 'does', 'did', 'have', 'has', 'had', 'will', 'would', 'can', 'could', 'shall', 'should', 'may', 'might', 'must', 'not', 'no', 'so', 'if', 'then', 'than', 'as', 'there', 'here', 'what', 'who', 'how', 'why', 'when', 'where', 'all', 'any', 'some']);
const BREAK = /[.!?;]|\n/;

const translated = (e: Entry | undefined): e is Entry => !!e && !!e.target.trim() && (e.status === 'done' || e.status === 'appr');
const ukStems = (target: string): string[] => wordTokens(target).map(t => t.keys[0]!).filter(k => k.length >= 4);
const norm = (s: string): string => normalizeGap(s).toLowerCase();

/** Two stems of Ukrainian words are one word when they start the same way for most of the shorter one («знім» and «зніміть» are the same verb). */
function sameWord(a: string, b: string): boolean {
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  return p >= 4 && p / Math.min(a.length, b.length) >= 0.75;
}
const has = (stems: Set<string>, rep: string): boolean => { for (const s of stems) if (s === rep || sameWord(s, rep)) return true; return false; };

interface Group { w1: string; part: string; rows: number[]; surfaces: Map<string, number> }
interface Row { file: string; key: string; target: string; stems: Set<string> }

/** A word is a candidate verb when it has letters only, is not a function word and is not itself a particle. */
const content = (keys: string[], word: string): boolean => /^\p{L}+$/u.test(word) && word.length >= 3 && !STOP.has(keys[0]!) && !PARTICLES.has(keys[0]!);

/**
 * Look through the translated rows for constructions that are not in the glossary yet. The screen is given back between
 * slices (`pause`), so a game of a hundred thousand rows is looked through without a freeze; at most `limit` rows are read.
 */
export async function mineConstructions(views: FileView[], saved: Pick<SavedProject, 'files'>, terms: Pick<GlossaryTerm, 'en'>[], pause: () => Promise<void>, limit = 20000, slice = 2500): Promise<ConstructionSuggestion[]> {
  const rows: Row[] = [];
  const groups = new Map<string, Group>();
  const df = new Map<string, number>();
  let seen = 0;
  // pass 1: the rows with a verb, up to three words, and a particle; and how often every Ukrainian word is used
  for (const v of views) {
    const ents = saved.files[v.name] as Record<string, Entry | undefined> | undefined;
    for (const u of v.units) {
      const e = ents?.[u.key];
      if (!translated(e)) continue;
      if (rows.length >= limit) break;
      const idx = rows.length;
      const stems = new Set(ukStems(e.target));
      for (const k of stems) df.set(k, (df.get(k) ?? 0) + 1);
      const row: Row = { file: v.name, key: u.key, target: e.target, stems };
      rows.push(row);
      const p = prepareText(u.source), t = p.tokens;
      for (let j = 0; j < t.length; j++) {
        const pk = t[j]!.keys[0]!;
        if (!PARTICLES.has(pk)) continue;
        for (let i = j - 1; i >= 0 && j - i - 1 <= MAX_GAP; i--) {
          if (BREAK.test(p.text.slice(t[i]!.end, t[i + 1]!.start))) break;
          const word = p.text.slice(t[i]!.start, t[i]!.end).toLowerCase();
          if (!content(t[i]!.keys, word)) continue;
          for (const k of t[i]!.keys) {
            const id = `${k}\u0001${pk}`;
            let g = groups.get(id);
            if (!g) groups.set(id, g = { w1: k, part: pk, rows: [], surfaces: new Map() });
            if (g.rows[g.rows.length - 1] !== idx) g.rows.push(idx);
            g.surfaces.set(word, (g.surfaces.get(word) ?? 0) + 1);
          }
        }
      }
      if (++seen % slice === 0) await pause();
    }
  }
  const total = rows.length || 1;
  const known = new Set(terms.map(t => norm(t.en)));

  // a group is a candidate when most of its rows render it with one Ukrainian word that is not common everywhere
  interface Cand { g: Group; stem: string; share: number }
  const cands: Cand[] = [];
  for (const g of groups.values()) {
    if (g.rows.length < MIN_ROWS) continue;
    // the stem (taken from the rows themselves) that most of the rows contain in some form, and that is not common everywhere
    const distinct = new Set<string>();
    for (const r of g.rows) for (const x of rows[r]!.stems) distinct.add(x);
    let best = '', bestN = 0;
    for (const rep of [...distinct].slice(0, 400)) {
      if (total >= MIN_FOR_COMMON && (df.get(rep) ?? 0) / total >= COMMON_SHARE) continue;
      let n = 0;
      for (const r of g.rows) if (has(rows[r]!.stems, rep)) n++;
      if (n > bestN) { best = rep; bestN = n; }
    }
    if (!best || bestN / g.rows.length < SAME_SHARE) continue;
    cands.push({ g, stem: best, share: bestN / g.rows.length });
  }
  if (!cands.length) return [];

  // pass 2: the rows that have the verb but not the particle. When they render the same word, the verb alone is the entry, not the construction.
  const wanted = new Map<string, Cand[]>();
  for (const c of cands) { const l = wanted.get(c.g.w1); if (l) l.push(c); else wanted.set(c.g.w1, [c]); }
  const control = new Map<Cand, { n: number; hit: number }>(cands.map(c => [c, { n: 0, hit: 0 }]));
  const inGroup = new Map<Cand, Set<number>>(cands.map(c => [c, new Set(c.g.rows)]));
  let at = 0;
  for (const v of views) {
    const ents = saved.files[v.name] as Record<string, Entry | undefined> | undefined;
    for (const u of v.units) {
      const e = ents?.[u.key];
      if (!translated(e)) continue;
      if (at >= rows.length) break;
      const idx = at++;
      const keys = new Set<string>();
      for (const t of prepareText(u.source).tokens) for (const k of t.keys) if (wanted.has(k)) keys.add(k);
      for (const k of keys) for (const c of wanted.get(k)!) {
        if (inGroup.get(c)!.has(idx)) continue;
        const ctl = control.get(c)!;
        ctl.n++;
        if (has(rows[idx]!.stems, c.stem)) ctl.hit++;
      }
      if (at % slice === 0) await pause();
    }
  }

  // one suggestion per Ukrainian word and overlapping rows: «take … off» beats «hat … off» (more rows); an entry already in the glossary is not proposed
  const out: ConstructionSuggestion[] = [];
  const taken: { stem: string; rows: Set<number> }[] = [];
  for (const c of cands.sort((a, b) => b.g.rows.length - a.g.rows.length || a.g.w1.length - b.g.w1.length)) {
    const ctl = control.get(c)!;
    if (ctl.n >= MIN_ROWS && ctl.hit / ctl.n > CONTROL_SHARE) continue;
    if (taken.some(t => t.stem === c.stem && c.g.rows.filter(r => t.rows.has(r)).length * 2 > c.g.rows.length)) continue;
    // the base form of the verb as it stands in the rows (the surface whose own key is the group's), the Ukrainian word as it is most often written
    const surf = [...c.g.surfaces.entries()].sort((a, b) => b[1] - a[1]);
    const base = surf.find(([w]) => wordTokens(w)[0]?.keys[0] === c.g.w1 || w === c.g.w1)?.[0] ?? c.g.w1;
    const forms = new Map<string, number>();
    for (const r of c.g.rows) {
      const { target } = rows[r]!;
      for (const t of wordTokens(target)) if (t.keys[0] === c.stem || sameWord(t.keys[0]!, c.stem)) { const w = target.slice(t.start, t.end).toLowerCase(); forms.set(w, (forms.get(w) ?? 0) + 1); }
    }
    const uk = [...forms.entries()].sort((a, b) => (Number(/ти$/.test(b[0])) - Number(/ти$/.test(a[0]))) || b[1] - a[1])[0]?.[0] ?? c.stem;
    const en = `${base} ${GAP} ${c.g.part}`;
    if (known.has(norm(en)) || known.has(norm(`${base} ${c.g.part}`))) continue;
    taken.push({ stem: c.stem, rows: new Set(c.g.rows) });
    out.push({ en, uk, rows: c.g.rows.map(r => ({ file: rows[r]!.file, key: rows[r]!.key })) });
    if (out.length >= MAX_SUGGESTIONS) break;
  }
  return out;
}
