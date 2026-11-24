import { test } from 'vitest';
import type { SavedProject } from '../../src/core/project';
import { findReplace, literalPattern } from '../../src/core/findreplace';
import { removeTerm, saveTerm } from '../../src/core/termedit';
import type { TermForm } from '../../src/core/termedit';
import { rng, text, writeVectors } from './util';

const FIND = ['cat', 'Cat', 'сім', "сім'я", 'сім’я', 'a.b', 'x+y', '(a)', 'ґанок', 'Привіт', "it's", 'a-b', '$1', '', ' ', 'є', '😀', 'I', 'ß', 'İ', 'Σ', '[x]', 'a|b', '\\'];
const WORDS = ['cat', 'Cat', 'CAT', 'cats', 'сім', 'Сім', 'сім’я', "сім'я", 'сімʼя', 'сім-я', 'a.b', 'aXb', 'x+y', '(a)', 'Ґанок', 'ґанок', 'привіт', 'ПРИВІТ', "it's", 'it’s', 'a-b', '$1', 'Σ', 'σ', 'ς', 'ß', 'SS', 'İ', 'i', 'I', '[x]', 'a|b', '\\', '😀', 'є', '1cat', 'cat1', ' ', ',', '.'];
const REPL = ['dog', '', '$&', '$1', '\\', 'Пес', "'"];
const KEYS = ['k1', 'k2', 'k3', 'k4'];

test('export findreplace vectors', () => {
  const r = rng(9091);
  const out: Record<string, { input: unknown; output: unknown }[]> = {};
  const add = (name: string, input: unknown, output: unknown) => (out[name] ??= []).push({ input, output });

  for (let i = 0; i < 400; i++) {
    const files: SavedProject['files'] = {};
    const views = [];
    for (const fn of ['a.json', 'b.json', 'c.json']) {
      const units = KEYS.filter(() => r.chance(0.8)).map(key => ({ key, source: text(r, 3), speaker: '', kind: 'dialogue' as const, context: '' }));
      views.push({ name: fn, units });
      if (r.chance(0.9)) files[fn] = Object.fromEntries(KEYS.filter(() => r.chance(0.8)).map(k => [k, { target: Array.from({ length: r.int(5) }, () => r.pick(WORDS)).join(r.pick([' ', '', ', '])) + (r.chance(0.2) ? text(r, 3) : ''), status: 'done' as const, mt: 1 }]));
    }
    const o = { find: r.pick(FIND), replace: r.pick(REPL), caseSensitive: r.chance(0.4), wholeWord: r.chance(0.5) };
    const limit = r.chance(0.2) ? 1 + r.int(4) : 2000;
    const saved = { files } as unknown as SavedProject;
    add('findReplace', { views, files, o, limit }, findReplace(views as never, saved, o, limit));
  }
  // lit pattern directly on simple haystacks
  for (const f of FIND.filter(Boolean)) for (const ww of [false, true]) for (const cs of [false, true]) {
    const re = literalPattern(f, ww, cs);
    add('literal', { f, ww, cs, hay: WORDS }, WORDS.map(w => { const m = [...w.matchAll(re)]; return m.map(x => [x.index, x[0]]); }));
  }

  // termedit
  const T = ['take … off', 'take...off', 'Cat', ' cat ', 'dog', 'Ґанок', '', '…', 'a', 'A b', 'x'];
  const U = ['брати … геть', 'кіт', ' кіт ', '', '…', 'пес', 'ґанок'];
  const mkForm = (): TermForm => ({ en: r.pick(T), uk: r.pick(U), ...(r.chance(0.5) ? { alt: r.pick(['', 'a; b', 'a, b;; c', ' x ', 'take…off, y']) } : {}), ...(r.chance(0.4) ? { kind: r.pick(['', ' ', 'item', ' place ']) } : {}), ...(r.chance(0.4) ? { note: r.pick(['', 'n', ' note ']) } : {}), ...(r.chance(0.3) ? { qa: r.chance(0.5) } : {}), ...(r.chance(0.4) ? { gender: r.pick(['', 'm', 'f', 'n', 'p', 'x'] as const) } : {}) });
  for (let i = 0; i < 400; i++) {
    const terms: Record<string, unknown>[] = [];
    for (let n = r.int(5); n > 0; n--) terms.push({ en: r.pick(T.slice(0, 7)), uk: 'x', mt: 5, ...(r.chance(0.4) ? { alt: ['q'] } : {}), ...(r.chance(0.3) ? { kind: 'k' } : {}), ...(r.chance(0.3) ? { note: 'n' } : {}), ...(r.chance(0.3) ? { gender: 'f' } : {}), ...(r.chance(0.3) ? { qa: false } : {}), ...(r.chance(0.2) ? { extra: 1 } : {}) });
    const deleted = r.chance(0.4) ? { cat: 3 } : undefined;
    const ops = Array.from({ length: 1 + r.int(4) }, () => r.chance(0.25) ? { op: 'remove', en: r.pick(T) } : { op: 'save', form: mkForm(), was: r.chance(0.5) ? r.pick(T) : undefined });
    const saved = { terms: JSON.parse(JSON.stringify(terms)), ...(deleted ? { deletedTerms: { ...deleted } } : {}) } as unknown as SavedProject;
    const results: unknown[] = [];
    let now = 100;
    for (const o of ops) results.push(o.op === 'remove' ? removeTerm(saved, o.en!, ++now) : saveTerm(saved, o.form!, ++now, o.was));
    add('terms', { terms, deleted, ops }, { results, terms: saved.terms, deletedTerms: saved.deletedTerms ?? null });
  }
  writeVectors('findreplace', out);
});
