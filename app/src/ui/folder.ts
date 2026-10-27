import type { GameFile } from '../core';

/** A file chosen by the user, not read yet. */
export interface PickedFile { name: string; path: string; read: () => Promise<string> }

type DirHandle = { name: string; values(): AsyncIterable<{ kind: 'file' | 'directory'; name: string; getFile?: () => Promise<File>; values?: () => AsyncIterable<unknown> }> };
type PickerWindow = Window & { showDirectoryPicker?: () => Promise<DirHandle> };

/** Prefer the File System Access API (Chromium); fall back to a hidden <input webkitdirectory>. */
export async function pickGameFolder(input: HTMLInputElement): Promise<PickedFile[] | null> {
  const w = window as PickerWindow;
  if (w.showDirectoryPicker && !input.dataset.forceInput) {
    try {
      const dir = await w.showDirectoryPicker();
      const out: PickedFile[] = [];
      await walk(dir, '', out, 0);
      return choose(out);
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return null;
      throw e;
    }
  }
  return new Promise(resolve => {
    input.onchange = () => {
      const files = [...(input.files ?? [])];
      input.value = '';
      if (!files.length) return resolve(null);
      resolve(choose(files.map(f => ({ name: f.name, path: f.webkitRelativePath || f.name, read: () => f.text() }))));
    };
    input.click();
  });
}

async function walk(dir: DirHandle, prefix: string, out: PickedFile[], depth: number): Promise<void> {
  for await (const entry of dir.values()) {
    if (entry.kind === 'file' && entry.name.endsWith('.json') && entry.getFile) {
      const getFile = entry.getFile;
      out.push({ name: entry.name, path: prefix + entry.name, read: async () => (await getFile()).text() });
    } else if (entry.kind === 'directory' && depth < 3 && !/^(node_modules|\.)/.test(entry.name)) {
      await walk(entry as unknown as DirHandle, prefix + entry.name + '/', out, depth + 1);
    }
  }
}

/** Keep only the game's data folder when the user picked the game root. */
function choose(files: PickedFile[]): PickedFile[] {
  const json = files.filter(f => f.name.endsWith('.json'));
  const inData = json.filter(f => /(^|\/)data\/[^/]+$/.test(f.path));
  return (inData.length ? inData : json).sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
}

/** Read and parse files one by one so the UI can show progress. Unreadable files are reported, not fatal. */
export async function readFiles(files: PickedFile[], onProgress: (done: number, total: number) => void): Promise<{ files: GameFile[]; failed: string[] }> {
  const out: GameFile[] = [];
  const failed: string[] = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i]!;
    try { out.push({ name: f.name, json: JSON.parse(await f.read()) }); }
    catch { failed.push(f.name); }
    onProgress(i + 1, files.length);
    if (i % 4 === 3) await new Promise(r => setTimeout(r));
  }
  return { files: out, failed };
}
