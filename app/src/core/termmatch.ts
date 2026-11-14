import { candidateTerms, phraseForms, prepareText, termRangesIn, wordAgrees, wordTokens } from './glossary';
import type { Term } from './qa';

/** A glossary term found in a text: where, and which term. */
export interface TermHit<T extends Term = Term> { start: number; end: number; term: T }

const SEPARATOR = /^[\s\-–—]+$/;

/** Longest first at the same place, no two hits overlapping. */
function disjoint<T extends Term>(hits: TermHit<T>[]): TermHit<T>[] {
  hits.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
  const out: TermHit<T>[] = [];
  for (const h of hits) if (!out.length || h.start >= out[out.length - 1]!.end) out.push(h);
  return out;
}

/** Where the glossary's English terms stand in an original (any plural, verb or spelling form). */
export function sourceTermHits<T extends Term>(source: string, terms: T[]): TermHit<T>[] {
  const p = prepareText(source), hits: TermHit<T>[] = [];
  for (const t of candidateTerms(p, terms)) for (const [start, end] of termRangesIn(p, t.en)) hits.push({ start, end, term: t });
  return disjoint(hits);
}

/**
 * Where the Ukrainian rendering of a term (or one of its alternatives) stands in a translation. Words are compared by
 * their stems, so any case or number is found; a phrase must stand together (words separated by spaces or hyphens).
 */
export function termRangesInTarget(text: string, uk: string, alt: string[] = []): [number, number][] {
  const toks = wordTokens(text), out: [number, number][] = [];
  for (const phrase of [uk, ...alt]) {
    const need = wordTokens(phrase).map(t => t.keys[0]!);
    if (!need.length) continue;
    const forms = phraseForms(phrase);
    for (let i = 0; i + need.length <= toks.length; i++) {
      let ok = true;
      for (let j = 0; j < need.length && ok; j++) ok = wordAgrees(forms, j, text.slice(toks[i + j]!.start, toks[i + j]!.end), toks[i + j]!.keys[0]!, need[j]!) && (j === 0 || SEPARATOR.test(text.slice(toks[i + j - 1]!.end, toks[i + j]!.start)));
      if (ok) out.push([toks[i]!.start, toks[i + need.length - 1]!.end]);
    }
  }
  return out;
}

/** The renderings of the terms that occur in the original, as they stand in the translation. */
export function targetTermHits<T extends Term>(target: string, termsInSource: T[]): TermHit<T>[] {
  const hits: TermHit<T>[] = [];
  for (const t of termsInSource) for (const [start, end] of termRangesInTarget(target, t.uk, t.alt)) hits.push({ start, end, term: t });
  return disjoint(hits);
}
