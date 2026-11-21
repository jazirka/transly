import { describe, expect, it } from 'vitest';
import { saveTerm } from '../src/core/termedit';
import { repairProject } from '../src/core/validate';
import type { SavedProject } from '../src/core/project';

const base = (): SavedProject => ({ version: 1, name: 'T', sourceLang: 'en', targetLang: 'uk', resetEpoch: 0, files: {}, memory: [], terms: [{ en: 'boy', uk: 'хлопчик', alt: ['хлопець'], mt: 1 }], settings: {} } as unknown as SavedProject);

describe('the gender of a term', () => {
  it('is saved, kept when the form does not mention it, and cleared by an empty one', () => {
    const p = base();
    expect(saveTerm(p, { en: 'boy', uk: 'хлопчик', alt: 'хлопець', gender: 'm', note: 'слуга' }, 2, 'boy')).toBe('changed');
    expect(p.terms[0]).toMatchObject({ gender: 'm', note: 'слуга', alt: ['хлопець'] });
    saveTerm(p, { en: 'boy', uk: 'хлопчик', alt: 'хлопець' }, 3, 'boy');
    expect(p.terms[0]!.gender).toBe('m');
    saveTerm(p, { en: 'boy', uk: 'хлопчик', alt: 'хлопець', gender: '' }, 4, 'boy');
    expect(p.terms[0]!.gender).toBeUndefined();
  });
  it('is dropped when it is not one of the four', () => {
    const o = JSON.parse(JSON.stringify(base())) as Record<string, unknown>;
    (o.terms as Record<string, unknown>[])[0]!.gender = 'x';
    repairProject(o);
    expect((o.terms as Record<string, unknown>[])[0]!.gender).toBeUndefined();
  });
});
