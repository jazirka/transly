import { createZip, fileText, isRpgMakerFile } from '../core';
import { saveFile } from './save';
import type { BuildResult } from '../core';

type FsDir = { getDirectoryHandle(name: string, o: { create: boolean }): Promise<FsDir>; getFileHandle(name: string, o: { create: boolean }): Promise<{ createWritable(): Promise<{ write(d: string | Uint8Array): Promise<void>; close(): Promise<void> }> }> };
type SaveWindow = Window & { showDirectoryPicker?: (o?: { mode: 'readwrite' }) => Promise<FsDir> };

export const canWriteFolder = (): boolean => !!(window as SaveWindow).showDirectoryPicker;

/** Write changed files into a folder the user picks. Returns false when the picker was cancelled. */
export async function writeToFolder(result: BuildResult): Promise<boolean> {
  const w = window as SaveWindow;
  if (!w.showDirectoryPicker) throw new Error('Браузер не вміє записувати в папку');
  let dir: FsDir;
  try { dir = await w.showDirectoryPicker({ mode: 'readwrite' }); }
  catch (e) { if (e instanceof DOMException && e.name === 'AbortError') return false; throw e; }
  for (const f of result.files) {
    // Names with a folder part (same file name in several folders) are written into sub-folders.
    const parts = f.name.split('/');
    let d = dir;
    for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p, { create: true });
    const h = await d.getFileHandle(parts[parts.length - 1]!, { create: true });
    const w2 = await h.createWritable();
    await w2.write(fileText(f));
    await w2.close();
  }
  return true;
}

/** Download the changed files as one ZIP (works in every browser). */
export async function downloadZip(result: BuildResult, name = 'transly-build.zip'): Promise<boolean> {
  const enc = new TextEncoder();
  const zip = createZip(result.files.map(f => ({ name: isRpgMakerFile(f.name) ? `data/${f.name}` : f.name, data: enc.encode(fileText(f)) })));
  return saveFile(name, zip, 'application/zip');
}
