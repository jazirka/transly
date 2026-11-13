import type { Entry, Unit } from './model';
import type { FileView, SavedProject } from './project';
import { knownStatus } from './model';
import { rowState } from './progress';
import { activeIssues } from './qa';
import { hasAdvice } from './qaadvice';
import type { QaOptions } from './qa';
import { sourceChanged } from './workflow';

/**
 * The rows that wait for the translator, in the order of the project (file after file, row after row): what to look at next,
 * not only in the open file but in the whole game. One definition of each kind, used by the menu, the keys, the counters and
 * the phone.
 *  - untranslated: no text yet;
 *  - error: has a QA error (a blocking one);
 *  - advice: has a QA advice;
 *  - unreviewed: sent, waiting for proofreading;
 *  - sourceChanged: the original changed after the translation was written.
 */
export type QueueKind = 'untranslated' | 'error' | 'advice' | 'unreviewed' | 'sourceChanged';

export interface QueueRow { file: string; key: string; /** Position of the row in the whole project (0-based). */ at: number }

/** The words for each kind, for messages and menus. */
export const QUEUE_LABEL: Record<QueueKind, { empty: string; title: string }> = {
  untranslated: { empty: 'Рядків без перекладу немає', title: 'Без перекладу' },
  error: { empty: 'Помилок QA немає', title: 'Помилка QA' },
  advice: { empty: 'Порад немає', title: 'Порада' },
  unreviewed: { empty: 'Рядків, що чекають вичитки, немає', title: 'На вичитку' },
  sourceChanged: { empty: 'Рядків зі зміненим оригіналом немає', title: 'Оригінал змінився' },
};

function isIn(kind: QueueKind, u: Unit, e: Entry | undefined, qa: QaOptions): boolean {
  switch (kind) {
    case 'untranslated': return rowState(e) === 'untranslated';
    case 'unreviewed': return rowState(e) === 'sent';
    case 'sourceChanged': return sourceChanged(e, u);
    case 'error': return !!e && !!e.target && knownStatus(e.status) !== 'new' && activeIssues(u, e, qa).some(i => i.severity === 'bad');
    case 'advice': return hasAdvice(u, e, qa);
  }
}

/** All rows of the kind in the project, in order. */
export function queueRows(views: FileView[], saved: SavedProject, kind: QueueKind, qa: QaOptions): QueueRow[] {
  const out: QueueRow[] = [];
  let at = 0;
  for (const v of views) {
    const ents = saved.files[v.name] ?? {};
    for (const u of v.units) {
      if (isIn(kind, u, ents[u.key], qa)) out.push({ file: v.name, key: u.key, at });
      at++;
    }
  }
  return out;
}

/** Where a row stands in the whole project; -1 when there is no such row. */
export function positionOf(views: FileView[], from: { file: string; key: string } | null): number {
  if (!from) return -1;
  let at = 0;
  for (const v of views) {
    if (v.name !== from.file) { at += v.units.length; continue; }
    const i = v.units.findIndex(u => u.key === from.key);
    return i < 0 ? -1 : at + i;
  }
  return -1;
}

/**
 * The next (dir 1) or previous (dir -1) row of the queue after position `at` (-1 = before the start), going round at the ends.
 * The row at `at` itself is not offered, unless it is the only one. Returns the row and its place in the queue (1-based).
 */
export function nextIn(rows: QueueRow[], at: number, dir: 1 | -1): { row: QueueRow; place: number } | null {
  if (!rows.length) return null;
  let i: number;
  if (dir === 1) { i = rows.findIndex(r => r.at > at); if (i < 0) i = 0; }
  else { let j = -1; for (let k = rows.length - 1; k >= 0; k--) if (rows[k]!.at < at) { j = k; break; } i = j < 0 ? rows.length - 1 : j; }
  return { row: rows[i]!, place: i + 1 };
}
