import { describe, expect, it } from 'vitest';
import { emptyProject, joinAlts, mergeProjects, removeTerm, saveTerm, splitAlts } from '../src/core';

const fresh = () => emptyProject('T');

describe('saveTerm', () => {
  it('adds a term with alternatives, a category, a note and the QA switch', () => {
    const p = fresh();
    expect(saveTerm(p, { en: 'Lantern flail', uk: 'Ліхтарний ціп', alt: 'ліхтарний ціп; ціп-ліхтар', kind: 'Weapons', note: 'Зброя', qa: false }, 10)).toBe('added');
    expect(p.terms[0]).toEqual({ en: 'Lantern flail', uk: 'Ліхтарний ціп', mt: 10, alt: ['ліхтарний ціп', 'ціп-ліхтар'], kind: 'Weapons', note: 'Зброя', qa: false });
  });

  it('both fields are required', () => {
    const p = fresh();
    expect(saveTerm(p, { en: ' ', uk: 'x' }, 1)).toBeNull();
    expect(saveTerm(p, { en: 'x', uk: '' }, 1)).toBeNull();
    expect(p.terms).toEqual([]);
  });

  it('a word that is already there is refused when adding, in any letter case', () => {
    const p = fresh();
    saveTerm(p, { en: 'Potion', uk: 'Зілля' }, 1);
    expect(saveTerm(p, { en: 'potion', uk: 'Еліксир' }, 2)).toBe('exists');
    expect(p.terms).toHaveLength(1);
    expect(p.terms[0]!.uk).toBe('Зілля');
  });

  it('changing a term keeps what the form does not hold and drops what was emptied', () => {
    const p = fresh();
    saveTerm(p, { en: 'Potion', uk: 'Зілля', alt: 'напій', kind: 'Items', note: 'x' }, 1);
    // No note field in the form (the phone's): the note stays; the alternatives were emptied: they go.
    expect(saveTerm(p, { en: 'Potion', uk: 'Еліксир', alt: '', kind: 'Items' }, 5, 'Potion')).toBe('changed');
    expect(p.terms[0]).toEqual({ en: 'Potion', uk: 'Еліксир', mt: 5, kind: 'Items', note: 'x' });
    // An empty note in the form clears it.
    saveTerm(p, { en: 'Potion', uk: 'Еліксир', note: '', kind: '' }, 6, 'Potion');
    expect(p.terms[0]).toEqual({ en: 'Potion', uk: 'Еліксир', mt: 6 });
  });

  it('renaming leaves a trace of the old word and refuses a word that is taken', () => {
    const p = fresh();
    saveTerm(p, { en: 'Potion', uk: 'Зілля' }, 1);
    saveTerm(p, { en: 'Ether', uk: 'Ефір' }, 1);
    expect(saveTerm(p, { en: 'ether', uk: 'x' }, 2, 'Potion')).toBe('exists');
    expect(saveTerm(p, { en: 'Elixir', uk: 'Еліксир' }, 3, 'Potion')).toBe('changed');
    expect(p.terms.map(t => t.en).sort()).toEqual(['Elixir', 'Ether']);
    expect(p.deletedTerms).toEqual({ potion: 3 });
  });

  it('the list can be told apart from a form text and back', () => {
    expect(splitAlts('a; b, c ;')).toEqual(['a', 'b', 'c']);
    expect(joinAlts(['a', 'b'])).toBe('a; b');
    expect(joinAlts(undefined)).toBe('');
  });
});

describe('removeTerm', () => {
  it('removes and leaves a trace that wins over the other device’s older copy in a merge', () => {
    const a = fresh(), b = fresh();
    saveTerm(a, { en: 'Potion', uk: 'Зілля' }, 10);
    saveTerm(b, { en: 'Potion', uk: 'Зілля' }, 10);
    expect(removeTerm(a, 'POTION', 20)).toBe(true);
    expect(a.terms).toEqual([]);
    const m = mergeProjects(a, b).project;
    expect(m.terms).toEqual([]);
  });

  it('a term added again after its deletion survives the merge', () => {
    const a = fresh(), b = fresh();
    saveTerm(a, { en: 'Potion', uk: 'Зілля' }, 10);
    removeTerm(a, 'Potion', 20);
    saveTerm(b, { en: 'Potion', uk: 'Новий' }, 30);
    expect(mergeProjects(a, b).project.terms.map(t => t.uk)).toEqual(['Новий']);
  });

  it('an unknown word changes nothing', () => {
    const p = fresh();
    expect(removeTerm(p, 'nothing', 5)).toBe(false);
    expect(p.deletedTerms).toBeUndefined();
  });
});

describe('patterns in the glossary form', () => {
  it('a gap typed as three dots is stored as the gap mark, in the term, its rendering and its alternatives', () => {
    const saved = { terms: [] as never[], deletedTerms: {} } as never as Parameters<typeof saveTerm>[0];
    expect(saveTerm(saved, { en: 'take...off', uk: 'зняти ...', alt: 'здійняти...з' }, 1)).toBe('added');
    expect(saved.terms[0]).toMatchObject({ en: 'take … off', uk: 'зняти …', alt: ['здійняти … з'] });
  });

  it('a form with nothing but gap marks is refused', () => {
    const saved = { terms: [], deletedTerms: {} } as never as Parameters<typeof saveTerm>[0];
    expect(saveTerm(saved, { en: '…', uk: 'x' }, 1)).toBeNull();
    expect(saveTerm(saved, { en: 'x', uk: '...' }, 1)).toBeNull();
  });
});
