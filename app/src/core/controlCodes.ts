/** RPG Maker escape codes: \C[2], \V[1], \N[3], \I[5], \{ \} \. \| \! \> \< \^ \$ \\ */
const CODE = /\\[A-Za-z]+\[\d+\]|\\[{}.|!><^$]|\\\\/g;

export const codesOf = (text: string): string[] => text.match(CODE) ?? [];

/** Text length as the player sees it: code points without escape codes and line breaks. */
export const displayLength = (text: string): number => [...text.replace(CODE, '').replace(/\n/g, '')].length;

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
