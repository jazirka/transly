import type { FileView, SavedProject } from './project';

export interface FindOptions { find: string; replace: string; caseSensitive: boolean; wholeWord: boolean }
export interface FindMatch { file: string; key: string; source: string; before: string; after: string; count: number }

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Every translation containing the text, with what it would become. Nothing is changed here. */
export function findReplace(views: FileView[], saved: SavedProject, o: FindOptions, limit = 2000): FindMatch[] {
  if (!o.find) return [];
  const body = esc(o.find);
  const re = new RegExp(o.wholeWord ? `(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])` : body, o.caseSensitive ? 'gu' : 'giu');
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
