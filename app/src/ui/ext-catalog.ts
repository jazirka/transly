import { checkManifest, entryOfManifest, fetchCatalog, mergeCatalogs, parseCatalogRef, plugins, suggestFromCatalog, t } from '../core';
import type { CatalogEntry, CatalogIndex, CatalogRef, SourceInput } from '../core';

/**
 * The catalog of plugins as the page sees it: the examples the application carries (they install without a network), and the catalogs the user added
 * (a GitHub repository or an address with `transly-catalog.json`). The lists of the added catalogs are kept on this device with the last answer, so the
 * page opens at once and the network is asked only when the user asks («Оновити»).
 */

/** The plugins that are inside the application: a manifest and the files it lists, loaded only when they are wanted. */
const BUNDLED: Record<string, () => Promise<[string, string][]>> = {
  'style-pack': async () => [
    ['transly-plugin.json', (await import('../../examples/plugins/style-pack/transly-plugin.json?raw')).default],
    ['help/guide.md', (await import('../../examples/plugins/style-pack/help/guide.md?raw')).default],
    ['terms.tsv', (await import('../../examples/plugins/style-pack/terms.tsv?raw')).default],
  ],
  'lang-files': async () => [
    ['transly-plugin.json', (await import('../../examples/plugins/lang-files/transly-plugin.json?raw')).default],
    ['help/about.md', (await import('../../examples/plugins/lang-files/help/about.md?raw')).default],
  ],
  'json-dialogs': async () => [
    ['transly-plugin.json', (await import('../../examples/plugins/json-dialogs/transly-plugin.json?raw')).default],
  ],
};

let bundled: Promise<CatalogIndex> | null = null;
/** The examples of the application as a catalog (their entries are made from their manifests, so they cannot differ from what installs). */
export function bundledCatalog(): Promise<CatalogIndex> {
  return (bundled ??= (async () => {
    const entries: CatalogEntry[] = [];
    for (const key of Object.keys(BUNDLED)) {
      try {
        const text = (await BUNDLED[key]!()).find(f => f[0] === 'transly-plugin.json')?.[1] ?? '';
        const m = checkManifest(text);
        if (m.ok) entries.push(entryOfManifest(m.manifest, { kind: 'bundled', key }));
      } catch { /* an example that cannot be read is not offered */ }
    }
    return { name: t('Приклади в застосунку'), entries, warnings: [] };
  })());
}

/** The files of a plugin that is inside the application, as an installation reads them. */
export async function bundledFiles(key: string): Promise<{ name: string; data: Uint8Array }[]> {
  const load = BUNDLED[key];
  if (!load) throw new Error(t('Такого розширення в застосунку немає'));
  return (await load()).map(([name, text]) => ({ name, data: new TextEncoder().encode(text) }));
}

/** What to give the installer for an entry. */
export async function sourceOf(e: CatalogEntry): Promise<SourceInput> {
  const s = e.source;
  return s.kind === 'bundled' ? { kind: 'files', files: await bundledFiles(s.key) } : s.kind === 'github' ? { kind: 'github', ref: s.ref } : { kind: 'url', url: s.url };
}

// ---------- the catalogs the user added ----------

const REFS = 'transly.ext.catalogs', CACHE = 'transly.ext.catalog-cache';
const read = <T>(k: string, fallback: T): T => { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; } };
const write = (k: string, v: unknown): void => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* not kept */ } };

export const catalogRefs = (): CatalogRef[] => read<CatalogRef[]>(REFS, []).filter(r => r && (r.kind === 'github' || r.kind === 'url') && typeof r.location === 'string' && parseCatalogRef(r.location));
type Cache = Record<string, { at: number; index: CatalogIndex }>;
const cache = (): Cache => read<Cache>(CACHE, {});

/** Add a catalog (what the user typed). Returns the reference, or a reason it was refused. */
export function addCatalog(input: string): { ref: CatalogRef } | { error: string } {
  const ref = parseCatalogRef(input);
  if (!ref) return { error: t('Напишіть автор/репозиторій або адресу https файлу transly-catalog.json') };
  const refs = catalogRefs();
  if (refs.some(r => r.id === ref.id)) return { error: t('Цей каталог уже додано') };
  if (refs.length >= 8) return { error: t('Каталогів уже забагато (до 8)') };
  write(REFS, [...refs, ref]);
  return { ref };
}

export function removeCatalog(id: string): void {
  write(REFS, catalogRefs().filter(r => r.id !== id));
  const c = cache(); delete c[id]; write(CACHE, c);
}

/** Ask the net for every added catalog. A catalog that fails keeps its last answer; the reasons are returned for the page to show. */
export async function refreshCatalogs(): Promise<{ id: string; error: string }[]> {
  const c = cache(), errors: { id: string; error: string }[] = [];
  await Promise.all(catalogRefs().map(async ref => {
    try { c[ref.id] = { at: Date.now(), index: await fetchCatalog(ref) }; } catch (e) { errors.push({ id: ref.id, error: e instanceof Error ? e.message : String(e) }); }
  }));
  write(CACHE, c);
  return errors;
}

/** What each added catalog said the last time (without asking the net). */
export function cachedCatalogs(): { ref: CatalogRef; index: CatalogIndex | null; at: number }[] {
  const c = cache();
  return catalogRefs().map(ref => ({ ref, index: c[ref.id]?.index ?? null, at: c[ref.id]?.at ?? 0 }));
}

/** Everything the page can offer: the examples and what the added catalogs said. */
export async function allEntries(): Promise<CatalogEntry[]> {
  const idx = [await bundledCatalog(), ...cachedCatalogs().flatMap(c => (c.index ? [{ ...c.index, name: c.index.name || c.ref.location }] : []))];
  return mergeCatalogs(idx);
}

/** The plugins that would read a folder the application does not understand (from the file list), best first. */
export async function suggestForFiles(paths: string[]): Promise<{ entry: CatalogEntry; score: number }[]> {
  return suggestFromCatalog(await allEntries(), paths, plugins).slice(0, 3);
}
