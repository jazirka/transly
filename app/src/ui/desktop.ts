import { invoke } from '@tauri-apps/api/core';
import type { PickedFile } from './folder';

/** True inside the Tauri desktop shell; in a plain browser everything here is unavailable. */
export const isDesktop = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

interface JsonFile { name: string; path: string; orig?: string }

const LS_DIR = 'transly-game-dir';
const LS_EXE = 'transly-game-exe';
/** The game folder and the game's exe belong to a project: each project remembers its own. */
let project = 'default';
export const setProject = (id: string): void => { project = id; migrateGameDirKeys(); };
const k = (base: string): string => `${base}:${project}`;
const get = (k: string): string | null => { try { return localStorage.getItem(k); } catch { return null; } };
const set = (k: string, v: string): void => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

const toPicked = (files: JsonFile[]): PickedFile[] => {
  const json = files.filter(f => f.name.endsWith('.json'));
  // Prefer the game's data folder when a whole game folder was picked.
  const inData = json.filter(f => /(^|[\\/])data[\\/][^\\/]+$/.test(f.path));
  return (inData.length ? inData : json)
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }))
    .map(f => ({ name: f.name, path: f.path, // The game's files may already hold a translation: the originals are read from the app's backup or the game's spare data1.
    read: () => invoke<string>('read_text', { path: f.orig ?? f.path }), fromBackup: !!f.orig }));
};

/** Older versions kept one folder (and game exe) for the whole app. It belongs to a project now: the current project takes the shared one over once, and the shared key is dropped so no other project inherits it. */
export function migrateGameDirKeys(): void {
  for (const base of [LS_DIR, LS_EXE]) {
    const old = get(base);
    if (old === null) continue;
    if (get(k(base)) === null) set(k(base), old);
    try { localStorage.removeItem(base); } catch { /* ignore */ }
  }
}
const read = (base: string): string | null => get(k(base));
export const rememberedGameDir = (): string | null => read(LS_DIR);
export const rememberedExe = (): string | null => read(LS_EXE);

export async function pickGameDirDesktop(): Promise<PickedFile[] | null> {
  const dir = await invoke<string | null>('pick_dir');
  if (!dir) return null;
  set(k(LS_DIR), dir);
  return toPicked(await invoke<JsonFile[]>('list_json', { dir }));
}

/** The remembered game folder, found again for this session (`ok`), or the reason it could not be. `null` when the project has none. */
export type Reopened = { ok: true; root: string; files: PickedFile[] } | { ok: false; root: string; reason: 'missing' | 'failed' };

export async function reopenGameDir(): Promise<Reopened | null> {
  const root = rememberedGameDir();
  if (!root) return null;
  try { await invoke('allow_again', { path: root }); }
  catch (e) { return { ok: false, root, reason: String(e).includes('не існує') ? 'missing' : 'failed' }; }
  try { return { ok: true, root, files: toPicked(await invoke<JsonFile[]>('list_json', { dir: root })) }; }
  catch { return { ok: false, root, reason: 'failed' }; }
}

export async function reopenGameDirDesktop(): Promise<PickedFile[] | null> {
  const r = await reopenGameDir();
  return r?.ok ? r.files : null;
}

/** Forget the folder of the project (the translation and the originals kept in it stay). */
export function forgetGameDir(): void {
  try { localStorage.removeItem(k(LS_DIR)); } catch { /* ignore */ }
}

/** Folder that holds the game's JSON files, from the files that were actually read. */
export function dataDirOf(files: PickedFile[]): string | null {
  const p = files[0]?.path;
  if (!p) return null;
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return i > 0 ? p.slice(0, i) : null;
}

export async function pickExe(): Promise<string | null> {
  const exe = await invoke<string | null>('pick_exe');
  if (exe) set(k(LS_EXE), exe);
  return exe;
}

export async function applyToGame(dataDir: string, files: { name: string; json: unknown; text?: string }[]): Promise<number> {
  return invoke<number>('apply_data', { dataDir, files: files.map(f => ({ name: f.name, content: f.text ?? JSON.stringify(f.json) })) });
}

/** Put the test plugin (js/plugins/TranslyJump.js) into the game so it starts inside one scene. */
export const applyJump = (dataDir: string, source: string): Promise<void> => invoke<void>('apply_jump', { dataDir, source });

/** Take the test plugin out again. True when it was there. */
export const restoreJump = (dataDir: string): Promise<boolean> => invoke<boolean>('restore_jump', { dataDir });

export const restoreGame = (dataDir: string): Promise<number> => invoke<number>('restore_data', { dataDir });

export async function launchGame(): Promise<void> {
  let exe = rememberedExe();
  if (!exe) exe = await pickExe();
  if (!exe) return;
  try { await invoke('allow_again', { path: exe }); } catch { /* picked again below */ }
  try { await invoke('launch', { exe }); }
  catch (e) {
    if (String(e).includes('не знайдено') || String(e).includes('не дозволено')) { const again = await pickExe(); if (again) await invoke('launch', { exe: again }); }
    else throw e;
  }
}

/** A picture from the game folder as bytes, or null when there is no folder or no such file. */
export async function readGameImage(game: string, rel: string): Promise<ArrayBuffer | null> {
  try { return await invoke<ArrayBuffer>('read_image', { game, rel }); } catch { return null; }
}

/** Open a dictionary page in the system browser (the shell checks the address); a plain browser opens a tab. */
export async function openLink(url: string): Promise<void> {
  if (isDesktop()) { try { await invoke('open_url', { url }); } catch { /* refused or no browser */ } return; }
  window.open(url, '_blank', 'noopener,noreferrer');
}
