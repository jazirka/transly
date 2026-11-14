/** RPG Maker escape codes: \C[2], \V[1], \N[3], \I[5], \{ \} \. \| \! \> \< \^ \$ \\ */
const CODE = /\\[A-Za-z]+\[\d+\]|\\[{}.|!><^$]|\\\\/g;
/** The pattern of one control code, for building other patterns from it. */
export const CODE_SOURCE = CODE.source;

export const codesOf = (text: string): string[] => text.match(CODE) ?? [];

/** Text length as the player sees it: code points without escape codes and line breaks. */
const WIDTH_CODE = new RegExp(`${CODE.source}|\\\\G`, 'g');
/** What a code takes on screen: an escaped backslash is one character, the currency name `\G` about three, every other code nothing. */
const codeWidth = (code: string): string => (code === '\\\\' ? '\\' : code === '\\G' ? '000' : '');

/** The text as it takes room on the screen: control codes gone (`\G` stands for a few characters), line breaks gone. Measure this, not the raw text. */
export const visibleText = (text: string): string => text.replace(WIDTH_CODE, codeWidth).replace(/\n/g, '');

export const displayLength = (text: string): number => [...visibleText(text)].length;

/** Codes in `source` that are missing in `target` (multiset difference). */
export function missingCodes(source: string, target: string): string[] {
  const left = new Map<string, number>();
  for (const c of codesOf(target)) left.set(c, (left.get(c) ?? 0) + 1);
  const out: string[] = [];
  for (const c of codesOf(source)) {
    const n = left.get(c) ?? 0;
    if (n > 0) left.set(c, n - 1);
    else out.push(c);
  }
  return out;
}

/**
 * The translation with the missing codes put back where the original has them: a code at the start of the original goes to the start,
 * one at the end goes to the end, one in the middle goes to the same share of the text (at the nearest space).
 */
export function withCodes(source: string, target: string, miss: string[]): string {
  const plain = (t: string): number => [...t.replace(new RegExp(CODE_SOURCE, 'g'), '')].length;
  // where each code goes, in the translation as it is (so that the places do not shift each other)
  const places = miss.map((code, idx) => {
    const at = source.indexOf(code);
    if (at < 0) return { code, idx, pos: target.length };
    const before = source.slice(0, at), after = source.slice(at + code.length);
    if (!before.trim() || plain(before) === 0) return { code, idx, pos: 0 };
    if (!after.trim() || plain(after) === 0) return { code, idx, pos: target.length };
    let pos = Math.round(target.length * (plain(before) / (plain(before) + plain(after))));
    // the nearest space, so that a word is not cut; the code stands before the word it belongs to: after the space
    let l = pos, r = pos;
    while (l > 0 && target[l - 1] !== ' ') l--;
    while (r < target.length && target[r] !== ' ') r++;
    pos = pos - l <= r - pos ? l : r;
    if (target[pos] === ' ') pos++;
    return { code, idx, pos };
  });
  // from the back, and the codes of one place from the last to the first: they come out in the order of the list
  places.sort((a, b) => b.pos - a.pos || b.idx - a.idx);
  let out = target;
  for (const p of places) out = out.slice(0, p.pos) + p.code + out.slice(p.pos);
  return out;
}
