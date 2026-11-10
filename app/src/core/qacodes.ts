/**
 * Helpers the QA rules share. A control code of the game (`\C[2]`, `\N[1]`, `\{`) holds Latin letters and digits, so a rule
 * that looks at letters has to blank the codes out first; the blanking keeps every position, so a place found in the
 * blanked text is the same place in the real one.
 */
export const BLANK = '';

/** A valid control code: a name with an optional bracket, or one of the single-sign codes (and the escaped backslash). */
const CODE = /\\[A-Za-z]+(?:\[[^\]\n]*\])?|\\[{}.|!><^$\\]/g;

/** The text with every control code turned into `BLANK`s of the same length. */
export const maskCodes = (text: string): string => text.replace(CODE, m => BLANK.repeat(m.length));

export type Script = 'cyr' | 'lat' | 'mixed' | 'other' | 'none';

export interface ScriptWord { text: string; start: number; end: number; script: Script; cyr: number; lat: number }

/** Letters, marks and digits joined by an apostrophe form a word; a hyphen, a dot or a slash ends it (HP-бар is two words). */
const WORD = /[\p{L}\p{M}\p{Nd}]+(?:['’ʼ`´‘][\p{L}\p{M}\p{Nd}]+)*/gu;
const CYR = /\p{Script=Cyrillic}/u, LAT = /\p{Script=Latin}/u, LETTER = /\p{L}/u;

/** The words of a (masked) text with the script of their letters; digits and marks do not count as a script. */
export function scriptWords(masked: string): ScriptWord[] {
  const out: ScriptWord[] = [];
  for (const m of masked.matchAll(WORD)) {
    let cyr = 0, lat = 0, other = 0;
    for (const c of m[0]) {
      if (!LETTER.test(c)) continue;
      if (CYR.test(c)) cyr++; else if (LAT.test(c)) lat++; else other++;
    }
    const script: Script = other ? 'other' : cyr && lat ? 'mixed' : cyr ? 'cyr' : lat ? 'lat' : 'none';
    out.push({ text: m[0], start: m.index!, end: m.index! + m[0].length, script, cyr, lat });
  }
  return out;
}

/** The text with the given places replaced; `edits` must not overlap. */
export function applyEdits(text: string, edits: { start: number; end: number; text: string }[]): string {
  let out = text;
  for (const e of [...edits].sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}
