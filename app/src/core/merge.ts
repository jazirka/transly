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

const STATUS_RANK: Record<string, number> = { new: 0, draft: 1, done: 2, appr: 3 };

/**
 * The version of a row that wins. The later `mt` wins; when both were changed in the same millisecond the answer must not
 * depend on which copy is `a` (two devices merging each other's file would otherwise keep different texts for good):
 * the further status, then the greater text, then the other translation fields decide, the same on both devices.
 */
function newerOf(a: Entry, b: Entry): Entry {
  if (a.mt !== b.mt) return b.mt > a.mt ? b : a;
  const ra = STATUS_RANK[a.status] ?? 0, rb = STATUS_RANK[b.status] ?? 0;
  if (ra !== rb) return rb > ra ? b : a;
  if (a.target !== b.target) return b.target > a.target ? b : a;
  // Only the fields that belong to the translation itself: comments, history and ignored warnings are merged separately, and
  // looking at them here would make the choice depend on what earlier merges had already combined (not associative).
  const ka = JSON.stringify([a.src ?? '', a.orig ?? '', a.returned ? 1 : 0]), kb = JSON.stringify([b.src ?? '', b.orig ?? '', b.returned ? 1 : 0]);
  return kb > ka ? b : a;
}

const sameHistory = (h: HistoryItem): string => `${h.at}\u0001${h.who}\u0001${h.what}\u0001${h.text}`;

/**
 * Merge two versions of one row. The translation itself (text, status, review marks) comes from the side that was
 * changed later; comments, history and ignored warnings are combined, because they are written independently of the
 * translation and nothing here may be lost to a newer edit on the other side.
 */
export function mergeEntry(a: Entry, b: Entry): Entry {
  const win = newerOf(a, b);
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
