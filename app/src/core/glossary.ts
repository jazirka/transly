import type { Term } from './qa';

/** A glossary entry. Imported dictionaries set `qa: false`: they help the translator but never raise QA warnings. */
export interface GlossaryTerm extends Term {
  mt: number;
  /** Other acceptable translations. */
  alt?: string[];
  note?: string;
  kind?: string;
  /** false = hint only, no QA check. Missing means true. */
  qa?: boolean;
}

/**
 * Words are compared by a key that depends on the language of the word itself, told apart by script: Cyrillic is
 * Ukrainian (a stem that survives case endings), anything else is English (a form that survives plurals,
 * -ing/-ed and British/American spelling). Keys only have to agree with each other, not be real words.
 */
const CYRILLIC = /[Ѐ-ӿ]/;
const APOSTROPHES = /['’ʼ`]/g;

/* ---------- English ---------- */

const EN_IRREGULAR: Record<string, string> = { knives: 'knife', wolves: 'wolf', leaves: 'leaf', lives: 'life', halves: 'half', thieves: 'thief', shelves: 'shelf', men: 'man', women: 'woman', children: 'child', feet: 'foot', teeth: 'tooth', mice: 'mouse', geese: 'goose', oxen: 'ox', people: 'person', dice: 'die', staves: 'staff' };

/** British spellings written as American, whole words (inflected forms are handled by the rules below). */
const EN_SPELLING: Record<string, string> = { centre: 'center', theatre: 'theater', metre: 'meter', litre: 'liter', fibre: 'fiber', calibre: 'caliber', sabre: 'saber', sombre: 'somber', lustre: 'luster', spectre: 'specter', grey: 'gray', mould: 'mold', plough: 'plow', cheque: 'check', tyre: 'tire', sceptic: 'skeptic', artefact: 'artifact', catalogue: 'catalog', dialogue: 'dialog', analogue: 'analog', aluminium: 'aluminum', jewellery: 'jewelry', moustache: 'mustache', speciality: 'specialty', ageing: 'aging', towards: 'toward', learnt: 'learned', burnt: 'burned', spelt: 'spelled', dreamt: 'dreamed', judgement: 'judgment', manoeuvre: 'maneuver', sulphur: 'sulfur', cosy: 'cozy', draught: 'draft', kerb: 'curb', storey: 'story', pyjamas: 'pajamas', mum: 'mom', whilst: 'while', amongst: 'among', gaol: 'jail', paralyse: 'paralyze', cancelled: 'canceled', cancelling: 'canceling' };

/** -our words (armour, colour, honour…): not "hour", "four", "pour". */
const EN_OUR = /^(arm|col|hon|fav|flav|lab|neighb|rum|sav|vap|harb|hum|behavi|endeav|glam|od|rig|vig|val|splend|ferv|clam|cand|parl|savi|demean)our/;

function enSpelling(w: string): string {
  const known = EN_SPELLING[w];
  if (known) return known;
  let r = w.replace(EN_OUR, '$1or');
  r = r.replace(/^(defen|offen|licen|preten)ce/, '$1se');                 // defence → defense
  r = r.replace(/([a-z]{2,})is(e|ed|es|ing|ation|ations|er|ers)$/, '$1iz$2'); // organise → organize
  r = r.replace(/([a-z]{2,})ys(e|ed|es|ing)$/, '$1yz$2');                // analyse → analyze
  r = r.replace(/([aeiou])ll(ed|ing|er|ers)$/, '$1l$2');                  // travelled → traveled
  return r;
}

/** Keys of one English word: the form with plural/verb endings removed. Terms use the first one, text all of them. */
function enKeys(raw: string): string[] {
  let w = raw.toLowerCase().replace(APOSTROPHES, "'").replace(/'s?$/, '');
  if (EN_IRREGULAR[w]) w = EN_IRREGULAR[w]!;
  w = enSpelling(w);
  if (/^\d+$/.test(w)) return [w];
  if (w.length > 4 && w.endsWith('ies')) return [w.slice(0, -3) + 'y'];
  if (/(ss|us|is|sh|ch|x|z)es$/.test(w) && w.length > 4) return [w.slice(0, -2)];
  if (w.length > 3 && w.endsWith('s') && !/(ss|us|is)$/.test(w)) return [w.slice(0, -1)];
  const out = [w];
  const derived = (stem: string) => {
    if (stem.length < 3) return;
    out.push(stem, stem + 'e');
    if (/([^aeioulsfz])\1$/.test(stem)) out.push(stem.slice(0, -1)); // running → runn → run
  };
  if (w.length > 5 && w.endsWith('ing')) derived(w.slice(0, -3));
  else if (w.length > 4 && w.endsWith('ed')) derived(w.slice(0, -2));
  return out;
}

/* ---------- Ukrainian ---------- */

/** Case, number and verb endings, longest first. */
const UK_ENDINGS = ['ськими', 'ськими', 'ського', 'ськими', 'ами', 'ями', 'ові', 'еві', 'єві', 'ого', 'ому', 'ими', 'іми', 'ою', 'ею', 'єю', 'ої', 'ую', 'юю', 'ий', 'ій', 'їй', 'ів', 'їв', 'ам', 'ям', 'ах', 'ях', 'ом', 'ем', 'єм', 'ей', 'ать', 'ять', 'ють', 'уть', 'ати', 'яти', 'ити', 'ути', 'ає', 'яє', 'ює', 'ає', 'ав', 'ив', 'ла', 'ли', 'ло', 'а', 'я', 'у', 'ю', 'і', 'ї', 'и', 'е', 'є', 'о', 'ь', 'й'].sort((a, b) => b.length - a.length);

/**
 * Stem of a Ukrainian word that survives declension: the ending is cut, then alternations are flattened
 * (г/з/ж, к/ц/ч, х/с/ш at the end; і/о inside) so "нога/нозі", "рука/руці", "кінь/коня" agree.
 */
function ukKey(raw: string): string {
  let w = raw.toLowerCase().replace(APOSTROPHES, '');
  if (w.length >= 4) for (const e of UK_ENDINGS) if (w.endsWith(e) && w.length - e.length >= 3) { w = w.slice(0, -e.length); break; }
  // genitive plural with a fleeting vowel: навичок → навичк, кінець → кінц
  if (w.length >= 5) w = w.replace(/([бвгґджзклмнпрстфхцчшщ])[оеє](к|ц)$/, '$1$2');
  w = w.replace(/і/g, 'о').replace(/[гзж]$/, 'г').replace(/[кцч]$/, 'к').replace(/[хсш]$/, 'х');
  return w;
}

/* ---------- tokens ---------- */

interface Token { start: number; end: number; keys: string[] }

const WORD = /[\p{L}\p{N}]+(?:['’ʼ`][\p{L}]+)*/gu;

/** A word of a text with its place and the keys it is compared by (see `tokens`). */
export type WordToken = Token;
export const wordTokens = (text: string): WordToken[] => tokens(text);
/** Do two keys of Ukrainian words belong to one word? One has to be the beginning of the other, and a very short key must match fully. */
export const ukStemsAgree = (hay: string, need: string): boolean => hay === need || prefixAgrees(hay, need) || prefixAgrees(need, hay);
/** `long` starts with `short`: for a short key (the key of «бог» is «бог») only one more letter is the same word, not «богдан». */
const prefixAgrees = (long: string, short: string): boolean => short.length >= 3 && long.startsWith(short) && (short.length >= 5 || long.length - short.length <= 1);

function tokens(text: string): Token[] {
  const out: Token[] = [];
  for (const m of text.matchAll(WORD)) {
    const word = m[0];
    out.push({ start: m.index!, end: m.index! + word.length, keys: CYRILLIC.test(word) ? [ukKey(word)] : enKeys(word) });
  }
  return out;
}

/** A source text split into words once, so many terms can be tried against it cheaply. */
export interface PreparedText { text: string; tokens: Token[] }
/** Control codes (`\\N[1]`, `\\C[2]`) are not words: they are blanked out before the text is split. */
const CODES = /\\[A-Za-z]+\[\d+\]|\\[{}.|!><^$]/g;
export const prepareText = (text: string): PreparedText => { const blank = text.replace(CODES, m => ' '.repeat(m.length)); return { text: blank, tokens: tokens(blank) }; };

const termKeyCache = new Map<string, string[]>();
function termKeys(en: string): string[] {
  let k = termKeyCache.get(en);
  if (!k) {
    k = tokens(en).map(t => t.keys[0]!);
    if (termKeyCache.size > 20000) termKeyCache.clear();
    termKeyCache.set(en, k);
  }
  return k;
}

/** Where the term occurs in the prepared text: a run of words (separated by spaces or hyphens) whose keys agree. */
export function termRangesIn(p: PreparedText, en: string): [number, number][] {
  const need = termKeys(en.trim());
  const out: [number, number][] = [];
  if (!need.length) return out;
  const t = p.tokens;
  for (let i = 0; i + need.length <= t.length; i++) {
    let ok = true;
    for (let j = 0; j < need.length && ok; j++) {
      ok = t[i + j]!.keys.includes(need[j]!) && (j === 0 || /^[\s\-–—]+$/.test(p.text.slice(t[i + j - 1]!.end, t[i + j]!.start)));
    }
    if (ok) out.push([t[i]!.start, t[i + need.length - 1]!.end]);
  }
  return out;
}

export const hasTermIn = (p: PreparedText, en: string): boolean => termRangesIn(p, en).length > 0;

/** Does `text` contain the English term, in any plural, verb or British/American form? Whole words only. */
export function hasTerm(text: string, en: string): boolean {
  return hasTermIn(prepareText(text), en);
}

/** Character ranges of the term in `text` (for highlighting). */
export function termRanges(text: string, en: string): [number, number][] {
  return termRangesIn(prepareText(text), en);
}

/** Terms by the key of their first word, so a line is only tried against terms that could possibly start in it. */
const indexCache = new WeakMap<object, { n: number; rev: number; map: Map<string, Term[]> }>();

const termRevs = new WeakMap<object, number>();
const termIds = new WeakMap<object, number>();
let nextTermsId = 1;
/**
 * Call after a term list was changed in place. A term that is replaced (not added) leaves the length as it was, so the
 * caches built from the list (the word index, QA results) could not tell by themselves.
 */
export const touchTerms = (terms: object): void => { termRevs.set(terms, (termRevs.get(terms) ?? 0) + 1); };
/** Identity and state of a term list as one short text: equal while the list is the same and unchanged. */
export function termsStamp(terms: object & { length: number }): string {
  let id = termIds.get(terms);
  if (!id) termIds.set(terms, id = nextTermsId++);
  return `${id}.${termRevs.get(terms) ?? 0}.${terms.length}`;
}

function termIndex(terms: Term[]): Map<string, Term[]> {
  const hit = indexCache.get(terms);
  if (hit && hit.n === terms.length && hit.rev === (termRevs.get(terms) ?? 0)) return hit.map;
  const map = new Map<string, Term[]>();
  for (const t of terms) {
    const first = termKeys(t.en.trim())[0];
    if (first === undefined) continue;
    const a = map.get(first);
    if (a) a.push(t); else map.set(first, [t]);
  }
  indexCache.set(terms, { n: terms.length, rev: termRevs.get(terms) ?? 0, map });
  return map;
}

/** The terms that could occur in the prepared text (cheap pre-filter; confirm with `hasTermIn`). */
export function candidateTerms<T extends Term>(p: PreparedText, terms: T[]): T[] {
  const map = termIndex(terms);
  const seen = new Set<Term>();
  for (const tok of p.tokens) for (const k of tok.keys) for (const t of map.get(k) ?? []) seen.add(t);
  return terms.filter(t => seen.has(t));
}

/** Terms whose English form occurs in the source text. */
export function termsIn<T extends Term>(source: string, terms: T[]): T[] {
  const p = prepareText(source);
  return candidateTerms(p, terms).filter(t => hasTermIn(p, t.en));
}

/**
 * Does `target` contain the Ukrainian term (or one of its alternatives)? Every word is compared by its stem, so any
 * case, number or ending does.
 */
export function targetHasTerm(target: string, uk: string, alt: string[] = []): boolean {
  const hay = tokens(target).map(t => t.keys[0]!);
  const has = (phrase: string) => {
    const need = tokens(phrase).map(t => t.keys[0]!);
    return need.length > 0 && need.every(n => hay.some(h => h === n || prefixAgrees(h, n) || prefixAgrees(n, h)));
  };
  return [uk, ...alt].some(has);
}

/** Parse "english<TAB>українською" lines (also accepts ;). Returns valid pairs and the count of rejected lines. */
export function parseTerms(text: string): { terms: Term[]; rejected: number } {
  const terms: Term[] = [];
  let rejected = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parts = line.includes('\t') ? line.split('\t') : line.split(';');
    const en = parts[0]?.trim(), uk = parts[1]?.trim();
    if (en && uk) terms.push({ en, uk }); else rejected++;
  }
  return { terms, rejected };
}
