import { createZip, fileText, isRpgMakerFile } from '../core';
import { el, esc } from './dom';
import { showDialog } from './modal';
import { saveFile } from './save';
import type { BuildResult } from '../core';

type FsFile = { createWritable(): Promise<{ write(d: string | Uint8Array): Promise<void>; close(): Promise<void> }>; getFile?(): Promise<{ text(): Promise<string> }> };
type FsDir = { name?: string; resolve?(possibleDescendant: unknown): Promise<string[] | null>; getDirectoryHandle(name: string, o: { create: boolean }): Promise<FsDir>; getFileHandle(name: string, o: { create: boolean }): Promise<FsFile> };
type SaveWindow = Window & { showDirectoryPicker?: (o?: { mode: 'readwrite' }) => Promise<FsDir> };

export const canWriteFolder = (): boolean => !!(window as SaveWindow).showDirectoryPicker;

/** Folder of the files written by an earlier build: the translator chose it for the output, so replacing its files is expected. */
const MARKER = '.transly-build';
/** Where the original of a replaced file is kept (the first one only), inside the chosen folder. */
const ORIG = '.transly-orig';

async function fileIn(dir: FsDir, rel: string): Promise<FsFile | null> {
  try {
    const parts = rel.split('/');
    let d = dir;
    for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p, { create: false });
    return await d.getFileHandle(parts[parts.length - 1]!, { create: false });
  } catch { return null; }
}

/** Ask before the build replaces the files of a game; resolves true only when the translator chooses to go on. */
function confirmReplace(folder: string, n: number, inGame: boolean): Promise<boolean> {
  return new Promise(resolve => {
    const dlg = el('dialog', 'adlg');
    dlg.setAttribute('aria-labelledby', 'xo-t');
    dlg.innerHTML = `<form method="dialog"><h2 id="xo-t">У цій папці вже є файли гри</h2>
      <p class="hint">${inGame ? `Папка «${esc(folder)}» — частина гри, з якої ви відкрили проєкт.` : `У папці «${esc(folder)}» уже є файли з такими самими назвами (${n}).`} Збірка замінить їх перекладеними. Перед заміною кожен оригінал буде збережено в підпапці «${ORIG}»: з неї його можна повернути. Щоб нічого не чіпати, оберіть окрему порожню папку.</p>
      <div class="acts"><button class="btn p" value="cancel" id="xo-no">Скасувати</button><button class="btn" id="xo-yes" type="button">Замінити й зберегти копії</button></div></form>`;
    document.body.appendChild(dlg);
    let yes = false;
    dlg.addEventListener('click', e => { if ((e.target as HTMLElement).id === 'xo-yes') { yes = true; dlg.close(); } });
    dlg.addEventListener('close', () => { dlg.remove(); resolve(yes); });
    showDialog(dlg);
    dlg.querySelector<HTMLElement>('#xo-no')?.focus();
  });
}

/**
 * Write changed files into a folder the user picks. Returns false when nothing was written (the picker was cancelled, or the
 * translator did not agree to replace files that are there). `game` is the folder the game was opened from, when the browser
 * gave a handle to it: a folder inside it is the game itself.
 */
export async function writeToFolder(result: BuildResult, game: FsDir | null = null): Promise<boolean> {
  const w = window as SaveWindow;
  if (!w.showDirectoryPicker) throw new Error('Браузер не вміє записувати в папку');
  let dir: FsDir;
  try { dir = await w.showDirectoryPicker({ mode: 'readwrite' }); }
  catch (e) { if (e instanceof DOMException && e.name === 'AbortError') return false; throw e; }
  let inGame = false;
  try { inGame = !!game?.resolve && (await game.resolve(dir)) !== null; } catch { inGame = false; }
  const marked = !!(await fileIn(dir, MARKER));
  const existing: string[] = [];
  for (const f of result.files) if (await fileIn(dir, f.name)) existing.push(f.name);
  // a folder of an earlier build is the translator's output folder; any other folder with these files in it is a game (or something else worth a second look)
  const replacing = inGame || (!marked && existing.length > 0);
  if (replacing && !(await confirmReplace(dir.name ?? '', existing.length, inGame))) return false;
  for (const f of result.files) {
    // Names with a folder part (same file name in several folders) are written into sub-folders.
    const parts = f.name.split('/');
    if (replacing) await keepOriginal(dir, f.name);
    let d = dir;
    for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p, { create: true });
    const h = await d.getFileHandle(parts[parts.length - 1]!, { create: true });
    const w2 = await h.createWritable();
    await w2.write(fileText(f));
    await w2.close();
  }
  if (!marked) { const m = await (await dir.getFileHandle(MARKER, { create: true })).createWritable(); await m.write('Transly build output'); await m.close(); }
  return true;
}

/** Keep the file as it is now in `<folder>/.transly-orig/<name>`, unless an original is kept there already (the first one is the real one). */
async function keepOriginal(dir: FsDir, rel: string): Promise<void> {
  const now = await fileIn(dir, rel);
  if (!now?.getFile) return;
  let backup = await dir.getDirectoryHandle(ORIG, { create: true });
  const parts = rel.split('/');
  for (const p of parts.slice(0, -1)) backup = await backup.getDirectoryHandle(p, { create: true });
  const name = parts[parts.length - 1]!;
  try { await backup.getFileHandle(name, { create: false }); return; } catch { /* no copy yet */ }
  const text = await (await now.getFile()).text();
  const out = await (await backup.getFileHandle(name, { create: true })).createWritable();
  await out.write(text); await out.close();
}

/** Download the changed files as one ZIP (works in every browser). */
export async function downloadZip(result: BuildResult, name = 'transly-build.zip'): Promise<boolean> {
  const enc = new TextEncoder();
  const zip = createZip(result.files.map(f => ({ name: isRpgMakerFile(f.name) ? `data/${f.name}` : f.name, data: enc.encode(fileText(f)) })));
  return saveFile(name, zip, 'application/zip');
}
