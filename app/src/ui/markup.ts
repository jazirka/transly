import { prepareText, termRangesIn } from '../core';
import { esc } from './dom';

const CODE = /\\[A-Za-z]+\[\d+\]|\\[{}.|!><^$]/g;

/** Characters that take no room but change how a text reads or is laid out (zero-width, direction marks and overrides): shown as marks, so they can be seen. */
const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;
const showInvisible = (escaped: string): string => escaped.replace(INVISIBLE, c => { const hex = c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0'); return `<span class="inv" title="Невидимий символ U+${hex}">‹${hex}›</span>`; });

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
    out += showInvisible(esc(text.slice(at, m.start))) + `<span class="${m.cls}"${m.cls === 'term-hit' ? ' title="Термін глосарію"' : ''}>${esc(text.slice(m.start, m.end))}</span>`;
    at = m.end;
  }
  return out + showInvisible(esc(text.slice(at)));
}

/** A word of an original that has a card: a glossary term, or a name the game itself defines (`key` is then the name's place in the list the panel keeps). */
export interface TermMark { start: number; end: number; en: string; missing: boolean; kind?: 'term' | 'name'; key?: string }

/** Control codes of RPG Maker texts, as they stand in a text. */
export const CODE_RE = CODE;

/**
 * The original with every control code, glossary term and game name as an interactive word: it can be pointed at or
 * chosen with the keyboard to open its card (`data-hc` says which kind, `data-hk` which one). A term the translation
 * lacks is underlined differently.
 */
export function markupTerms(text: string, hits: TermMark[]): string {
  const marks: { start: number; end: number; cls: string; attrs: string }[] = hits.map(h => h.kind === 'name'
    ? { start: h.start, end: h.end, cls: 'name-hit nh', attrs: ` data-hc="name" data-hk="${esc(h.key ?? '')}" tabindex="0" role="button" title="Назва, яку визначає сама гра"` }
    : { start: h.start, end: h.end, cls: `term-hit th${h.missing ? ' miss' : ''}`, attrs: ` data-term="${esc(h.en)}" data-hc="term" data-hk="${esc(h.en)}" tabindex="0" role="button" title="${h.missing ? 'Термін глосарію: у перекладі його немає' : 'Термін глосарію'}"` });
  for (const m of text.matchAll(CODE)) if (!marks.some(x => m.index! < x.end && m.index! + m[0].length > x.start)) marks.push({ start: m.index!, end: m.index! + m[0].length, cls: 'code', attrs: ` data-hc="code" data-hk="${esc(m[0])}" tabindex="0" role="button" title="Керівний код: що він означає"` });
  marks.sort((a, b) => a.start - b.start);
  let out = '', at = 0;
  for (const m of marks) {
    if (m.start < at) continue;
    out += showInvisible(esc(text.slice(at, m.start))) + `<span class="${m.cls}"${m.attrs}>${esc(text.slice(m.start, m.end))}</span>`;
    at = m.end;
  }
  return out + showInvisible(esc(text.slice(at)));
}
