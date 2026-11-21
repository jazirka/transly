import { t } from './i18n';
import { MANIFEST_FILE, LIMITS, checkManifest } from './manifest';
import type { PluginManifest } from './types';

/** A plugin package after it was read and checked: its manifest and its files as text. */
export interface PluginPackage {
  manifest: PluginManifest;
  /** The manifest exactly as it was written (its hash identifies the package). */
  manifestText: string;
  /** The text of every file of the package except the manifest, by path. */
  files: Record<string, string>;
  warnings: string[];
}

/** The SHA-256 of bytes as lower case hex. */
export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
  return [...h].map(b => b.toString(16).padStart(2, '0')).join('');
}

export type Built = { ok: true; pkg: PluginPackage } | { ok: false; errors: string[] };

/**
 * Check the files of a package against its manifest: the manifest is valid, every file is named in it with the right checksum, no file is
 * left over, every file is text of a sensible size. A package that passes is what its author published; one that does not is refused as a whole.
 */
export async function buildPackage(entries: Map<string, Uint8Array>, opts: { builtin?: boolean } = {}): Promise<Built> {
  const raw = entries.get(MANIFEST_FILE);
  if (!raw) return { ok: false, errors: [t('У пакеті немає файлу «{name}»', { name: MANIFEST_FILE })] };
  if (raw.length > LIMITS.manifestBytes) return { ok: false, errors: [t('Опис розширення завеликий')] };
  const dec = new TextDecoder('utf-8', { fatal: true });
  let manifestText: string;
  try { manifestText = dec.decode(raw); } catch { return { ok: false, errors: [t('Опис розширення не в кодуванні UTF-8')] }; }
  const checked = checkManifest(manifestText, opts);
  if (!checked.ok) return { ok: false, errors: checked.errors };
  const m = checked.manifest, listed = m.files ?? {}, errors: string[] = [];
  const files: Record<string, string> = {};
  const names = [...entries.keys()].filter(p => p !== MANIFEST_FILE);
  if (names.length > LIMITS.files) errors.push(t('Забагато файлів у пакеті'));
  for (const p of names) if (!(p in listed)) errors.push(t('Файл «{p}» є в пакеті, але його немає в описі (files)', { p }));
  let total = 0;
  for (const [p, want] of Object.entries(listed)) {
    const bytes = entries.get(p);
    if (!bytes) { errors.push(t('Файл «{p}» названо в описі, але його немає в пакеті', { p })); continue; }
    total += bytes.length;
    if (bytes.length > LIMITS.fileBytes) { errors.push(t('Файл «{p}» завеликий', { p })); continue; }
    const got = `sha256-${await sha256Hex(bytes)}`;
    if (got !== want) { errors.push(t('Файл «{p}» не збігається з контрольною сумою в описі', { p })); continue; }
    try { const text = dec.decode(bytes); if (text.includes('\0')) throw new Error('binary'); files[p] = text; } catch { errors.push(t('Файл «{p}» має бути текстом UTF-8', { p })); }
  }
  if (total > LIMITS.totalBytes) errors.push(t('Пакет завеликий'));
  return errors.length ? { ok: false, errors } : { ok: true, pkg: { manifest: m, manifestText, files, warnings: checked.warnings } };
}

/** The same check for files that were already read as text (a folder, or files fetched from the net). */
export async function buildPackageFromText(manifestText: string, files: Record<string, string>, opts: { builtin?: boolean } = {}): Promise<Built> {
  const enc = new TextEncoder();
  const map = new Map<string, Uint8Array>([[MANIFEST_FILE, enc.encode(manifestText)]]);
  for (const [p, text] of Object.entries(files)) map.set(p, enc.encode(text));
  return buildPackage(map, opts);
}
