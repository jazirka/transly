import type { MorphDict } from './ukmorph';
import { ukForms, ukWordForms } from './ukmorph';
import { tokenize } from './autofill';
import type { SavedProject } from './project';

/**
 * Putting a line together from its parts. «Villager [left arm]» has no translation, but «Villager» is a term (or a short line
 * that was translated), and «left» and «arm» were translated somewhere else. The brackets, digits and codes are copied from the
 * original, every run of words between them is covered by the longest known parts (up to four words), and the adjectives are
 * put in the gender and the number of the noun they stand before («лівий» + «рука» → «ліва рука»).
 */

/** An original phrase (lower case, one space between the words) → its translation (lower case). */
export type Lexicon = Map<string, { uk: string; adj: boolean }>;

const MAX_PART = 4;
const lower = (s: string): string => s.toLowerCase();
/** The English adjectives that game lines are full of: they tell that a translation seen as «ліва» is the adjective «лівий». */
const ADJ_EN = new Set(('left right upper lower top bottom front back inner outer big small little large tiny huge great long short tall high low wide narrow thick thin ' +
  'old new young ancient fresh first second third last next main secondary basic special rare common unique magic magical holy dark light bright red green blue yellow white black ' +
  'brown gray grey golden silver iron steel wooden stone broken heavy hot cold warm cool dry wet empty full strong weak sharp dull hard soft fast slow good bad best worst ' +
  'happy sad angry wild poor rich dead alive free secret hidden lost final deep shallow sweet sour bitter royal dirty clean').split(/\s+/));

/** The masculine lemma of an adjective seen in another gender («ліва» → «лівий»); null when the word is not one. */
export function adjLemma(uk: string): string | null {
  if (/(ий|ій)$/.test(uk)) return uk;
  const stem = (suf: string): string => uk.slice(0, -suf.length);
  for (const [suf, to] of [['а', 'ий'], ['я', 'ій'], ['е', 'ий'], ['є', 'ій'], ['і', 'ий']] as const) {
    if (!uk.endsWith(suf) || uk.length < 4) continue;
    const cand = stem(suf) + to;
    // the adjective takes its gender from the noun after it: the forms are asked with a noun of each gender
    if (['стіл', 'стіна', 'вікно'].some(n => ukWordForms(`${cand} ${n}`)?.[0]?.has(uk))) return cand;
  }
  return null;
}

const onlyWords = (text: string): string[] | null => { const t = tokenize(text); return t.length && t.length <= MAX_PART && t.every(x => x.word) ? t.map(x => lower(x.text)) : null; };

/** What the parts are: glossary terms and translated short lines (whole phrases), and the words learned from lines of the same shape. */
export function buildLexicon(wholeLines: Map<string, string>, dict: Map<string, string>, saved: SavedProject): Lexicon {
  const lex: Lexicon = new Map();
  const put = (en: string, uk: string): void => {
    const e = onlyWords(en), u = onlyWords(uk);
    if (!e || !u) return;
    const one = u.length === 1 && e.length === 1;
    const ukWord = u.join(' ');
    const lemma = one ? (ADJ_EN.has(e[0]!) || /(ий|ій)$/.test(ukWord) ? adjLemma(ukWord) : null) : null;
    lex.set(e.join(' '), { uk: lemma ?? ukWord, adj: !!lemma });
  };
  for (const [w, uk] of dict) put(w, uk);
  for (const [s, t] of wholeLines) put(s, t);
  for (const t of saved.terms) if (t.uk.trim()) put(t.en.trim(), t.uk.trim());
  return lex;
}

/** The gender of the terms is known: the morphology does not have to guess it. */
const morphOf = (saved: SavedProject): MorphDict => {
  const g = new Map<string, 'm' | 'f' | 'n'>();
  for (const t of saved.terms) if (t.gender && t.gender !== 'p' && t.uk.trim() && !/\s/.test(t.uk.trim())) g.set(lower(t.uk.trim()), t.gender);
  return { info: lemma => { const x = g.get(lower(lemma)); return x ? { gender: x } : null; } };
};

const isCap = (s: string): boolean => { const c = [...s][0] ?? ''; return c !== c.toLowerCase(); };
const capitalise = (s: string): string => { const [c = '', ...rest] = [...s]; return c.toUpperCase() + rest.join(''); };

interface Piece { uk: string; adj: boolean }

/** One run of words: covered by the longest parts, the adjectives agreed with the noun; null when a word is not known. */
function composeGroup(words: string[], lex: Lexicon, dict: MorphDict): string | null {
  const pieces: Piece[] = [];
  let plural = false;
  for (let i = 0; i < words.length;) {
    let hit: Piece | undefined, took = 0;
    for (let n = Math.min(MAX_PART, words.length - i); n >= 1 && !hit; n--) { const e = lex.get(words.slice(i, i + n).join(' ')); if (e) { hit = e; took = n; } }
    if (!hit) {
      // «arms» of «arm»: the plural of the last word
      const w = words[i]!;
      const base = i === words.length - 1 ? lex.get(w.replace(/(es|s)$/, '')) ?? lex.get(w.replace(/s$/, '')) : undefined;
      if (!base || !/(es|s)$/.test(w) || base.adj) return null;
      hit = base; took = 1; plural = true;
    }
    pieces.push(hit); i += took;
  }
  const phrase = pieces.map(p => p.uk).join(' ');
  if (!pieces.some(p => p.adj) && !plural) return phrase;
  const forms = ukForms(phrase, dict);
  return forms?.[plural ? 'nom.pl' : 'nom.sg'][0] ?? null;
}

/** The translation of a line put together from its parts; null when some word is not known or nothing changes. */
export function composeLine(source: string, lex: Lexicon, saved: SavedProject, maxWords = 10): string | null {
  const toks = tokenize(source), nWords = toks.filter(t => t.word).length;
  if (!nWords || nWords > maxWords) return null;
  const dict = morphOf(saved);
  let out = '', at = 0;
  for (let i = 0; i < toks.length;) {
    const t = toks[i]!;
    out += source.slice(at, t.index);
    if (!t.word) { out += t.text; at = t.index + t.text.length; i++; continue; }
    // a run of words with nothing but spaces between them
    let j = i;
    while (j + 1 < toks.length && toks[j + 1]!.word && /^\s*$/.test(source.slice(toks[j]!.index + toks[j]!.text.length, toks[j + 1]!.index))) j++;
    const run = toks.slice(i, j + 1);
    const uk = composeGroup(run.map(x => lower(x.text)), lex, dict);
    if (uk === null) return null;
    const first = run[0]!.text, letters = [...source.slice(run[0]!.index, run[j - i]!.index + run[j - i]!.text.length)].filter(c => c.toLowerCase() !== c.toUpperCase());
    out += letters.length > 1 && letters.every(c => c === c.toUpperCase()) ? uk.toUpperCase() : isCap(first) ? capitalise(uk) : uk;
    const last = run[run.length - 1]!;
    at = last.index + last.text.length;
    i = j + 1;
  }
  return out === source ? null : out;
}
