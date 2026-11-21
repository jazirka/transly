import { crc32 } from '../zip';
import { LIMITS } from './manifest';
import { t } from './i18n';

/**
 * A reader of zip archives for plugin packages (stored and deflated entries, no encryption, no zip64). An archive is untrusted: every size is checked
 * against the limits before and while the data is unpacked (a small file that unpacks into gigabytes is a «zip bomb»), every name is checked, every
 * checksum is compared. What comes out is only the names and the bytes; nothing is written anywhere.
 */

const u16 = (d: DataView, o: number): number => d.getUint16(o, true);
const u32 = (d: DataView, o: number): number => d.getUint32(o, true);

async function inflate(data: Uint8Array, expected: number): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > expected || total > LIMITS.fileBytes) { await reader.cancel(); throw new Error(t('Файл у архіві розпаковується більше, ніж заявлено')); }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

const SKIP = /(^|\/)(__MACOSX\/|\.DS_Store$|Thumbs\.db$)/;

/** The files of a zip by path (directories left out, the common top folder of a GitHub archive taken off). */
export async function readZip(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  if (bytes.length > LIMITS.totalBytes * 2) throw new Error(t('Архів завеликий'));
  const d = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) if (u32(d, i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error(t('Це не zip-архів'));
  const count = u16(d, eocd + 10), cdSize = u32(d, eocd + 12), cdAt = u32(d, eocd + 16);
  if (count === 0xffff || cdAt === 0xffffffff) throw new Error(t('Архіви zip64 не підтримуються'));
  if (count > LIMITS.files + 20 || cdAt + cdSize > bytes.length) throw new Error(t('Архів пошкоджено або має забагато файлів'));
  const dec = new TextDecoder('utf-8', { fatal: false });
  const out = new Map<string, Uint8Array>();
  let at = cdAt, total = 0;
  for (let n = 0; n < count; n++) {
    if (at + 46 > bytes.length || u32(d, at) !== 0x02014b50) throw new Error(t('Архів пошкоджено'));
    const flags = u16(d, at + 8), method = u16(d, at + 10), crc = u32(d, at + 16), csize = u32(d, at + 20), usize = u32(d, at + 24);
    const nl = u16(d, at + 28), xl = u16(d, at + 30), cl = u16(d, at + 32), lh = u32(d, at + 42);
    const name = dec.decode(bytes.subarray(at + 46, at + 46 + nl));
    at += 46 + nl + xl + cl;
    if (name.endsWith('/') || SKIP.test(name)) continue;
    if (flags & 1) throw new Error(t('Зашифровані архіви не підтримуються'));
    if (name.includes('\\') || name.startsWith('/') || name.split('/').includes('..') || name.includes('\0')) throw new Error(t('Небезпечне ім’я файлу в архіві: «{name}»', { name }));
    if (usize > LIMITS.fileBytes) throw new Error(t('Файл «{name}» завеликий', { name }));
    total += usize;
    if (total > LIMITS.totalBytes) throw new Error(t('Пакет завеликий'));
    if (lh + 30 > bytes.length || u32(d, lh) !== 0x04034b50) throw new Error(t('Архів пошкоджено'));
    const start = lh + 30 + u16(d, lh + 26) + u16(d, lh + 28);
    if (start + csize > bytes.length) throw new Error(t('Архів пошкоджено'));
    const raw = bytes.subarray(start, start + csize);
    const data = method === 0 ? raw : method === 8 ? await inflate(raw, usize) : null;
    if (!data) throw new Error(t('Спосіб стиснення файлу «{name}» не підтримується', { name }));
    if (data.length !== usize || crc32(data) !== crc) throw new Error(t('Файл «{name}» пошкоджено (контрольна сума)', { name }));
    if (out.has(name)) throw new Error(t('Файл «{name}» двічі в архіві', { name }));
    out.set(name, data);
  }
  // an archive of a repository has everything inside one folder (`repo-1a2b3c/…`): the folder is not part of the package
  const names = [...out.keys()];
  const top = names.length && names.every(p => p.includes('/')) ? names[0]!.split('/')[0]! : '';
  if (top && names.every(p => p.startsWith(`${top}/`)) && !out.has('transly-plugin.json')) {
    const moved = new Map<string, Uint8Array>();
    for (const [p, b] of out) moved.set(p.slice(top.length + 1), b);
    return moved;
  }
  return out;
}
