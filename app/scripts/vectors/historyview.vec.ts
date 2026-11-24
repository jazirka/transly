import { test } from 'vitest';
import type { HistoryItem } from '../../src/core/model';
import { activityKind, dayLabel, historyRows, restoreNote } from '../../src/core/historyview';
import { diffCounts, diffWords, sideOf } from '../../src/core/textdiff';
import { rng, text, writeVectors } from './util';

const WORDS = ['Привіт', 'світе', "п'ять", 'сім’я', 'a-b', 'hello', 'World', '  ', ',', '.', '!', '\n', '\t', '123', '1.5', 'я', '😀', ' ', '﻿', '\u0085', 'е́', '—'];

test('export historyview vectors', () => {
  process.env.TZ = 'Europe/Kyiv';
  const r = rng(555);
  const out: Record<string, { input: unknown; output: unknown }[]> = {};
  const add = (name: string, input: unknown, output: unknown) => (out[name] ??= []).push({ input, output });
  const phrase = (n = 8): string => Array.from({ length: r.int(n + 1) }, () => r.pick(WORDS)).join(r.pick([' ', '', ' ']));

  for (let i = 0; i < 400; i++) {
    const a = phrase(), b = r.chance(0.6) ? mutate(a) : phrase();
    const segs = diffWords(a, b);
    add('diff', { a, b }, { segs, before: sideOf(segs, 'before'), after: sideOf(segs, 'after'), counts: diffCounts(segs) });
  }
  // long enough to be shown as replaced
  { const a = Array.from({ length: 1500 }, (_, i) => `a${i}`).join(' '), b = Array.from({ length: 1500 }, (_, i) => `b${i}`).join(' '); const segs = diffWords(a, b); add('diff', { a, b }, { segs, before: sideOf(segs, 'before'), after: sideOf(segs, 'after'), counts: diffCounts(segs) }); }

  for (let i = 0; i < 200; i++) {
    const n = r.int(5);
    const history: HistoryItem[] = [];
    for (let k = 0; k < n; k++) history.push({ at: r.chance(0.1) ? 0 : 1_700_000_000_000 + k * 1000, who: 'me', what: r.pick(['send', 'надіслано', 'правка', 'вичитано ✓', 'відновлено версію', 'повернено', 'затверджено', '']), text: r.pick(['', phrase(3), phrase(3)]), ...(r.chance(0.3) ? { prev: { target: phrase(3), status: 'draft' as const } } : {}) });
    const current = r.chance(0.5) && history.length ? history[history.length - 1]!.text : phrase(3);
    add('rows', { history, current }, historyRows(history, current));
    if (history.length) { const rec = history[0]!; add('restore', { rec, which: 'text', when: '14 листопада' }, restoreNote(rec, 'text', '14 листопада')); add('restore', { rec, which: 'before', when: 'вчора' }, restoreNote(rec, 'before', 'вчора')); }
  }
  add('rows', { history: null, current: 'x' }, historyRows(undefined, 'x'));

  for (const w of ['send', 'надіслано 3', 'вичитано', 'затверджено', 'відновлено текст', 'повернено', 'edit', '', 'x']) add('activity', w, activityKind(w));

  // day labels (the offset of Europe/Kyiv, with summer time)
  const NOW = Date.UTC(2026, 10, 24, 10, 0, 0);
  const marks = [0, NOW, NOW - 3_600_000, NOW - 11 * 3_600_000, NOW - 20 * 3_600_000, NOW - 30 * 3_600_000, NOW - 86_400_000 * 2, NOW - 86_400_000 * 40, NOW - 86_400_000 * 400, NOW - 86_400_000 * 200, Date.UTC(2026, 2, 29, 0, 30), Date.UTC(2026, 2, 29, 12), Date.UTC(2026, 9, 25, 0, 30), Date.UTC(2026, 9, 25, 23), Date.UTC(2025, 11, 31, 22, 30), Date.UTC(2026, 0, 1, 0, 30), NOW + 86_400_000];
  const nows = [NOW, Date.UTC(2026, 2, 30, 8), Date.UTC(2026, 9, 26, 8), Date.UTC(2027, 0, 1, 23, 30), Date.UTC(2026, 5, 15, 21, 30)];
  for (const now of nows) for (const at of marks) add('day', { at, now }, dayLabel(at, now));
  add('tz', { probe: [Date.UTC(2026, 0, 1), Date.UTC(2026, 6, 1)] }, [new Date(Date.UTC(2026, 0, 1)).getTimezoneOffset(), new Date(Date.UTC(2026, 6, 1)).getTimezoneOffset()]);
  writeVectors('historyview', out);

  function mutate(s: string): string {
    const parts = s.split(' ');
    if (!parts.length) return s + r.pick(WORDS);
    const k = r.int(parts.length);
    parts[k] = r.pick(['', r.pick(WORDS), text(r, 3)]);
    if (r.chance(0.3)) parts.splice(r.int(parts.length + 1), 0, r.pick(WORDS));
    return parts.join(' ');
  }
});
