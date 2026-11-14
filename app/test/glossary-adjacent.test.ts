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
