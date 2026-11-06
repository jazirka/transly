import { describe, expect, it } from 'vitest';
import { diffCounts, diffWords, sideOf } from '../src/core';

describe('diffWords', () => {
  it('equal texts are one stretch that stayed', () => {
    expect(diffWords('Привіт, світе', 'Привіт, світе')).toEqual([{ t: 'same', text: 'Привіт, світе' }]);
    expect(diffWords('', '')).toEqual([]);
  });

  it('one replaced word', () => {
    expect(diffWords('Я йду додому', 'Я іду додому')).toEqual([
      { t: 'same', text: 'Я ' }, { t: 'del', text: 'йду' }, { t: 'add', text: 'іду' }, { t: 'same', text: ' додому' },
    ]);
  });

  it('an added and a removed word', () => {
    expect(diffWords('Візьми меч', 'Візьми старий меч')).toEqual([{ t: 'same', text: 'Візьми ' }, { t: 'add', text: 'старий ' }, { t: 'same', text: 'меч' }]);
    expect(diffWords('Візьми старий меч', 'Візьми меч')).toEqual([{ t: 'same', text: 'Візьми ' }, { t: 'del', text: 'старий ' }, { t: 'same', text: 'меч' }]);
  });

  it('the segments give either text back exactly', () => {
    const cases: [string, string][] = [
      ['', 'щось'], ['щось', ''],
      ['\\C[2]Меч\\C[0] світла', '\\C[2]Меч світла\\C[0]'],
      ['Ім’я героя — Олег.', 'Ім’я героя: Олег!'],
      ['рядок один\nрядок два', 'рядок один рядок два'],
      ['а б в г д е', 'е д г в б а'],
    ];
    for (const [a, b] of cases) {
      const d = diffWords(a, b);
      expect(sideOf(d, 'before')).toBe(a);
      expect(sideOf(d, 'after')).toBe(b);
    }
  });

  it('a word with an apostrophe or a hyphen is one word', () => {
    const d = diffWords('Мʼясо десь-то', 'Мʼясо десь-інде');
    expect(d.filter(s => s.t === 'del').map(s => s.text)).toEqual(['десь-то']);
    expect(d.filter(s => s.t === 'add').map(s => s.text)).toEqual(['десь-інде']);
  });

  it('counts the words that changed', () => {
    expect(diffCounts(diffWords('Я йду додому швидко', 'Я іду додому'))).toEqual({ added: 1, removed: 2 });
  });

  it('a very long text does not take the page down: the middle is shown as replaced', () => {
    const a = Array.from({ length: 3000 }, (_, i) => `слово${i}`).join(' ');
    const b = Array.from({ length: 3000 }, (_, i) => `інше${i}`).join(' ');
    const t0 = Date.now();
    const d = diffWords(a, b);
    expect(Date.now() - t0).toBeLessThan(1500);
    expect(sideOf(d, 'before')).toBe(a);
    expect(sideOf(d, 'after')).toBe(b);
  });
});
