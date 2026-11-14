import { deserialize, mergeProjects, serialize } from './project';
import type { SavedProject } from './project';

/**
 * A write to IndexedDB is asynchronous and a page that is closed, reloaded or navigated away from a moment after the last
 * keystroke may not live to finish it. The page therefore also puts the rows changed since the last confirmed save into a
 * small synchronous store (localStorage) at the moment it is going away: the next start merges them back in (the later
 * mark wins, as in any merge) and the first confirmed save clears them.
 */

/** The part of `localStorage` that is used (so that tests need no browser). */
export interface KeyValue { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }

/** What an `Autosave` calls when the page is going away with unsaved work, and when a save has gone through. */
export interface Rescue { write(p: SavedProject, since: number): void; clear(): void }

const keyOf = (id: string): string => `transly:outbox:${id}`;

/**
 * The project without the game snapshot, holding only the rows (and memory records and terms) marked at or after `since`.
 * Rows that were saved already may come along (the caller adds slack to `since`): merging them back changes nothing.
 */
export function changedSince(p: SavedProject, since: number): SavedProject {
  const files: SavedProject['files'] = {};
  for (const [name, rows] of Object.entries(p.files)) {
    let out: typeof rows | undefined;
    for (const [key, e] of Object.entries(rows)) if (e.mt >= since) (out ??= {})[key] = e;
    if (out) files[name] = out;
  }
  const { snapshot: _snapshot, reference: _reference, ...rest } = p;
  return { ...rest, files, memory: p.memory.filter(m => m.mt >= since), terms: p.terms.filter(t => t.mt >= since) };
}

/** Keep the changes in the outbox; false when the browser refused (quota, private mode). */
export function writeOutbox(kv: KeyValue, id: string, p: SavedProject, since: number): boolean {
  try { kv.setItem(keyOf(id), serialize(changedSince(p, since))); return true; } catch { return false; }
}

export function clearOutbox(kv: KeyValue, id: string): void {
  try { kv.removeItem(keyOf(id)); } catch { /* nothing to clear */ }
}

/** The ready-made `Rescue` for one project id. */
export const outboxRescue = (kv: KeyValue, id: string): Rescue => ({ write: (p, since) => { writeOutbox(kv, id, p, since); }, clear: () => clearOutbox(kv, id) });

/**
 * What the previous session left in the outbox, merged into `loaded`; null when there is nothing (or nothing that the
 * stored project does not have already: the outbox is then cleared). `rows` is how many rows came back.
 */
export function takeOutbox(kv: KeyValue, id: string, loaded: SavedProject, now: number): { project: SavedProject; rows: number } | null {
  let text: string | null;
  try { text = kv.getItem(keyOf(id)); } catch { return null; }
  if (!text) return null;
  try {
    const part = deserialize(text, now);
    let rows = 0;
    for (const [name, rs] of Object.entries(part.files)) for (const [key, e] of Object.entries(rs)) { const have = loaded.files[name]?.[key]; if (!have || e.mt > have.mt) rows++; }
    for (const m of part.memory) if (!loaded.memory.some(x => x.s === m.s && x.t === m.t && x.mt >= m.mt)) rows++;
    for (const t of part.terms) { const have = loaded.terms.find(x => x.en.toLowerCase() === t.en.toLowerCase()); if (!have || t.mt > have.mt) rows++; }
    if (!rows) { clearOutbox(kv, id); return null; }
    return { project: mergeProjects(loaded, part).project, rows };
  } catch { return null; }
}
