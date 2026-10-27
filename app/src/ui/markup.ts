import { esc } from './dom';

const CODE = /\\[A-Za-z]+\[\d+\]|\\[{}.|!><^$]/g;

/** Escape text and mark control codes. Optionally mark glossary terms (English forms). */
export function markup(text: string, termsEn: string[] = []): string {
  const safe = esc(text);
  const terms = termsEn.filter(Boolean).sort((a, b) => b.length - a.length);
  const parts = ['(' + CODE.source + ')'];
  if (terms.length) parts.push(`(?<![\\p{L}\\p{N}])(${terms.map(t => esc(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?:s|es|ed|ing)?(?![\\p{L}\\p{N}])`);
  const re = new RegExp(parts.join('|'), 'giu');
  return safe.replace(re, (m, code: string | undefined, term: string | undefined) =>
    code ? `<span class="code">${m}</span>` : term ? `<span class="term-hit" title="Термін глосарію">${m}</span>` : m);
}
