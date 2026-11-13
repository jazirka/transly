import type { FileView, SavedProject } from './project';
import { knownStatus } from './model';
import { rowState } from './progress';
import { activeIssues } from './qa';
import type { QaOptions } from './qa';
import { hasAdvice } from './qaadvice';
import { sourceChanged } from './workflow';

/**
 * What is not ready, counted before the game is built (or run): one look at the whole project, so that a build does not
 * quietly leave out rows the translator thinks are done. Nothing is blocked here (the build has its own switches); this says
 * what the build will meet.
 */
export interface Preflight { total: number; untranslated: number; drafts: number; sent: number; errors: number; advice: number; sourceChanged: number }

export function preflight(views: FileView[], saved: SavedProject, qa: QaOptions): Preflight {
  const p: Preflight = { total: 0, untranslated: 0, drafts: 0, sent: 0, errors: 0, advice: 0, sourceChanged: 0 };
  for (const v of views) {
    const ents = saved.files[v.name] ?? {};
    for (const u of v.units) {
      p.total++;
      const e = ents[u.key], st = rowState(e);
      if (st === 'untranslated') { p.untranslated++; continue; }
      if (st === 'draft') p.drafts++;
      if (st === 'sent') p.sent++;
      if (e && knownStatus(e.status) !== 'new' && activeIssues(u, e, qa).some(i => i.severity === 'bad')) p.errors++;
      if (hasAdvice(u, e, qa)) p.advice++;
      if (sourceChanged(e, u)) p.sourceChanged++;
    }
  }
  return p;
}

/** The lines to show: only what is not zero, in the order of how much it matters for a build. */
/** `draftsOption`: the dialog has the switch «Додати чернетки» (the desktop app); otherwise the text says how to get a draft into the build. */
export function preflightLines(p: Preflight, draftsOption = false): string[] {
  const out: string[] = [];
  if (p.errors) out.push(`помилок QA: ${p.errors} (такі рядки в збірку не беруться, якщо ввімкнено перемикач)`);
  if (p.sourceChanged) out.push(`оригінал змінився після перекладу: ${p.sourceChanged}`);
  if (p.drafts) out.push(`чернеток: ${p.drafts} (${draftsOption ? 'не потраплять у збірку без «Додати чернетки»' : 'до збірки беруться лише надіслані й вичитані: надішліть їх'})`);
  if (p.untranslated) out.push(`без перекладу: ${p.untranslated}`);
  if (p.advice) out.push(`порад: ${p.advice}`);
  return out;
}
