/** Links to online dictionaries for the words of a line. The pages open in the browser; nothing is fetched. */

/** `Тлумачення` = meaning, `Синоніми` = synonyms: both are pages of goroh.pp.ua (Ukrainian). */
export type GorohKind = 'Тлумачення' | 'Синоніми';

export const gorohUrl = (word: string, kind: GorohKind = 'Тлумачення'): string => `https://goroh.pp.ua/${encodeURIComponent(kind)}/${encodeURIComponent(word.toLowerCase())}`;
/** Multitran: English (1) to Ukrainian (33). */
export const multitranUrl = (word: string): string => `https://www.multitran.com/m.exe?l1=1&l2=33&s=${encodeURIComponent(word)}`;

const CODES = /\\[A-Za-z]+(\[[^\]]*\])?|\\[.|!<>^{}$]/g;

/** The distinct words of a line (game control codes dropped), in order of appearance. */
export function wordsOf(text: string, limit = 24): string[] {
  const seen = new Set<string>(), out: string[] = [];
  for (const m of text.replace(CODES, ' ').matchAll(/\p{L}[\p{L}'’-]*/gu)) {
    const w = m[0].replace(/[-'’]+$/, '');
    const k = w.toLowerCase();
    if ([...w].length < 2 || seen.has(k)) continue;
    seen.add(k); out.push(w);
    if (out.length >= limit) break;
  }
  return out;
}
