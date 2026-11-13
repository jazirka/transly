import { SCHEMA, deserialize, mergeProjects, serialize } from '../core';
import type { ProjectStore, SavedProject } from '../core';

const DB = 'transly';
const STORE = 'projects';
const HANDLES = 'handles';
const SNAPS = 'snapshots';
/** How often the record that is about to be replaced is also kept as a copy (`<id>:bak`), at most. */
const BAK_EVERY_MS = 5 * 60 * 1000;

const open = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
  const req = indexedDB.open(DB, 3);
  req.onupgradeneeded = () => {
    const db = req.result;
    if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    if (!db.objectStoreNames.contains(HANDLES)) db.createObjectStore(HANDLES);
    if (!db.objectStoreNames.contains(SNAPS)) db.createObjectStore(SNAPS);
  };
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

const get = <T>(db: IDBDatabase, store: string, key: string): Promise<T | undefined> => new Promise((resolve, reject) => {
  const r = db.transaction(store).objectStore(store).get(key);
  r.onsuccess = () => resolve(r.result as T | undefined);
  r.onerror = () => reject(r.error);
});

/** The stored project exists but cannot be read (a newer layout, damaged text). It carries the raw record so nothing is lost. */
export class LoadFailure extends Error {
  constructor(readonly reason: string, readonly raw: string) { super(reason); this.name = 'LoadFailure'; }
}

/**
 * One project per browser profile for now; the key is the project id.
 * The game snapshot is large and rarely changes, so it lives in its own record and is only rewritten
 * when it changes. Saving a keystroke therefore stays cheap.
 */
export class IdbStore implements ProjectStore {
  private lastSnap: SavedProject['snapshot'];
  private lastRef: SavedProject['reference'];
  /** Whether a save has already made sure that no stale snapshot is stored for a project that has none. */
  private snapChecked = false;
  /** Set when the stored project could not be read: nothing may be written over it until the translator decides what to do. */
  private locked = false;
  /**
   * The revision of the stored project as this page last saw it (the record `<id>:meta`, bumped by every write). A write that finds a
   * higher one knows another tab or window has written meanwhile, and merges its data instead of overwriting it.
   */
  private rev = 0;
  private lastBak = 0;
  /** Called after a write that found and merged what another tab had written: the page should take the merged project over. */
  onForeign: ((merged: SavedProject) => void) | null = null;
  constructor(private id: string) {}

  /** Keep the unreadable record under a separate key and allow writing again (the app then starts an empty project). */
  async releaseAfterBackup(raw: string): Promise<void> {
    if (!raw) { this.locked = false; return; }
    const db = await open();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(SNAPS, 'readwrite');
        tx.objectStore(SNAPS).put(raw, `${this.id}:unreadable:${new Date().toISOString()}`);
        tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
      });
    } finally { db.close(); }
    this.locked = false;
  }

  async load(): Promise<SavedProject | null> {
    const why = (e: unknown): string => (e instanceof Error ? e.message : String(e));
    let db: IDBDatabase;
    try { db = await open(); } catch (e) { this.locked = true; throw new LoadFailure(`сховище браузера недоступне (${why(e)})`, ''); }
    try {
      // the revision first: a write between the two reads only makes the next save merge once more
      this.rev = (await get<{ rev?: number }>(db, SNAPS, `${this.id}:meta`))?.rev ?? 0;
      const text = await get<string>(db, STORE, this.id);
      if (typeof text !== 'string') return null;
      let p: SavedProject;
      try { p = deserialize(text, Date.now()); }
      catch (e) { this.locked = true; throw new LoadFailure(why(e), text); }
      p.schema = SCHEMA; // what is on this device is read and written by this build
      const snap = await get<SavedProject['snapshot']>(db, SNAPS, this.id);
      if (snap) { p.snapshot = snap; this.lastSnap = snap; }
      const ref = await get<SavedProject['reference']>(db, SNAPS, `${this.id}:ref`);
      if (ref) { p.reference = ref; this.lastRef = ref; }
      return p;
    } catch (e) {
      if (e instanceof LoadFailure) throw e;
      this.locked = true;
      throw new LoadFailure(`сховище браузера не відповіло (${why(e)})`, '');
    } finally { db.close(); }
  }

  async save(p: SavedProject): Promise<void> {
    if (this.locked) throw new Error('Збережений проєкт не прочитано: новий запис не зроблено, щоб не втратити старий');
    const db = await open();
    const { snapshot, reference, ...rest } = p;
    const writeSnap = snapshot !== undefined && snapshot !== this.lastSnap;
    // A project without a snapshot (after "Скинути проєкт", or one that never had a game) must not keep the old game's
    // snapshot in the store: the next load would bring the old game back. Deleting a missing key is free, so it is done
    // once for a fresh page and again only after a snapshot was written or loaded.
    const dropSnap = snapshot === undefined && (this.lastSnap !== undefined || !this.snapChecked);
    const writeRef = reference !== this.lastRef;
    const metaKey = `${this.id}:meta`, bakDue = Date.now() - this.lastBak > BAK_EVERY_MS;
    const out: { foreign: SavedProject | null; rev: number } = { foreign: null, rev: this.rev };
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction([STORE, SNAPS], 'readwrite');
        const projects = tx.objectStore(STORE), snaps = tx.objectStore(SNAPS);
        const finish = (text: string, rev: number): void => {
          projects.put(text, this.id);
          if (writeSnap) snaps.put(snapshot, this.id);
          else if (dropSnap) snaps.delete(this.id);
          if (writeRef) { if (reference) snaps.put(reference, `${this.id}:ref`); else snaps.delete(`${this.id}:ref`); }
          snaps.put({ rev, at: Date.now() }, metaKey);
          out.rev = rev;
        };
        // Everything below runs inside one read-write transaction, which the browser runs one at a time: whoever writes second
        // sees the first one's revision, so two tabs can never overwrite each other's work unseen.
        const metaReq = snaps.get(metaKey);
        metaReq.onsuccess = () => {
          const stored = (metaReq.result as { rev?: number } | undefined)?.rev ?? 0;
          if (stored === this.rev && !bakDue) { finish(serialize(rest), stored + 1); return; }
          const prevReq = projects.get(this.id);
          prevReq.onsuccess = () => {
            const prev = prevReq.result as unknown;
            let text = serialize(rest);
            if (stored !== this.rev && typeof prev === 'string') {
              try { const merged = mergeProjects(deserialize(prev, Date.now()), rest as SavedProject).project; out.foreign = merged; text = serialize(merged); }
              catch { /* the other record cannot be read: ours is written and theirs is kept as the copy below */ }
            }
            if (typeof prev === 'string') snaps.put(prev, `${this.id}:bak`);
            finish(text, stored + 1);
          };
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
      this.rev = out.rev;
      if (bakDue) this.lastBak = Date.now();
      if (writeSnap) this.lastSnap = snapshot;
      if (dropSnap) { this.lastSnap = undefined; this.snapChecked = true; }
      if (writeRef) this.lastRef = reference;
    } finally { db.close(); }
    if (out.foreign) this.onForeign?.(out.foreign);
  }
}

/** Remember the game folder between sessions (File System Access handles can be stored in IndexedDB). */
export async function saveHandle(id: string, handle: unknown): Promise<void> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(HANDLES, 'readwrite');
    tx.objectStore(HANDLES).put(handle, id);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export async function loadHandle(id: string): Promise<unknown> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const r = db.transaction(HANDLES).objectStore(HANDLES).get(id);
    r.onsuccess = () => { db.close(); resolve(r.result ?? null); };
    r.onerror = () => { db.close(); reject(r.error); };
  });
}
