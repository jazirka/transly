import type { Entry } from './model';
import type { FileView, SavedProject } from './project';
import { note } from './workflow';

export type SendKind = 'send' | 'approve';
export interface SentItem { file: string; key: string; source: string; target: string; at: number; /** No history record of the send: found by the row's change time only. */ guessed?: boolean }
/** Rows sent (or approved) together; they can be taken back while nothing was changed in them since. */
export interface SendBatch { kind: SendKind; at: number; items: SentItem[]; /** True when the rows have no history record of the send (grouped by their change time). */ guessed?: boolean }

const KIND = (what: string): SendKind | null => (what.startsWith('надіслано на вичитування') ? 'send' : what.startsWith('вичитано') ? 'approve' : null);
const GAP = 3 * 60 * 1000;

/**
 * Batches of sends that can still be undone: a row counts only while its newest history record is the send itself and
 * its status is still the one the send gave it (editing or returning it afterwards means the send is no longer undoable).
 * Records within three minutes of each other form one batch. Newest first.
 */
export function sendBatches(views: FileView[], saved: SavedProject, limit = 20): SendBatch[] {
  const found: (SentItem & { kind: SendKind })[] = [], loose: (SentItem & { kind: SendKind })[] = [];
  for (const v of views) {
    const ents = saved.files[v.name]; if (!ents) continue;
    for (const u of v.units) {
      const e = ents[u.key]; const last = e?.history?.[e.history.length - 1];
      const kind = last ? KIND(last.what) : null;
      if (e && e.status === 'done' && !(last && kind === 'send')) { loose.push({ kind: 'send', file: v.name, key: u.key, source: u.source, target: e.target, at: e.mt, guessed: true }); continue; }
      if (!e || !last || !kind) continue;
      if (kind === 'send' ? e.status !== 'done' : e.status !== 'appr') continue;
      found.push({ kind, file: v.name, key: u.key, source: u.source, target: e.target, at: last.at });
    }
  }
  found.sort((a, b) => b.at - a.at);
  const out: SendBatch[] = [];
  for (const f of found) {
    const cur = out[out.length - 1];
    const item: SentItem = { file: f.file, key: f.key, source: f.source, target: f.target, at: f.at };
    if (cur && cur.kind === f.kind && cur.items[cur.items.length - 1]!.at - f.at <= GAP) cur.items.push(item);
    else { if (out.length >= limit) break; out.push({ kind: f.kind, at: f.at, items: [item] }); }
  }
  // Rows waiting for review without a record of the send (sent by an older version, or the history was lost): by change time.
  loose.sort((a, b) => b.at - a.at);
  const guessed: SendBatch[] = [];
  for (const f of loose) {
    const cur = guessed[guessed.length - 1];
    const item: SentItem = { file: f.file, key: f.key, source: f.source, target: f.target, at: f.at, guessed: true };
    if (cur && cur.items[cur.items.length - 1]!.at - f.at <= GAP) cur.items.push(item);
    else guessed.push({ kind: 'send', at: f.at, items: [item], guessed: true });
  }
  return [...out, ...guessed].sort((a, b) => b.at - a.at).slice(0, limit);
}

/** Take a batch back: sent rows return to drafts, approved rows to «waiting for review». Returns how many changed. */
export function undoBatch(saved: SavedProject, batch: SendBatch, who: string, now: number): number {
  let n = 0;
  for (const it of batch.items) {
    const e: Entry | undefined = saved.files[it.file]?.[it.key];
    const last = e?.history?.[e.history.length - 1];
    if (!e) continue;
    if (it.guessed) { if (e.status !== 'done' || e.mt !== it.at) continue; }
    else if (!last || last.at !== it.at || KIND(last.what) !== batch.kind) continue;
    const back = { ...e, status: batch.kind === 'send' ? 'draft' as const : 'done' as const, mt: now };
    saved.files[it.file]![it.key] = note(back, batch.kind === 'send' ? 'надсилання скасовано' : 'вичитування скасовано', e.target, who, now);
    n++;
  }
  return n;
}
