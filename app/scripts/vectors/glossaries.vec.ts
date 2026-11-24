import { test } from 'vitest';
import type { SavedProject } from '../../src/core/project';
import { applyGlossaryImport, glossaryTerms, planGlossaryImport } from '../../src/core/ext/glossaries';
import { rng, writeVectors } from './util';

const EN = ['cat', 'Cat', ' dog ', 'take … off', 'take...off', '…', '', 'Fire Sword', 'fire sword', 'x'.repeat(201), 'y'.repeat(200), 'ґанок', 'Ґанок', 'a b'];
const UK = ['кіт', 'КІТ', 'пес', 'брати … геть', '…', '', 'Вогняний меч', 'z'.repeat(201), ' ґанок '];
const ALT = [[], ['a'], ['a', ' ', 'b'], ['x'.repeat(201), 'ok'], [1, 'str']];
const NOTE = [undefined, '', '  ', ' n ', 'note', 'q'.repeat(400), 5];

test('export glossaries vectors', () => {
  const r = rng(77);
  const out: Record<string, { input: unknown; output: unknown }[]> = {};
  const add = (name: string, input: unknown, output: unknown) => (out[name] ??= []).push({ input, output });
  const term = () => r.pick([
    () => ({ en: r.pick(EN), uk: r.pick(UK), ...(r.chance(0.4) ? { alt: r.pick(ALT) } : {}), ...(r.chance(0.4) ? { note: r.pick(NOTE) } : {}) }),
    () => r.pick([null, 5, 'str', [], { en: 5, uk: 'x' }, { uk: 'x' }, {}]),
  ])();
  const tsvLine = () => r.pick([`${r.pick(EN)}\t${r.pick(UK)}`, `${r.pick(EN)}\t${r.pick(UK)}\t${r.pick(['', 'a; b', ' ;; c ', 'x'])}`, `${r.pick(EN)}\t${r.pick(UK)}\ta\t${r.pick(['', ' n ', 'note'])}`, '# comment', '', '   ', 'onlyen', `\t${r.pick(UK)}`]);
  for (let i = 0; i < 400; i++) {
    const kind = r.pick(['terms', 'json', 'tsv', 'both', 'badjson', 'nofile'] as const);
    const g: Record<string, unknown> = { id: 'g', title: 'G' };
    let text = '';
    if (kind === 'terms' || kind === 'both') g.terms = Array.from({ length: r.int(8) }, term);
    if (kind === 'json' || kind === 'both') { g.file = r.pick(['t.json', 'T.JSON']); text = JSON.stringify(r.chance(0.9) ? Array.from({ length: r.int(8) }, term) : { not: 'list' }); }
    if (kind === 'badjson') { g.file = 'x.json'; text = r.pick(['{broken', '', '﻿[]']); }
    if (kind === 'tsv') { g.file = r.pick(['t.tsv', 't.txt']); text = Array.from({ length: r.int(8) }, tsvLine).join(r.pick(['\n', '\r\n'])); }
    if (kind === 'nofile') { g.file = 'missing.tsv'; }
    const files = new Map<string, string>(kind === 'nofile' ? [] : [[g.file as string ?? 'z', text]]);
    const res = glossaryTerms({ files } as never, g as never);
    add('glossaryTerms', { g, text: kind === 'nofile' ? '' : text }, res);
    // plan + apply against a project
    const terms = Array.from({ length: r.int(5) }, () => ({ en: r.pick(EN), uk: r.pick(UK), mt: 3, ...(r.chance(0.3) ? { extra: 1 } : {}) }));
    const saved = { terms } as unknown as SavedProject;
    const plan = planGlossaryImport(saved, res.terms);
    const copy = { terms: JSON.parse(JSON.stringify(terms)) } as unknown as SavedProject;
    const n = applyGlossaryImport(copy, plan, 500);
    add('import', { terms, brought: res.terms }, { plan, n, terms: copy.terms, deletedTerms: copy.deletedTerms ?? null });
  }
  writeVectors('glossaries', out);
});
