import type { Entry } from './model';
import type { FileView, SavedProject } from './project';
import type { GlossaryTerm } from './glossary';
import { hasTermIn, prepareText, targetHasTerm } from './glossary';

/**
 * What the app can offer after something happened, worked out from the data and never stored. Each function answers one
 * question the translator would otherwise have to ask by hand; the screens show the answer as a message with a button.
 */

export interface RowKey { file: string; key: string }

export interface TermRows {
  /** The original has the term, the row has a translation, and the translation does not use the term. */
  lacking: RowKey[];
  /** The original has the term and there is no translation yet. */
  waiting: RowKey[];
}

/**
 * After a term was added (or its original word changed): the rows that contain it in the original. The first list is
 * the work to look at (translated without the term), the second is the work that will meet the term when it comes to it.
 */
export function rowsWithTerm(views: FileView[], saved: SavedProject, term: Pick<GlossaryTerm, 'en' | 'uk' | 'alt'>): TermRows {
  const out: TermRows = { lacking: [], waiting: [] };
  const en = term.en.trim();
  if (!en || !term.uk.trim()) return out;
  for (const v of views) {
    const ents = saved.files[v.name] as Record<string, Entry | undefined> | undefined;
    for (const u of v.units) {
      if (!hasTermIn(prepareText(u.source), en)) continue;
      const e = ents?.[u.key];
      if (!e || !e.target.trim()) out.waiting.push({ file: v.name, key: u.key });
      else if (!targetHasTerm(e.target, term.uk, term.alt ?? [])) out.lacking.push({ file: v.name, key: u.key });
    }
  }
  return out;
}

/** The sentence about those rows, or '' when the term is in no row. */
export function termRowsNote(en: string, r: TermRows): string {
  const parts: string[] = [];
  if (r.lacking.length) parts.push(`перекладено без нього: ${r.lacking.length}`);
  if (r.waiting.length) parts.push(`чекають перекладу: ${r.waiting.length}`);
  return parts.length ? `У рядках із «${en}» ${parts.join(', ')}` : '';
}
