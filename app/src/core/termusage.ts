import type { Entry } from './model';
import type { FileView, SavedProject } from './project';
import { prepareText, targetHasTerm, termFirstKey, termMatchesIn } from './glossary';
import type { GlossaryTerm } from './glossary';

/**
 * Where a term or a pattern is used in the whole game and how it was rendered there: the numbers behind a thread's card
 * («14 рядків · 12 як у записі, 2 інакше») and the list of rows that went another way. Worked out from the rows, never stored.
 */

export interface TermUse { file: string; key: string }

export interface TermUsage {
  /** Every row whose original has the term, in game order. */
  rows: TermUse[];
  /** The translation uses the term's own rendering. */
  main: number;
  /** It uses one of the alternatives. */
  alt: number;
  /** It is translated, but without the term or an alternative. */
  other: number;
  /** Not translated yet. */
  none: number;
  /** The rows counted in `other`, to be looked at. */
  otherRows: TermUse[];
}

/**
 * The words of every original, once: a word's key to the rows that have it, so a term is tried only against the rows that
 * could contain it (the rows with the key of its first word, in any form: «took» is under «take»).
 */
export class WordIndex {
  readonly rows: { file: string; key: string; source: string }[] = [];
  private byKey = new Map<string, number[]>();

  private add(file: string, key: string, source: string): void {
    const at = this.rows.push({ file, key, source }) - 1;
    const seen = new Set<string>();
    for (const t of prepareText(source).tokens) for (const k of t.keys) if (!seen.has(k)) { seen.add(k); const l = this.byKey.get(k); if (l) l.push(at); else this.byKey.set(k, [at]); }
  }

  /** All at once: fine for a game of some thousands of rows. */
  static of(views: FileView[]): WordIndex {
    const ix = new WordIndex();
    for (const v of views) for (const u of v.units) ix.add(v.name, u.key, u.source);
    return ix;
  }

  /** In slices, giving the screen back between them: a game of a hundred thousand rows is indexed without a freeze. */
  static async build(views: FileView[], pause: () => Promise<void>, slice = 4000): Promise<WordIndex> {
    const ix = new WordIndex();
    let n = 0;
    for (const v of views) for (const u of v.units) { ix.add(v.name, u.key, u.source); if (++n % slice === 0) await pause(); }
    return ix;
  }

  /** The indexes (into `rows`) of the rows that have a word with this key. */
  withKey(key: string): readonly number[] { return this.byKey.get(key) ?? []; }
}

/** How the term is used across the game. `skip` leaves one row out (the open one). */
export function termUsage(index: WordIndex, saved: Pick<SavedProject, 'files'>, term: Pick<GlossaryTerm, 'en' | 'uk' | 'alt'>, skip?: TermUse): TermUsage {
  const out: TermUsage = { rows: [], main: 0, alt: 0, other: 0, none: 0, otherRows: [] };
  const en = term.en.trim(), first = termFirstKey(en);
  if (!en || first === undefined) return out;
  const alt = term.alt ?? [];
  for (const at of index.withKey(first)) {
    const r = index.rows[at]!;
    if (skip && r.file === skip.file && r.key === skip.key) continue;
    if (!termMatchesIn(prepareText(r.source), en).length) continue;
    out.rows.push({ file: r.file, key: r.key });
    const tr = (saved.files[r.file] as Record<string, Entry | undefined> | undefined)?.[r.key]?.target;
    if (!tr?.trim()) out.none++;
    else if (targetHasTerm(tr, term.uk)) out.main++;
    else if (alt.length && targetHasTerm(tr, alt[0]!, alt.slice(1))) out.alt++;
    else { out.other++; out.otherRows.push({ file: r.file, key: r.key }); }
  }
  return out;
}
