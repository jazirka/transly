import { ExtHost, i18n, plugins } from '../core';
import type { PluginStore, StoredPlugin } from '../core';
import { startDomTranslation } from './i18n-dom';

/**
 * The plugins of the application, as the page sees them: the host that installs and loads them, where they are kept (IndexedDB, its own database, so
 * the project's database is untouched), and the language of the interface that is kept between sessions.
 */

const DB = 'transly-plugins', STORE = 'plugins';

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { r.result.createObjectStore(STORE, { keyPath: 'id' }); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
const done = <T>(r: IDBRequest<T>): Promise<T> => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export class IdbPluginStore implements PluginStore {
  private db: Promise<IDBDatabase> | null = null;
  private conn(): Promise<IDBDatabase> { return (this.db ??= open()); }
  async all(): Promise<StoredPlugin[]> { const db = await this.conn(); return done(db.transaction(STORE).objectStore(STORE).getAll() as IDBRequest<StoredPlugin[]>); }
  async put(p: StoredPlugin): Promise<void> { const db = await this.conn(); await done(db.transaction(STORE, 'readwrite').objectStore(STORE).put(p)); }
  async remove(id: string): Promise<void> { const db = await this.conn(); await done(db.transaction(STORE, 'readwrite').objectStore(STORE).delete(id)); }
}

export const ext = new ExtHost(plugins, new IdbPluginStore());

const LANG = 'transly.lang';
const read = (k: string): string | null => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string): void => { try { localStorage.setItem(k, v); } catch { /* not kept */ } };

/** The language of the interface (kept on this device). */
export function setInterfaceLanguage(code: string): void { write(LANG, code); i18n.setLanguage(code); }
export const interfaceLanguage = (): string => i18n.language;

/** What the installed plugins reported when the application started (for the notice on the screen). */
export let startupProblems: { id: string; message: string }[] = [];

/** Load the installed plugins and set the language. Never throws: an application that cannot read its plugins is still an application. */
export async function initExt(): Promise<void> {
  ext.restoreBuiltinState();
  try { startupProblems = (await ext.init()).problems; } catch (e) { startupProblems = [{ id: '*', message: e instanceof Error ? e.message : String(e) }]; }
  const want = read(LANG);
  if (want) i18n.setLanguage(want);
  startDomTranslation();
}
