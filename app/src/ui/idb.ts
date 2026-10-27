import { deserialize, serialize } from '../core';
import type { ProjectStore, SavedProject } from '../core';

const DB = 'transly';
const STORE = 'projects';

const open = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
  const req = indexedDB.open(DB, 1);
  req.onupgradeneeded = () => { req.result.createObjectStore(STORE); };
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
