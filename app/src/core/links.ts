import type { Entry, Status } from './model';
import type { FileView, SavedProject } from './project';
import { hashText, rowRef } from './groups';
import type { RowChange } from './journal';

/**
 * Links between rows. Rows whose original is exactly the same (ignoring spaces at the ends) are linked by themselves:
 * nothing is stored for the pair. Only the exceptions are written into the project: a row that was **unlinked**, and
 * the row the translator chose as the **main** translation of a cluster. Everything else is worked out from the rows.
 *
 * What a cluster is compared with (the *reference*): the main translation when one is chosen and has a text, otherwise
 * the translation of the row that was sent or approved last (a draft never spreads). A row is then `empty` (nothing to
 * show yet), `same`, `differs` (older text than the reference), `edited` (changed after the reference was written, so
 * it is not touched unless asked) or `unlinked`.
 *
 * Row keys are positions and can shift when the game is updated, so every stored item carries a hash of the original it
 * was made for; an item whose original is not the one at that place any more is ignored, never applied.
 */
export type LinkMode = 'ask' | 'auto' | 'off';

/** The mode of a project: `ask` unless chosen otherwise; a project of an older build that had the copying switched off is `off`. */
export const linkModeOf = (s: { linkMode?: LinkMode | undefined; propagate?: boolean | undefined } | undefined): LinkMode => {
  const m = s?.linkMode;
  if (m === 'ask' || m === 'auto' || m === 'off') return m;
  return s?.propagate === false ? 'off' : 'ask';
};

/** A stored exception. `u:<rowRef>`: the row is unlinked. `m:<original>`: `ref` is the main row of that original. */
export interface LinkItem { k: 'u' | 'm'; ref: string; h: string; mt: number; del?: true }
export type LinkData = { links?: Record<string, LinkItem> | undefined };

const MIN_LENGTH = 2;
/** What makes two originals the same: the text without the spaces at its ends. */
export const linkKey = (source: string): string => source.trim();
const unlinkId = (ref: string): string => `u:${ref}`;
const mainId = (text: string): string => `m:${text}`;

export interface LinkRow { file: string; key: string; ref: string; /** The original as it is in the game (the hash guard and `src` are made from it). */ source: string }

/** The rows that share an original, across all files. Built once per set of files. Only clusters of two or more exist. */
export class LinkIndex {
  private byText = new Map<string, LinkRow[]>();
  private textOf = new Map<string, string>();

  constructor(views: FileView[]) {
    const all = new Map<string, LinkRow[]>();
    for (const v of views) for (const u of v.units) {
      const text = linkKey(u.source);
      if (text.length < MIN_LENGTH) continue;
      let l = all.get(text);
      if (!l) all.set(text, l = []);
      l.push({ file: v.name, key: u.key, ref: rowRef(v.name, u.key), source: u.source });
    }
    for (const [text, rows] of all) if (rows.length > 1) { this.byText.set(text, rows); for (const r of rows) this.textOf.set(r.ref, text); }
  }

  /** The cluster a row is in, or null when its original is unique. */
  clusterOf(file: string, key: string): { text: string; rows: LinkRow[] } | null {
    const text = this.textOf.get(rowRef(file, key));
    return text === undefined ? null : { text, rows: this.byText.get(text)! };
  }
  /** How many other rows share the original of this one. */
  others(file: string, key: string): number { return Math.max(0, (this.clusterOf(file, key)?.rows.length ?? 1) - 1); }
  clusters(): IterableIterator<[string, LinkRow[]]> { return this.byText.entries(); }
  get size(): number { return this.byText.size; }
}

export type LinkState = 'main' | 'same' | 'empty' | 'differs' | 'edited' | 'unlinked' | 'draft';

export interface LinkRowView extends LinkRow {
  entry: Entry | undefined;
  target: string;
  status: Status;
  state: LinkState;
}
export interface LinkView {
  text: string;
  rows: LinkRowView[];
  /** The row the view was made for. */
  self: LinkRowView;
  /** The row that holds the text the others are compared with (the chosen main, or the one sent last). */
  reference?: LinkRowView;
  /** The main row the translator chose, when that choice is still valid. */
  main?: LinkRowView;
}

const live = (it: LinkItem | undefined, h: string): boolean => !!it && !it.del && it.h === h;
const sent = (r: { target: string; status: Status }): boolean => !!r.target.trim() && (r.status === 'done' || r.status === 'appr');

/** The cluster of a row with the state of each of its rows, or null when the row has no twin. */
export function linkView(saved: SavedProject, idx: LinkIndex, file: string, key: string): LinkView | null {
  const c = idx.clusterOf(file, key);
  if (!c) return null;
  const links = saved.links;
  const rows: LinkRowView[] = c.rows.map(r => {
    const entry = saved.files[r.file]?.[r.key];
    return { ...r, entry, target: entry?.target ?? '', status: entry?.status ?? 'new', state: live(links?.[unlinkId(r.ref)], hashText(r.source)) ? 'unlinked' : 'draft' };
  });
  const linked = rows.filter(r => r.state !== 'unlinked');
  const mi = links?.[mainId(c.text)];
  const main = mi && !mi.del ? linked.find(r => r.ref === mi.ref && hashText(r.source) === mi.h) : undefined;
  const reference = main?.target.trim() ? main : linked.filter(sent).sort((a, b) => (b.entry?.mt ?? 0) - (a.entry?.mt ?? 0) || (a.ref < b.ref ? -1 : 1))[0];
  for (const r of linked) {
    if (!reference) { r.state = r.target.trim() ? 'draft' : 'empty'; continue; }
    r.state = r === reference ? 'main' : !r.target.trim() ? 'empty' : r.target === reference.target ? 'same' : (r.entry?.mt ?? 0) > (reference.entry?.mt ?? 0) ? 'edited' : 'differs';
  }
  const self = rows.find(r => r.file === file && r.key === key)!;
  return { text: c.text, rows, self, ...(reference ? { reference } : {}), ...(main ? { main } : {}) };
}

export interface LinkPlan {
  view: LinkView;
  /** Rows with no translation yet: they get the reference as it is. */
  fills: LinkRowView[];
  /** Rows with an older, different text. */
  updates: LinkRowView[];
  /** Rows changed after the reference was written: only on request. */
  edited: LinkRowView[];
}

/** What would change in the cluster of a row to make it follow its reference. The row itself is never in the plan. */
export function planLinkSync(saved: SavedProject, idx: LinkIndex, file: string, key: string): LinkPlan | null {
  const view = linkView(saved, idx, file, key);
  if (!view?.reference) return null;
  const others = view.rows.filter(r => r !== view.self);
  return { view, fills: others.filter(r => r.state === 'empty'), updates: others.filter(r => r.state === 'differs'), edited: others.filter(r => r.state === 'edited') };
}

/** The rows as they are after they took the text of the reference; sent for review, since the text was already reviewed once. Approval is never copied. */
export function linkChanges(reference: string, rows: LinkRowView[], now: number): RowChange[] {
  return rows.map(r => ({
    file: r.file, key: r.key, text: reference,
    next: { ...(r.entry ?? {}), target: reference, status: 'done', mt: now, src: r.source, orig: reference, returned: false } as Entry,
  }));
}

export interface SendSync {
  /** The writes to make now (one action of the journal). */
  changes: RowChange[];
  filled: number;
  updated: number;
  /** Rows that differ and are left for the translator to look at. */
  pending: number;
}

/** After a row was sent: what the project's mode does with the rest of its cluster. */
export function afterSend(saved: SavedProject, idx: LinkIndex, mode: LinkMode, file: string, key: string, now: number): SendSync {
  const none: SendSync = { changes: [], filled: 0, updated: 0, pending: 0 };
  if (mode === 'off') return none;
  const plan = planLinkSync(saved, idx, file, key);
  if (!plan?.view.reference) return none;
  const take = mode === 'auto' ? [...plan.fills, ...plan.updates] : plan.fills;
  return {
    changes: linkChanges(plan.view.reference.target, take, now),
    filled: plan.fills.length,
    updated: mode === 'auto' ? plan.updates.length : 0,
    pending: (mode === 'auto' ? 0 : plan.updates.length) + plan.edited.length,
  };
}

/** How many rows next to the given ones (in their clusters) have something to look at: empty, different or changed later. Each row is counted once. */
export function pendingLinks(saved: SavedProject, idx: LinkIndex, rows: { file: string; key: string }[]): number {
  const seen = new Set<string>(), done = new Set<string>();
  for (const r of rows) {
    const c = idx.clusterOf(r.file, r.key);
    if (!c || done.has(c.text)) continue;
    done.add(c.text);
    const plan = planLinkSync(saved, idx, r.file, r.key);
    if (plan) for (const x of [...plan.fills, ...plan.updates, ...plan.edited]) seen.add(x.ref);
  }
  return seen.size;
}

/* ---------- what the translator decides ---------- */

const put = (saved: SavedProject, id: string, item: LinkItem): void => { (saved.links ??= {})[id] = item; };

/** Make a row the main translation of its cluster (the others follow it). */
export function setMain(saved: SavedProject, row: { file: string; key: string; source: string }, now: number): void {
  put(saved, mainId(linkKey(row.source)), { k: 'm', ref: rowRef(row.file, row.key), h: hashText(row.source), mt: now });
}
/** Go back to «the one sent last is the reference». */
export function clearMain(saved: SavedProject, source: string, now: number): void {
  const id = mainId(linkKey(source)), cur = saved.links?.[id];
  if (cur && !cur.del) put(saved, id, { ...cur, mt: now, del: true });
}
/** The row stops following its twins and is not touched by them. */
export function unlinkRow(saved: SavedProject, row: { file: string; key: string; source: string }, now: number): void {
  const ref = rowRef(row.file, row.key);
  put(saved, unlinkId(ref), { k: 'u', ref, h: hashText(row.source), mt: now });
}
/** The row follows its twins again. */
export function relinkRow(saved: SavedProject, row: { file: string; key: string }, now: number): void {
  const ref = rowRef(row.file, row.key), id = unlinkId(ref), cur = saved.links?.[id];
  if (cur && !cur.del) put(saved, id, { ...cur, mt: now, del: true });
}

/* ---------- the whole project ---------- */

export interface LinkCluster {
  text: string;
  view: LinkView;
  counts: Record<LinkState, number>;
  /** The clusters's distinct translations with the rows that have them, the most used first. */
  variants: { target: string; rows: LinkRowView[] }[];
}

/**
 * The clusters that have something to look at: rows that differ from the reference or from each other, rows changed
 * after it, or empty rows next to a translation. The biggest first; `total` is the count before `limit`.
 */
export function reviewClusters(saved: SavedProject, idx: LinkIndex, limit = 300): { clusters: LinkCluster[]; total: number } {
  const out: LinkCluster[] = [];
  for (const [, rows] of idx.clusters()) {
    const first = rows[0]!;
    const view = linkView(saved, idx, first.file, first.key);
    if (!view) continue;
    const counts: Record<LinkState, number> = { main: 0, same: 0, empty: 0, differs: 0, edited: 0, unlinked: 0, draft: 0 };
    for (const r of view.rows) counts[r.state]++;
    const targets = new Map<string, LinkRowView[]>();
    for (const r of view.rows) if (r.state !== 'unlinked' && r.target.trim()) { const l = targets.get(r.target) ?? []; l.push(r); targets.set(r.target, l); }
    const needs = counts.differs || counts.edited || (counts.empty && view.reference) || targets.size > 1;
    if (!needs) continue;
    out.push({ text: view.text, view, counts, variants: [...targets].map(([target, rs]) => ({ target, rows: rs })).sort((a, b) => b.rows.length - a.rows.length) });
  }
  out.sort((a, b) => b.view.rows.length - a.view.rows.length || (a.text < b.text ? -1 : 1));
  return { clusters: out.slice(0, limit), total: out.length };
}

/** Two copies of the links: per item the newer wins, and what is older than the last reset is dropped. */
export function mergeLinkData(a: LinkData, b: LinkData, epoch: number): LinkData {
  if (!a.links && !b.links) return {};
  const out: Record<string, LinkItem> = {};
  for (const src of [a.links ?? {}, b.links ?? {}]) for (const [k, v] of Object.entries(src)) if (v.mt > epoch && (!out[k] || v.mt > out[k]!.mt)) out[k] = v;
  return Object.keys(out).length ? { links: out } : {};
}
