import type { IssueCat } from './qa';

/**
 * What a remark is for, in the order the translator needs it: a mistake that breaks the text, a term that disagrees with
 * the glossary, a fact about the situation of the line, a recommendation, and reference material. Each kind has its own
 * glyph and name as well as its own colour, so the difference is not carried by colour alone.
 */
export const HINT_ORDER: readonly IssueCat[] = ['error', 'term', 'context', 'style', 'info'];

/** Name of one remark of the kind. */
export const HINT_LABEL: Record<IssueCat, string> = { error: 'Помилка', term: 'Термін', context: 'Контекст', style: 'Порада', info: 'Довідка' };

/** Name of the group of such remarks. */
export const HINT_GROUP: Record<IssueCat, string> = { error: 'Помилки', term: 'Терміни', context: 'Контекст', style: 'Поради', info: 'Довідка' };

/** A different shape for each kind. */
export const HINT_GLYPH: Record<IssueCat, string> = { error: '✖', term: '◆', context: '●', style: '▲', info: '↗' };

/** Remarks in the order of their kinds (the order inside a kind is kept). */
export function byHintOrder<T extends { cat: IssueCat }>(items: readonly T[]): T[] {
  const rank = (c: IssueCat): number => HINT_ORDER.indexOf(c);
  return items.map((x, i) => [x, i] as const).sort((a, b) => rank(a[0].cat) - rank(b[0].cat) || a[1] - b[1]).map(([x]) => x);
}

/** Remarks split by kind, in order; kinds without remarks are left out. */
export function groupHints<T extends { cat: IssueCat }>(items: readonly T[]): { cat: IssueCat; items: T[] }[] {
  return HINT_ORDER.map(cat => ({ cat, items: items.filter(x => x.cat === cat) })).filter(g => g.items.length);
}
