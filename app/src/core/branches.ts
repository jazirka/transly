import type { Entry, Translations } from './model';
import { nextMt } from './model';
import type { Branch, SavedProject } from './project';
import type { RowChange } from './journal';
import { merge } from './merge';
import { planOf } from './plan';
import type { ChangePlan } from './plan';

/**
 * Branches of a translation. A branch is a whole copy of the translator's rows (the game's files are the same for all of them).
 * `SavedProject.files` always holds the rows of the CURRENT branch, so every tool and every screen keeps working on it unchanged;
 * the other branches are parked in `SavedProject.branches[name].files`. Switching moves the rows in and out; nothing else is copied.
 * A branch remembers where it began (`base`): the rows as they were when it was made, or as they were settled by the last merge.
 * That is what lets a merge tell «only they changed it» (goes in by itself) from «both changed it» (a conflict, the translator decides).
 */
export type { Branch };

export const MAIN = 'main';
export const MAX_NAME = 40;

type Files = Record<string, Translations>;
const clone = <T>(x: T): T => structuredClone(x);

/** The name of the branch whose rows are in `files`. */
export const branchOf = (p: Pick<SavedProject, 'branch'>): string => p.branch || MAIN;

/** Every branch of the project, `main` first and then in the order they were made. */
export function branchNames(p: Pick<SavedProject, 'branch' | 'branches'>): string[] {
  const names = new Set<string>([MAIN, branchOf(p), ...Object.keys(p.branches ?? {})]);
  return [...names].sort((x, y) => (x === MAIN ? -1 : y === MAIN ? 1 : (p.branches?.[x]?.at ?? 0) - (p.branches?.[y]?.at ?? 0) || (x < y ? -1 : 1)));
}

/** Why a name cannot be used for a branch, or null when it can (`except` is the branch being renamed). */
export function nameProblem(p: Pick<SavedProject, 'branch' | 'branches'>, raw: string, except?: string): string | null {
  const name = raw.trim();
  if (!name) return 'Назва гілки не може бути порожньою';
  if (name.length > MAX_NAME) return `Назва гілки не довша за ${MAX_NAME} знаків`;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(name)) return 'У назві гілки не може бути керівних знаків';
  const taken = branchNames(p).find(n => n.toLowerCase() === name.toLowerCase() && n !== except);
  return taken ? `Гілка «${taken}» уже є` : null;
}

/** How many rows with a translation a branch has (the current one is `files`). */
export function rowsIn(p: SavedProject, name: string): number {
  const files = name === branchOf(p) ? p.files : p.branches?.[name]?.files;
  let n = 0;
  for (const t of Object.values(files ?? {})) for (const e of Object.values(t)) if (e.target.trim()) n++;
  return n;
}

/** A new branch made from the current one; it becomes the current one (the rows of the old current branch are parked). */
export function createBranch(p: SavedProject, name: string, now: number): SavedProject {
  const bad = nameProblem(p, name);
  if (bad) throw new Error(bad);
  const cur = branchOf(p), key = name.trim();
  const branches: Record<string, Branch> = { ...(p.branches ?? {}) };
  branches[cur] = { ...(branches[cur] ?? { at: 0 }), files: p.files };
  branches[key] = { from: cur, at: now, base: clone(p.files) };
  const out: SavedProject = { ...p, files: clone(p.files), branch: key, branches };
  if (p.goneBranches?.[key] !== undefined) { const g = { ...p.goneBranches }; delete g[key]; if (Object.keys(g).length) out.goneBranches = g; else delete out.goneBranches; }
  return out;
}

function moveTo(p: SavedProject, name: string, strict: boolean): SavedProject {
  const cur = branchOf(p);
  if (name === cur) return p;
  const target = p.branches?.[name];
  if (strict && !target?.files && name !== MAIN) throw new Error(`Гілки «${name}» немає`);
  const branches: Record<string, Branch> = { ...(p.branches ?? {}) };
  branches[cur] = { ...(branches[cur] ?? { at: 0 }), files: p.files };
  const { files, ...meta } = (target ?? { at: 0 }) as Branch;
  branches[name] = meta;
  const out: SavedProject = { ...p, files: files ?? {}, branches };
  if (name === MAIN) delete out.branch; else out.branch = name;
  return out;
}

/** The project with another branch as the current one. */
export const switchBranch = (p: SavedProject, name: string): SavedProject => moveTo(p, name, true);

/** The same, for a merge of two copies: a branch a copy never saw is an empty one there. */
export const checkoutBranch = (p: SavedProject, name: string): SavedProject => moveTo(p, name, false);

/** Rename a branch (the branches made from it follow it). */
export function renameBranch(p: SavedProject, from: string, to: string): SavedProject {
  if (from === MAIN) throw new Error('Гілку «main» не можна перейменувати');
  const bad = nameProblem(p, to, from);
  if (bad) throw new Error(bad);
  const key = to.trim();
  if (key === from) return p;
  const branches: Record<string, Branch> = {};
  for (const [n, b] of Object.entries(p.branches ?? {})) branches[n === from ? key : n] = b.from === from ? { ...b, from: key } : b;
  return { ...p, branches, ...(branchOf(p) === from ? { branch: key } : {}) };
}

/** Delete a branch that is not the current one; the branches made from it are made from its parent now. */
export function deleteBranch(p: SavedProject, name: string, now: number): SavedProject {
  if (name === branchOf(p)) throw new Error('Поточну гілку не можна видалити: спершу перемкніться на іншу');
  if (name === MAIN) throw new Error('Гілку «main» не можна видалити');
  const own = p.branches?.[name];
  const branches: Record<string, Branch> = {};
  for (const [n, b] of Object.entries(p.branches ?? {})) if (n !== name) branches[n] = b.from === name ? { ...b, from: own?.from } : b;
  return { ...p, branches, goneBranches: { ...(p.goneBranches ?? {}), [name]: now } };
}

// ---------- compare and merge ----------

export type DiffKind = 'new' | 'changed' | 'conflict';

/** One row that differs between the current branch (`mine`) and another one (`theirs`). */
export interface DiffRow {
  file: string;
  key: string;
  kind: DiffKind;
  mine?: Entry;
  theirs: Entry;
  /** The row where the two began. */
  base?: Entry;
  /** The row is proofread in the current branch: a merge does not touch it. */
  locked: boolean;
}

const text = (e: Entry | undefined): string => e?.target ?? '';

/** The rows where two branches began: where the other branch was made from this one (or this one from it), as far as a merge has settled. */
function baseFor(p: SavedProject, source: string): Files | undefined {
  const cur = branchOf(p);
  const s = p.branches?.[source];
  if (s?.from === cur && s.base) return s.base;
  const c = p.branches?.[cur];
  if (c?.from === source && c.base) return c.base;
  return undefined;
}

/**
 * What the branch `source` would bring into the current one. A row is listed only when it has a translation in `source` that
 * the current branch does not have: `new` (nothing here yet), `changed` (only `source` changed it since the branches parted) or
 * `conflict` (both did). A row only the current branch changed is not listed: there is nothing to take.
 */
export function diffBranches(p: SavedProject, source: string): DiffRow[] {
  const src = p.branches?.[source]?.files;
  if (!src) throw new Error(`Гілки «${source}» немає`);
  const base = baseFor(p, source);
  const out: DiffRow[] = [];
  for (const file of new Set([...Object.keys(p.files), ...Object.keys(src)])) {
    const mine = p.files[file] ?? {}, theirs = src[file] ?? {}, from = base?.[file] ?? {};
    for (const key of Object.keys(theirs)) {
      const t = theirs[key]!, m = mine[key], b = from[key];
      if (!text(t).trim() || text(t) === text(m)) continue;
      const mineEmpty = !text(m).trim();
      let kind: DiffKind;
      if (mineEmpty) kind = 'new';
      else if (base) {
        if (text(m) === text(b)) kind = 'changed';
        else if (text(t) === text(b)) continue;
        else kind = 'conflict';
      } else kind = 'conflict';
      out.push({ file, key, kind, ...(m ? { mine: m } : {}), theirs: t, ...(b ? { base: b } : {}), locked: kind !== 'new' && m?.status === 'appr' });
    }
  }
  return out;
}

/** What the translator decided for a row: take theirs, keep mine, or write the row's text by hand. */
export type Decision = { take: 'theirs' } | { take: 'mine' } | { take: 'custom'; text: string };

export const rowId = (r: { file: string; key: string }): string => `${r.file}\u0001${r.key}`;

/** The decision the merge starts with: rows that only they changed are taken, conflicts wait for the translator, proofread rows are kept. */
export function defaultDecision(r: DiffRow): Decision | undefined {
  if (r.locked) return { take: 'mine' };
  return r.kind === 'conflict' ? undefined : { take: 'theirs' };
}

/**
 * The plan of a merge: the rows to write, as one action of the journal («merge»). A row without a decision stays as it is in the
 * current branch; a proofread row is never written (the plan counts it in `skipped`).
 */
export function planMerge(p: SavedProject, rows: DiffRow[], decide: (r: DiffRow) => Decision | undefined, now: number): ChangePlan {
  const changes: RowChange[] = [];
  for (const r of rows) {
    const d = decide(r);
    if (!d || d.take === 'mine') continue;
    const prev = r.mine;
    if (d.take === 'theirs') {
      changes.push({ file: r.file, key: r.key, text: r.theirs.target, next: { ...(prev ?? {}), target: r.theirs.target, status: r.theirs.status, ...(r.theirs.src !== undefined ? { src: r.theirs.src } : {}), mt: nextMt(prev?.mt, now) } });
    } else {
      changes.push({ file: r.file, key: r.key, text: d.text, next: { ...(prev ?? {}), target: d.text, status: d.text.trim() ? 'draft' : 'new', mt: nextMt(prev?.mt, now) } });
    }
  }
  return planOf(file => p.files[file] ?? {}, changes, 'merge', 'skip');
}

// ---------- merging two copies of a project that has branches ----------

/** Merge the parked branches of two copies of a project (both already have the same current branch `cur`). */
export function mergeBranchData(a: SavedProject, b: SavedProject, cur: string, epoch: number, live: (t: Translations) => Translations): Pick<SavedProject, 'branches' | 'goneBranches'> {
  const gone: Record<string, number> = {};
  for (const src of [a.goneBranches ?? {}, b.goneBranches ?? {}]) for (const [k, t] of Object.entries(src)) if (t > epoch && t > (gone[k] ?? 0)) gone[k] = t;
  const names = new Set([...Object.keys(a.branches ?? {}), ...Object.keys(b.branches ?? {})]);
  const branches: Record<string, Branch> = {};
  for (const name of names) {
    const x = a.branches?.[name], y = b.branches?.[name];
    const born = Math.min(x?.at ?? Infinity, y?.at ?? Infinity);
    if (name !== cur && (gone[name] ?? 0) >= born && (gone[name] ?? 0) > 0) continue;
    const one = x && y ? undefined : (x ?? y)!;
    if (one) { branches[name] = one; continue; }
    const from = x!.from ?? y!.from;
    const base = x!.base && y!.base ? (JSON.stringify(y!.base) > JSON.stringify(x!.base) ? y!.base : x!.base) : (x!.base ?? y!.base);
    const merged: Branch = { ...(from !== undefined ? { from } : {}), at: Math.min(x!.at, y!.at), ...(base ? { base } : {}) };
    if (name !== cur && (x!.files || y!.files)) {
      const files: Files = {};
      for (const f of new Set([...Object.keys(x!.files ?? {}), ...Object.keys(y!.files ?? {})])) files[f] = merge(live(x!.files?.[f] ?? {}), live(y!.files?.[f] ?? {}), 0).merged;
      merged.files = files;
    }
    branches[name] = merged;
  }
  return { ...(Object.keys(branches).length ? { branches } : {}), ...(Object.keys(gone).length ? { goneBranches: gone } : {}) };
}
