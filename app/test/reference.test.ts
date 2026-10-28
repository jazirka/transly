import { describe, expect, it } from 'vitest';
import { alignReference, referenceSets, withReference, withoutReference } from '../src/core';
import type { Unit } from '../src/core';

const u = (key: string, source: string, kind: Unit['kind'] = 'dialogue'): Unit => ({ key, source, speaker: '', kind, context: 'c' });
const L = (i: number) => `events[1].pages[0].list[${i}]`;

describe('alignReference', () => {
  it('pairs in order when the shape matches', () => {
    const r = alignReference([u(L(0), 'Hello'), u(L(3), 'Bye')], [u(L(0), 'Привіт'), u(L(5), 'Бувай')]);
    expect(r).toEqual({ [L(0)]: 'Привіт', [L(3)]: 'Бувай' });
  });

  it('survives lines added or removed in the reference version', () => {
    const en = [u(L(0), 'Where are you going?'), u(L(2), 'The \\C[2]door\\C[0] is locked.'), u(L(4), 'Take the key.'), u(L(6), 'Goodbye.')];
    // the reference has an extra scroll text before and is missing "Take the key."
    const ru = [u(L(0), 'Это ново.', 'scroll'), u(L(2), 'Куда ты идёшь?'), u(L(5), 'Дверь \\C[2]заперта\\C[0].'), u(L(8), 'Прощай.')];
    const r = alignReference(en, ru);
    expect(r[L(0)]).toBe('Куда ты идёшь?');
    expect(r[L(2)]).toBe('Дверь \\C[2]заперта\\C[0].');
    expect(r[L(6)]).toBe('Прощай.');
    expect(r[L(4)]).toBeUndefined();
  });

  it('never pairs different kinds and pairs database entries by key', () => {
    const r = alignReference([u(L(0), 'Leave', 'choice'), u('[1].name', 'Key', 'name')], [u(L(0), 'Текст'), u('[1].name', 'Ключ', 'name')]);
    expect(r[L(0)]).toBeUndefined();
    expect(r['[1].name']).toBe('Ключ');
  });

  it('keeps choice options together', () => {
    const en = [u(`${L(0)}.choice[0]`, 'Yes', 'choice'), u(`${L(0)}.choice[1]`, 'No', 'choice')];
    const ru = [u(`${L(0)}.choice[0]`, 'Да', 'choice'), u(`${L(0)}.choice[1]`, 'Нет', 'choice')];
    expect(alignReference(en, ru)).toEqual({ [`${L(0)}.choice[0]`]: 'Да', [`${L(0)}.choice[1]`]: 'Нет' });
  });
});

describe('several reference languages', () => {
  const ru = { lang: 'ru', texts: { 'A.json': { k: 'Да' } } };
  const pl = { lang: 'pl', texts: { 'A.json': { k: 'Tak' } } };
  it('adds languages, replaces one with the same code and removes them one by one', () => {
    const one = withReference(undefined, ru);
    expect(referenceSets(one).map(x => x.lang)).toEqual(['ru']);
    const two = withReference(one, pl);
    expect(referenceSets(two).map(x => x.lang)).toEqual(['ru', 'pl']);
    const replaced = withReference(two, { lang: 'pl', texts: { 'A.json': { k: 'Owszem' } } });
    expect(referenceSets(replaced).map(x => [x.lang, x.texts['A.json']!.k])).toEqual([['ru', 'Да'], ['pl', 'Owszem']]);
    expect(referenceSets(withoutReference(two, 'ru')).map(x => x.lang)).toEqual(['pl']);
    expect(withoutReference(one, 'ru')).toBeUndefined();
  });
  it('keeps the first language where older projects stored it', () => {
    const b = withReference(withReference(undefined, ru), pl);
    expect(b.lang).toBe('ru');
    expect(b.texts).toBe(ru.texts);
  });
});
