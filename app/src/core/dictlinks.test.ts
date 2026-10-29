import { describe, expect, it } from 'vitest';
import { gorohUrl, multitranUrl, wordsOf } from './dictlinks';

describe('dictionary links', () => {
  it('words: distinct, without control codes, apostrophes and hyphens kept', () => {
    expect(wordsOf("\\C[2]Sword\\C[0] of the sword, a don't-stop \\V[1]")).toEqual(['Sword', 'of', 'the', "don't-stop"]);
    expect(wordsOf('В’їзд, м’яч')).toEqual(['В’їзд', 'м’яч']);
  });
  it('urls are encoded', () => {
    expect(gorohUrl('Меч')).toBe('https://goroh.pp.ua/%D0%A2%D0%BB%D1%83%D0%BC%D0%B0%D1%87%D0%B5%D0%BD%D0%BD%D1%8F/%D0%BC%D0%B5%D1%87');
    expect(multitranUrl('a b&c')).toBe('https://www.multitran.com/m.exe?l1=1&l2=33&s=a%20b%26c');
  });
});
