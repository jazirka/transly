import type { Issue, IssueCat } from './qa';
import { BLANK, applyEdits, maskCodes, scriptWords } from './qacodes';
import type { ScriptWord } from './qacodes';

/**
 * The registry of QA rules about the form of a translation (letters, spaces, apostrophes, damaged control codes). Each
 * rule looks at the source and the target and gives one remark with the places it found; when every place has an
 * unambiguous correction, the remark carries a ready fix (the whole translation with all of them made). The id of a rule
 * is stored in the row's list of ignored remarks, so ids never change.
 *
 * The level of a rule is the project's choice: `off`, `warn` (an advice: it shows, and fixes with one click, but blocks
 * nothing) or `bad` (an error: the row cannot be sent or built until it is mended).
 */
export type RuleSeverity = 'off' | 'warn' | 'bad';

export interface QaRules {
  /** The level of every rule by id. */
  sev: Record<string, RuleSeverity>;
  /** Latin words the translator allows to stay in Ukrainian text (lower case). */
  keep: Set<string>;
  /** The apostrophe the project writes: `any` accepts the three right ones and only flags the wrong signs. */
  apostrophe: 'any' | '’' | 'ʼ' | "'";
  /** Everything above as one short text, for the memo of the QA answers. */
  sig: string;
}

interface RuleCtx {
  source: string;
  target: string;
  ms: string;
  mt: string;
  rules: QaRules;
  /** The words of the source (blanked), as a set: a word that stands in the original is the game's own. */
  srcWords: () => Set<string>;
}

interface RuleHit { fixed?: string; what: string }
interface RuleOut { message: string; detail?: string; fixed?: string }

export interface QaRule {
  id: string;
  title: string;
  explain: string;
  cat: IssueCat;
  /** The level when the project has not chosen one. */
  def: RuleSeverity;
  /** Does the rule have a ready fix at all (for «Виправити в файлі»). */
  fixable: boolean;
  run(c: RuleCtx): RuleOut | null;
}

/* ---------- the letters that look alike ---------- */

/** Cyrillic → Latin: letters that are drawn the same (the strong ones), then the ones that are only close (к м т). */
const C2L_STRONG: Record<string, string> = { а: 'a', е: 'e', о: 'o', р: 'p', с: 'c', у: 'y', х: 'x', і: 'i', А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', Х: 'X', У: 'Y', І: 'I' };
const C2L: Record<string, string> = { ...C2L_STRONG, к: 'k', м: 'm', т: 't', ї: 'ï', Ї: 'Ï' };
const L2C_STRONG: Record<string, string> = Object.fromEntries(Object.entries(C2L_STRONG).map(([c, l]) => [l, c]));
const L2C: Record<string, string> = { ...L2C_STRONG, k: 'к', m: 'м', t: 'т', ï: 'ї', Ï: 'Ї' };

const BUILTIN_LATIN = new Set('hp mp tp sp exp xp lv lvl atk def mat mdf agi luk str dex int vit wis ap cp ui hud npc pc dlc dps aoe dot pvp pve rpg ok tv gps id usb vip dj ai km m cm mm kg g mg l ml s ms h hz khz mhz ghz kb mb gb tb px pt dpi fps wi fi'.split(' '));
const isLatinOk = (w: string, c: RuleCtx): boolean => {
  const low = w.toLowerCase();
  return BUILTIN_LATIN.has(low) || c.rules.keep.has(low) || /^[x×]\d+$/i.test(w) || /^\d+[x×]$/i.test(w) || /^[IVXLCDM]+$/.test(w) || c.srcWords().has(w);
};

const convert = (w: string, map: Record<string, string>): string => [...w].map(ch => map[ch] ?? ch).join('');
const allMapped = (w: string, test: RegExp, map: Record<string, string>): boolean => [...w].every(ch => !test.test(ch) || map[ch] !== undefined);
const ROMAN = /^M{0,4}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/;
const LATIN_LETTER = /\p{Script=Latin}/u, CYR_LETTER = /\p{Script=Cyrillic}/u;

/* ---------- 1. damaged control codes ---------- */

interface CodeHit { kind: string; start: number; end: number; shown: string; fix?: string }

function codeHits(text: string): CodeHit[] {
  const hits: CodeHit[] = [];
  const push = (kind: string, m: RegExpMatchArray, fix?: string): void => { hits.push({ kind, start: m.index!, end: m.index! + m[0].length, shown: m[0], ...(fix !== undefined ? { fix } : {}) }); };
  // a Cyrillic letter that looks like the Latin one of a code: \С[2]
  for (const m of text.matchAll(/\\([\u0400-\u04FF]+)(\[[^\]\n]*\])?/g)) {
    const latin = [...m[1]!].map(ch => C2L_STRONG[ch] ?? '?').join('');
    push('cyr', m, /^[A-Za-z]+$/.test(latin) ? '\\' + latin + (m[2] ?? '') : undefined);
  }
  // a space inside: \ C[2], \C [2]
  for (const m of text.matchAll(/\\\s+[A-Za-z]{1,3}\[\d+\]|\\[A-Za-z]{1,3}\s+\[\d+\]/g)) push('space', m, m[0].replace(/\s+/g, ''));
  // an opening bracket that is never closed: \C[2, \C[2text
  for (const m of text.matchAll(/\\[A-Za-z]{1,3}\[(\d+)(?![\d\]])/g)) push('open', m, m[0] + ']');
  for (const m of text.matchAll(/\\[A-Za-z]{1,3}\[(?![\d\]])/g)) if (!/\]/.test(text.slice(m.index! + m[0].length).split('\n')[0] ?? '')) push('open', m);
  // a parameter that is not a number where the game wants one
  const opened = new Set(hits.filter(h => h.kind === 'open').map(h => h.start));
  for (const m of text.matchAll(/\\[CVNPI]\[(?!\d+\])[^\]\n]*\]/g)) if (!opened.has(m.index!)) push('param', m);
  // the wide characters of a keyboard or a copy
  for (const m of text.matchAll(/[\uFF3C\uFF3B\uFF3D]/g)) push('wide', m, m[0] === '\uFF3C' ? '\\' : m[0] === '\uFF3B' ? '[' : ']');
  return hits;
}

const ruleCodeMalformed: QaRule = {
  id: 'code-malformed', cat: 'error', def: 'bad', fixable: true,
  title: 'Пошкоджений керівний код',
  explain: 'Керівний код гри (\\C[2], \\N[1]) написано з помилкою: кирилична літера замість латинської, зайвий пробіл, немає дужки чи не число. Гра покаже його текстом або зламає рядок.',
  run(c) {
    const src = new Set(codeHits(c.source).map(h => h.shown));
    const hits = codeHits(c.target).filter(h => !src.has(h.shown));
    if (!hits.length) return null;
    const fixable = hits.filter(h => h.fix !== undefined);
    return {
      message: `Пошкоджений керівний код: ${hits.slice(0, 3).map(h => h.shown).join(' ')}${hits.length > 3 ? '…' : ''}`,
      detail: 'Керівні коди пишуться латиницею, без пробілів, із числом у дужках.',
      ...(fixable.length === hits.length ? { fixed: applyEdits(c.target, fixable.map(h => ({ start: h.start, end: h.end, text: h.fix! }))) } : {}),
    };
  },
};

/* ---------- 2. Latin and Cyrillic letters that are mixed up ---------- */

const ruleHomoglyph: QaRule = {
  id: 'uk-homoglyph', cat: 'style', def: 'warn', fixable: true,
  title: 'Латинські літери в українському слові',
  explain: 'Латинська літера, схожа на кириличну (a, c, e, i, o, p, x), потрапила всередину українського слова, або навпаки. Текст виглядає правильно, але пошук, переноси й перевірка слів її не впізнають.',
  run(c) {
    const words = scriptWords(c.mt);
    const edits: { start: number; end: number; text: string }[] = [];
    const bad: string[] = [];
    let unfixable = 0;
    const note = (w: ScriptWord, fix?: string): void => { bad.push(w.text); if (fix !== undefined && fix !== w.text) edits.push({ start: w.start, end: w.end, text: fix }); else unfixable++; };
    const near = (i: number, dir: -1 | 1): ScriptWord | undefined => {
      const w = words[i + dir];
      if (!w) return undefined;
      // only spaces and ordinary punctuation may stand between the words
      const gap = dir < 0 ? c.mt.slice(w.end, words[i]!.start) : c.mt.slice(words[i]!.end, w.start);
      return gap.includes(BLANK) || gap.includes('\n') ? undefined : w;
    };
    words.forEach((w, i) => {
      if (c.srcWords().has(w.text)) return;
      if (w.script === 'mixed') {
        const toLat = convert(w.text, C2L);
        if (allMapped(w.text, CYR_LETTER, C2L) && isLatinOk(toLat, c)) note(w, toLat);
        else note(w, allMapped(w.text, LATIN_LETTER, L2C) ? convert(w.text, L2C) : undefined);
      } else if (w.script === 'cyr') {
        // НР for HP: capitals that are drawn like the Latin ones and make a word of the original (or an allowed one)
        if (w.text.length >= 2 && w.text === w.text.toUpperCase() && [...w.text].every(ch => C2L_STRONG[ch])) {
          const lat = convert(w.text, C2L_STRONG);
          if (c.srcWords().has(lat) || c.rules.keep.has(lat.toLowerCase())) { note(w, lat); return; }
          // ХІХ for XIX: a Roman number written with the Cyrillic Х and І
          if (/[\u0425]/.test(w.text) && ROMAN.test(lat)) note(w, lat);
        }
      } else if (w.script === 'lat' && w.cyr === 0 && w.lat === 1 && /^[aioyc]$/.test(w.text)) {
        // «Ти i я»: a single Latin letter that is a Ukrainian word, standing between two Ukrainian words
        const p = near(i, -1), n = near(i, 1);
        if (p?.script === 'cyr' && n?.script === 'cyr') note(w, convert(w.text, L2C_STRONG));
      }
    });
    if (!bad.length) return null;
    return {
      message: `Літери не з того алфавіту: ${bad.slice(0, 3).map(b => `«${b}»`).join(' ')}${bad.length > 3 ? '…' : ''}`,
      detail: 'Це латинські літери, схожі на українські (або навпаки). Виправлення замінює їх на літери того алфавіту, до якого належить слово.',
      ...(unfixable === 0 && edits.length ? { fixed: applyEdits(c.target, edits) } : {}),
    };
  },
};

/* ---------- 3. letters that Ukrainian does not have ---------- */

const UK_SET = /[А-ЩЬЮЯЄІЇҐа-щьюяєіїґ]/;
const ruleForeignLetters: QaRule = {
  id: 'uk-foreign-letters', cat: 'style', def: 'warn', fixable: false,
  title: 'Літери, яких немає в українській',
  explain: 'Літери ы, э, ъ, ё (та інша кирилиця поза українським алфавітом) потрапили в текст, найчастіше з російської. Українською: ы → и, э → е, ъ → ’, ё → е або йо.',
  run(c) {
    const inSource = new Set([...c.source].filter(ch => /[\u0400-\u04FF]/.test(ch)));
    const found = new Set<string>();
    for (const ch of c.target) if (/[\u0400-\u04FF]/.test(ch) && !UK_SET.test(ch) && !inSource.has(ch)) found.add(ch);
    return found.size ? { message: `Літери, яких немає в українській: ${[...found].slice(0, 4).join(' ')}`, detail: 'ы → и, э → е, ъ → ’, ё → е або йо. Якщо це ім’я чи навмисна репліка, проігноруйте.' } : null;
  },
};

/* ---------- 4. a letter written as two characters ---------- */

const ruleNormalization: QaRule = {
  id: 'uk-normalization', cat: 'style', def: 'warn', fixable: true,
  title: 'Літера з двох символів',
  explain: 'Літери й та ї записано розкладеними (и + знак, і + дві крапки). На екрані вони схожі на звичайні, але пошук і порівняння їх не впізнають.',
  run(c) {
    const n = c.target.normalize('NFC');
    if (n === c.target || c.source.normalize('NFC') !== c.source) return null;
    return { message: 'Літера записана розкладеною (й, ї)', detail: 'Виправлення складає такі літери в один символ.', fixed: n };
  },
};

/* ---------- 5. invisible characters ---------- */

const HIDDEN = /[\u200B\u200C\u200D\u2060\uFEFF\u00AD\u2028\u2029\u2002-\u200A\u3000\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const hex = (ch: string): string => 'U+' + ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0');
/** A joiner inside an emoji sequence (a family, a flag with a skin tone) is part of the picture, not a hidden sign. */
const emojiJoiner = (text: string, at: number): boolean => text[at] === '\u200D' && /\p{Extended_Pictographic}\uFE0F?$/u.test(text.slice(0, at)) && /^\p{Extended_Pictographic}/u.test(text.slice(at + 1));
/** The hidden signs of a text that the translator has not copied from the original, with their places. */
function hiddenIn(text: string, own: Set<string>): { ch: string; at: number }[] {
  const out: { ch: string; at: number }[] = [];
  for (const m of text.matchAll(HIDDEN)) if (!own.has(m[0]) && !emojiJoiner(text, m.index!)) out.push({ ch: m[0], at: m.index! });
  return out;
}
const ruleHidden: QaRule = {
  id: 'ws-hidden', cat: 'style', def: 'warn', fixable: true,
  title: 'Невидимі символи',
  explain: 'У тексті є символи, яких не видно: нульової ширини, м’який перенос, нестандартні пробіли. Вони ламають перенесення рядків і пошук, а в деяких шрифтах показуються квадратиками.',
  run(c) {
    const own = new Set(c.source.match(HIDDEN) ?? []);
    const found = hiddenIn(c.target, own);
    if (!found.length) return null;
    const edits = found.map(f => ({ start: f.at, end: f.at + 1, text: /[\u2002-\u200A\u3000]/.test(f.ch) ? ' ' : /[\u2028\u2029]/.test(f.ch) ? '\n' : '' }));
    return { message: `Невидимі символи: ${[...new Set(found.map(f => f.ch))].slice(0, 3).map(hex).join(' ')}`, detail: 'Виправлення прибирає їх (нестандартні пробіли стають звичайними).', fixed: applyEdits(c.target, edits) };
  },
};

/* ---------- 6. spaces at the edges ---------- */

const EDGE_LEAD = /^[ \t\n\u00A0]*/, EDGE_TAIL = /[ \t\n\u00A0]*$/;
const ruleEdges: QaRule = {
  id: 'ws-edges', cat: 'style', def: 'warn', fixable: true,
  title: 'Пробіли на краях',
  explain: 'На початку чи в кінці перекладу пробілів або переходів на новий рядок не стільки, скільки в оригіналі. Гра склеює повідомлення разом, тому зайвий або загублений пробіл видно на екрані.',
  run(c) {
    if (c.source.trim().length < 2 || !c.target.trim()) return null;
    const sl = EDGE_LEAD.exec(c.source)![0], st = EDGE_TAIL.exec(c.source)![0];
    const tl = EDGE_LEAD.exec(c.target)![0], tt = EDGE_TAIL.exec(c.target)![0];
    if (sl === tl && st === tt) return null;
    const core = c.target.slice(tl.length, c.target.length - tt.length);
    const what = sl !== tl ? 'на початку' : 'в кінці';
    return { message: `Пробіли ${what} не такі, як в оригіналі`, detail: 'Виправлення копіює пробіли й переходи на новий рядок з країв оригіналу.', fixed: sl + core + st };
  },
};

/* ---------- 7. two spaces in a row ---------- */

const ruleDouble: QaRule = {
  id: 'ws-double', cat: 'style', def: 'warn', fixable: true,
  title: 'Подвійні пробіли',
  explain: 'Між словами два й більше пробілів, а в оригіналі їх нема. Найчастіше це випадковий зайвий пробіл.',
  run(c) {
    const spots = /[^\s] {2,}[^\s]/;
    if (spots.test(c.source) || !spots.test(c.target)) return null;
    return { message: 'Подвійний пробіл між словами', detail: 'Виправлення лишає один пробіл.', fixed: c.target.replace(/(?<=[^\s]) {2,}(?=[^\s])/g, ' ') };
  },
};

/* ---------- 8. the apostrophe ---------- */

const CYR_LET = '[А-Яа-яЁёҐґЄєІіЇї]';
const WRONG_APOS = /(?<=[А-Яа-яЁёҐґЄєІіЇї])[`\u00B4‘′ʹˈ՚"”](?=[А-Яа-яЁёҐґЄєІіЇї])/g;
const GOOD_APOS = new RegExp(`(?<=${CYR_LET})['ʼ’](?=${CYR_LET})`, 'g');
const ruleApostrophe: QaRule = {
  id: 'uk-apostrophe', cat: 'style', def: 'warn', fixable: true,
  title: 'Апостроф',
  explain: 'Між двома українськими літерами стоїть не апостроф (наприклад, ` \u00B4 ‘ або лапка). Правильний апостроф: ’ (U+2019), ʼ (U+02BC) або \' з клавіатури; один знак на весь проєкт обирається в налаштуваннях правил.',
  run(c) {
    const want = c.rules.apostrophe === 'any' ? '’' : c.rules.apostrophe;
    const wrong = c.target.match(WRONG_APOS) ?? [];
    const differs = c.rules.apostrophe === 'any' ? [] : (c.target.match(GOOD_APOS) ?? []).filter(ch => ch !== want);
    if (!wrong.length && !differs.length) return null;
    const fixed = c.target.replace(WRONG_APOS, want).replace(GOOD_APOS, ch => (c.rules.apostrophe === 'any' ? ch : want));
    return {
      message: wrong.length ? `Неправильний апостроф: ${[...new Set(wrong)].join(' ')}` : `Апостроф не такий, як у проєкті: ${[...new Set(differs)].join(' ')}`,
      detail: `Виправлення ставить ${want}.`, fixed,
    };
  },
};

/** The rules in the order their remarks are made. */
export const QA_RULES: QaRule[] = [ruleCodeMalformed, ruleHomoglyph, ruleForeignLetters, ruleNormalization, ruleHidden, ruleEdges, ruleDouble, ruleApostrophe];

export const RULE_BY_ID: Record<string, QaRule> = Object.fromEntries(QA_RULES.map(r => [r.id, r]));

/** The remarks of the enabled rules for a translation, one per rule. */
export function runRules(source: string, target: string, rules: QaRules): Issue[] {
  let srcWords: Set<string> | null = null;
  const ms = maskCodes(source), mt = maskCodes(target);
  const ctx: RuleCtx = { source, target, ms, mt, rules, srcWords: () => (srcWords ??= new Set(scriptWords(ms).map(w => w.text))) };
  const out: Issue[] = [];
  for (const r of QA_RULES) {
    const sev = rules.sev[r.id] ?? r.def;
    if (sev === 'off') continue;
    const hit = r.run(ctx);
    if (!hit) continue;
    out.push({
      key: r.id, severity: sev === 'bad' ? 'bad' : 'warn', cat: sev === 'bad' ? 'error' : r.cat, message: hit.message,
      detail: hit.detail ?? r.explain,
      ...(hit.fixed !== undefined && hit.fixed !== target ? { fix: { label: 'Виправити', text: hit.fixed } } : {}),
    });
  }
  return out;
}
