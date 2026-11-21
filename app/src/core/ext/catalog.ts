import { t } from './i18n';
import { isHttps } from './manifest';
import { matchDetect } from './registry';
import type { PluginRegistry } from './registry';
import { compareVersions, parseVersion, satisfies, validRange } from './semver';
import { allowedUrl, defaultFetcher, fetchBytes, parseGithubRef } from './sources';
import type { Fetcher } from './sources';
import type { EngineDetect, PluginManifest } from './types';
import { APP_VERSION } from './version';

/**
 * A catalog is a list of plugins somebody recommends: a JSON file (`transly-catalog.json`) on any server or in a GitHub repository. It only *describes*
 * plugins and says where each one is; installing one goes through the same steps as any other (what it adds and asks for is shown first, nothing is written
 * without consent, every file is checked against its checksum). A catalog is untrusted text: every entry is checked, one bad entry is skipped, and nothing
 * in it is ever run.
 */

export const CATALOG_FILE = 'transly-catalog.json';
export const CATALOG_VERSION = 1;
export const CATALOG_LIMITS = { entries: 500, bytes: 1_000_000, name: 80, text: 600 } as const;

export const CATALOG_TAGS = ['language', 'engine', 'format', 'qa', 'commands', 'glossary', 'help'] as const;
export type CatalogTag = (typeof CATALOG_TAGS)[number];

/** Where a plugin of a catalog is: a GitHub repository (`owner/repo[@ref][#folder]`), an address, or the application itself (the examples it carries). */
export type CatalogSource = { kind: 'github'; ref: string } | { kind: 'url'; url: string } | { kind: 'bundled'; key: string };

export interface CatalogEntry {
  /** The plugin's id (`author.name`). */
  id: string;
  name: string;
  description?: string;
  version?: string;
  author?: string;
  homepage?: string;
  tags: CatalogTag[];
  /** The interface languages of a language pack (codes). */
  languages?: string[];
  /** How a game of the kind this plugin reads is told from its files: the application may suggest the plugin for a folder it does not understand. */
  detect?: EngineDetect;
  requires?: { transly?: string };
  source: CatalogSource;
  /** The name of the catalog the entry came from (filled in when catalogs are put together). */
  origin?: string;
}

export interface CatalogIndex { name: string; entries: CatalogEntry[]; warnings: string[] }
export type CheckedCatalog = { ok: true; index: CatalogIndex } | { ok: false; errors: string[] };

const ID = /^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$/;
const LANG = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2}$/;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, max: number): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const globs = (v: unknown): string[] | undefined | null => (v === undefined ? undefined : Array.isArray(v) && v.length <= 16 && v.every(g => str(g, 120)) ? (v as string[]) : null);

function entry(raw: unknown, i: number, warn: (s: string) => void): CatalogEntry | null {
  const w = (s: string): null => { warn(`plugins[${i}]: ${s}`); return null; };
  if (!isObj(raw)) return w(t('має бути об’єктом'));
  if (typeof raw.id !== 'string' || !ID.test(raw.id) || raw.id.length > 64) return w(t('«id» — на кшталт автор.назва'));
  if (!str(raw.name, CATALOG_LIMITS.name)) return w(t('«name» — непорожній рядок'));
  const source = ((): CatalogSource | null => {
    const hasRepo = raw.repo !== undefined, hasUrl = raw.url !== undefined;
    if (hasRepo === hasUrl) return null;
    if (hasRepo) return typeof raw.repo === 'string' && parseGithubRef(raw.repo) ? { kind: 'github', ref: raw.repo.trim() } : null;
    return isHttps(raw.url) && allowedUrl(raw.url) ? { kind: 'url', url: raw.url } : null;
  })();
  if (!source) return w(t('потрібне одне з «repo» (автор/репозиторій) або «url» (https)'));
  for (const k of ['description'] as const) if (raw[k] !== undefined && !str(raw[k], CATALOG_LIMITS.text)) return w(t('«{k}» — текст', { k }));
  if (raw.author !== undefined && !str(raw.author, 80)) return w(t('«author» — текст'));
  if (raw.version !== undefined && (typeof raw.version !== 'string' || !parseVersion(raw.version))) return w(t('«version» — версія на кшталт 1.2.0'));
  if (raw.homepage !== undefined && !isHttps(raw.homepage)) return w(t('«homepage» — адреса https'));
  const tags = raw.tags === undefined ? [] : Array.isArray(raw.tags) && raw.tags.length <= 8 && raw.tags.every(x => (CATALOG_TAGS as readonly unknown[]).includes(x)) ? (raw.tags as CatalogTag[]) : null;
  if (tags === null) return w(t('«tags» — {list}', { list: CATALOG_TAGS.join(', ') }));
  if (raw.languages !== undefined && !(Array.isArray(raw.languages) && raw.languages.length <= 16 && raw.languages.every(c => typeof c === 'string' && LANG.test(c)))) return w(t('«languages» — коди мов'));
  let detect: EngineDetect | undefined;
  if (raw.detect !== undefined) {
    const d = raw.detect;
    const files = isObj(d) ? globs(d.files) : null, anyFiles = isObj(d) ? globs(d.anyFiles) : null, excludeFiles = isObj(d) ? globs(d.excludeFiles) : null;
    if (!isObj(d) || files === null || anyFiles === null || excludeFiles === null || (d.min !== undefined && !(Number.isInteger(d.min) && (d.min as number) >= 1 && (d.min as number) <= 16))) return w(t('«detect» — files, anyFiles, excludeFiles (до 16 шаблонів) і min'));
    detect = { ...(files ? { files } : {}), ...(anyFiles ? { anyFiles } : {}), ...(excludeFiles ? { excludeFiles } : {}), ...(d.min !== undefined ? { min: d.min as number } : {}) };
  }
  let requires: { transly?: string } | undefined;
  if (raw.requires !== undefined) {
    if (!isObj(raw.requires) || (raw.requires.transly !== undefined && (typeof raw.requires.transly !== 'string' || !validRange(raw.requires.transly)))) return w(t('«requires.transly» — діапазон версій'));
    requires = raw.requires.transly !== undefined ? { transly: raw.requires.transly as string } : {};
  }
  return {
    id: raw.id, name: raw.name.trim(), ...(raw.description ? { description: raw.description as string } : {}), ...(raw.version ? { version: raw.version as string } : {}),
    ...(raw.author ? { author: raw.author as string } : {}), ...(raw.homepage ? { homepage: raw.homepage as string } : {}), tags, ...(raw.languages ? { languages: raw.languages as string[] } : {}),
    ...(detect ? { detect } : {}), ...(requires ? { requires } : {}), source,
  };
}

/** Read and check a catalog. A newer format is refused, a bad entry is left out (with a warning), the rest is kept. */
export function checkCatalog(input: string | unknown, fallbackName = ''): CheckedCatalog {
  let j: unknown = input;
  if (typeof input === 'string') {
    if (input.length > CATALOG_LIMITS.bytes) return { ok: false, errors: [t('Каталог завеликий')] };
    try { j = JSON.parse(input); } catch (e) { return { ok: false, errors: [t('Каталог — не JSON: {why}', { why: e instanceof Error ? e.message : String(e) })] }; }
  }
  if (!isObj(j)) return { ok: false, errors: [t('Каталог має бути об’єктом')] };
  if (j.catalogVersion !== CATALOG_VERSION) return { ok: false, errors: [t('Цей каталог має формат {v}, а застосунок знає лише {known}', { v: String(j.catalogVersion), known: CATALOG_VERSION })] };
  if (!Array.isArray(j.plugins)) return { ok: false, errors: [t('«plugins» має бути списком')] };
  const warnings: string[] = [], seen = new Set<string>(), entries: CatalogEntry[] = [];
  if (j.plugins.length > CATALOG_LIMITS.entries) warnings.push(t('У каталозі більше {n} розширень: решту пропущено', { n: CATALOG_LIMITS.entries }));
  for (const [i, raw] of j.plugins.slice(0, CATALOG_LIMITS.entries).entries()) {
    const e = entry(raw, i, s => warnings.push(s));
    if (!e) continue;
    if (seen.has(e.id)) { warnings.push(`plugins[${i}]: ${t('«{id}» уже є вище', { id: e.id })}`); continue; }
    seen.add(e.id); entries.push(e);
  }
  const name = typeof j.name === 'string' && j.name.trim() ? j.name.trim().slice(0, CATALOG_LIMITS.name) : fallbackName;
  return { ok: true, index: { name, entries, warnings } };
}

/** An entry for a plugin that is at hand (a manifest says everything an entry says, so an entry made from it cannot differ from what installs). */
export function entryOfManifest(m: PluginManifest, source: CatalogSource): CatalogEntry {
  const c = m.contributes ?? {};
  const tags = ([c.languages?.length ? 'language' : '', c.engines?.length ? 'engine' : '', c.formats?.length ? 'format' : '', c.qaRules?.length ? 'qa' : '', c.commands?.length ? 'commands' : '', c.glossaries?.length ? 'glossary' : '', c.help?.length ? 'help' : ''] as const).filter(Boolean) as CatalogTag[];
  const detect = c.engines?.find(e => e.detect)?.detect;
  const author = typeof m.author === 'string' ? m.author : m.author?.name;
  return {
    id: m.id, name: m.name, ...(m.description ? { description: m.description } : {}), version: m.version, ...(author ? { author } : {}), ...(m.homepage ? { homepage: m.homepage } : {}), tags,
    ...(c.languages?.length ? { languages: c.languages.map(l => l.code) } : {}), ...(detect ? { detect } : {}), ...(m.requires?.transly ? { requires: { transly: m.requires.transly } } : {}), source,
  };
}

/** A catalog the user added: a GitHub repository (the file `transly-catalog.json` in it) or the address of the file. */
export interface CatalogRef { id: string; kind: 'github' | 'url'; location: string; name?: string }

/** What the user typed: `owner/repo[@ref][#folder]`, a GitHub address, or an https address of a catalog file. Null when it is neither. */
export function parseCatalogRef(input: string): CatalogRef | null {
  const s = input.trim();
  if (/^https:\/\//i.test(s) && !/^https:\/\/github\.com\//i.test(s)) { const u = allowedUrl(s); return u ? { id: `url:${u.href}`, kind: 'url', location: u.href } : null; }
  const g = parseGithubRef(s);
  return g ? { id: `github:${s}`, kind: 'github', location: s } : null;
}

/** The address a catalog file is read from. */
export function catalogAddress(ref: CatalogRef): string | null {
  if (ref.kind === 'url') return allowedUrl(ref.location)?.href ?? null;
  const g = parseGithubRef(ref.location);
  if (!g) return null;
  const dir = g.dir ? `${g.dir.replace(/\/+$/, '')}/` : '';
  return `https://raw.githubusercontent.com/${g.owner}/${g.repo}/${g.ref ?? 'HEAD'}/${dir.split('/').map(encodeURIComponent).join('/').replace(/%2F/g, '/')}${CATALOG_FILE}`;
}

export async function fetchCatalog(ref: CatalogRef, f: Fetcher = defaultFetcher): Promise<CatalogIndex> {
  const url = catalogAddress(ref);
  if (!url) throw new Error(t('Не вдалося розпізнати адресу каталогу'));
  const text = new TextDecoder().decode(await fetchBytes(f, url, CATALOG_LIMITS.bytes));
  const r = checkCatalog(text, ref.name ?? ref.location);
  if (!r.ok) throw new Error(r.errors.join('; '));
  return r.index;
}

/** Catalogs put together: a plugin that several have is listed once (the newest version, the earlier catalog on a tie). Each entry knows its catalog. */
export function mergeCatalogs(indexes: readonly CatalogIndex[]): CatalogEntry[] {
  const by = new Map<string, CatalogEntry>();
  for (const idx of indexes) for (const e of idx.entries) {
    const have = by.get(e.id);
    if (!have || (e.version && have.version && compareVersions(e.version, have.version) > 0) || (e.version && !have.version)) by.set(e.id, { ...e, origin: idx.name });
  }
  return [...by.values()];
}

export type CatalogStatus = 'available' | 'installed' | 'update' | 'incompatible';

/** Where an entry stands for this application: not installed, installed (and whether the catalog has a newer version), or not for this version of Transly. */
export function catalogStatus(e: CatalogEntry, reg: Pick<PluginRegistry, 'get'>, app: string = APP_VERSION): { status: CatalogStatus; installed?: string; reason?: string } {
  const have = reg.get(e.id);
  if (have) {
    const newer = e.version && compareVersions(e.version, have.manifest.version) > 0;
    return { status: newer ? 'update' : 'installed', installed: have.manifest.version };
  }
  if (e.requires?.transly && !satisfies(app, e.requires.transly)) return { status: 'incompatible', reason: t('Потрібен Transly {range}', { range: e.requires.transly }) };
  return { status: 'available' };
}

/** The entries whose `detect` fits the files of a folder, best first, for a folder the application does not understand. Plugins that are installed are not suggested again. */
export function suggestFromCatalog(entries: readonly CatalogEntry[], paths: readonly string[], reg: Pick<PluginRegistry, 'get'>, app: string = APP_VERSION): { entry: CatalogEntry; score: number; matched: string[] }[] {
  const out: { entry: CatalogEntry; score: number; matched: string[] }[] = [];
  for (const e of entries) {
    if (!e.detect || reg.get(e.id) || catalogStatus(e, reg, app).status === 'incompatible') continue;
    const m = matchDetect(e.detect, paths);
    if (m) out.push({ entry: e, score: m.score, matched: m.matched });
  }
  return out.sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name));
}

/** Entries filtered by a tag and by words (name, id, description, author, languages). */
export function filterCatalog(entries: readonly CatalogEntry[], opts: { tag?: CatalogTag | undefined; q?: string | undefined } = {}): CatalogEntry[] {
  const words = (opts.q ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  return entries.filter(e => (!opts.tag || e.tags.includes(opts.tag)) && words.every(w => `${e.name} ${e.id} ${e.description ?? ''} ${e.author ?? ''} ${(e.languages ?? []).join(' ')}`.toLowerCase().includes(w)));
}

