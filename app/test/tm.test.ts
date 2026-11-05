import { describe, expect, it } from 'vitest';
import { TmIndex, addComment, note, parseTerms, similarity, termsIn } from '../src/core';
import type { Entry } from '../src/core';

describe('similarity', () => {
  it('is 100 for equal, 0 for empty, graded otherwise', () => {
    expect(similarity('abc', 'abc')).toBe(100);
    expect(similarity('', 'abc')).toBe(0);
    expect(similarity('kitten', 'sitting')).toBe(57);
  });
});

describe('TmIndex', () => {
  const tm = new TmIndex();
  tm.add({ s: "You shouldn't be here, kid.", t: 'Тобі тут не місце, малий.', src: 'Map041.json' });
  tm.add({ s: 'Where are you going?', t: 'Куди ти йдеш?', src: 'Map001.json' });
  tm.add({ s: 'The door is locked.', t: 'Двері замкнені.', src: 'Map002.json' });
  tm.add({ s: 'untranslated', t: '', src: 'x' });

  it('ignores untranslated pairs and finds near matches best first', () => {
    expect(tm.size).toBe(3);
    const m = tm.find("You shouldn't be here, kid. The \\C[2]Dark\\C[0] remembers faces.", { min: 40 });
    expect(m[0]).toMatchObject({ t: 'Тобі тут не місце, малий.', src: 'Map041.json' });
    expect(m[0]!.score).toBeGreaterThanOrEqual(40);
  });

  it('exact matches score 100 and exclusions are honoured', () => {
    expect(tm.find('Where are you going?')[0]).toMatchObject({ score: 100, t: 'Куди ти йдеш?' });
    expect(tm.find('Where are you going?', { exclude: e => e.src === 'Map001.json' })).toEqual([]);
    expect(tm.find('zzz qqq')).toEqual([]);
  });
});

describe('glossary', () => {
  it('finds whole-word terms case-insensitively', () => {
    const terms = [{ en: 'Dark', uk: 'Темрява' }, { en: 'Ark', uk: 'Ковчег' }];
    expect(termsIn('The dark remembers.', terms).map(t => t.en)).toEqual(['Dark']);
    expect(termsIn('Darkness falls', terms)).toEqual([]);
  });
  it('parses TSV and semicolon lines and counts rejected ones', () => {
    expect(parseTerms('Dark\tТемрява\nKey;Ключ\nbroken\n\n')).toEqual({ terms: [{ en: 'Dark', uk: 'Темрява' }, { en: 'Key', uk: 'Ключ' }], rejected: 1 });
  });
});

describe('history and comments', () => {
  it('caps history and keeps entries immutable', () => {
    let e: Entry = { target: 'x', status: 'draft', mt: 1 };
    for (let i = 0; i < 60; i++) e = note(e, 'правка', String(i), 'Я', i);
    expect(e.history).toHaveLength(50);
    expect(e.history![49]!.text).toBe('59');
    const c = addComment(undefined, 'Я', 'Питання', 5);
    expect(c.comments).toEqual([{ who: 'Я', at: 5, text: 'Питання', id: expect.any(String) }]);
    expect(c.mt).toBe(0); // a comment is not a change of the translation, so it never wins a merge over a newer one
  });
});
