import { normalizeGap, patternParts, touchTerms } from './glossary';
import type { GlossaryTerm } from './glossary';
import type { SavedProject } from './project';

/** What the term form holds: the alternatives as one text, separated by `;` or `,`. A category or note left out (undefined) keeps what the term has; an empty one clears it. */
export interface TermForm { en: string; uk: string; alt?: string; kind?: string; note?: string; qa?: boolean }

const keyOf = (en: string): string => en.trim().toLowerCase();

/** The alternatives of a term as typed in the form. */
export const splitAlts = (s: string | undefined): string[] => (s ?? '').split(/[;,]/).map(x => x.trim()).filter(Boolean);

/** The alternatives as shown in the form. */
export const joinAlts = (alt: string[] | undefined): string => (alt ?? []).join('; ');

/**
 * Add a term, or change one. `was` is the original word of the term being changed (it may be renamed); without it the
 * form adds a new term, and a word that is already in the glossary is refused (`exists`). Both fields are required
 * (`null` when one is empty). A renamed term leaves a trace of the old word, so another device's copy of it does not
 * come back in a merge.
 */
export function saveTerm(saved: SavedProject, form: TermForm, now: number, was?: string): 'added' | 'changed' | 'exists' | null {
  // «take...off» and «take … off» are one pattern: the gap is written one way
  const en = normalizeGap(form.en), uk = normalizeGap(form.uk);
  if (!en || !uk || !patternParts(en).length || !patternParts(uk).length) return null;
  const oldKey = keyOf(was ?? en), newKey = keyOf(en);
  const at = saved.terms.findIndex(t => keyOf(t.en) === oldKey);
  if (was === undefined && at >= 0) return 'exists';
  if (at >= 0 && oldKey !== newKey && saved.terms.some(t => keyOf(t.en) === newKey)) return 'exists';
  const alts = splitAlts(form.alt).map(normalizeGap);
  const prev = at >= 0 ? saved.terms[at] : undefined;
  const { alt: _a, kind: _k, note: _n, qa: _q, ...kept } = prev ?? ({} as GlossaryTerm);
  // A field the form does not have (undefined) keeps what the term already holds; an empty one clears it.
  const kind = form.kind === undefined ? prev?.kind : form.kind.trim() || undefined;
  const note = form.note === undefined ? prev?.note : form.note.trim() || undefined;
  const term: GlossaryTerm = {
    ...kept, en, uk, mt: now,
    ...(alts.length ? { alt: alts } : {}),
    ...(kind ? { kind } : {}),
    ...(note ? { note } : {}),
    ...(form.qa === false ? { qa: false } : {}),
  };
  if (at >= 0) {
    saved.terms[at] = term;
    if (oldKey !== newKey) saved.deletedTerms = { ...(saved.deletedTerms ?? {}), [oldKey]: now };
  } else saved.terms.push(term);
  touchTerms(saved.terms);
  return at >= 0 ? 'changed' : 'added';
}

/** Delete a term. A trace of the deletion stays, so another device's copy of the term does not bring it back in a merge. */
export function removeTerm(saved: SavedProject, en: string, now: number): boolean {
  const k = keyOf(en);
  const before = saved.terms.length;
  saved.terms = saved.terms.filter(t => keyOf(t.en) !== k);
  if (saved.terms.length === before) return false;
  saved.deletedTerms = { ...(saved.deletedTerms ?? {}), [k]: now };
  touchTerms(saved.terms);
  return true;
}
