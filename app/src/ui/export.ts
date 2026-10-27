import { createZip } from '../core';
import type { BuildResult } from '../core';

type FsDir = { getFileHandle(name: string, o: { create: boolean }): Promise<{ createWritable(): Promise<{ write(d: string | Uint8Array): Promise<void>; close(): Promise<void> }> }> };
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
    const h = await dir.getFileHandle(f.name, { create: true });
    const w2 = await h.createWritable();
    await w2.write(JSON.stringify(f.json));
    await w2.close();
  }
  return true;
}

/** Download the changed files as one ZIP (works in every browser). */
export function downloadZip(result: BuildResult, name = 'transly-build.zip'): void {
  const enc = new TextEncoder();
  const zip = createZip(result.files.map(f => ({ name: `data/${f.name}`, data: enc.encode(JSON.stringify(f.json)) })));
  const url = URL.createObjectURL(new Blob([zip as BlobPart], { type: 'application/zip' }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
