import { describe, expect, it } from 'vitest';
import { byVote, castVote, mergeEntry, repairProject, sentVariants, setDropped, tallyOf, variantId } from '../src/core';
import type { Entry, HistoryItem, Vote } from '../src/core';

const h = (at: number, who: string, what: string, text: string): HistoryItem => ({ at, who, what, text });
const e = (over: Partial<Entry>): Entry => ({ target: '', status: 'draft', mt: 1, ...over });

describe('sentVariants', () => {
  it('has nothing for a row that has not been sent', () => {
    expect(sentVariants(undefined)).toEqual([]);
    expect(sentVariants(e({ target: 'Чернетка', status: 'draft', history: [h(1, 'Ви', 'правка', 'Чернетка')] }))).toEqual([]);
  });
  it('lists every send of every translator, the newest first, several from one translator included', () => {
    const v = sentVariants(e({ target: 'Нокдаун', status: 'done', mt: 9, history: [h(1, 'Оля', 'надіслано', 'Удар'), h(2, 'Ви', 'правка', 'Нокаут!'), h(3, 'Ви', 'надіслано', 'Нокаут'), h(4, 'Іван', 'надіслано', 'Нокдаун')] }));
    expect(v.map(x => `${x.who}:${x.text}`)).toEqual(['Іван:Нокдаун', 'Ви:Нокаут', 'Оля:Удар']);
  });
  it('marks the translation the row holds now, and whether it is proofread', () => {
    const v = sentVariants(e({ target: 'Нокаут', status: 'appr', history: [h(1, 'Оля', 'надіслано', 'Удар'), h(2, 'Ви', 'надіслано', 'Нокаут'), h(3, 'Ви', 'вичитано', 'Нокаут')] }));
    expect(v.map(x => [x.text, x.current, x.approved])).toEqual([['Нокаут', true, true], ['Удар', false, false]]);
  });
  it('a translation without a history (it came with the game) is still the current one', () => {
    const v = sentVariants(e({ target: 'Нокаут', status: 'appr', mt: 7 }));
    expect(v).toEqual([{ id: variantId('Нокаут'), who: '', at: 7, sentAt: 7, text: 'Нокаут', current: true, approved: true }]);
  });
  it('the same text sent again is one contribution, and the translator who sent it first keeps it', () => {
    const v = sentVariants(e({ target: 'Нокаут', status: 'done', history: [h(1, 'Ви', 'надіслано', 'Нокаут'), h(5, 'Ви', 'надіслано', 'Нокаут'), h(6, 'Оля', 'надіслано', 'Удар'), h(7, 'Іван', 'надіслано', 'Нокаут')] }));
    expect(v.map(x => `${x.who}:${x.text}:${x.at}`)).toEqual(['Ця:Удар:6'.replace('Ця', 'Оля'), 'Ви:Нокаут:1']);
    expect(v[1]!.current).toBe(true);
  });
  it('a row sent and then edited again (a draft) shows the sends, none of them current', () => {
    const v = sentVariants(e({ target: 'Нокаут!!', status: 'draft', history: [h(1, 'Ви', 'надіслано', 'Нокаут')] }));
    expect(v.map(x => x.current)).toEqual([false]);
  });
});

describe('votes for the contributions of a row', () => {
  const base = e({ target: 'Нокаут', status: 'done', mt: 9, history: [h(1, 'Оля', 'надіслано', 'Удар'), h(2, 'Ви', 'надіслано', 'Нокаут')] });
  const [cur, old] = sentVariants(base) as [ReturnType<typeof sentVariants>[number], ReturnType<typeof sentVariants>[number]];

  it('gives every contribution an id of its text', () => {
    expect(cur.id).toBe(variantId('Нокаут'));
    expect(old.id).toBe(variantId('Удар'));
    expect(old.id).not.toBe(cur.id);
  });
  it('counts the votes for and against, and shows the vote of the translator', () => {
    let x = castVote(base, cur.id, 'Іван', 1, 100);
    x = castVote(x, cur.id, 'Оля', 1, 101);
    x = castVote(x, cur.id, 'Ви', -1, 102);
    expect(tallyOf(x, cur.id, 'Іван')).toEqual({ up: 2, down: 1, mine: 1 });
    expect(tallyOf(x, cur.id, 'Ви').mine).toBe(-1);
    expect(tallyOf(x, old.id, 'Іван')).toEqual({ up: 0, down: 0, mine: 0 });
  });
  it('the same vote again takes it back, another vote replaces it, and neither touches the translation or its clock', () => {
    let x = castVote(base, cur.id, 'Іван', 1, 100);
    x = castVote(x, cur.id, 'Іван', 1, 101);
    expect(tallyOf(x, cur.id, 'Іван')).toEqual({ up: 0, down: 0, mine: 0 });
    x = castVote(x, cur.id, 'Іван', -1, 102);
    expect(tallyOf(x, cur.id, 'Іван')).toEqual({ up: 0, down: 1, mine: -1 });
    expect(x.mt).toBe(base.mt); expect(x.target).toBe(base.target); expect(x.status).toBe(base.status);
    expect(base.votes).toBeUndefined();
  });
  it('a vote is always later than the one it replaces, even when the clock does not move', () => {
    const a = castVote(base, cur.id, 'Іван', 1, 100), b = castVote(a, cur.id, 'Іван', 1, 100);
    expect(b.votes![0]!.at).toBeGreaterThan(a.votes![0]!.at);
  });
  it('merges by the later vote of each translator, the same in either order, and keeps the votes of the other device', () => {
    const a = castVote(base, cur.id, 'Іван', 1, 100);
    const b = castVote(castVote(base, cur.id, 'Іван', 1, 100), cur.id, 'Іван', 1, 200); // Іван took the vote back on the other device
    const c = castVote(base, old.id, 'Оля', 1, 150);
    const ab = mergeEntry(a, b), ba = mergeEntry(b, a);
    expect(ab.votes).toEqual(ba.votes);
    expect(tallyOf(ab, cur.id, 'Іван').mine).toBe(0);
    const abc = mergeEntry(ab, c);
    expect(tallyOf(abc, old.id, 'Оля').mine).toBe(1);
    expect(abc.votes).toEqual(mergeEntry(c, ab).votes);
    expect(mergeEntry(abc, abc).votes).toEqual(abc.votes);
    expect(abc.votes).toEqual([...abc.votes!].sort(byVote));
  });
  it('a vote does not win a merge over a newer translation', () => {
    const newer = e({ target: 'Нокдаун', status: 'draft', mt: 50 });
    const voted = castVote(base, cur.id, 'Іван', 1, 100);
    const m = mergeEntry(voted, newer);
    expect(m.target).toBe('Нокдаун');
    expect(tallyOf(m, cur.id, 'Іван').mine).toBe(1);
  });
  it('a stored project with wrong votes is repaired: the broken ones are dropped, the good ones stay', () => {
    const good: Vote = { who: 'Іван', at: 5, on: 'x', v: 1 };
    const raw = { version: 2, name: 'p', sourceLang: 'en', targetLang: 'uk', files: { 'A.json': { k: { target: 'т', status: 'draft', mt: 1, votes: [good, { who: 1, at: 5, on: 'x', v: 1 }, { who: 'a', at: 5, on: 'x', v: 7 }, 'junk'] } } } };
    const r = repairProject(raw as never);
    const v = (raw.files['A.json'].k as Entry).votes;
    expect(v).toEqual([good]);
    expect(r.length).toBeGreaterThan(0);
  });
});

describe('contributions taken off the card', () => {
  const base = e({ target: 'Нокаут', status: 'done', mt: 9, history: [h(1, 'Оля', 'надіслано', 'Удар'), h(2, 'Ви', 'надіслано', 'Нокаут')] });
  const old = variantId('Удар'), cur = variantId('Нокаут');

  it('a contribution that was taken off is not in the list, and the history keeps it', () => {
    const x = setDropped(base, old, 'Ви', false, 100);
    expect(sentVariants(x).map(v => v.text)).toEqual(['Нокаут']);
    expect(x.history).toBe(base.history);
    expect(x.mt).toBe(base.mt);
  });
  it('it comes back when it is put back, and when it is sent anew', () => {
    const off = setDropped(base, old, 'Ви', false, 100);
    expect(sentVariants(setDropped(off, old, 'Ви', true, 101)).map(v => v.text)).toEqual(['Нокаут', 'Удар']);
    const again = { ...off, history: [...off.history!, h(200, 'Іван', 'надіслано', 'Удар')] };
    expect(sentVariants(again).map(v => v.text)).toEqual(['Нокаут', 'Удар']);
  });
  it('the translation the row holds is never taken off the card', () => {
    expect(sentVariants(setDropped(base, cur, 'Ви', false, 100)).map(v => v.text)).toEqual(['Нокаут', 'Удар']);
  });
  it('merges by the later record of each contribution, in either order, and does not win over a newer translation', () => {
    const a = setDropped(base, old, 'Ви', false, 100), b = setDropped(a, old, 'Іван', true, 200);
    expect(mergeEntry(a, b).drops).toEqual(mergeEntry(b, a).drops);
    expect(sentVariants(mergeEntry(a, b)).map(v => v.text)).toContain('Удар');
    const newer = e({ target: 'Нокдаун', status: 'draft', mt: 50 });
    expect(mergeEntry(a, newer).target).toBe('Нокдаун');
    expect(mergeEntry(a, newer).drops).toEqual(a.drops);
  });
  it('wrong drop records in a stored project are repaired', () => {
    const good = { who: 'Ви', at: 5, on: 'x' };
    const raw = { version: 2, name: 'p', sourceLang: 'en', targetLang: 'uk', files: { 'A.json': { k: { target: 'т', status: 'draft', mt: 1, drops: [good, { who: 1, at: 5, on: 'x' }, 'junk', { who: 'a', at: 6, on: 'y', off: 'yes' }] } } } };
    repairProject(raw as never);
    expect((raw.files['A.json'].k as Entry).drops).toEqual([good, { who: 'a', at: 6, on: 'y' }]);
  });
});
