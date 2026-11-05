import type { Comment, Entry, HistoryItem, Translations } from './model';
import { HISTORY_LIMIT, commentId } from './workflow';

export interface MergeResult { merged: Translations; conflicts: string[] }

/** `x` followed by what `y` has that `x` lacks. Returns `x` itself when `y` adds nothing, so unchanged data keeps its identity. */
function unionBy<T>(x: T[] | undefined, y: T[] | undefined, id: (v: T) => string, pick?: (a: T, b: T) => T): T[] | undefined {
  if (!y?.length) return x;
  if (!x?.length) return y;
  const byId = new Map<string, T>();
  for (const v of x) byId.set(id(v), v);
  let changed = false;
  for (const v of y) {
    const k = id(v), had = byId.get(k);
    if (had === undefined) { byId.set(k, v); changed = true; }
    else if (pick) { const w = pick(had, v); if (w !== had) { byId.set(k, w); changed = true; } }
  }
  return changed ? [...byId.values()] : x;
}

/** Two versions of one comment: the text of the later edit, the later resolve state. */
function pickComment(a: Comment, b: Comment): Comment {
  const textFrom = (b.ed ?? b.at) > (a.ed ?? a.at) ? b : a;
  const resFrom = (b.res?.at ?? 0) > (a.res?.at ?? 0) ? b : a;
  if (textFrom === resFrom || textFrom.res === resFrom.res) return textFrom;
  const { res: _res, ...rest } = textFrom;
  return resFrom.res ? { ...rest, res: resFrom.res } : rest;
}

const sameHistory = (h: HistoryItem): string => `${h.at}\u0001${h.who}\u0001${h.what}\u0001${h.text}`;

/**
 * Merge two versions of one row. The translation itself (text, status, review marks) comes from the side that was
 * changed later; comments, history and ignored warnings are combined, because they are written independently of the
 * translation and nothing here may be lost to a newer edit on the other side.
 */
export function mergeEntry(a: Entry, b: Entry): Entry {
  const win = b.mt > a.mt ? b : a;
  const out: Entry = { ...win };
  const comments = unionBy(a.comments, b.comments, commentId, pickComment);
  if (comments) out.comments = comments === a.comments || comments === b.comments ? comments : [...comments].sort((x, y) => x.at - y.at);
  else delete out.comments;
  const history = unionBy(a.history, b.history, sameHistory);
  if (history) out.history = history === a.history || history === b.history ? history : history.sort((x, y) => x.at - y.at).slice(-HISTORY_LIMIT);
  else delete out.history;
  // Ignored warnings: the side whose list changed later decides (so a warning can also be brought back); without clocks, both lists count.
  const aAt = a.ignAt ?? 0, bAt = b.ignAt ?? 0;
  if (aAt !== bAt) { const from = bAt > aAt ? b : a; if (from.ign) out.ign = from.ign; else delete out.ign; out.ignAt = Math.max(aAt, bAt); }
  else { const u = unionBy(a.ign, b.ign, k => k); if (u) out.ign = u; else delete out.ign; if (aAt) out.ignAt = aAt; }
  return out;
}

/**
 * Merge two translation sets per unit (see `mergeEntry`).
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
    merged[key] = mergeEntry(ea, eb);
  }
  return { merged, conflicts };
}
