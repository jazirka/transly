/** RPG Maker escape codes: \C[2], \V[1], \N[3], \I[5], \{ \} \. \| \! \> \< \^ \$ \\ */
const CODE = /\\[A-Za-z]+\[\d+\]|\\[{}.|!><^$]|\\\\/g;
/** The pattern of one control code, for building other patterns from it. */
export const CODE_SOURCE = CODE.source;

export const codesOf = (text: string): string[] => text.match(CODE) ?? [];

/** Text length as the player sees it: code points without escape codes and line breaks. */
const WIDTH_CODE = new RegExp(`${CODE.source}|\\\\G`, 'g');
/** What a code takes on screen: an escaped backslash is one character, the currency name `\G` about three, every other code nothing. */
const codeWidth = (code: string): string => (code === '\\\\' ? '\\' : code === '\\G' ? '000' : '');

export const displayLength = (text: string): number => [...text.replace(WIDTH_CODE, codeWidth).replace(/\n/g, '')].length;

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
