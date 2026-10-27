import type { Term } from './qa';

/** Terms whose English form occurs in the source text (whole-word, case-insensitive). */
export function termsIn(source: string, terms: Term[]): Term[] {
  const lower = source.toLowerCase();
  return terms.filter(t => {
    const en = t.en.toLowerCase().trim();
    if (!en) return false;
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${en.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'iu');
    return re.test(lower);
  });
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
