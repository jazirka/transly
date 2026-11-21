import { readableExtensions, formatOf, isRpgMakerFile, isTextFormat } from '../core';
import type { GameFile } from '../core';
import { isDesktop, pickGameDirDesktop } from './desktop';

/** A file chosen by the user, not read yet. */
export interface PickedFile { name: string; path: string; /** Path relative to the picked folder, with `/`. */ rel?: string; read: () => Promise<string>; /** The text comes from the app's backup of the game's untouched originals. */ fromBackup?: boolean }

export type DirHandle = {
  queryPermission?(o: { mode: 'read' | 'readwrite' }): Promise<string>;
  requestPermission?(o: { mode: 'read' | 'readwrite' }): Promise<string>; name: string; values(): AsyncIterable<{ kind: 'file' | 'directory'; name: string; getFile?: () => Promise<File>; values?: () => AsyncIterable<unknown> }> };
type PickerWindow = Window & { showDirectoryPicker?: () => Promise<DirHandle> };

/** Prefer the File System Access API (Chromium); fall back to a hidden <input webkitdirectory>. */
export interface Picked { files: PickedFile[]; handle: DirHandle | null }

export async function pickGameFolder(input: HTMLInputElement): Promise<Picked | null> {
  if (isDesktop()) { const files = await pickGameDirDesktop(); return files ? { files, handle: null } : null; }
  const w = window as PickerWindow;
  if (w.showDirectoryPicker && !input.dataset.forceInput && !document.documentElement.dataset.forceInput) {
    try {
      const dir = await w.showDirectoryPicker();
      const out: PickedFile[] = [];
      await walk(dir, '', out, 0);
      return { files: choose(out), handle: dir };
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return null;
      // Inside an embedded frame the picker is refused (SecurityError): fall back to the plain folder input.
      if (!(e instanceof DOMException && (e.name === 'SecurityError' || e.name === 'NotAllowedError'))) throw e;
    }
  }
  return new Promise(resolve => {
    input.onchange = () => {
      const files = [...(input.files ?? [])];
      input.value = '';
      if (!files.length) return resolve(null);
      resolve({ files: choose(files.map(f => ({ name: f.name, path: f.webkitRelativePath || f.name, rel: (f.webkitRelativePath || f.name).split('/').slice(1).join('/') || f.name, read: () => f.text() }))), handle: null });
    };
    input.click();
  });
}

async function walk(dir: DirHandle, prefix: string, out: PickedFile[], depth: number): Promise<void> {
  for await (const entry of dir.values()) {
    if (entry.kind === 'file' && isReadable(entry.name) && entry.getFile) {
      // bound to its handle: a native FileSystemFileHandle throws «Illegal invocation» when getFile is called without it
      const getFile = entry.getFile.bind(entry);
      out.push({ name: entry.name, path: prefix + entry.name, rel: prefix + entry.name, read: async () => (await getFile()).text() });
    } else if (entry.kind === 'directory' && depth < 3 && !/^(node_modules|\.)/.test(entry.name)) {
      await walk(entry as unknown as DirHandle, prefix + entry.name + '/', out, depth + 1);
    }
  }
}

const isReadable = (name: string): boolean => readableExtensions().some(e => name.toLowerCase().endsWith(e));

/**
 * Keep files the app can translate. For RPG Maker, prefer the game's data folder when a whole game was picked.
 * Files with the same name in different folders are told apart by their relative path.
 */
function choose(files: PickedFile[]): PickedFile[] {
  const known = files.filter(f => isReadable(f.name) && formatOf({ name: f.name }) !== null);
  const rpg = known.filter(f => isRpgMakerFile(f.name));
  const inData = rpg.filter(f => /(^|\/)data\/[^/]+$/.test(f.path));
  const picked = inData.length ? inData : rpg.length ? rpg : known;
  // RPG Maker files keep their plain names (they live in one data folder). Everything else keeps its folder
  // structure, so a build can be dropped back over the game.
  return picked
    .map(f => (isRpgMakerFile(f.name) ? f : { ...f, name: f.rel ?? f.path }))
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
}

/** A file from an ordinary multi-file picker, under the name the game uses; `text` when it was already read. */
export interface Chosen { file: File; name: string; text?: string }

/** Files chosen with a multi-file picker (a phone has no folder picker): the same selection rules as a folder. */
export function pickFromFiles(items: Chosen[]): PickedFile[] {
  return choose(items.map(i => ({ name: i.name, path: i.name, rel: i.name, read: () => (i.text !== undefined ? Promise.resolve(i.text) : i.file.text()) })));
}

/** Read and parse files one by one so the UI can show progress. Unreadable files are reported, not fatal. */
export async function readFiles(files: PickedFile[], onProgress: (done: number, total: number) => void): Promise<{ files: GameFile[]; failed: string[] }> {
  const out: GameFile[] = [];
  const failed: string[] = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i]!;
    try {
      const raw = await f.read();
      out.push(isTextFormat(formatOf({ name: f.name })) ? { name: f.name, json: null, text: raw } : { name: f.name, json: JSON.parse(raw) });
    } catch { failed.push(f.name); }
    onProgress(i + 1, files.length);
    if (i % 4 === 3) await new Promise(r => setTimeout(r));
  }
  return { files: out, failed };
}

/** Re-read a remembered folder. Must be called from a click, because the browser may ask for permission. */
export async function reopenHandle(handle: DirHandle): Promise<PickedFile[] | null> {
  if (handle.queryPermission && (await handle.queryPermission({ mode: 'read' })) !== 'granted') {
    if (!handle.requestPermission || (await handle.requestPermission({ mode: 'read' })) !== 'granted') return null;
  }
  const out: PickedFile[] = [];
  await walk(handle, '', out, 0);
  return choose(out);
}
