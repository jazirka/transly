import { test } from 'vitest';
import { hasGap, hasTerm, normalizeGap, parseTerms, patternParts, phraseForms, prepareText, targetHasTerm, termFirstKey, termMatchesIn, termMatchesInTarget, termRanges, termsIn, ukStemsAgree, wordTokens } from '../../src/core/glossary';
import { rng, writeVectors } from './util';
import { EN, UK, genTerm, genText } from './corpus';

test('export glossary vectors', () => {
  const r = rng(4242);
  const out: Record<string, { input: unknown; output: unknown }[]> = {};
  const add = (name: string, input: unknown, output: unknown) => (out[name] ??= []).push({ input, output });

  // окремі слова: усі ключі
  for (const w of [...EN, ...UK]) add('wordTokens', w, wordTokens(w));
  for (let i = 0; i < 300; i++) { const t = genText(r, r.pick(['en', 'uk', 'mix'] as const)); add('wordTokens', t, wordTokens(t)); }
  for (let i = 0; i < 300; i++) { const t = genText(r, r.pick(['en', 'uk', 'mix'] as const)); const p = prepareText(t); add('prepareText', t, { text: p.text, tokens: p.tokens }); }
  // ворожі рядки
  for (const t of ['a'.repeat(60), 'organise'.repeat(8), 'ь'.repeat(50), '', ' ', '\\N[1]\\C[2]', "'s", 's', "dogs'", 'x'.repeat(41) + 'ises']) { add('wordTokens', t, wordTokens(t)); const p = prepareText(t); add('prepareText', t, { text: p.text, tokens: p.tokens }); }

  const pairs: [string, string][] = [['слова', 'слово'], ['бог', 'богдан'], ['бог', 'богу'], ['кін', 'кінь'], ['абв', 'абвгд'], ['абвгд', 'абвгдеж'], ['нога', 'нозі']];
  for (const [a, b] of pairs) add('ukStemsAgree', { a, b }, ukStemsAgree(a, b));
  for (let i = 0; i < 300; i++) {
    const a = wordTokens(r.pick(UK))[0]?.keys[0] ?? '', b = wordTokens(r.pick(UK))[0]?.keys[0] ?? '';
    add('ukStemsAgree', { a, b }, ukStemsAgree(a, b));
  }

  for (const t of ['take … off', 'take...off', '…x', 'x…', 'a … b … c', '… …', 'plain', ' ... ', '']) {
    add('hasGap', t, hasGap(t)); add('patternParts', t, patternParts(t)); add('normalizeGap', t, normalizeGap(t));
  }
  for (let i = 0; i < 200; i++) { const t = genTerm(r, r.pick(['en', 'uk'] as const)); add('hasGap', t, hasGap(t)); add('patternParts', t, patternParts(t)); add('normalizeGap', t, normalizeGap(t)); add('termFirstKey', t, termFirstKey(t) ?? null); }

  for (let i = 0; i < 900; i++) {
    const text = genText(r, 'en');
    // у половині випадків термін береться з самого тексту, щоб були збіги
    const toks = wordTokens(text);
    let en = genTerm(r, 'en');
    if (toks.length && r.chance(0.6)) {
      const a = r.int(toks.length), b = Math.min(toks.length - 1, a + r.int(2));
      en = text.slice(toks[a]!.start, toks[b]!.end);
      if (r.chance(0.3) && b + 3 < toks.length) en = text.slice(toks[a]!.start, toks[a]!.end) + ' … ' + text.slice(toks[b + 2]!.start, toks[b + 2]!.end);
    }
    add('termMatchesIn', { text, en }, termMatchesIn(prepareText(text), en));
    add('hasTerm', { text, en }, hasTerm(text, en));
    add('termRanges', { text, en }, termRanges(text, en));
  }

  for (let i = 0; i < 300; i++) {
    const source = genText(r, 'en');
    const terms = Array.from({ length: 1 + r.int(8) }, () => ({ en: r.chance(0.5) ? r.pick(EN) : genTerm(r, 'en'), uk: r.pick(UK) }));
    add('termsIn', { source, terms }, termsIn(source, terms).map(t => terms.indexOf(t)));
  }

  for (let i = 0; i < 1200; i++) {
    const target = genText(r, 'uk');
    const toks = wordTokens(target);
    let uk = genTerm(r, 'uk');
    if (toks.length && r.chance(0.6)) {
      const a = r.int(toks.length), b = Math.min(toks.length - 1, a + r.int(2));
      uk = target.slice(toks[a]!.start, toks[b]!.end);
      if (r.chance(0.3) && b + 3 < toks.length) uk = target.slice(toks[a]!.start, toks[a]!.end) + ' … ' + target.slice(toks[b + 2]!.start, toks[b + 2]!.end);
    }
    const alt = r.chance(0.3) ? Array.from({ length: 1 + r.int(2) }, () => genTerm(r, 'uk')) : [];
    add('targetHasTerm', { target, uk, alt }, targetHasTerm(target, uk, alt));
    add('termMatchesInTarget', { target, uk }, termMatchesInTarget(target, uk));
  }

  for (const p of [...UK.slice(0, 80), 'залізний меч', 'зняти … з', 'abc']) { const f = phraseForms(p); add('phraseForms', p, f && f.map(s => [...s].sort())); }

  const lines = ['sword\tменч', 'a;b', ';', '\t', 'x\ty\tz', '  ', 'one;two;three', ' k ; v ', 'no separator', 'a\r\nb;c\r\n\r\nd\te', ';x', 'x;'];
  for (const t of lines) { const p = parseTerms(t); add('parseTerms', t, p); }
  for (let i = 0; i < 100; i++) { const t = Array.from({ length: r.int(6) }, () => r.pick(EN) + r.pick(['\t', ';', '', ' ;']) + r.pick(UK)).join(r.pick(['\n', '\r\n'])); add('parseTerms', t, parseTerms(t)); }
  writeVectors('glossary', out);
});
