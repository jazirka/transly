import { test } from 'vitest';
import type { Comment, Drop, Entry, HistoryItem, Status, Translations, Vote } from '../../src/core/model';
import { knownStatus, nextMt } from '../../src/core/model';
import { OTHER_DEVICE, REPLACED_WHAT, RESET_WHAT, merge, mergeEntry } from '../../src/core/merge';
import { castVote, sentVariants, setDropped, tallyOf, variantId, voteId } from '../../src/core/variants';
import { HISTORY_LIMIT, addComment, commentId, edit, note, reconcile, sendBack, setIgnored, sourceChanged } from '../../src/core/workflow';
import { KEYS, STATUSES, WHATS, WHOS, genComment, genDrop, genEntry, genHist, genSet, genVote, sibling, time } from './entrygen';
import { rng, text, writeVectors } from './util';

const unitOf = (key: string, source: string) => ({ key, source, speaker: '', kind: 'dialogue' as const, context: '' });

test('export merge vectors', () => {
  const r = rng(20261124);
  const N = 150;
  const out: Record<string, { input: unknown; output: unknown }[]> = {};
  const add = (name: string, input: unknown, output: unknown) => (out[name] ??= []).push({ input, output });

  for (let i = 0; i < 200; i++) {
    const prev = r.chance(0.8) ? r.pick([0, 1, 5, 1000]) : undefined, now = r.pick([0, 1, 5, 6, 1000, 1001]);
    add('nextMt', { prev: prev ?? null, now }, nextMt(prev, now));
  }
  for (const s of ['new', 'draft', 'done', 'appr', '', 'x', 'DONE']) add('knownStatus', s, knownStatus(s));
  for (let i = 0; i < 100; i++) { const s = text(r); add('variantId', s, variantId(s)); }
  add('constants', null, { HISTORY_LIMIT });

  for (let i = 0; i < N; i++) { const c = genComment(r); add('commentId', c, commentId(c)); }
  for (let i = 0; i < N; i++) { const v = genVote(r); add('voteId', v, voteId(v)); }

  for (let i = 0; i < N; i++) {
    const e = genEntry(r);
    // Історія й чинний переклад перетинаються частіше, щоб картки варіантів не були порожні.
    if (e.history && r.chance(0.6)) for (const h of e.history) if (r.chance(0.5)) h.text = e.target;
    add('sentVariants', e, sentVariants(e));
  }
  add('sentVariants', null, sentVariants(undefined));
  for (let i = 0; i < N; i++) { const e = genEntry(r), id = r.pick(['p', 'q', 'r']), who = r.pick(WHOS); add('tallyOf', { e, id, who }, tallyOf(e, id, who)); }
  for (let i = 0; i < N; i++) {
    const e = genEntry(r), id = r.pick(['p', 'q', 'r']), who = r.pick(WHOS), v = r.pick([1, -1] as const), now = time(r);
    add('castVote', { e, id, who, v, now }, castVote(e, id, who, v, now));
  }
  for (let i = 0; i < N; i++) {
    const e = genEntry(r), id = r.pick(['p', 'q', 'r']), who = r.pick(WHOS), off = r.chance(0.5), now = time(r);
    add('setDropped', { e, id, who, off, now }, setDropped(e, id, who, off, now));
  }
  {
    // ліміт голосів: 320 різних голосів поспіль
    let e: Entry = { target: '', status: 'new', mt: 0 };
    for (let i = 0; i < 320; i++) e = castVote(e, 'p' + i, 'u', 1, i);
    add('castVoteMany', 320, e);
  }

  for (let i = 0; i < N; i++) {
    const e = r.chance(0.8) ? genEntry(r) : { target: '', status: 'new' as const, mt: 0 }, what = r.pick(WHATS), t = text(r), who = r.pick(WHOS), now = time(r);
    add('note', { e, what, text: t, who, now }, note(e, what, t, who, now));
  }
  {
    // понад HISTORY_LIMIT записів: працює обрізання
    let e: Entry = { target: '', status: 'new', mt: 0 };
    for (let i = 0; i < HISTORY_LIMIT + 7; i++) e = note(e, 'w', 't' + i, 'u', i);
    add('noteMany', HISTORY_LIMIT + 7, e);
  }
  for (let i = 0; i < N; i++) {
    const e = r.chance(0.7) ? genEntry(r) : undefined, who = r.pick(WHOS), t = text(r), now = time(r), re = r.chance(0.3) ? 'i1' : undefined;
    add('addComment', { e: e ?? null, who, text: t, now, re: re ?? null }, addComment(e, who, t, now, re));
  }
  for (let i = 0; i < N; i++) {
    const e = genEntry(r), key = r.pick(['k1', 'k2', 'k9']), on = r.chance(0.5), now = time(r);
    add('setIgnored', { e, key, on, now }, setIgnored(e, key, on, now));
  }
  for (let i = 0; i < N; i++) {
    const prev = r.chance(0.8) ? genEntry(r) : undefined, source = text(r), t = r.pick(['', 'a', text(r)]), stage = r.pick(['translate', 'review'] as const), now = r.pick([0, 1, 5, 1000, 1700000000001]);
    add('edit', { prev: prev ?? null, source, text: t, stage, now }, edit(prev, unitOf('k', source), t, stage, now));
  }
  for (let i = 0; i < N; i++) { const e = genEntry(r), now = time(r); add('sendBack', { e, now }, sendBack(e, now)); }
  for (let i = 0; i < N; i++) {
    const e = r.chance(0.8) ? genEntry(r) : undefined, source = r.pick(['', 's', 't']);
    add('sourceChanged', { e: e ?? null, source }, sourceChanged(e, unitOf('k', source)));
  }
  for (let i = 0; i < 150; i++) {
    const entries = genSet(r), now = time(r);
    const units = KEYS.filter(() => r.chance(0.7)).map(key => unitOf(key, r.pick(['', 's', 't'])));
    const copy: Record<string, Entry> = JSON.parse(JSON.stringify(entries));
    const changed = reconcile(units, copy, now);
    add('reconcile', { units, entries, now }, { changed, entries: copy });
  }

  for (let i = 0; i < 250; i++) {
    const a = genEntry(r), b = r.chance(0.6) ? sibling(r, a) : genEntry(r);
    add('mergeEntry', { a, b }, mergeEntry(a, b));
  }
  for (let i = 0; i < 120; i++) {
    const a = genSet(r), b = r.chance(0.5) ? Object.fromEntries(Object.entries(a).map(([k, e]) => [k, sibling(r, e)])) : genSet(r);
    const since = r.pick([0, 1, 2, 100, 1000]);
    for (const k of KEYS) if (r.chance(0.2)) delete b[k];
    add('merge', { a, b, since }, merge(a, b, since));
  }
  writeVectors('merge', out);
});
