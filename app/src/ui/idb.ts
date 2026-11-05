import { SCHEMA, deserialize, serialize } from '../core';
import type { ProjectStore, SavedProject } from '../core';

const DB = 'transly';
const STORE = 'projects';
const HANDLES = 'handles';
const SNAPS = 'snapshots';

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

/**
 * One project per browser profile for now; the key is the project id.
 * The game snapshot is large and rarely changes, so it lives in its own record and is only rewritten
 * when it changes. Saving a keystroke therefore stays cheap.
 */
export class IdbStore implements ProjectStore {
  private lastSnap: SavedProject['snapshot'];
  private lastRef: SavedProject['reference'];
  constructor(private id: string) {}

  async load(): Promise<SavedProject | null> {
    const db = await open();
    try {
      const text = await get<string>(db, STORE, this.id);
      if (typeof text !== 'string') return null;
      const p = deserialize(text);
      p.schema = SCHEMA; // what is on this device is read and written by this build
      const snap = await get<SavedProject['snapshot']>(db, SNAPS, this.id);
      if (snap) { p.snapshot = snap; this.lastSnap = snap; }
      const ref = await get<SavedProject['reference']>(db, SNAPS, `${this.id}:ref`);
      if (ref) { p.reference = ref; this.lastRef = ref; }
      return p;
    } finally { db.close(); }
  }

  async save(p: SavedProject): Promise<void> {
    const db = await open();
    const { snapshot, reference, ...rest } = p;
    const writeSnap = snapshot !== undefined && snapshot !== this.lastSnap;
    const writeRef = reference !== this.lastRef;
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction([STORE, SNAPS], 'readwrite');
        tx.objectStore(STORE).put(serialize(rest), this.id);
        if (writeSnap) tx.objectStore(SNAPS).put(snapshot, this.id);
        if (writeRef) { if (reference) tx.objectStore(SNAPS).put(reference, `${this.id}:ref`); else tx.objectStore(SNAPS).delete(`${this.id}:ref`); }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
      if (writeSnap) this.lastSnap = snapshot;
      if (writeRef) this.lastRef = reference;
    } finally { db.close(); }
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
