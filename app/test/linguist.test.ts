// The Ukrainian-language audit: every `it` asserts the CORRECT Ukrainian behaviour (declension of a term, retargeting of the forms in
// the rows, the QA rules for letters, find and replace, autofill). Known limits are named where a test was left out: a regular
// plural noun in a phrase («золоті монети»), and a stem key that cannot tell нога from ніж.
import { describe, it, expect } from 'vitest';
import { proposeTermSync } from '../src/core/termsync';
import { ukForms, ukRetarget } from '../src/core/ukmorph';
import { runRules } from '../src/core/qarules';
import { qaOf } from '../src/core/qaconfig';
import { check } from '../src/core/qa';
import { findReplace } from '../src/core/findreplace';
import { learnWords, proposals } from '../src/core/autofill';

const rules = qaOf(undefined);
function sync(old: string, next: string, sentence: string): { after: string; level: string | null; tick: boolean; alts: string[] } {
  const views: any = [{ name: 'f.json', units: [{ key: 'k', source: 'The term appears here', speaker: '', kind: 'dialogue', context: '' }] }];
  const saved: any = { files: { 'f.json': { k: { target: sentence, status: 'draft', mt: 0 } } }, terms: [], settings: {} };
  const r = proposeTermSync(views, saved, { en: 'term', old: [old], next });
  const p = r.proposals[0];
  return { after: p ? p.after : sentence, level: p?.conf.level ?? null, tick: p?.tick ?? false, alts: p ? p.spans.flatMap(s => s.alts.map(a => a.text)) : [] };
}
const qa = (src: string, tgt: string): { key: string; fix?: string }[] => runRules(src, tgt, rules, 'dialogue').map(i => ({ key: i.key, fix: i.fix?.text }));

describe('ling-01 plurale tantum "ворота" treated as singular feminine', () => {
  it('gen: біля брами -> біля воріт', () => { const r = sync('брама', 'ворота', 'Біля брами стояв вартовий.'); expect(r.after).toBe('Біля воріт стояв вартовий.'); });
  it('must not be high+ticked when wrong', () => { const r = sync('брама', 'ворота', 'Ми підійшли до брами.'); expect(r.tick && r.after !== 'Ми підійшли до воріт.').toBe(false); });
});
describe('ling-02 -ар loanwords declined soft', () => {
  it('радар ins.sg', () => { expect(ukForms('радар')!['ins.sg'][0]).toBe('радаром'); });
  it('радар nom.pl', () => { expect(ukForms('радар')!['nom.pl'][0]).toBe('радари'); });
  it('sync: радара -> сканера for old=радар works, new=радар: "зі сканером" -> "з радаром"', () => { expect(sync('сканер', 'радар', 'Він пишається сканером.').after).toBe('Він пишається радаром.'); });
});
describe('ling-03 fleeting vowel -ер/-ел/-єць', () => {
  it('майстер gen.sg', () => { expect(ukForms('майстер')!['gen.sg'][0]).toBe('майстра'); });
  it('орел gen.sg', () => { expect(ukForms('орел')!['gen.sg'][0]).toBe('орла'); });
  it('заєць gen.sg', () => { expect(ukForms('заєць')!['gen.sg'][0]).toBe('зайця'); });
  it('sync вежа->майстер: "У вежі" -> "У майстрі/майстрові"', () => { const r = sync('вежа', 'майстер', 'У вежі було темно.'); expect(['У майстрі було темно.', 'У майстрові було темно.']).toContain(r.after); });
  it('sync old=майстер misses майстра', () => { expect(sync('майстер', 'умілець', 'Це робота майстра.').after).toBe('Це робота умільця.'); });
});
describe('ling-04 гість is masculine', () => {
  it('гість gen.sg', () => { expect(ukForms('гість')!['gen.sg'][0]).toBe('гостя'); });
  it('sync лицар->гість "Для лицаря"', () => { expect(sync('лицар', 'гість', 'Для лицаря є місце.').after).toBe('Для гостя є місце.'); });
});
describe('ling-05 друг plural stem друз-', () => {
  it('друг gen.pl', () => { expect(ukForms('друг')!['gen.pl'][0]).toBe('друзів'); });
  it('друг dat.pl', () => { expect(ukForms('друг')!['dat.pl'][0]).toBe('друзям'); });
  it('sync друг->товариш "друзям" found', () => { expect(sync('друг', 'товариш', 'Ми допоможемо друзям.').after).toBe('Ми допоможемо товаришам.'); });
});
describe('ling-10 animate feminine acc.pl = gen.pl', () => {
  it('відьма acc.pl (ukForms)', () => { expect(ukForms('відьма')!['acc.pl'][0]).toBe('відьом'); });
  it('жінка acc.pl (ukForms)', () => { expect(ukForms('жінка')!['acc.pl'][0]).toBe('жінок'); });
  it('production path ukRetarget: acc.pl of жінка (unique-cell probe) is high-confidence and wrong', () => {
    const SUFF = ['а', 'б', 'в', 'г', 'ґ', 'д', 'е', 'є', 'ж', 'з', 'и', 'і', 'ї', 'й'];
    const cells = ['nom.sg','nom.pl','gen.sg','gen.pl','dat.sg','dat.pl','acc.sg','acc.pl','ins.sg','ins.pl','loc.sg','loc.pl','voc.sg','voc.pl'];
    const uni: Record<string, string> = Object.fromEntries(cells.map((c, i) => [c, 'ааа' + (i === 0 ? '' : SUFF[i - 1])]));
    const dict: any = { lexeme: (l: string) => (l === 'ааа' ? Object.fromEntries(cells.map(c => [c, [uni[c]]])) : null), info: () => null };
    const r = ukRetarget('ааа', 'жінка', uni['acc.pl']!, { dict })!;
    expect(r.text).toBe('жінок');
  });
});
describe('ling-06 гра plural ігри', () => {
  it('гра nom.pl', () => { expect(ukForms('гра')!['nom.pl'][0]).toBe('ігри'); });
  it('гра gen.pl', () => { expect(ukForms('гра')!['gen.pl'][0]).toBe('ігор'); });
});
describe('ling-07 neuter -ко locative', () => {
  it('ліжко loc.sg', () => { expect(['ліжку', 'ліжці']).toContain(ukForms('ліжко')!['loc.sg'][0]); });
  it('sync меч->ліжко "У мечі" ', () => { expect(['У ліжку була тріщина.', 'У ліжці була тріщина.']).toContain(sync('меч', 'ліжко', 'У мечі була тріщина.').after); });
});
describe('ling-08 masculine names in -о', () => {
  it('Петро acc.sg', () => { expect(ukForms('Петро')!['acc.sg'][0]).toBe('петра'); });
  it('Петро voc.sg', () => { expect(ukForms('Петро')!['voc.sg'][0]).toBe('петре'); });
  it('батько acc.sg', () => { expect(ukForms('батько')!['acc.sg'][0]).toBe('батька'); });
  it('батько loc.sg is not "батькі"', () => { expect(ukForms('батько')!['loc.sg'][0]).not.toBe('батькі'); });
});
describe('ling-09 geminate -я nouns that are not neuter', () => {
  it('Ілля gen.sg', () => { expect(ukForms('Ілля')!['gen.sg'][0]).toBe('іллі'); });
  it('стаття gen.sg', () => { expect(ukForms('стаття')!['gen.sg'][0]).toBe('статті'); });
  it('sync Іван->Ілля "Я бачив Івана": the accusative is offered (the form fits the genitive too, so it is an alternative)', () => { const r = sync('король', 'Ілля', 'Я бачив короля.'); expect([r.after, ...r.alts.map(a => 'Я бачив ' + a + '.')].map(x => x.toLowerCase())).toContain('я бачив іллю.'); expect(r.after).not.toBe('Я бачив Ілля.'); });
});
describe('ling-11 masculine nouns in -а/-я take feminine adjectives', () => {
  it('Старий Микола nom.sg', () => { expect(ukForms('Старий Микола')!['nom.sg'][0]).toBe('старий микола'); });
  it('sync "Старий Микола" -> "Старий Хома": gen "старого Миколи"', () => { expect(sync('Старий Микола', 'Старий Хома', 'Я бачив старого Миколу.').after).toBe('Я бачив старого Хому.'); });
});
describe('ling-12 plural / non-masculine adjectives in term phrases', () => {
  it('залізні двері nom.sg', () => { expect(ukForms('залізні двері')!['gen.pl'][0]).toBe('залізних дверей'); });
  it('чорні ворота gen.pl (a plural adjective before a noun that has only a plural)', () => { expect(ukForms('чорні ворота')!['gen.pl'][0]).toBe('чорних воріт'); });
});
describe('ling-13 gender change not reflected in confidence', () => {
  it('корабель -> судно: "Корабель відплив" must not be high+ticked while verb disagrees', () => { const r = sync('корабель', 'судно', 'Корабель відплив на світанку.'); expect(r.tick && /Судно відплив/.test(r.after)).toBe(false); });
});
describe('ling-17 prepositions are not adapted (з/зі)', () => {
  it('вовк -> звір "з вовком" must become "зі звіром"', () => { expect(sync('вовк', 'звір', 'Вона йшла з вовком.').after).toBe('Вона йшла зі звіром.'); });
  it('дракон -> змій "з драконом" -> "зі змієм"', () => { expect(sync('дракон', 'змій', 'Вона говорила з драконом.').after).toBe('Вона говорила зі змієм.'); });
});
describe('ling-15 locative suggested without a preposition', () => {
  it('"Мечі лежали" -> "Клинки лежали" (nominative plural) must be the primary', () => { expect(sync('меч', 'клинок', 'Мечі лежали на землі.').after).toBe('Клинки лежали на землі.'); });
  it('"Королі та королеви" -> "Володарі"', () => { expect(sync('король', 'володар', 'Королі та королеви зібралися.').after).toBe('Володарі та королеви зібралися.'); });
});
describe('ling-16 variant index of the old form reused for another lemma', () => {
  it('на коні -> на скакуні', () => { expect(sync('кінь', 'скакун', 'Вона їхала на коні.').after).toBe('Вона їхала на скакуні.'); });
});
describe('ling-18 QA term check accepts any word sharing a 3-letter key', () => {
  const terms = (en: string, uk: string): any => [{ en, uk }];
  const hasTermIssue = (en: string, uk: string, source: string, target: string): boolean => check({ source, kind: 'dialogue' } as any, target, { tolerancePct: 1000, terms: terms(en, uk) }).some(i => i.key === 'term');
  it('god -> бог: "Богдан" is not "бог"', () => { expect(hasTermIssue('god', 'бог', 'The god is angry.', 'Богдан розлютився.')).toBe(true); });
  it('bow -> лук: "Лукаш" is not "лук"', () => { expect(hasTermIssue('bow', 'лук', 'The bow is old.', 'Лукаш старий.')).toBe(true); });
  // (нога / ніж: both flatten to the key «ног», the key of the stem cannot tell them apart: a known limit of the stem comparison)
});
describe('ling-19 find/replace whole word vs apostrophe', () => {
  const fr = (find: string, replace: string, text: string, ww: boolean): string | null => {
    const views: any = [{ name: 'f', units: [{ key: 'k', source: '', speaker: '', kind: 'dialogue', context: '' }] }];
    const saved: any = { files: { f: { k: { target: text, status: 'draft', mt: 0 } } } };
    return findReplace(views, saved, { find, replace, caseSensitive: false, wholeWord: ww })[0]?.after ?? null;
  };
  it('whole word "сім" must not match inside "сім’я"', () => { expect(fr('сім', 'вісім', 'Сім’я та сім котів', true)).toBe('Сім’я та вісім котів'); });
  it('whole word "об" must not match inside "об’єкт"', () => { expect(fr('об', 'на', 'Це об’єкт', true)).toBeNull(); });
});
describe('ling-21 hidden/bidi/space characters', () => {
  for (const [n, ch] of [['RLM', '\u200F'], ['LRM', '\u200E'], ['RLO', '\u202E'], ['LRE', '\u202A'], ['LRI', '\u2066'], ['EN QUAD', '\u2000'], ['EM QUAD', '\u2001'], ['NEL', '\u0085']] as const)
    it(`${n} is reported by ws-hidden`, () => { expect(qa('Hello', `Привіт${ch}світе`).some(i => i.key === 'ws-hidden')).toBe(true); });
  it('U+2000 is not reported as a decomposed letter', () => { expect(qa('Hello', 'Привіт світе').some(i => i.key === 'uk-normalization')).toBe(false); });
});
describe('ling-22 apostrophe look-alikes', () => {
  for (const [n, ch] of [['U+02BB', '\u02BB'], ['U+201B', '\u201B'], ['U+FF07', '\uFF07']] as const)
    it(`${n} between Cyrillic letters is flagged`, () => { expect(qa('Hello', `Сім${ch}я`).some(i => i.key === 'uk-apostrophe')).toBe(true); });
});
describe('ling-23 quotes next to Cyrillic letters become apostrophes', () => {
  it('„Так”і : the fix must not turn the closing quote into an apostrophe', () => { const f = qa('Hello', 'Він сказав: „Так”і пішов.').find(i => i.key === 'uk-apostrophe')?.fix; expect(f ?? '').not.toContain('Так’і'); });
  it('"Так"і', () => { const f = qa('Hello', 'Він сказав:"Так"і пішов.').find(i => i.key === 'uk-apostrophe')?.fix; expect(f ?? '').not.toContain('Так’і'); });
});
describe('ling-24 uk-homoglyph reverts a correct Ukrainian caps word to Latin', () => {
  for (const [s, t] of [['ATOM', 'АТОМ'], ['TOM', 'ТОМ'], ['MAMA!', 'МАМА!']] as const)
    it(`${s} -> ${t} is legitimate Ukrainian`, () => { expect(qa(s, t).some(i => i.key === 'uk-homoglyph')).toBe(false); });
});
describe('ling-25 single Latin labels converted to Cyrillic', () => {
  it('Нехай x і y — числа', () => { const r = qa('Solve the puzzle', 'Нехай x і y — числа').find(i => i.key === 'uk-homoglyph'); expect(r?.fix ?? 'Нехай x і y — числа').toBe('Нехай x і y — числа'); });
  it('Якщо a більше за b, то a виграє', () => { const r = qa('Solve the puzzle', 'Якщо a більше за b, то a виграє').find(i => i.key === 'uk-homoglyph'); expect(r?.fix ?? 'Якщо a більше за b, то a виграє').toBe('Якщо a більше за b, то a виграє'); });
});
describe('ling-26 Cyrillic look-alike labels not flagged', () => {
  it('Roman numeral with Cyrillic І: "Акт ІІ" when the source is not Latin numeral', () => { expect(qa('Hello', 'Акт ІІ').some(i => i.key === 'uk-homoglyph')).toBe(true); });
});
describe('ling-27 code-malformed fix duplicates the bracket', () => {
  it('\\N[1 ], привіт', () => { const f = qa('\\N[1]', '\\N[1 ], привіт').find(i => i.key === 'code-malformed')?.fix; expect(f).not.toContain('] ]'); });
});
describe('ling-28 uk-normalization disabled by a non-NFC source', () => {
  it('decomposed й in target is flagged although source has a decomposed é', () => { expect(qa('Café', 'Украйна').some(i => i.key === 'uk-normalization')).toBe(true); });
});

describe('ling-14 PREP table lacks у/в + genitive (possessive "у вовка")', () => {
  it('"У вовка була рана" -> "У звіра була рана"', () => { expect(sync('вовк', 'звір', 'У вовка була рана.').after).toBe('У звіра була рана.'); });
});
describe('ling-20 find/replace treats apostrophe variants as different letters', () => {
  const fr = (find: string, text: string): number => {
    const views: any = [{ name: 'f', units: [{ key: 'k', source: '', speaker: '', kind: 'dialogue', context: '' }] }];
    const saved: any = { files: { f: { k: { target: text, status: 'draft', mt: 0 } } } };
    return findReplace(views, saved, { find, replace: 'x', caseSensitive: false, wholeWord: false }).length;
  };
  it("ASCII ' finds U+2019", () => { expect(fr("зв'язок", 'Втрачено зв’язок')).toBe(1); });
  it("U+2019 finds ASCII '", () => { expect(fr('зв’язок', "Втрачено зв'язок")).toBe(1); });
  it('U+02BC finds U+2019', () => { expect(fr('зв\u02BCязок', 'Втрачено зв’язок')).toBe(1); });
});

describe('ling-29 autofill substitutes a learned inflected form word by word', () => {
  const run = (target: string): string | undefined => {
    const pairs: [string, string][] = [['New game', 'Нова гра'], ['Save game', 'Зберегти гру'], ['Load game', 'Завантажити гру'], [target, '']];
    const units: any = pairs.map((p, i) => ({ key: 'k' + i, source: p[0], speaker: '', kind: 'name', context: '' }));
    const files: any = { 'f.json': Object.fromEntries(pairs.slice(0, 3).map((p, i) => ['k' + i, { target: p[1], status: 'done', mt: 0 }])) };
    const views: any = [{ name: 'f.json', units }], saved: any = { files, terms: [], settings: {} };
    return proposals(views, saved, learnWords(views, saved)).find(p => p.source === target)?.target;
  };
  it('"New Game" -> "Нова гра" (nominative, sentence case), not "Нова Гру"', () => { expect(run('New Game')).toBe('Нова гра'); });
  it('"NEW GAME" keeps capitals', () => { expect(run('NEW GAME')).toBe('НОВА ГРА'); });
});

describe('control (must PASS: the harness is not failing trivially)', () => {
  it('меч gen.sg', () => { expect(ukForms('меч')!['gen.sg'][0]).toBe('меча'); });
  it('sync меч->клинок "Без меча"', () => { expect(sync('меч', 'клинок', 'Без меча я безсилий.').after).toBe('Без клинка я безсилий.'); });
  it('QA: correct Ukrainian text gets no remark', () => { expect(qa('Hello', 'Ключ лежить у скрині біля ліжка. Ім’я — Мар’яна.')).toEqual([]); });
  it('QA: homoglyph is found', () => { expect(qa('Hello', 'Пpивіт').some(i => i.key === 'uk-homoglyph')).toBe(true); });
});
