import type { Entry } from './model';
import type { FileView, SavedProject } from './project';
import { note } from './workflow';

export type SendKind = 'send' | 'approve';
export interface SentItem { file: string; key: string; source: string; target: string; at: number }
/** Rows sent (or approved) together; they can be taken back while nothing was changed in them since. */
export interface SendBatch { kind: SendKind; at: number; items: SentItem[] }

const KIND = (what: string): SendKind | null => (what.startsWith('надіслано на вичитування') ? 'send' : what.startsWith('вичитано') ? 'approve' : null);
const GAP = 3 * 60 * 1000;

/**
 * Batches of sends that can still be undone: a row counts only while its newest history record is the send itself and
 * its status is still the one the send gave it (editing or returning it afterwards means the send is no longer undoable).
 * Records within three minutes of each other form one batch. Newest first.
 */
export function sendBatches(views: FileView[], saved: SavedProject, limit = 20): SendBatch[] {
  const found: (SentItem & { kind: SendKind })[] = [];
  for (const v of views) {
    const ents = saved.files[v.name]; if (!ents) continue;
    for (const u of v.units) {
      const e = ents[u.key]; const last = e?.history?.[e.history.length - 1];
      const kind = last ? KIND(last.what) : null;
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
  return out;
}

/** Take a batch back: sent rows return to drafts, approved rows to «waiting for review». Returns how many changed. */
export function undoBatch(saved: SavedProject, batch: SendBatch, who: string, now: number): number {
  let n = 0;
  for (const it of batch.items) {
    const e: Entry | undefined = saved.files[it.file]?.[it.key];
    const last = e?.history?.[e.history.length - 1];
    if (!e || !last || last.at !== it.at || KIND(last.what) !== batch.kind) continue;
    const back = { ...e, status: batch.kind === 'send' ? 'draft' as const : 'done' as const, mt: now };
    saved.files[it.file]![it.key] = note(back, batch.kind === 'send' ? 'надсилання скасовано' : 'вичитування скасовано', e.target, who, now);
    n++;
  }
  return n;
}
