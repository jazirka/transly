import { describe, expect, it } from 'vitest';
import { check, hasTerm, targetHasTerm, termRanges, termsIn } from '../src/core';

describe('English side: plurals, verb forms, British and American spelling', () => {
  it('matches a singular term in a plural text and the other way round', () => {
    expect(hasTerm('You learned two new Skills.', 'skill')).toBe(true);
    expect(hasTerm('Learn a skill.', 'skills')).toBe(true);
    expect(hasTerm('Three boxes and a body', 'box')).toBe(true);
    expect(hasTerm('Many bodies lay there', 'body')).toBe(true);
    expect(hasTerm('Sharp knives', 'knife')).toBe(true);
    expect(hasTerm('Several statuses apply', 'status')).toBe(true);
    expect(hasTerm("The hero's sword", 'sword')).toBe(true);
  });
  it('treats armor and armour (and other British spellings) as one word', () => {
    for (const [text, term] of [['Heavy Armour', 'armor'], ['Heavy armor', 'armour'], ['Armours of old', 'armor'], ['A strong defence', 'defense'], ['The colour of fire', 'color'], ['Honour the dead', 'honor'], ['A grey cloak', 'gray'], ['He travelled far', 'travel'], ['Travelling light', 'travel'], ['They organised it', 'organize'], ['Centre of town', 'center']] as const) expect(hasTerm(text, term), `${text} ~ ${term}`).toBe(true);
  });
  it('knows verb forms but not unrelated longer words', () => {
    expect(hasTerm('Making a potion', 'make')).toBe(true);
    expect(hasTerm('He was running', 'run')).toBe(true);
    expect(hasTerm('Darkness falls', 'dark')).toBe(false);
    expect(hasTerm('A skillful thief', 'skill')).toBe(false);
    expect(hasTerm('One hour left', 'honor')).toBe(false);
    expect(hasTerm('Four doors', 'door')).toBe(true);
    expect(hasTerm('Pour the water', 'pore')).toBe(false);
  });
  it('matches phrases across spaces and hyphens, ignoring control codes', () => {
    expect(hasTerm('Cast Fire-Balls now', 'fire ball')).toBe(true);
    expect(hasTerm('\\C[2]Fire\\C[0] Ball', 'fire ball')).toBe(true);
    expect(hasTerm('Fire. Ball', 'fire ball')).toBe(false);
    expect(hasTerm('A 16-bit console', '16-bit')).toBe(true);
    expect(termRanges('Two Armours and an armor', 'armor')).toEqual([[4, 11], [19, 24]]);
    expect(termsIn('Skills and Armour', [{ en: 'skill', uk: 'навичка' }, { en: 'armor', uk: 'броня' }, { en: 'sword', uk: 'меч' }]).map(t => t.en)).toEqual(['skill', 'armor']);
  });
});

describe('Ukrainian side: cases are found by the stem', () => {
  it('finds a term in any case and number', () => {
    for (const [text, term] of [['Він вдарив мечем', 'меч'], ['багато мечів', 'меч'], ['Зброя в руці', 'рука'], ['Вдарив рукою', 'рука'], ['Біль у нозі', 'нога'], ['Позбувся коня', 'кінь'], ['Сталевими мечами', 'сталевий меч'], ['звук у п’ятому колі', 'п’яте коло'], ['Видобув ключі', 'ключ'], ['пошукай навичок', 'навичка'], ['Нова збірка гри', 'збірка'], ['налаштувань гри', 'налаштування']] as const) expect(targetHasTerm(text, term), `${text} ~ ${term}`).toBe(true);
  });
  it('does not accept an unrelated word', () => {
    expect(targetHasTerm('Двері замкнені', 'ключ')).toBe(false);
    expect(targetHasTerm('Він сів на стілець', 'меч')).toBe(false);
    expect(targetHasTerm('гарна навичка', 'броня')).toBe(false);
  });
  it('QA: the English plural in the source requires the Ukrainian term in any case', () => {
    const terms = [{ en: 'skill', uk: 'навичка' }, { en: 'armor', uk: 'броня' }];
    const o = { tolerancePct: 1000, terms };
    expect(check({ source: 'You learned three Skills.' }, 'Ви вивчили три навички.', o)).toEqual([]);
    expect(check({ source: 'Heavy Armour' }, 'Важкі обладунки', o).map(i => i.key)).toEqual(['term']);
    expect(check({ source: 'Heavy Armour' }, 'Важка броня', o)).toEqual([]);
  });
});

describe('speed', () => {
  it('a 1 400 term dictionary against a few thousand lines takes well under a second', () => {
    const terms = Array.from({ length: 1400 }, (_, i) => ({ en: `term${i} word`, uk: 'х' }));
    terms.push({ en: 'skill', uk: 'навичка' });
    const t0 = performance.now();
    let hits = 0;
    for (let i = 0; i < 3000; i++) hits += termsIn(`Line ${i}: you learned two new Skills and used armour in the dark forest.`, terms).length;
    expect(hits).toBe(3000);
    expect(performance.now() - t0).toBeLessThan(1500);
  });
});
