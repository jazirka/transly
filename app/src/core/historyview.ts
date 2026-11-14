import type { HistoryItem } from './model';
import { diffWords } from './textdiff';
import type { DiffSeg } from './textdiff';

/**
 * The history of a row as it is shown: newest first, every record with the text before it and the changes it made, and
 * what can be brought back. A record keeps the text after the action (`text`) and, when the action had a snapshot, the
 * translation before it (`prev`); without a snapshot the text of the record before it stands in.
 */
export interface HistoryRow {
  /** Place of the record in the stored history (oldest = 0). */
  index: number;
  rec: HistoryItem;
  /** The translation before this record. */
  before: string;
  /** Changes from `before` to the text of the record. */
  diff: DiffSeg[];
  /** The record's text is what the row holds now. */
  isCurrent: boolean;
  /** This version can be brought back: it has text and differs from the current one. */
  canRestore: boolean;
  /** The version before the record can be brought back (a clearing or an overwrite can be taken back this way). */
  canRestoreBefore: boolean;
}

export function historyRows(history: HistoryItem[] | undefined, current: string): HistoryRow[] {
  const h = history ?? [];
  const rows: HistoryRow[] = h.map((rec, index) => {
    const before = rec.prev ? rec.prev.target : index > 0 ? h[index - 1]!.text : '';
    return {
      index, rec, before,
      diff: rec.text || before ? diffWords(before, rec.text) : [],
      // only the newest record can be the text that stands now (an older record with the same words, after a restore, is not)
      isCurrent: index === h.length - 1 && rec.text === current,
      canRestore: !!rec.text && rec.text !== current,
      canRestoreBefore: !!before && before !== current && before !== rec.text,
    };
  });
  return rows.reverse();
}

/** The sentence a restore leaves in the history. */
export const restoreNote = (rec: HistoryItem, which: 'text' | 'before', when: string): string =>
  which === 'text' ? `відновлено версію від ${when} (${rec.what})` : `відновлено текст, що був перед дією «${rec.what}» від ${when}`;
