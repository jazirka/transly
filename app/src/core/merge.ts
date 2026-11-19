import type { Comment, Entry, HistoryItem, Translations } from './model';
import { byDrop, byVote, laterDrop, laterVote, voteId } from './variants';
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
  const sa = a.ed ?? a.at, sb = b.ed ?? b.at;
  // the same stamp on different texts (two devices, one millisecond): the greater form wins, on both devices alike
  const textFrom = sb !== sa ? (sb > sa ? b : a) : (JSON.stringify(b) > JSON.stringify(a) ? b : a);
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

/** The wording of the history record that keeps a translation which a merge replaced (the same on every device, so merges still agree). */
export const OTHER_DEVICE = 'інший пристрій';
export const REPLACED_WHAT = 'версія з іншого пристрою, замінена пізнішою правкою';
export const RESET_WHAT = 'переклад, який відкинуло скидання проєкту (годинник пристрою, що скидав, міг спішити)';

/**
 * Records that keep a translation another device lost carry no time (`at` is 0) and are identified by their text alone: the same lost
 * text could otherwise be recorded with different times depending on the order in which three copies are merged, and the merge must
 * not depend on that. The history shows them as versions from another device, after the dated records.
 */
const isKept = (h: HistoryItem): boolean => h.who === OTHER_DEVICE && (h.what === REPLACED_WHAT || h.what === RESET_WHAT);
const sameHistory = (h: HistoryItem): string => (isKept(h) ? `kept\u0001${h.what}\u0001${h.text}` : `${h.at}\u0001${h.who}\u0001${h.what}\u0001${h.text}`);
/** Oldest first; records of the same time in a fixed order, so that the order of a merge does not show in the result. */
const byTime = (x: HistoryItem, y: HistoryItem): number => x.at - y.at || (sameHistory(x) < sameHistory(y) ? -1 : sameHistory(x) > sameHistory(y) ? 1 : 0);
/** Of two records of the same lost text, the earlier one stays (so that every order of merging gives the same record). */
const earlier = (a: HistoryItem, b: HistoryItem): HistoryItem => (isKept(a) && b.at < a.at ? b : a);

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
  const votes = unionBy(a.votes, b.votes, voteId, laterVote);
  if (votes) out.votes = votes === a.votes || votes === b.votes ? votes : [...votes].sort(byVote);
  else delete out.votes;
  const drops = unionBy(a.drops, b.drops, d => d.on, laterDrop);
  if (drops) out.drops = drops === a.drops || drops === b.drops ? drops : [...drops].sort(byDrop);
  else delete out.drops;
  const history = unionBy(a.history, b.history, sameHistory, earlier);
  if (history) out.history = history === a.history || history === b.history ? history : history.sort(byTime).slice(-HISTORY_LIMIT);
  else delete out.history;
  // A kept translation that is the row's text again (an older version that won in the end) is not a lost version any more. Without
  // this the record would exist or not depending on the order in which three copies were merged.
  if (out.history?.some(h => isKept(h) && h.text === out.target)) {
    const rest = out.history.filter(h => !(isKept(h) && h.text === out.target));
    if (rest.length) out.history = rest; else delete out.history;
  }
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
    const entry = mergeEntry(ea, eb);
    if (ea.target !== eb.target && ea.mt > since && eb.mt > since) {
      conflicts.push(key);
      // the version that lost is not thrown away: its text goes into the row's history, where it can be brought back
      const loser = newerOf(ea, eb) === ea ? eb : ea;
      if (loser.target.trim() && loser.target !== entry.target) {
        const kept: HistoryItem = { at: 0, who: OTHER_DEVICE, what: REPLACED_WHAT, text: loser.target };
        const h = unionBy(entry.history, [kept], sameHistory, earlier) ?? [kept];
        entry.history = h === entry.history ? h : [...h].sort(byTime).slice(-HISTORY_LIMIT);
      }
    }
    merged[key] = entry;
  }
  return { merged, conflicts };
}
