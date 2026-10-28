import { invoke } from '@tauri-apps/api/core';
import type { PickedFile } from './folder';

/** True inside the Tauri desktop shell; in a plain browser everything here is unavailable. */
export const isDesktop = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

interface JsonFile { name: string; path: string; orig?: string }

const LS_DIR = 'transly-game-dir';
const LS_EXE = 'transly-game-exe';
const get = (k: string): string | null => { try { return localStorage.getItem(k); } catch { return null; } };
const set = (k: string, v: string): void => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

const toPicked = (files: JsonFile[]): PickedFile[] => {
  const json = files.filter(f => f.name.endsWith('.json'));
  // Prefer the game's data folder when a whole game folder was picked.
  const inData = json.filter(f => /(^|[\\/])data[\\/][^\\/]+$/.test(f.path));
  return (inData.length ? inData : json)
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }))
    .map(f => ({ name: f.name, path: f.path, // The game's files may already hold a translation: the originals are read from the backup the app made.
    read: () => invoke<string>('read_text', { path: f.orig ?? f.path }), fromBackup: !!f.orig }));
};

export const rememberedGameDir = (): string | null => get(LS_DIR);
export const rememberedExe = (): string | null => get(LS_EXE);

export async function pickGameDirDesktop(): Promise<PickedFile[] | null> {
  const dir = await invoke<string | null>('pick_dir');
  if (!dir) return null;
  set(LS_DIR, dir);
  return toPicked(await invoke<JsonFile[]>('list_json', { dir }));
}

export async function reopenGameDirDesktop(): Promise<PickedFile[] | null> {
  const dir = get(LS_DIR);
  if (!dir) return null;
  try { await invoke('allow_again', { path: dir }); } catch { return null; }
  return toPicked(await invoke<JsonFile[]>('list_json', { dir }));
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
  if (exe) set(LS_EXE, exe);
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
  let exe = get(LS_EXE);
  if (!exe) exe = await pickExe();
  if (!exe) return;
  try { await invoke('allow_again', { path: exe }); } catch { /* picked again below */ }
  try { await invoke('launch', { exe }); }
  catch (e) {
    if (String(e).includes('не знайдено') || String(e).includes('не дозволено')) { const again = await pickExe(); if (again) await invoke('launch', { exe: again }); }
    else throw e;
  }
}
