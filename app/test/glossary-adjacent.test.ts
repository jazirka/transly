import { describe, expect, it } from 'vitest';
import { isMessageUnit, targetHasTerm } from '../src/core';

describe('a phrase of the glossary must stand together', () => {
  it('words scattered over the line do not count as the term, the forms of it do', () => {
    expect(targetHasTerm('Тут лежить залізний ключ.', 'залізний ключ')).toBe(true);
    expect(targetHasTerm('Візьми залізного ключа.', 'залізний ключ')).toBe(true);
    expect(targetHasTerm('Ключ від старої брами був залізний.', 'залізний ключ')).toBe(false);
    expect(targetHasTerm('залізний, а ключ мідний', 'залізний ключ')).toBe(false);
    expect(targetHasTerm('Брама-гавань', 'брама гавань')).toBe(true);
  });
});

describe('Ren’Py lines in a group', () => {
  it('a line key with the file in front is still a Ren’Py line, not a message of the game window', () => {
    expect(isMessageUnit({ kind: 'dialogue', key: 'L12' })).toBe(false);
    expect(isMessageUnit({ kind: 'dialogue', key: 'script.rpy␟L12' })).toBe(false);
    expect(isMessageUnit({ kind: 'dialogue', key: 'Map001.json␟msg[0]' })).toBe(true);
  });
});

describe('forms with a vowel that drops out are the term', () => {
  it('the QA check and the highlight accept «майстра», «пса», «дня», «орла», «корабля», «зайця», «вітру»', () => {
    const cases: [string, string][] = [['Біля пса сиділа кішка.', 'пес'], ['Пси гавкають.', 'пес'], ['Це було до дня битви.', 'день'], ['Вітру не було.', 'вітер'], ['Привіт, майстра тут немає.', 'майстер'], ['Орла видно здалеку.', 'орел'], ['Біля корабля стояли люди.', 'корабель'], ['Зайця ніхто не бачив.', 'заєць']];
    for (const [text, uk] of cases) expect([text, targetHasTerm(text, uk)]).toEqual([text, true]);
    expect(targetHasTerm('Гарна погода.', 'майстер')).toBe(false);
  });
});

import { ukRetarget } from '../src/core';
describe('a name that is not in the lists', () => {
  it('«Остапа» after a verb may be the accusative: the proposal is not sure, and after «біля» it is the genitive', () => {
    const afterVerb = ukRetarget('Остап', 'Ілля', 'Остапа', { prev: 'бачив' });
    expect(afterVerb?.ambiguous).toBe(true);
    expect(afterVerb?.conf.level).not.toBe('high');
    const afterPrep = ukRetarget('Остап', 'Ілля', 'Остапа', { prev: 'біля' });
    expect(afterPrep?.text).toBe('Іллі');
  });
});
