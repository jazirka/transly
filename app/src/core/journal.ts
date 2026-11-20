import type { Entry, HistoryItem } from './model';
import type { FileView, SavedProject } from './project';
import { rows } from './plural';
import { HISTORY_LIMIT } from './workflow';

/**
 * The journal of bulk actions. Every row an action touches gets a history record that carries the id of the action
 * (`batch`) and what the row was before (`prev`). From that the whole action can be listed, taken back and repeated,
 * for any kind of action, without a separate undo stack: the data lives in the rows and travels with the project.
 */
export type Prev = NonNullable<HistoryItem['prev']>;

/** What a bulk action is. The kind is the part of the batch id before the colon. */
export type BatchKind = 'edit' | 'send' | 'approve' | 'scene' | 'words' | 'twin' | 'replace' | 'unify' | 'memory' | 'wrap' | 'clear' | 'copy' | 'back' | 'link' | 'term' | 'fix' | 'reconcile' | 'rekey' | 'merge' | 'undo' | 'redo';

/** The history text and the feed title of each kind of action. */
export const BATCH_INFO: Record<BatchKind, { what: string; title: (n: string) => string }> = {
  edit: { what: 'змінено переклад', title: n => `Змінено переклад: ${n}` },
  send: { what: 'надіслано', title: n => `Надіслано: ${n}` },
  approve: { what: 'вичитано', title: n => `Вичитано: ${n}` },
  scene: { what: 'надіслано (вся сцена)', title: n => `Надіслано сцену: ${n}` },
  words: { what: 'автозаповнено за словами', title: n => `Автозаповнення за словами: ${n}` },
  twin: { what: 'підставлено з однакового рядка', title: n => `Підставлено з однакових рядків: ${n}` },
  replace: { what: 'знайти й замінити', title: n => `Знайдено й замінено: ${n}` },
  unify: { what: 'узгоджено з іншими', title: n => `Узгоджено переклади: ${n}` },
  memory: { what: 'підставлено з пам’яті перекладів', title: n => `Підставлено з пам’яті: ${n}` },
  wrap: { what: 'перенесено рядки', title: n => `Перенесено рядки: ${n}` },
  clear: { what: 'очищено переклад', title: n => `Очищено переклади: ${n}` },
  copy: { what: 'вставлено оригінал', title: n => `Вставлено оригінал: ${n}` },
  back: { what: 'повернуто на доопрацювання', title: n => `Повернуто на доопрацювання: ${n}` },
  link: { what: 'автозаповнено з однакового рядка', title: n => `Автозаповнення з однакових рядків: ${n}` },
  term: { what: 'змінено термін', title: n => `Змінено переклад терміна: ${n}` },
  fix: { what: 'виправлено за правилом', title: n => `Виправлено за правилом: ${n}` },
  reconcile: { what: 'оригінал змінився: повернуто в чернетки', title: n => `Оригінал змінився, повернуто в чернетки: ${n}` },
  rekey: { what: 'зіставлено з новою версією гри', title: n => `Переклади зіставлено з новою версією гри: ${n}` },
  merge: { what: 'злито з іншої гілки', title: n => `Злито з іншої гілки: ${n}` },
  undo: { what: 'скасовано', title: n => `Скасовано дію: ${n}` },
  redo: { what: 'повторено', title: n => `Повторено дію: ${n}` },
};

export const prevOf = (e: Entry | undefined): Prev => ({ target: e?.target ?? '', status: e?.status ?? 'new', ...(e?.returned ? { returned: true } : {}) });

const rand = (): string => Math.floor(Math.random() * 46656).toString(36).padStart(3, '0');

/** A new id for a bulk action: `send:lq3k2a9fx2a`. */
export const newBatch = (kind: BatchKind, now: number): string => `${kind}:${now.toString(36)}${rand()}`;
export const kindOfBatch = (id: string): string => id.slice(0, Math.max(0, id.indexOf(':')));

/**
 * A row after a change, with a history record that says what was done, to which text and what the row was before.
 * `after` is the new state (made from `before`); `batch` ties the record to a bulk action.
 */
export function recordChange(before: Entry | undefined, after: Entry, what: string, text: string, who: string, now: number, batch?: string): Entry {
  // a device whose clock is behind the row's last edit still makes a newer one (and the record is dated with it, so the row counts as untouched)
  const mt = before && after.mt < before.mt ? before.mt + 1 : after.mt;
  const rec: HistoryItem = { at: Math.max(now, mt), who, what, text, prev: prevOf(before), ...(batch ? { batch } : {}) };
  return { ...after, mt, history: [...(after.history ?? before?.history ?? []), rec].slice(-HISTORY_LIMIT) };
}

export interface JournalItem { file: string; key: string; source: string; target: string; at: number }
export interface JournalBatch {
  id: string;
  kind: string;
  at: number;
  /** Rows that are still as the action left them: only these can be taken back. */
  items: JournalItem[];
  /** All rows that carry a record of the action, also those changed since (as far as their history reaches). */
  total: number;
  /** Text of the history record, e.g. what a feed line should call it. */
  what: string;
}

/**
 * Is the row still as the record left it? Typing in a row writes no history record, but it moves `mt` past the time of
 * the last record, so a row edited afterwards is not taken back (that would wipe what was typed).
 */
export const untouched = (e: Entry, rec: HistoryItem): boolean => e.mt <= rec.at;

/** How many of the newest history records of a row are searched for an action (it is the newest one while the row is untouched). */
const DEPTH = 8;

/**
 * The bulk actions that can still be taken back, newest first. A row belongs to an action while its newest history
 * record is that action's record; later changes take it out (and count only in `total`).
 */
export function journalBatches(views: FileView[], saved: SavedProject, limit = 30): JournalBatch[] {
  const by = new Map<string, JournalBatch>();
  const get = (id: string, rec: HistoryItem): JournalBatch => {
    let b = by.get(id);
    if (!b) by.set(id, b = { id, kind: kindOfBatch(id), at: rec.at, items: [], total: 0, what: rec.what });
    return b;
  };
  for (const v of views) {
    const ents = saved.files[v.name]; if (!ents) continue;
    for (const u of v.units) {
      const h = ents[u.key]?.history; if (!h?.length) continue;
      const last = h[h.length - 1]!;
      const seen = new Set<string>();
      for (let i = h.length - 1; i >= 0 && i >= h.length - DEPTH; i--) {
        const rec = h[i]!;
        if (!rec.batch || seen.has(rec.batch)) continue;
        seen.add(rec.batch);
        const b = get(rec.batch, rec);
        b.total++;
        b.at = Math.max(b.at, rec.at);
        if (rec === last && rec.prev && untouched(ents[u.key]!, rec)) b.items.push({ file: v.name, key: u.key, source: u.source, target: ents[u.key]!.target, at: rec.at });
      }
    }
  }
  return [...by.values()].filter(b => b.items.length).sort((a, b) => b.at - a.at).slice(0, limit);
}

export interface UndoResult { done: number; skipped: number; kind: string; /** Id of the new action that records the undo (undo it to repeat). */ batch: string }

/**
 * Take an action back (or, for an undo, repeat it): every row that is still as the action left it returns to what it was
 * before, and the return is itself an action in the journal. `skipped` counts rows that were changed since and stay as they are.
 */
export function undoJournal(saved: SavedProject, id: string, who: string, now: number): UndoResult {
  const kind = kindOfBatch(id) === 'undo' ? 'redo' : 'undo';
  const batch = newBatch(kind, now);
  let done = 0, total = 0;
  for (const ents of Object.values(saved.files)) {
    for (const [key, e] of Object.entries(ents)) {
      const h = e.history; if (!h?.length) continue;
      let has = false;
      for (let i = h.length - 1; i >= 0 && i >= h.length - DEPTH; i--) if (h[i]!.batch === id) { has = true; break; }
      if (!has) continue;
      total++;
      const last = h[h.length - 1]!;
      if (last.batch !== id || !last.prev || !untouched(e, last)) continue;
      const restored: Entry = { ...e, target: last.prev.target, status: last.prev.status, returned: !!last.prev.returned, mt: now };
      if (!restored.target) delete restored.orig;
      const base = last.what.replace(/^(скасовано|повторено): /, '');
      ents[key] = recordChange(e, restored, `${BATCH_INFO[kind].what}: ${base}`, restored.target, who, now, batch);
      done++;
    }
  }
  return { done, skipped: total - done, kind: kindOfBatch(id), batch };
}

export interface RowChange {
  file: string; key: string;
  /** The row as it should be after the action (made with `edit`, `submit`…). */
  next: Entry;
  /** What the history shows for this row (usually the new translation). */
  text: string;
  /** The history record's own wording, when it differs from the action's (e.g. the score of a memory match). */
  what?: string;
}

/**
 * Write many rows as one action. `entries` gives the translations of a file (the project's own, or a view that writes
 * through to it). Returns the id of the action, which `undoJournal` takes back.
 */
export function commitRows(entries: (file: string) => Record<string, Entry>, changes: RowChange[], kind: BatchKind, who: string, now: number, what: string = BATCH_INFO[kind].what): string {
  const batch = newBatch(kind, now);
  for (const c of changes) { const ents = entries(c.file); ents[c.key] = recordChange(ents[c.key], c.next, c.what ?? what, c.text, who, now, batch); }
  return batch;
}

const cap = (t: string): string => t.charAt(0).toUpperCase() + t.slice(1);

/** The feed line of an action: what was done and to how many rows. */
export function batchTitle(b: JournalBatch): string {
  const n = rows(b.items.length);
  if (b.kind === 'undo' || b.kind === 'redo') {
    const [verb, ...rest] = b.what.split(': ');
    return `${cap(verb ?? b.what)} «${rest.join(': ')}»: ${n}`;
  }
  const info = (BATCH_INFO as Record<string, (typeof BATCH_INFO)[BatchKind] | undefined>)[b.kind];
  return info ? info.title(n) : `${cap(b.what)}: ${n}`;
}

/** What the button that takes the action back says: an undo is repeated, anything else is undone. */
export const batchUndoLabel = (b: JournalBatch): string => (b.kind === 'undo' ? 'Повторити' : 'Скасувати');

/** The sentence after an undo: how many rows went back and how many were changed since and stayed. */
export function undoReport(r: UndoResult): string {
  const n = rows(r.done);
  const again = r.kind === 'undo';
  const what = (BATCH_INFO as Record<string, { what: string } | undefined>)[r.kind]?.what;
  const head = again ? `Повторено: ${n}` : `Скасовано${what ? ` «${what}»` : ''}: ${n}`;
  return r.skipped ? `${head}. Ще ${rows(r.skipped)} змінено після дії, їх не чіпав` : head;
}
