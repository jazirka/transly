import type { FileView, SavedProject } from './project';

export interface Variant { target: string; where: { file: string; key: string }[] }
export interface Inconsistency { source: string; variants: Variant[]; total: number }

/** The same original translated in different ways: a sign of drift (or of a context that really differs). */
export function inconsistencies(views: FileView[], saved: SavedProject, maxGroups = 300): Inconsistency[] {
  const bySource = new Map<string, Map<string, { file: string; key: string }[]>>();
  for (const v of views) {
    const ents = saved.files[v.name];
    if (!ents) continue;
    for (const u of v.units) {
      const t = ents[u.key]?.target?.trim();
      const src = u.source.trim();
      if (!t || src.length < 2) continue;
      const m = bySource.get(src) ?? new Map();
      const w = m.get(t) ?? [];
      w.push({ file: v.name, key: u.key });
      m.set(t, w); bySource.set(src, m);
    }
  }
  const out: Inconsistency[] = [];
  for (const [source, m] of bySource) {
    if (m.size < 2) continue;
    const variants = [...m].map(([target, where]) => ({ target, where })).sort((a, b) => b.where.length - a.where.length);
    out.push({ source, variants, total: variants.reduce((n, x) => n + x.where.length, 0) });
  }
  return out.sort((a, b) => b.total - a.total).slice(0, maxGroups);
}
