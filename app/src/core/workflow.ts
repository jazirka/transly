import { activeIssues, DEFAULT_QA } from './qa';
import type { QaOptions } from './qa';
import { isMessageUnit, wrapMessage } from './wrap';
import { nextMt } from './model';
import type { Comment, Entry, Unit } from './model';

/** Which pass the user is working in. */
export type Stage = 'translate' | 'review';

const blank = (): Entry => ({ target: '', status: 'new', mt: 0 });
export const HISTORY_LIMIT = 50;

/** Append a history record (immutably), keeping only the newest entries. */
export function note(e: Entry, what: string, text: string, who: string, now: number): Entry {
  const history = [...(e.history ?? []), { at: now, who, what, text }].slice(-HISTORY_LIMIT);
  return { ...e, history };
}

/** Short stable hash of a text (FNV-1a), enough to tell two comments of the same author and second apart. */
const hash = (t: string): string => { let h = 0x811c9dc5; for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(36); };

/** Id of a comment: the one it was given, or one derived from its author, time and text (older comments have none). */
export const commentId = (c: Comment): string => c.id ?? `${c.at}.${hash(c.who + '\u0001' + c.text)}`;

/**
 * Add a comment. A comment is not a change of the translation, so `mt` stays as it is: a comment written on a device
 * that has not seen the newest translation yet must not win a merge over it.
 */
export function addComment(e: Entry | undefined, who: string, text: string, now: number, replyTo?: string): Entry {
  const base = e ?? blank();
  const c: Comment = { who, at: now, text, id: `${now}.${hash(who + '\u0001' + text)}`, ...(replyTo ? { re: replyTo } : {}) };
  return { ...base, comments: [...(base.comments ?? []), c] };
}

/** Ignore (or stop ignoring) one QA warning of a row. It has its own clock and does not touch `mt`. */
export function setIgnored(e: Entry, key: string, on: boolean, now: number): Entry {
  const cur = e.ign ?? [];
  return { ...e, ign: on ? [...new Set([...cur, key])] : cur.filter(k => k !== key), ignAt: now };
}

/** Apply a text edit. Returns the new entry (the input is never mutated). */
export function edit(prev: Entry | undefined, unit: Unit, text: string, stage: Stage, now: number): Entry {
  const e = { ...(prev ?? blank()) };
  e.target = text;
  e.src = unit.source;
  e.mt = nextMt(prev?.mt, now);
  if (!text) { e.status = 'new'; e.returned = false; return e; }
  // In the translate pass any finished state drops back to draft; in review only a brand new row becomes a draft.
  if (stage === 'translate') { if (e.status === 'new' || e.status === 'done' || e.status === 'appr') e.status = 'draft'; }
  else if (e.status === 'new') e.status = 'draft';
  return e;
}

export type SubmitResult = { ok: true; entry: Entry } | { ok: false; reason: string };

export interface SubmitOptions { blockErrors: boolean; qa: QaOptions }

/** Send to review (translate pass) or approve (review pass). */
export function submit(prev: Entry | undefined, unit: Unit, stage: Stage, now: number, opts: SubmitOptions = { blockErrors: true, qa: DEFAULT_QA }): SubmitResult {
  if (!prev || !prev.target.trim()) return { ok: false, reason: 'Переклад порожній' };
  if (stage === 'translate') {
    if (prev.status === 'done') return { ok: false, reason: 'Рядок уже надіслано' };
    if (prev.status === 'appr') return { ok: false, reason: 'Рядок уже вичитано' };
  } else if (prev.status !== 'done' && prev.status !== 'appr') {
    return { ok: false, reason: 'Рядок ще не надіслано' };
  }
  // The wrapping mode «in the text»: the line breaks are put in when the row is sent, so what is reviewed is what the game shows.
  const plan = opts.qa.wrap;
  if (stage === 'translate' && plan?.settings.mode === 'text' && isMessageUnit(unit)) {
    const w = wrapMessage(plan, unit, prev.target);
    if (w.changed) prev = { ...prev, target: w.text };
  }
  if (opts.blockErrors) {
    const errors = activeIssues(unit, prev, opts.qa).filter(i => i.severity === 'bad');
    if (errors.length) return { ok: false, reason: 'Є помилка QA: ' + errors.map(i => i.message).join('; ') };
  }
  const e = { ...prev, mt: nextMt(prev.mt, now), src: unit.source };
  if (stage === 'translate') { e.status = 'done'; e.orig = e.target; e.returned = false; }
  else e.status = 'appr';
  return { ok: true, entry: e };
}

/**
 * Approve a row in one step: a draft is sent first (so the history can tell both), then approved. Refused with a reason
 * when there is no translation, or when a QA error blocks the send. A row that is already approved stays approved.
 */
export function approveEntry(prev: Entry | undefined, unit: Unit, now: number, opts: SubmitOptions = { blockErrors: true, qa: DEFAULT_QA }): SubmitResult {
  if (!prev || !prev.target.trim()) return { ok: false, reason: 'Переклад порожній' };
  let next = prev;
  if (next.status !== 'done' && next.status !== 'appr') {
    const r = submit(next, unit, 'translate', now, opts);
    if (!r.ok) return r;
    next = r.entry;
  }
  return submit(next, unit, 'review', now, opts);
}

/** Reviewer sends a unit back to the translator. */
export function sendBack(prev: Entry, now: number): Entry {
  return { ...prev, status: 'draft', returned: true, mt: nextMt(prev.mt, now) };
}

/** True when the game's original text changed after this translation was written. */
export const sourceChanged = (entry: Entry | undefined, unit: Unit): boolean =>
  !!entry && !!entry.target && entry.src !== undefined && entry.src !== unit.source;

/**
 * Called after re-reading game files: translated units whose original changed go back to draft
 * so they cannot slip into a build unnoticed. Returns the keys that were downgraded.
 */
export function reconcile(units: Unit[], entries: Record<string, Entry>, now: number): string[] {
  const changed: string[] = [];
  for (const u of units) {
    const e = entries[u.key];
    if (!sourceChanged(e, u) || !e) continue;
    changed.push(u.key);
    if (e.status === 'done' || e.status === 'appr') entries[u.key] = { ...e, status: 'draft', mt: nextMt(e.mt, now) };
  }
  return changed;
}
