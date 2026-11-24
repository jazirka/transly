import { test } from 'vitest';
import { hasGap, hasTerm, normalizeGap, parseTerms, patternParts, phraseForms, prepareText, targetHasTerm, termFirstKey, termMatchesIn, termMatchesInTarget, termRanges, termsIn, ukStemsAgree, wordTokens } from '../../src/core/glossary';
import { rng, writeVectors } from './util';
import type { Rng } from './util';

// Англійські слова: правильні дієслова, множина, винятки, британське написання — щоб пройти кожну гілку enKeys.
const EN = `sword swords knife knives wolf wolves leaf leaves life lives half halves thief thieves shelf shelves man men woman women child children foot feet tooth teeth mouse mice goose geese ox oxen person people die dice staff staves
take took taken give gave given go went gone come came make made get got gotten run ran seen see knew know known throw threw wear wore broke broken fell fallen ate eaten drank drunk rode sang swam held kept brought bought caught taught sold told stood sat spoke woke chose hid blew grew flew shook forgot froze stole wrote began sent built lay laid paid said slept met led fought sought
centre center theatre grey gray colour color armour armor honour favourite flavour labour neighbour behaviour defence defense offence licence organise organize analyse analyze travelled traveled cancelled towards learnt dialogue catalog
box boxes glass glasses bus buses wish wishes church churches buzz quiz fox foxes class classes status focus virus crisis analysis axis
story stories city cities hero heroes potato potatoes key keys day days boy boys
running runs runned jumping jumped walking walked stopped stopping hopped hopping loving loved moved moving making taking baking tapped tipped added adding sing singing ring king ping thing bring string
use used using car cars bed beds bad dad pass passed kiss kissed miss missed Chris's king's dogs' dog's world's
1 2 10 100 3rd 42 99 level lvl hp mp HP MP Lv15 x2 e-mail don't can't isn't rock'n'roll
fire ice water earth wind light dark heal poison shield armor helmet potion elixir scroll key door chest gate cave tower village castle forest river mountain
off on up down out in over under away back with from into onto upon about against between through`.split(/\s+/).filter(Boolean);

const UK = `меч мечем мечі мечів мечу мечеві мечами нога нозі ногою ноги рука руці рукою руки кінь коня коні коней вежа вежі вежею залізний залізного залізним залізних залізні залізна залізної сталевий сталевого сталеві сталевих
майстер майстра майстром майстрові пес пса псу собака собаки собаці дракон дракона драконові дракони драконів богдан бог бога богу богів боги бо навичка навичок навичці навички кінець кінця кінцем кінці
лікар лікаря лікарю зілля зілля вогонь вогню вогнем вогні гість гостя гостю гості гостей двері дверей дверям ворота воріт
ім'я імені імена імен сім'я сім'ї обʼєкт об'єкта об’єкти п'ять
зняти знімає знімають знімати зняв зі з із на у в до про від по й та
квітка квітки квіткою півень півня ніч ночі ніччю річ речі річчю сіль солі
Дракон ДРАКОН Меч МЕЧІ`.split(/\s+/).filter(Boolean);

const CODES = ['\\N[1]', '\\C[2]', '\\{', '\\}', '\\.', '\\|', '\\!', '\\>', '\\<', '\\^', '\\$', '\\V[12]', '\\n'];
const PUNCT = [' ', ' ', ' ', ' ', ', ', '. ', '! ', '? ', '; ', '\n', '-', ' - ', ' – ', '—', '"', '(', ')', '...', '…', ' … ', '😀', ' 🙂 ', '’', "'", '`', 'ʼ', '\t', ' ', ' '];

function genText(r: Rng, lang: 'en' | 'uk' | 'mix'): string {
  let s = '';
  const n = 1 + r.int(14);
  for (let i = 0; i < n; i++) {
    const roll = r.next();
    if (roll < 0.06) s += r.pick(CODES);
    else if (lang === 'en' || (lang === 'mix' && r.chance(0.5))) s += r.pick(EN);
    else s += r.pick(UK);
    s += r.pick(PUNCT);
  }
  if (r.chance(0.1)) s = s.toUpperCase();
  return s;
}
function genTerm(r: Rng, lang: 'en' | 'uk'): string {
  const pool = lang === 'en' ? EN : UK;
  const k = r.pick([1, 1, 1, 2, 2, 3]);
  const parts: string[] = [];
  for (let i = 0; i < k; i++) parts.push(r.pick(pool));
  const sep = r.pick([' ', ' ', ' ', '-', ' - ']);
  let t = parts.join(sep);
  if (r.chance(0.35)) {
    // шаблон з пропуском: «take … off»
    const gap = r.pick([' … ', '…', ' ... ', '...', ' …', '… ']);
    t = r.pick(pool) + gap + (r.chance(0.3) ? r.pick(pool) + ' ' + r.pick(pool) : r.pick(pool));
    if (r.chance(0.1)) t += gap + r.pick(pool);
    if (r.chance(0.08)) t = '… ' + t;
    if (r.chance(0.08)) t += ' …';
  }
  return r.chance(0.05) ? ' ' + t + ' ' : t;
}

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
