import { test } from 'vitest';
import { strandKind, strandsOf } from '../../src/core/strands';
import { sourceTermHits, targetTermHits, termMatchesOfPhrases, termRangesInTarget } from '../../src/core/termmatch';
import { UK, genTerm, genText } from './corpus';
import { rng, writeVectors } from './util';
import type { Rng } from './util';

const genTerms = (r: Rng, source: string) => {
  const terms: { en: string; uk: string; alt?: string[] }[] = [];
  const toks = source.split(/\s+/).filter(Boolean);
  for (let i = 0, n = 1 + r.int(8); i < n; i++) {
    // половина термінів береться з самого оригіналу, щоб були знахідки (в т.ч. шаблони й накладання)
    let en = r.chance(0.5) && toks.length ? toks.slice(r.int(toks.length)).slice(0, 1 + r.int(2)).join(' ').replace(/[^\p{L}\p{N}' -]/gu, '') || genTerm(r, 'en') : genTerm(r, 'en');
    if (r.chance(0.15) && toks.length > 3) en = `${r.pick(toks)} … ${r.pick(toks)}`.replace(/[^\p{L}\p{N}' …]/gu, '');
    terms.push({ en, uk: genTerm(r, 'uk'), ...(r.chance(0.3) ? { alt: Array.from({ length: 1 + r.int(2) }, () => genTerm(r, 'uk')) } : {}) });
  }
  return terms;
};

test('export strands vectors', () => {
  const r = rng(909);
  const out: Record<string, { input: unknown; output: unknown }[]> = {};
  const add = (name: string, input: unknown, output: unknown) => (out[name] ??= []).push({ input, output });
  const idx = <T extends { term: object }>(terms: object[], hs: T[]) => hs.map(h => ({ ...h, term: terms.indexOf(h.term) }));

  for (const en of ['sword', 'iron sword', 'take … off', 'take ... off', 'x … ', '… x', '']) add('strandKind', en, strandKind(en));
  for (let i = 0; i < 100; i++) { const t = genTerm(r, 'en'); add('strandKind', t, strandKind(t)); }

  for (let i = 0; i < 600; i++) {
    const source = genText(r, 'en'), terms = genTerms(r, source);
    add('sourceTermHits', { source, terms }, idx(terms, sourceTermHits(source, terms)));
  }
  for (let i = 0; i < 600; i++) {
    const target = genText(r, 'uk'), uk = genTerm(r, 'uk');
    const alt = r.chance(0.4) ? [genTerm(r, 'uk')] : [];
    add('termMatchesOfPhrases', { target, uk, alt }, termMatchesOfPhrases(target, uk, alt));
    add('termRangesInTarget', { target, uk, alt }, termRangesInTarget(target, uk, alt));
    // відповідники беруться з самого перекладу, щоб були знахідки
    const words = target.split(/\s+/).filter(Boolean);
    const terms = Array.from({ length: 1 + r.int(5) }, () => ({ en: 'x', uk: r.chance(0.6) && words.length ? words[r.int(words.length)]!.replace(/[^\p{L}\p{N}'’]/gu, '') || r.pick(UK) : genTerm(r, 'uk'), ...(r.chance(0.2) ? { alt: [r.pick(UK)] } : {}) }));
    add('targetTermHits', { target, terms }, idx(terms, targetTermHits(target, terms)));
  }
  for (let i = 0; i < 1200; i++) {
    const source = genText(r, 'en'), terms = genTerms(r, source);
    // переклад: або з відповідників термінів (щоб були ok/alt), або випадковий, або порожній
    const parts = terms.flatMap(t => (r.chance(0.5) ? [r.chance(0.2) && t.alt ? t.alt[0]! : t.uk] : []));
    const target = r.chance(0.1) ? '' : r.chance(0.7) ? parts.join(r.pick([' ', ', ', ' и '])) + ' ' + genText(r, 'uk') : genText(r, 'uk');
    const ss = strandsOf(source, target, terms);
    add('strandsOf', { source, target, terms }, ss.map(s => ({ ...s, term: terms.indexOf(s.term) })));
  }
  writeVectors('strands', out);
});
