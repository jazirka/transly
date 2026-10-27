import type { Entry, Translations } from './model';

export interface MergeResult { merged: Translations; conflicts: string[] }

/**
 * Merge two translation sets per unit, last writer wins (by `mt`).
 * A conflict is reported when both sides changed the same unit to different text;
 * the newer one is kept, so no data is lost silently and the caller can note it in history.
 */
export function merge(a: Translations, b: Translations): MergeResult {
  const merged: Translations = { ...a };
  const conflicts: string[] = [];
  for (const [key, eb] of Object.entries(b)) {
    const ea: Entry | undefined = merged[key];
    if (!ea) { merged[key] = eb; continue; }
    if (ea.target !== eb.target && ea.mt > 0 && eb.mt > 0) conflicts.push(key);
    if (eb.mt > ea.mt) merged[key] = eb;
  }
  return { merged, conflicts };
}
