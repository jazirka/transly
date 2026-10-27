import { displayLength, missingCodes } from './controlCodes';
import { hasTerm, targetHasTerm } from './glossary';
import type { Unit } from './model';

export type Severity = 'bad' | 'warn';
export interface Issue { key: 'codes' | 'len' | 'term' | 'empty-src-changed'; severity: Severity; message: string }
export interface Term { en: string; uk: string; alt?: string[]; /** false = hint only */ qa?: boolean }
export interface QaOptions { tolerancePct: number; terms: Term[] }

export const DEFAULT_QA: QaOptions = { tolerancePct: 25, terms: [] };

/** Deviation of the translation length from the source, in percent (rounded). */
export function lengthDeviation(source: string, target: string): number {
  const s = displayLength(source);
  if (!s) return 0;
  return Math.round(((displayLength(target) - s) / s) * 100);
}

export function check(unit: Pick<Unit, 'source'>, target: string, opts: QaOptions = DEFAULT_QA): Issue[] {
  if (!target.trim()) return [];
  const out: Issue[] = [];
  const miss = missingCodes(unit.source, target);
  if (miss.length) out.push({ key: 'codes', severity: 'bad', message: `Пропущено керівні коди: ${miss.join(' ')}` });
  const dev = lengthDeviation(unit.source, target);
  if (Math.abs(dev) > opts.tolerancePct) {
    out.push({ key: 'len', severity: 'warn', message: `Довжина відрізняється від оригіналу на ${dev > 0 ? '+' : ''}${dev}%. Рекомендація: якнайближче до оригіналу` });
  }
  for (const t of opts.terms) {
    if (t.qa === false) continue;
    if (hasTerm(unit.source, t.en) && !targetHasTerm(target, t.uk, t.alt)) {
      out.push({ key: 'term', severity: 'warn', message: `Термін «${t.en}» має бути «${[t.uk, ...(t.alt ?? [])].join('» або «')}» за глосарієм` });
    }
  }
  return out;
}
