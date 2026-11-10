import { describe, expect, it } from 'vitest';
import { hyphenPoints, isHyphenatable, syllables } from '../src/core/hyphen';

/** The word with a `-` at every place where it may be broken (two letters stay on each side). */
const hy = (w: string, l = 2, r = 2): string => {
  const p = hyphenPoints(w, l, r);
  return [...w].map((c, i) => (p.includes(i) ? '-' + c : c)).join('');
};

describe('hyphenPoints: слова', () => {
  const fixtures = `пе-ре-кла-дач мо-ва ін-фор-ма-ція ман-дрів-ник ра-дість зброя ві-кно сьо-го-дні під’-їзд під-зем-ний роз-мо-ва
    зв’я-зок ком-п’ю-тер ін-тер’-єр ми-сте-цтво ілю-стра-ція біо-ло-гія жи-т-тя ма-йор чай-ка укра-їн-ський гра
    пе-ре-кла-да-ти пе-ре-клад гра-вець се-стра дзві-нок дже-ре-ло ні-жний вве-че-рі кіль-кість бджо-ла во-гонь зу-стріч
    обли-ч-чя кра-ї-на ра-діо ков-бой не-зви-чай-ний збро-яр-ня Ман-дрів-ка га-ря-че Укра-ї-на Оде-са сон-це ро-бо-та
    сло-во ву-ли-ця мі-сто трид-цять осінь шко-ла ліс де учи-тель кі-ло-метр лі-ній-ка пам’-я-тник слов’-ян-ський
    від-кри-т-тя змі-ни-ти без-хать-ко без-пе-ка роз-бій-ник над-зви-чай-ний між-на-ро-дний пе-ре-пи-са-ти про-гра-ма
    гра-ві-та-ція пор-трет про-єкт стрі-лець ар-ба-лет`.split(/\s+/);
  for (const f of fixtures) it(f, () => expect(hy(f.replaceAll('-', ''))).toBe(f));
});

describe('hyphenPoints: правила', () => {
  it('апостроф і м’який знак не відриваються від літери', () => {
    for (const w of ['під’їзд', 'комп’ютер', 'пам’ятник', "п'ять", 'кільця', 'сьогодні', 'мільйон', 'батько', 'тридцять', 'сімдесят']) {
      for (const p of hyphenPoints(w, 1, 1)) {
        expect(w[p]).not.toMatch(/['’ʼь]/);
      }
    }
  });
  it('мінімум літер з кожного боку береться з налаштувань', () => {
    expect(hy('перекладач', 3, 3)).toBe('пере-кла-дач');
    for (const [l, r] of [[2, 2], [3, 2], [2, 4], [4, 4]] as const) {
      for (const w of ['перекладач', 'інформація', 'мандрівник', 'українське']) {
        for (const p of hyphenPoints(w, l, r)) {
          expect(p).toBeGreaterThanOrEqual(l);
          expect(w.length - p).toBeGreaterThanOrEqual(r);
        }
      }
    }
  });
  it('префікс ламається на своєму краї, а не посередині кореня', () => {
    expect(hy('розмова')).toBe('роз-мо-ва');
    expect(hy('підземний')).toBe('під-зем-ний');
    expect(hy('розум')).toBe('ро-зум');
    expect(hy('безпека')).toBe('без-пе-ка');
  });
  it('й лишається при голосній, крім «йо»', () => {
    expect(hy('чайка')).toBe('чай-ка');
    expect(hy('майор')).toBe('ма-йор');
    expect(hy('лінійка')).toBe('лі-ній-ка');
  });
  it('дж і дз не розриваються', () => {
    for (const w of ['джерело', 'дзвінок', 'будження', 'сторожі']) {
      for (const p of hyphenPoints(w, 1, 1)) expect(w.slice(p - 1, p + 1)).not.toMatch(/^д[жз]$/);
    }
  });
  it('без голосної, з латинкою, цифрами чи кодами не розбивається', () => {
    for (const w of ['Hello', 'Привіт1', 'W4вера', 'HP', 'ЗСУ', 'ь', '\\C[2]слово', 'слово\\C[0]', '']) expect(hyphenPoints(w)).toEqual([]);
    expect(isHyphenatable('слово')).toBe(true);
    expect(isHyphenatable('слово.')).toBe(false);
    expect(isHyphenatable('Hello')).toBe(false);
    expect(isHyphenatable('ыэ')).toBe(false);
  });
  it('точки йдуть за зростанням, без повторів, усередині слова', () => {
    for (const w of ['перекладач', 'розбійник', 'міжнародний', 'сьогодні', 'інтер’єр']) {
      const p = hyphenPoints(w, 1, 1);
      expect([...p].sort((a, b) => a - b)).toEqual(p);
      expect(new Set(p).size).toBe(p.length);
      for (const x of p) { expect(x).toBeGreaterThan(0); expect(x).toBeLessThan(w.length); }
    }
  });
  it('склади збираються назад у слово', () => {
    for (const w of ['перекладач', 'українське', 'під’їзд', 'Мандрівка', 'ілюстрація', 'шістнадцять']) {
      expect(syllables(w).join('')).toBe(w);
      expect(syllables(w, 2, 2).join('')).toBe(w);
    }
    expect(syllables('мова')).toEqual(['мо', 'ва']);
  });
  it('регістр не має значення', () => {
    for (const w of ['перекладач', 'підземний', 'розмова']) expect(hyphenPoints(w.toUpperCase())).toEqual(hyphenPoints(w));
  });
});
