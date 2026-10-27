import { toast } from './dom';

interface Downloads { save(r: { filename: string; data: string | Blob | ArrayBuffer | ArrayBufferView }): Promise<{ status: string }> }
type ClaudeHost = { claude?: { use?: (name: string) => Promise<unknown> } };

/** Where the page runs inside an artifact viewer, a plain link cannot download; the host offers a confirmed save instead. */
async function hostDownloads(): Promise<Downloads | null> {
  try { return ((await (window as unknown as ClaudeHost).claude?.use?.('downloads')) as Downloads | null | undefined) ?? null; }
  catch { return null; }
}

/** Save a file for the user: through the host when there is one, otherwise a normal browser download. */
export async function saveFile(filename: string, data: string | Blob | Uint8Array, mime = 'application/octet-stream'): Promise<boolean> {
  const host = await hostDownloads();
  if (host) {
    try { await host.save({ filename, data }); return true; }
    catch (e) {
      const code = (e as { code?: string }).code;
      if (code === 'declined') return false;
      toast(`Не вдалося зберегти файл (${code ?? 'помилка'})`);
      return false;
    }
  }
  const blob = data instanceof Blob ? data : new Blob([data as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return true;
}
