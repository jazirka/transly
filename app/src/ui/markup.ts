import { prepareText, termRangesIn } from '../core';
import { esc } from './dom';

const CODE = /\\[A-Za-z]+\[\d+\]|\\[{}.|!><^$]/g;

/** Escape text and mark control codes. Optionally mark glossary terms (any plural/verb/British-American form). */
export function markup(text: string, termsEn: string[] = []): string {
  const marks: { start: number; end: number; cls: 'code' | 'term-hit' }[] = [];
  for (const m of text.matchAll(CODE)) marks.push({ start: m.index!, end: m.index! + m[0].length, cls: 'code' });
  if (termsEn.length) {
    const prep = prepareText(text);
    for (const t of termsEn) for (const [start, end] of termRangesIn(prep, t)) if (!marks.some(x => start < x.end && end > x.start)) marks.push({ start, end, cls: 'term-hit' });
  }
  marks.sort((a, b) => a.start - b.start);
  let out = '', at = 0;
  for (const m of marks) {
    if (m.start < at) continue;
    out += esc(text.slice(at, m.start)) + `<span class="${m.cls}"${m.cls === 'term-hit' ? ' title="Термін глосарію"' : ''}>${esc(text.slice(m.start, m.end))}</span>`;
    at = m.end;
  }
  return out + esc(text.slice(at));
}

/** A glossary term found in an original: where, which term, and whether the translation has its rendering. */
export interface TermMark { start: number; end: number; en: string; missing: boolean }

/**
 * The original with control codes marked and every glossary term as an interactive word: it can be pointed at or chosen
 * with the keyboard to open the term's card, and it is underlined differently when the translation lacks the term.
 */
export function markupTerms(text: string, hits: TermMark[]): string {
  const marks: { start: number; end: number; cls: string; hit?: TermMark }[] = hits.map(h => ({ start: h.start, end: h.end, cls: `term-hit th${h.missing ? ' miss' : ''}`, hit: h }));
  for (const m of text.matchAll(CODE)) if (!marks.some(x => m.index! < x.end && m.index! + m[0].length > x.start)) marks.push({ start: m.index!, end: m.index! + m[0].length, cls: 'code' });
  marks.sort((a, b) => a.start - b.start);
  let out = '', at = 0;
  for (const m of marks) {
    if (m.start < at) continue;
    const attrs = m.hit ? ` data-term="${esc(m.hit.en)}" tabindex="0" role="button" title="${m.hit.missing ? 'Термін глосарію: у перекладі його немає' : 'Термін глосарію'}"` : '';
    out += esc(text.slice(at, m.start)) + `<span class="${m.cls}"${attrs}>${esc(text.slice(m.start, m.end))}</span>`;
    at = m.end;
  }
  return out + esc(text.slice(at));
}
