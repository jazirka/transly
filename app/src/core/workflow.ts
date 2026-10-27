import { activeIssues, DEFAULT_QA } from './qa';
import type { QaOptions } from './qa';
import type { Entry, Unit } from './model';

/** Which pass the user is working in. */
export type Stage = 'translate' | 'review';

const blank = (): Entry => ({ target: '', status: 'new', mt: 0 });
const HISTORY_LIMIT = 50;

/** Append a history record (immutably), keeping only the newest entries. */
export function note(e: Entry, what: string, text: string, who: string, now: number): Entry {
  const history = [...(e.history ?? []), { at: now, who, what, text }].slice(-HISTORY_LIMIT);
  return { ...e, history };
}

export function addComment(e: Entry | undefined, who: string, text: string, now: number): Entry {
  const base = e ?? blank();
  return { ...base, mt: Math.max(base.mt, now), comments: [...(base.comments ?? []), { who, at: now, text }] };
}

/** Apply a text edit. Returns the new entry (the input is never mutated). */
export function edit(prev: Entry | undefined, unit: Unit, text: string, stage: Stage, now: number): Entry {
  const e = { ...(prev ?? blank()) };
  e.target = text;
  e.src = unit.source;
  e.mt = now;
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
    if (prev.status === 'done') return { ok: false, reason: 'Рядок уже очікує вичитування' };
    if (prev.status === 'appr') return { ok: false, reason: 'Рядок уже вичитано' };
  } else if (prev.status !== 'done' && prev.status !== 'appr') {
    return { ok: false, reason: 'Рядок ще не надіслано на вичитування' };
  }
  if (opts.blockErrors) {
    const errors = activeIssues(unit, prev, opts.qa).filter(i => i.severity === 'bad');
    if (errors.length) return { ok: false, reason: 'Є помилка QA: ' + errors.map(i => i.message).join('; ') };
  }
  const e = { ...prev, mt: now, src: unit.source };
  if (stage === 'translate') { e.status = 'done'; e.orig = e.target; e.returned = false; }
  else e.status = 'appr';
  return { ok: true, entry: e };
}

/** Reviewer sends a unit back to the translator. */
export function sendBack(prev: Entry, now: number): Entry {
  return { ...prev, status: 'draft', returned: true, mt: now };
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
    if (e.status === 'done' || e.status === 'appr') entries[u.key] = { ...e, status: 'draft', mt: now };
  }
  return changed;
}
