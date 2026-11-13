import type { Entry } from './model';
import type { FileView, SavedProject } from './project';
import { note } from './workflow';
import { BATCH_INFO } from './journal';

/** What the app fills in by itself, each with the history note it leaves on the row. */
export type AutoKind = 'words' | 'twin';
export const AUTO_NOTE: Record<AutoKind, string> = { words: 'автозаповнено за словами', twin: 'підставлено з однакового рядка' };
const UNDONE: Record<AutoKind, string> = { words: 'автозаповнення скасовано', twin: 'підстановку скасовано' };
const GAP = 3 * 60 * 1000;

export interface AutoItem { file: string; key: string; source: string; target: string; at: number }
export interface AutoBatch { kind: AutoKind; at: number; items: AutoItem[] }

const kindOf = (what: string): AutoKind | null => (what === AUTO_NOTE.words ? 'words' : what === AUTO_NOTE.twin ? 'twin' : null);
/**
 * Is the row filled in by the app and not yet looked at by the translator? Its newest history record is an automatic one
 * (an equal original, the memory, the words) and nothing was typed in it since. Such a row is a draft marked «авто».
 */
export const isAutoFilled = (e: Entry | undefined): boolean => {
  const last = e?.history?.at(-1);
  return !!e && !!last && e.status === 'draft' && e.mt <= last.at && (isAutoNote(last.what) || last.what.startsWith('підставлено з пам’яті'));
};

export const isAutoNote = (what: string): boolean => kindOf(what) !== null || what === BATCH_INFO.link.what;

/**
 * Rows the app filled in by itself that are still as it left them: the newest history record of the row is the automatic
 * one (any later edit, send or return takes the row out). Records within three minutes form one batch; newest first.
 */
export function autoBatches(views: FileView[], saved: SavedProject, limit = 20): AutoBatch[] {
  const found: (AutoItem & { kind: AutoKind })[] = [];
  for (const v of views) {
    const ents = saved.files[v.name]; if (!ents) continue;
    for (const u of v.units) {
      const e = ents[u.key], last = e?.history?.at(-1), kind = last && !last.batch ? kindOf(last.what) : null;
      if (e && last && kind && e.mt <= last.at) found.push({ kind, file: v.name, key: u.key, source: u.source, target: e.target, at: last.at });
    }
  }
  found.sort((a, b) => b.at - a.at);
  const out: AutoBatch[] = [];
  for (const f of found) {
    const cur = out[out.length - 1];
    const item: AutoItem = { file: f.file, key: f.key, source: f.source, target: f.target, at: f.at };
    if (cur && cur.kind === f.kind && cur.items.at(-1)!.at - f.at <= GAP) cur.items.push(item);
    else { if (out.length >= limit) break; out.push({ kind: f.kind, at: f.at, items: [item] }); }
  }
  return out;
}

/** Take an automatic fill back: the row is empty again. Returns how many rows changed. */
export function undoAuto(saved: SavedProject, batch: AutoBatch, who: string, now: number): number {
  let n = 0;
  for (const it of batch.items) {
    const e: Entry | undefined = saved.files[it.file]?.[it.key], last = e?.history?.at(-1);
    if (!e || !last || last.at !== it.at || kindOf(last.what) !== batch.kind || e.mt > last.at) continue;
    const empty: Entry = { ...e, target: '', status: 'new', mt: now, returned: false };
    delete empty.orig;
    saved.files[it.file]![it.key] = note(empty, UNDONE[batch.kind], it.target, who, now);
    n++;
  }
  return n;
}

/** Automatic fills that were taken back (information for the feed). */
export function autoUndone(views: FileView[], saved: SavedProject, limit = 10): { kind: AutoKind; at: number; count: number }[] {
  const found: { kind: AutoKind; at: number }[] = [];
  for (const v of views) {
    const ents = saved.files[v.name]; if (!ents) continue;
    for (const u of v.units) {
      const last = ents[u.key]?.history?.at(-1);
      if (last?.what === UNDONE.words) found.push({ kind: 'words', at: last.at });
      else if (last?.what === UNDONE.twin) found.push({ kind: 'twin', at: last.at });
    }
  }
  found.sort((a, b) => b.at - a.at);
  const out: { kind: AutoKind; at: number; count: number }[] = [];
  for (const f of found) {
    const cur = out.at(-1);
    if (cur && cur.kind === f.kind && cur.at - f.at <= GAP) { cur.count++; continue; }
    if (out.length >= limit) break;
    out.push({ ...f, count: 1 });
  }
  return out;
}

/** The tail of a message about a bulk send/approve: how many of the rows were drafts the program wrote (they were not read by the translator yet). */
export const autoNote = (n: number): string => (n ? `. Із них заповнених автоматично: ${n}` : '');
