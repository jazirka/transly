import { hasGap, patternParts, termsIn, wordTokens } from './glossary';
import type { Term } from './qa';
import { sourceTermHits, targetTermHits } from './termmatch';
import { targetHasTerm } from './glossary';

/**
 * The strands of a row (the threads of the interface): each glossary entry the original contains, with where it stands in the original and where the
 * translation renders it. A word is one range at each end; a pattern («take … off») has a range for each of its parts, and
 * the words between them stay free. Worked out from the texts, never stored.
 */

export type StrandKind = 'word' | 'phrase' | 'construction';
/** ok: the entry's own rendering; alt: an acceptable alternative; missing: the translation has neither; pending: nothing translated yet. */
export type StrandState = 'ok' | 'alt' | 'missing' | 'pending';

export interface Strand<T extends Term = Term> {
  term: T;
  kind: StrandKind;
  /** The parts in the original (one for a word, more for a construction). */
  src: [number, number][];
  /** The parts where the translation renders it; empty when it does not. */
  dst: [number, number][];
  state: StrandState;
  /** Which of the row's colours it wears (0…COLORS-1, in the order the entries stand in the original). */
  ci: number;
}

/** How many colours the threads have; a row with more entries wraps round. */
export const COLORS = 6;

export function strandKind(en: string): StrandKind {
  if (hasGap(en) && patternParts(en).length > 1) return 'construction';
  return wordTokens(en).length > 1 ? 'phrase' : 'word';
}

const flat = (h: { start: number; end: number; parts?: [number, number][] } | undefined): [number, number][] => (h ? h.parts ?? [[h.start, h.end]] : []);

/** The strands of a row (the threads of the interface), in the order their first part stands in the original. One strand per entry (the first place it occurs). */
export function strandsOf<T extends Term>(source: string, target: string, terms: T[]): Strand<T>[] {
  const out: Strand<T>[] = [];
  const seen = new Set<T>();
  for (const h of sourceTermHits(source, termsIn(source, terms))) {
    if (seen.has(h.term)) continue;
    seen.add(h.term);
    const t = h.term;
    const dst = target.trim() ? flat(targetTermHits(target, [t])[0]) : [];
    const state: StrandState = !target.trim() ? 'pending' : targetHasTerm(target, t.uk) ? 'ok' : t.alt?.length && targetHasTerm(target, t.alt[0]!, t.alt.slice(1)) ? 'alt' : 'missing';
    out.push({ term: t, kind: strandKind(t.en), src: flat(h), dst, state, ci: out.length % COLORS });
  }
  return out;
}
