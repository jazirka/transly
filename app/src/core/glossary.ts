import type { Term } from './qa';

/** A glossary entry. Imported dictionaries set `qa: false`: they help the translator but never raise QA warnings. */
export interface GlossaryTerm extends Term {
  mt: number;
  /** Other acceptable translations. */
  alt?: string[];
  note?: string;
  kind?: string;
  /** false = hint only, no QA check. Missing means true. */
  qa?: boolean;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whole-word, case-insensitive match of `en` in `text`; allows a plural/verb ending (s, es, ed, ing). */
export function hasTerm(text: string, en: string): boolean {
  const t = en.trim();
  if (!t) return false;
  return new RegExp(`(^|[^\\p{L}\\p{N}])${esc(t)}(?:s|es|ed|ing)?(?![\\p{L}\\p{N}])`, 'iu').test(text);
}

/** Terms whose English form occurs in the source text. */
export function termsIn<T extends Term>(source: string, terms: T[]): T[] {
  return terms.filter(t => hasTerm(source, t.en));
}

/**
 * Does `target` contain the Ukrainian term (or one of its alternatives)? Ukrainian words inflect, so every word
 * is compared by its stem (the word minus a short ending).
 */
export function targetHasTerm(target: string, uk: string, alt: string[] = []): boolean {
  const words = (s: string) => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const stem = (w: string) => (w.length >= 7 ? w.slice(0, -2) : w.length >= 4 ? w.slice(0, -1) : w);
  const hay = words(target);
  const has = (phrase: string) => {
    const need = words(phrase).map(stem);
    return need.length > 0 && need.every(n => hay.some(h => h.startsWith(n)));
  };
  return [uk, ...alt].some(has);
}

/** Parse "english<TAB>українською" lines (also accepts ;). Returns valid pairs and the count of rejected lines. */
export function parseTerms(text: string): { terms: Term[]; rejected: number } {
  const terms: Term[] = [];
  let rejected = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parts = line.includes('\t') ? line.split('\t') : line.split(';');
    const en = parts[0]?.trim(), uk = parts[1]?.trim();
    if (en && uk) terms.push({ en, uk }); else rejected++;
  }
  return { terms, rejected };
}
