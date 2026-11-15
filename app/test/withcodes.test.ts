import { describe, expect, it } from 'vitest';
import { withCodes } from '../src/core';

describe('withCodes: a missing code goes where the original has it', () => {
  it('a code at the start of the original goes to the start', () => {
    expect(withCodes('\\C[2]Hello there', 'Привіт усім', ['\\C[2]'])).toBe('\\C[2]Привіт усім');
  });
  it('a code at the end goes to the end', () => {
    expect(withCodes('Hello there\\!', 'Привіт усім', ['\\!'])).toBe('Привіт усім\\!');
  });
  it('a code in the middle goes to the same share of the text, before a word', () => {
    const r = withCodes('One two \\N[1] three four', 'Раз два три чотири', ['\\N[1]']);
    expect(r).toBe('Раз два \\N[1] три чотири');
  });
  it('a code that is not in the original goes to the end', () => {
    expect(withCodes('Hello', 'Привіт', ['\\V[3]'])).toBe('Привіт\\V[3]');
  });
  it('several codes are all put back', () => {
    const r = withCodes('\\C[2]Gold\\C[0] and \\!silver', 'Золото та срібло', ['\\C[2]', '\\C[0]', '\\!']);
    for (const c of ['\\C[2]', '\\C[0]', '\\!']) expect(r).toContain(c);
    expect(r.startsWith('\\C[2]')).toBe(true);
  });
});

describe('withCodes keeps the spacing of the original', () => {
  it('a code that is followed by a space in the original is followed by one; a code stuck to a word stays stuck', () => {
    expect(withCodes('Hello \\N[1] came back', 'Привіт повернувся', ['\\N[1]'])).toMatch(/\\N\[1\] [а-яі]/);
    expect(withCodes('A \\C[2]sword\\C[0] here', 'Тут меч', ['\\C[2]'])).toMatch(/\\C\[2\][А-ЯІа-яі]/);
    expect(withCodes('Hello \\N[1]', 'Привіт', ['\\N[1]'])).toBe('Привіт \\N[1]');
  });
});
