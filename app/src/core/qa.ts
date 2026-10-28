import { displayLength, missingCodes } from './controlCodes';
import { candidateTerms, hasTermIn, prepareText, targetHasTerm } from './glossary';
import { limitFor, maxLineWidth } from './wrap';
import type { Unit } from './model';

export type Severity = 'bad' | 'warn';
export interface Issue { key: 'codes' | 'len' | 'term' | 'wrap' | 'empty-src-changed'; severity: Severity; message: string; /** Control codes missing from the translation (key `codes`). */ codes?: string[] }
export interface Term { en: string; uk: string; alt?: string[]; /** false = hint only */ qa?: boolean }
export interface QaOptions { tolerancePct: number; terms: Term[]; /** Longest allowed line of a message; 0 or missing = not checked. */ lineLimit?: number }

export const DEFAULT_QA: QaOptions = { tolerancePct: 25, terms: [] };

/** Deviation of the translation length from the source, in percent (rounded). */
export function lengthDeviation(source: string, target: string): number {
  const s = displayLength(source);
  if (!s) return 0;
  return Math.round(((displayLength(target) - s) / s) * 100);
}

export function check(unit: Pick<Unit, 'source'> & Partial<Pick<Unit, 'kind' | 'face'>>, target: string, opts: QaOptions = DEFAULT_QA): Issue[] {
  if (!target.trim()) return [];
  const out: Issue[] = [];
  const miss = missingCodes(unit.source, target);
  if (miss.length) out.push({ key: 'codes', severity: 'bad', message: `Пропущено керівні коди: ${miss.join(' ')}`, codes: miss });
  const dev = lengthDeviation(unit.source, target);
  if (Math.abs(dev) > opts.tolerancePct) {
    out.push({ key: 'len', severity: 'warn', message: `Довжина відрізняється від оригіналу на ${dev > 0 ? '+' : ''}${dev}%. Рекомендація: якнайближче до оригіналу` });
  }
  if (opts.lineLimit && (unit.kind === 'dialogue' || unit.kind === 'scroll')) {
    const limit = limitFor(opts.lineLimit, unit.face), w = maxLineWidth(target);
    if (w > limit) out.push({ key: 'wrap', severity: 'warn', message: `Рядок задовгий для вікна: ${w} символів, зазвичай до ${limit}. Натисніть «Перенести рядки»` });
  }
  const sourceText = prepareText(unit.source);
  for (const t of candidateTerms(sourceText, opts.terms)) {
    if (t.qa === false) continue;
    if (hasTermIn(sourceText, t.en) && !targetHasTerm(target, t.uk, t.alt)) {
      out.push({ key: 'term', severity: 'warn', message: `Термін «${t.en}» має бути «${[t.uk, ...(t.alt ?? [])].join('» або «')}» за глосарієм` });
    }
  }
  return out;
}

/** Issues the translator has not ignored. */
export function activeIssues(unit: Pick<Unit, 'source'> & Partial<Pick<Unit, 'kind' | 'face'>>, entry: { target: string; ign?: string[] } | undefined, opts: QaOptions = DEFAULT_QA): Issue[] {
  if (!entry?.target) return [];
  const ign = entry.ign ?? [];
  return check(unit, entry.target, opts).filter(i => !ign.includes(i.key));
}
