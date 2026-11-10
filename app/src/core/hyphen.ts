/**
 * Ukrainian word hyphenation for line breaking («перенос по складах»), by rules, with no data tables.
 *
 * `hyphenPoints` gives every place where a word may be broken with a hyphen at the end of the line. It follows the
 * rules of the Ukrainian orthography that matter for breaking a line: a break goes after a vowel before a single
 * consonant and before the last consonant of a cluster, but a sonorant or `ь` stays with the syllable before it; `й`
 * stays with the vowel before it, the apostrophe and `ь` are never taken off the letter they follow, `дж` and `дз`
 * are never torn apart, doubled consonants may be split, and the short prefixes (роз-, без-, під-, …) break at their
 * edge. Never fewer than two letters stay on either side. A break lost is harmless (the word goes to the next line),
 * a wrong one is ugly, so anything that is not a plain Ukrainian word (digits, Latin letters, control codes) is left alone.
 *
 * Measured against the TeX patterns hyph-uk (MIT/LPPL, M. Polyakov) on 77 thousand words: 97% of the breaks found here
 * are allowed there, and 98% of the breaks of the patterns are found.
 */

const VOWELS = 'аеєиіїоуюя';
const SONORANT = 'вмнлр';
const VOICED = 'бгґджз';
const VOICELESS = 'кптфхцчшщс';
const APOSTROPHES = /['’ʼ`]/;
/** Prefixes that break at their edge before a consonant: роз-мова, під-земний (but ро-зум). */
const PREFIXES = ['роз', 'без', 'від', 'під', 'над', 'пред', 'між', 'через', 'перед', 'понад', 'попід'];

/** A word made only of Ukrainian letters (and apostrophes), with at least one vowel: the only kind that is broken by syllables. */
export const isHyphenatable = (word: string): boolean => /^[Ѐ-ӿ'’ʼ`]+$/.test(word) && !/[ыэъёЫЭЪЁ]/.test(word) && [...word.toLowerCase()].some(c => VOWELS.includes(c));

const voicing = (c: string): 'v' | 'u' | 's' => (VOICED.includes(c) ? 'v' : VOICELESS.includes(c) ? 'u' : 's');

/**
 * The positions (between UTF-16 units of `word`) where a hyphen may be put, smallest first. `minLeft` and `minRight` are
 * the fewest letters that must stay before and after the break.
 */
export function hyphenPoints(word: string, minLeft = 2, minRight = 2): number[] {
  if (!isHyphenatable(word)) return [];
  const w = word.toLowerCase(), n = w.length;
  const at = (i: number): string => w[i] ?? '';
  const isV = (i: number): boolean => i >= 0 && i < n && VOWELS.includes(at(i));
  const isApos = (i: number): boolean => i >= 0 && i < n && APOSTROPHES.test(at(i));
  const vowels: number[] = [];
  for (let i = 0; i < n; i++) if (isV(i)) vowels.push(i);
  const prefix = PREFIXES.find(p => w.startsWith(p) && n > p.length + 2 && !isV(p.length) && at(p.length) !== 'ь' && !isApos(p.length));
  const out = new Set<number>();
  for (let k = 0; k + 1 < vowels.length; k++) {
    const a = vowels[k]!, b = vowels[k + 1]!;
    // A prefix breaks at its own edge.
    if (prefix && a < prefix.length && b >= prefix.length) { out.add(prefix.length); continue; }
    let s = a + 1;
    // «й» stays with the vowel before it, except before «о» (ма-йор).
    if (at(s) === 'й' && !(s + 1 === b && at(b) === 'о')) s++;
    // The consonants between the two vowels, as units: a letter with the «ь» or apostrophe after it, «дж» and «дз» as one.
    const units: [number, number][] = [];
    for (let j = s; j < b;) {
      const start = j;
      j += at(j) === 'д' && (at(j + 1) === 'ж' || at(j + 1) === 'з') && j + 1 < b ? 2 : 1;
      while (j < b && (at(j) === 'ь' || isApos(j))) j++;
      units.push([start, j]);
    }
    const last = (u: [number, number]): string => at(u[1] - 1);
    const first = (u: [number, number]): string => at(u[0]);
    if (!units.length) {
      // Two vowels in a row break between them (кра-ї-на), except «іо»/«ео» after a consonant (біо-, ра-діо).
      if (!(s === a + 1 && 'іе'.includes(at(a)) && at(b) === 'о' && a > 0 && !isV(a - 1))) out.add(s);
      continue;
    }
    if (units.length === 1) { out.add(isApos(units[0]![1] - 1) ? units[0]![1] : units[0]![0]); continue; }
    const c1 = units[0]!, c2 = units[1]!;
    if (isApos(c1[1] - 1)) out.add(c1[1]);
    else if (first(c1) === first(c2) && c1[1] - c1[0] === 1) { out.add(c1[0]); out.add(c1[1]); }
    else if (last(c1) === 'ь' && 'сзц'.includes(first(c1)) && first(c2) === 'к') out.add(c1[0]);
    else if (first(c1) === 'т' && last(c1) === 'ь' && first(c2) === 'с' && c2[1] === n - 1 && w.endsWith('ся')) out.add(c1[0]);
    else if (last(c1) === 'ь' || SONORANT.includes(first(c1))) out.add(c1[1]);
    else {
      const d1 = voicing(first(c1)), d2 = voicing(first(c2));
      out.add(d1 !== 's' && d2 !== 's' && d1 !== d2 ? c1[1] : c1[0]);
    }
  }
  // A break may not leave the apostrophe or «ь» at the start of the next line.
  return [...out].filter(j => j >= minLeft && n - j >= minRight && !isApos(j) && at(j) !== 'ь').sort((x, y) => x - y);
}

/** The syllables of a word as written in the text (the break points of `hyphenPoints` cut the word into them). */
export function syllables(word: string, minLeft = 1, minRight = 1): string[] {
  const out: string[] = [];
  let from = 0;
  for (const p of hyphenPoints(word, minLeft, minRight)) { out.push(word.slice(from, p)); from = p; }
  out.push(word.slice(from));
  return out;
}
