import { patternParts, normalizeGap } from '../glossary';
import { saveTerm } from '../termedit';
import type { SavedProject } from '../project';
import type { PluginRecord } from './registry';
import type { GlossaryContribution } from './types';

/** A term a plugin brings, as written in its glossary. */
export interface BroughtTerm { en: string; uk: string; alt?: string[]; note?: string }

const LIMIT = 5000;

/** The terms of one glossary of a plugin: the ones written in the manifest, or those of its file (`.json` list or `.tsv`: original, tab, translation, tab, alternatives after `;`). */
export function glossaryTerms(rec: Pick<PluginRecord, 'files'>, g: GlossaryContribution): { terms: BroughtTerm[]; skipped: number } {
  const raw: unknown[] = [];
  if (g.terms) raw.push(...g.terms);
  if (g.file) {
    const text = rec.files.get(g.file) ?? '';
    if (/\.json$/i.test(g.file)) { try { const j: unknown = JSON.parse(text); if (Array.isArray(j)) raw.push(...j); } catch { /* an unreadable file brings nothing */ } }
    else for (const line of text.split(/\r?\n/)) {
      if (!line.trim() || line.startsWith('#')) continue;
      const [en, uk, alt, note] = line.split('\t');
      raw.push({ en, uk, ...(alt?.trim() ? { alt: alt.split(';').map(x => x.trim()).filter(Boolean) } : {}), ...(note?.trim() ? { note: note.trim() } : {}) });
    }
  }
  const terms: BroughtTerm[] = [];
  let skipped = 0;
  const seen = new Set<string>();
  for (const r of raw.slice(0, LIMIT * 2)) {
    const x = r as Partial<BroughtTerm> | null;
    const en = typeof x?.en === 'string' ? normalizeGap(x.en) : '', uk = typeof x?.uk === 'string' ? normalizeGap(x.uk) : '';
    // a term must have something to look for on both sides (a gap alone is not a term)
    if (!en || !uk || en.length > 200 || uk.length > 200 || !patternParts(en).length || !patternParts(uk).length || seen.has(en.toLowerCase())) { skipped++; continue; }
    seen.add(en.toLowerCase());
    const alt = Array.isArray(x?.alt) ? x.alt.filter((a): a is string => typeof a === 'string' && !!a.trim() && a.length <= 200) : [];
    terms.push({ en, uk, ...(alt.length ? { alt } : {}), ...(typeof x?.note === 'string' && x.note.trim() ? { note: x.note.trim().slice(0, 300) } : {}) });
    if (terms.length >= LIMIT) break;
  }
  return { terms, skipped };
}

/** What adding a glossary to a project would do, term by term: new ones, ones the project already has the same way, and ones it translates differently (kept as they are). */
export interface GlossaryPlan { add: BroughtTerm[]; same: BroughtTerm[]; differ: { brought: BroughtTerm; has: string }[] }

export function planGlossaryImport(saved: Pick<SavedProject, 'terms'>, terms: readonly BroughtTerm[]): GlossaryPlan {
  const have = new Map(saved.terms.map(t => [t.en.trim().toLowerCase(), t]));
  const plan: GlossaryPlan = { add: [], same: [], differ: [] };
  for (const b of terms) {
    const h = have.get(b.en.toLowerCase());
    if (!h) plan.add.push(b);
    else if (h.uk.trim().toLowerCase() === b.uk.trim().toLowerCase()) plan.same.push(b);
    else plan.differ.push({ brought: b, has: h.uk });
  }
  return plan;
}

/** Add the new terms of a plan to the project. A term the project already has is never replaced here (it is the translator's own). Returns how many were added. */
export function applyGlossaryImport(saved: SavedProject, plan: GlossaryPlan, now: number): number {
  let n = 0;
  for (const b of plan.add) if (saveTerm(saved, { en: b.en, uk: b.uk, ...(b.alt?.length ? { alt: b.alt.join('; ') } : {}), ...(b.note ? { note: b.note } : {}) }, now) === 'added') n++;
  return n;
}
