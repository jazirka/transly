import type { Entry, Unit } from './model';

/**
 * How far the work has got: one set of definitions for every place that shows it (file tree, top bar, status bar, scenes,
 * groups, the phone, the widget). A row is in exactly one of four states:
 *  - untranslated: there is no text (a row with only spaces counts as none);
 *  - draft: there is text, and it was not sent;
 *  - sent: sent for review, not proofread yet;
 *  - approved: proofread.
 * «Перекладено» means everything but untranslated; the percentages are made by `pct`, always the same way.
 */
export type RowState = 'untranslated' | 'draft' | 'sent' | 'approved';

export const rowState = (e: Pick<Entry, 'target' | 'status'> | undefined): RowState =>
  !e || !e.target || !e.target.trim() ? 'untranslated' : e.status === 'appr' ? 'approved' : e.status === 'done' ? 'sent' : 'draft';

export interface Progress { total: number; untranslated: number; draft: number; sent: number; approved: number; /** Everything with text: draft + sent + approved. */ translated: number }

export const emptyProgress = (): Progress => ({ total: 0, untranslated: 0, draft: 0, sent: 0, approved: 0, translated: 0 });

/** Count one row into `p`. */
export function countRow(p: Progress, e: Pick<Entry, 'target' | 'status'> | undefined): void {
  p.total++;
  const st = rowState(e);
  p[st]++;
  if (st !== 'untranslated') p.translated++;
}

/** The progress of the given units, with their entries looked up by key. */
export function progressOf(units: Unit[], entries: Record<string, Entry | undefined>): Progress {
  const p = emptyProgress();
  for (const u of units) countRow(p, entries[u.key]);
  return p;
}

/** The sum of several progresses (the whole project from its files). */
export function sumProgress(list: Progress[]): Progress {
  const p = emptyProgress();
  for (const q of list) { p.total += q.total; p.untranslated += q.untranslated; p.draft += q.draft; p.sent += q.sent; p.approved += q.approved; p.translated += q.translated; }
  return p;
}

/**
 * A percentage for the screen. Rounded down, but a state that is not complete never shows 100 (995 of 1000 is 99, not 100)
 * and a state that has begun never shows 0 (1 of 1000 is 1).
 */
export const pct = (n: number, total: number): number => (total <= 0 || n <= 0 ? 0 : n >= total ? 100 : Math.min(99, Math.max(1, Math.floor((100 * n) / total))));
