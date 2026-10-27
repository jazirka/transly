import type { Entry, Translations } from './model';

export interface MergeResult { merged: Translations; conflicts: string[] }

/**
 * Merge two translation sets per unit, last writer wins (by `mt`).
 * A conflict is reported when both sides changed the same unit to different text after `since`
 * (the time this device last synced; earlier edits were already seen by both sides);
 * the newer one is kept, so no data is lost silently and the caller can note it in history.
 */
export function merge(a: Translations, b: Translations, since = 0): MergeResult {
  const merged: Translations = { ...a };
  const conflicts: string[] = [];
  for (const [key, eb] of Object.entries(b)) {
    const ea: Entry | undefined = merged[key];
    if (!ea) { merged[key] = eb; continue; }
    if (ea.target !== eb.target && ea.mt > since && eb.mt > since) conflicts.push(key);
    if (eb.mt > ea.mt) merged[key] = eb;
  }
  return { merged, conflicts };
}
