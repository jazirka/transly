import { describe, expect, it } from 'vitest';
import { sentVariants } from '../src/core';
import type { Entry, HistoryItem } from '../src/core';

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
    expect(v).toEqual([{ who: '', at: 7, text: 'Нокаут', current: true, approved: true }]);
  });
  it('the same text sent again by the same translator, one after another, is one', () => {
    const v = sentVariants(e({ target: 'Нокаут', status: 'done', history: [h(1, 'Ви', 'надіслано', 'Нокаут'), h(5, 'Ви', 'надіслано', 'Нокаут')] }));
    expect(v).toHaveLength(1);
    expect(v[0]!.at).toBe(5);
  });
  it('a row sent and then edited again (a draft) shows the sends, none of them current', () => {
    const v = sentVariants(e({ target: 'Нокаут!!', status: 'draft', history: [h(1, 'Ви', 'надіслано', 'Нокаут')] }));
    expect(v.map(x => x.current)).toEqual([false]);
  });
});
