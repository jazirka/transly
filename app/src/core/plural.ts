/** "1 рядок", "3 рядки", "5 рядків": the number with the Ukrainian plural form (one, few, many). */
export function plural(n: number, forms: [string, string, string]): string {
  const m10 = n % 10, m100 = n % 100;
  const f = m10 === 1 && m100 !== 11 ? forms[0] : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? forms[1] : forms[2];
  return `${n} ${f}`;
}

/** Rows: the word most often counted in messages. */
export const rows = (n: number): string => plural(n, ['рядок', 'рядки', 'рядків']);
