import type { FileView, SavedProject } from './project';

export interface FindOptions { find: string; replace: string; caseSensitive: boolean; wholeWord: boolean }
export interface FindMatch { file: string; key: string; source: string; before: string; after: string; count: number }

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The pattern for a piece of plain text (never a regular expression typed by someone): the apostrophe is written in several ways (' ’ ʼ `), and whichever
 * one is typed finds all of them; a whole word ends at a space or a sign, not at an apostrophe or a hyphen between letters («сім» is not the start of «сім’я»).
 */
export function literalPattern(find: string, wholeWord = false, caseSensitive = false): RegExp {
  const body = esc(find).replace(/['’ʼ`]/g, "['’ʼ`]");
  return new RegExp(wholeWord ? `(?<![\\p{L}\\p{N}])(?<![\\p{L}\\p{N}]['’ʼ\`])${body}(?![\\p{L}\\p{N}])(?!['’ʼ\`][\\p{L}\\p{N}])` : body, caseSensitive ? 'gu' : 'giu');
}

/** Every translation containing the text, with what it would become. Nothing is changed here. */
export function findReplace(views: FileView[], saved: SavedProject, o: FindOptions, limit = 2000): FindMatch[] {
  if (!o.find) return [];
  const re = literalPattern(o.find, o.wholeWord, o.caseSensitive);
  const out: FindMatch[] = [];
  for (const v of views) {
    const ents = saved.files[v.name];
    if (!ents) continue;
    for (const u of v.units) {
      const t = ents[u.key]?.target;
      if (!t) continue;
      let count = 0;
      const after = t.replace(re, () => { count++; return o.replace; });
      if (count) { out.push({ file: v.name, key: u.key, source: u.source, before: t, after, count }); if (out.length >= limit) return out; }
    }
  }
  return out;
}
