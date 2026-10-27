import { deserialize, serialize } from '../core';
import type { ProjectStore, SavedProject } from '../core';

const DB = 'transly';
const STORE = 'projects';
const HANDLES = 'handles';

const open = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
  const req = indexedDB.open(DB, 2);
  req.onupgradeneeded = () => {
    const db = req.result;
    if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    if (!db.objectStoreNames.contains(HANDLES)) db.createObjectStore(HANDLES);
  };
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

/** One project per browser profile for now; the key is the project id. */
export class IdbStore implements ProjectStore {
  constructor(private id: string) {}
  async load(): Promise<SavedProject | null> {
    const db = await open();
    return new Promise((resolve, reject) => {
      const r = db.transaction(STORE).objectStore(STORE).get(this.id);
      r.onsuccess = () => { db.close(); resolve(typeof r.result === 'string' ? deserialize(r.result) : null); };
      r.onerror = () => { db.close(); reject(r.error); };
    });
  }
  async save(p: SavedProject): Promise<void> {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(serialize(p), this.id);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
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
