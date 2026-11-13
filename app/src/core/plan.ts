import type { Entry } from './model';
import type { BatchKind, RowChange } from './journal';
import { BATCH_INFO } from './journal';
import { rows } from './plural';
import { sourceChanged } from './workflow';
import type { Unit } from './model';

/**
 * A plan of changes: what a tool is about to do to rows, worked out and looked at BEFORE anything is written. Every tool that
 * changes many rows makes one, shows what it says, and applies it as one action of the journal (so it can be taken back).
 * The plan is also where the rule lives that a proofread row is not touched by a bulk tool unless the translator asks for it.
 */
export type Protect = 'skip' | 'include';

export interface SkippedRow { file: string; key: string; reason: 'proofread' }

export interface ChangePlan {
  kind: BatchKind;
  /** The rows that will be written. */
  changes: RowChange[];
  /** Rows the tool wanted to change but left alone. */
  skipped: SkippedRow[];
  /** Rows of the plan that fall back to a draft: proofread ones (only when the translator included them) and sent ones. */
  demotes: { appr: number; done: number };
  protect: Protect;
}

const RANK: Record<string, number> = { new: 0, draft: 1, done: 2, appr: 3 };

/** A proofread row is protected from a change of its text or a lower status. Approving it (same text, still `appr`) is no change. */
export const isProtected = (prev: Entry | undefined, next: Entry): boolean => prev?.status === 'appr' && (next.target !== prev.target || next.status !== 'appr');

/**
 * Make a plan from the changes a tool has worked out. With `protect: 'skip'` (the default) proofread rows are left out and
 * counted in `skipped`; with `'include'` they are written and counted in `demotes`.
 */
export function planOf(entries: (file: string) => Record<string, Entry>, changes: RowChange[], kind: BatchKind, protect: Protect = 'skip'): ChangePlan {
  const keep: RowChange[] = [], skipped: SkippedRow[] = [], demotes = { appr: 0, done: 0 };
  for (const c of changes) {
    const prev = entries(c.file)[c.key];
    if (isProtected(prev, c.next)) {
      if (protect === 'skip') { skipped.push({ file: c.file, key: c.key, reason: 'proofread' }); continue; }
      demotes.appr++;
    } else if (prev && prev.status === 'done' && (RANK[c.next.status] ?? 0) < RANK.done!) demotes.done++;
    keep.push(c);
  }
  return { kind, changes: keep, skipped, demotes, protect };
}

/** Write the plan as one action of the journal; returns its id, or nothing when the plan changes no row. */
export const applyPlan = (commit: (changes: RowChange[], kind: BatchKind, what?: string) => string, plan: ChangePlan, what?: string): string | undefined =>
  (plan.changes.length ? commit(plan.changes, plan.kind, what) : undefined);

/** What the plan leaves out or demotes, as a sentence for a preview or a message ('' when there is nothing to say). */
export function planNote(plan: ChangePlan): string {
  const parts: string[] = [];
  if (plan.skipped.length) parts.push(`Вичитаних пропущено: ${plan.skipped.length}`);
  if (plan.demotes.appr) parts.push(`Вичитаних стане чернетками: ${plan.demotes.appr}`);
  if (plan.demotes.done) parts.push(`Надісланих стане чернетками: ${plan.demotes.done}`);
  return parts.join('. ');
}

/** The message after a plan was applied: what was done to how many rows, and what was left alone or demoted. */
export function planMessage(plan: ChangePlan, applied: number): string {
  const head = BATCH_INFO[plan.kind].title(rows(applied));
  const note = planNote(plan);
  return note ? `${head}. ${note}` : head;
}

/**
 * After the game files were read again: translated rows whose original changed. `changed` counts all of them (the row also
 * shows a remark); `changes` are the ones that were sent or proofread and go back to drafts, so that they cannot slip into a build
 * unnoticed. Nothing is written here: the caller applies `changes` as one action of the journal («reconcile»), which can be taken back.
 */
export function reconcileChanges(views: { name: string; units: Unit[] }[], files: Record<string, Record<string, Entry>>, now: number): { changes: RowChange[]; changed: number } {
  const changes: RowChange[] = [];
  let changed = 0;
  for (const v of views) {
    const ents = files[v.name];
    if (!ents) continue;
    for (const u of v.units) {
      const e = ents[u.key];
      if (!e || !sourceChanged(e, u)) continue;
      changed++;
      if (e.status === 'done' || e.status === 'appr') changes.push({ file: v.name, key: u.key, next: { ...e, status: 'draft', mt: now }, text: e.target });
    }
  }
  return { changes, changed };
}
