import { describe, expect, it } from 'vitest';
import { historyRows, restoreNote, sideOf } from '../src/core';
import type { HistoryItem } from '../src/core';

const rec = (at: number, what: string, text: string, prev?: string): HistoryItem => ({ at, who: 'Я', what, text, ...(prev !== undefined ? { prev: { target: prev, status: 'draft' as const } } : {}) });

describe('historyRows', () => {
  it('newest first, each record compared with the text before it', () => {
    const rows = historyRows([rec(1, 'надіслано', 'Привіт'), rec(2, 'правка', 'Вітаю')], 'Вітаю');
    expect(rows.map(r => r.rec.at)).toEqual([2, 1]);
    // The older record has nothing before it; the newer one follows it.
    expect(rows[1]!.before).toBe('');
    expect(rows[0]!.before).toBe('Привіт');
    expect(rows[0]!.diff.filter(s => s.t === 'del').map(s => s.text)).toEqual(['Привіт']);
    expect(rows[0]!.diff.filter(s => s.t === 'add').map(s => s.text)).toEqual(['Вітаю']);
  });

  it('a snapshot beats the record before it', () => {
    const rows = historyRows([rec(1, 'надіслано', 'Привіт'), rec(2, 'очищено', '', 'Привіт!')], '');
    expect(rows[0]!.before).toBe('Привіт!');
    expect(sideOf(rows[0]!.diff, 'before')).toBe('Привіт!');
    expect(rows[0]!.canRestore).toBe(false); // nothing to bring back from an empty text…
    expect(rows[0]!.canRestoreBefore).toBe(true); // …but what was cleared can come back
  });

  it('the version the row holds now is marked and cannot be restored again', () => {
    const rows = historyRows([rec(1, 'a', 'один'), rec(2, 'b', 'два')], 'два');
    expect(rows[0]).toMatchObject({ isCurrent: true, canRestore: false });
    expect(rows[1]).toMatchObject({ isCurrent: false, canRestore: true });
  });

  it('what was before is offered only when it differs from the current text and from the record', () => {
    const rows = historyRows([rec(1, 'a', 'один'), rec(2, 'b', 'два', 'один')], 'три');
    expect(rows[0]!.canRestoreBefore).toBe(true);
    const same = historyRows([rec(1, 'a', 'один'), rec(2, 'b', 'два', 'один')], 'один');
    expect(same[0]!.canRestoreBefore).toBe(false);
  });

  it('records without text (returned to the translator) have no changes and nothing to restore', () => {
    const rows = historyRows([rec(1, 'повернуто перекладачу', '')], 'щось');
    expect(rows[0]).toMatchObject({ diff: [], canRestore: false, canRestoreBefore: false });
  });

  it('no history at all', () => {
    expect(historyRows(undefined, 'x')).toEqual([]);
    expect(historyRows([], 'x')).toEqual([]);
  });

  it('the note of a restore says which version came back', () => {
    expect(restoreNote(rec(1, 'вичитано', 'x'), 'text', '05.11 12:30')).toBe('відновлено версію від 05.11 12:30 (вичитано)');
    expect(restoreNote(rec(1, 'очищено', ''), 'before', '05.11 12:30')).toContain('перед дією «очищено»');
  });
});
