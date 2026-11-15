import { describe, expect, it } from 'vitest';
import { apply, extract } from '../src/core';
import type { Translations } from '../src/core';

const entry = (target: string) => ({ target, status: 'draft' as const, mt: 1 });

describe('row keys that are names every object has', () => {
  it('a csv with keys __proto__ and constructor extracts, stores and writes back', () => {
    const text = 'key,source,target\n__proto__,Hello there,\nconstructor,Goodbye,\ntoString,See you,\n';
    const units = extract({ name: 'x.csv', json: null, text });
    expect(units.map(u => u.key)).toEqual(['~__proto__', '~constructor', '~toString']);
    const tr: Translations = Object.fromEntries(units.map((u, i) => [u.key, entry(['Привіт', 'Бувай', 'До зустрічі'][i]!)]));
    expect(Object.keys(tr)).toHaveLength(3);
    const out = apply({ name: 'x.csv', json: null, text }, tr) as string;
    expect(out).toContain('Привіт');
    expect(out).toContain('Бувай');
    expect(out).toContain('До зустрічі');
  });

  it('a gettext msgid __proto__ and a json key constructor do the same', () => {
    const po = 'msgid ""\nmsgstr ""\n\nmsgid "__proto__"\nmsgstr ""\n';
    const pu = extract({ name: 'a.po', json: null, text: po });
    expect(pu.map(u => u.key)).toEqual(['~__proto__']);
    expect(apply({ name: 'a.po', json: null, text: po }, { '~__proto__': entry('Протокол') }) as string).toContain('Протокол');
    const json = JSON.parse('{"constructor":"Hello there","__proto__x":"Bye"}');
    const ju = extract({ name: 'en.json', json });
    expect(ju[0]!.key).toBe('~constructor');
    const back = apply({ name: 'en.json', json }, { '~constructor': entry('Конструктор') }) as Record<string, string>;
    expect(JSON.stringify(back)).toContain('Конструктор');
  });
});
