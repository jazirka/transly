import { candidateTerms, hasGap, patternParts, phraseForms, prepareText, termMatchesIn, termMatchesInTarget, wordAgrees, wordTokens } from './glossary';
import type { Term } from './qa';

/**
 * A glossary term found in a text: where, and which term. `start`/`end` are the first part; a pattern («take … off») has a range
 * for every part in `parts` (the words in its gaps are not part of it, and can be hits of their own).
 */
export interface TermHit<T extends Term = Term> { start: number; end: number; term: T; parts?: [number, number][] }

const SEPARATOR = /^[\s\-–—]+$/;

/** Longest first at the same place, no two hits overlapping (the parts of a pattern are compared one by one: a term may stand in its gap). */
function disjoint<T extends Term>(hits: TermHit<T>[]): TermHit<T>[] {
  const size = (h: TermHit<T>): number => (h.parts ?? [[h.start, h.end]]).reduce((n, [a, b]) => n + (b - a), 0);
  hits.sort((a, b) => a.start - b.start || size(b) - size(a));
  const out: TermHit<T>[] = [], taken: [number, number][] = [];
  for (const h of hits) {
    const ps = h.parts ?? [[h.start, h.end]];
    if (ps.some(([a, b]) => taken.some(([c, d]) => a < d && b > c))) continue;
    out.push(h);
    taken.push(...ps);
  }
  return out;
}

const hitOf = <T extends Term>(m: [number, number][], term: T): TermHit<T> => (m.length > 1 ? { start: m[0]![0], end: m[0]![1], term, parts: m } : { start: m[0]![0], end: m[0]![1], term });

/** Where the glossary's English terms stand in an original (any plural, verb or spelling form). */
export function sourceTermHits<T extends Term>(source: string, terms: T[]): TermHit<T>[] {
  const p = prepareText(source), hits: TermHit<T>[] = [];
  for (const t of candidateTerms(p, terms)) for (const m of termMatchesIn(p, t.en)) hits.push(hitOf(m, t));
  return disjoint(hits);
}

/**
 * Where the Ukrainian rendering of a term (or one of its alternatives) stands in a translation. Words are compared by
 * their stems, so any case or number is found; a phrase must stand together (words separated by spaces or hyphens).
 */
export function termRangesInTarget(text: string, uk: string, alt: string[] = []): [number, number][] {
  return termMatchesOfPhrases(text, uk, alt).flat();
}

/** The same, one list of ranges per occurrence (a pattern has a range for each of its parts). */
export function termMatchesOfPhrases(text: string, uk: string, alt: string[] = []): [number, number][][] {
  const toks = wordTokens(text), out: [number, number][][] = [];
  for (const phrase of [uk, ...alt]) {
    if (hasGap(phrase) && patternParts(phrase).length > 1) { out.push(...termMatchesInTarget(text, phrase)); continue; }
    const need = wordTokens(patternParts(phrase).join(' ')).map(t => t.keys[0]!);
    if (!need.length) continue;
    const bare = patternParts(phrase).join(' ');
    const forms = phraseForms(bare);
    for (let i = 0; i + need.length <= toks.length; i++) {
      let ok = true;
      for (let j = 0; j < need.length && ok; j++) ok = wordAgrees(forms, j, text.slice(toks[i + j]!.start, toks[i + j]!.end), toks[i + j]!.keys[0]!, need[j]!) && (j === 0 || SEPARATOR.test(text.slice(toks[i + j - 1]!.end, toks[i + j]!.start)));
      if (ok) out.push([[toks[i]!.start, toks[i + need.length - 1]!.end]]);
    }
  }
  return out;
}

/** The renderings of the terms that occur in the original, as they stand in the translation. */
export function targetTermHits<T extends Term>(target: string, termsInSource: T[]): TermHit<T>[] {
  const hits: TermHit<T>[] = [];
  for (const t of termsInSource) for (const m of termMatchesOfPhrases(target, t.uk, t.alt)) hits.push(hitOf(m, t));
  return disjoint(hits);
}
