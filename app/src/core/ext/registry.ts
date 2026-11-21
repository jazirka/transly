import type { GameFile } from '../model';
import { globTest } from './declarative';
import { I18n, i18n as appI18n, parseCatalog, t } from './i18n';
import type { CatalogData } from './i18n';
import { compatibility } from './manifest';
import { satisfies } from './semver';
import type { EngineContribution, EngineDetect, FormatHandler, HelpContribution, PluginManifest, PluginState } from './types';

/** Where a plugin came from, as far as the application knows (kept with the installed plugin, shown in its details). */
export interface PluginSource {
  kind: 'builtin' | 'github' | 'url' | 'file';
  /** `owner/repo` for GitHub, the address for a URL. */
  location?: string;
  /** The branch, tag or commit that was installed. */
  ref?: string;
  installedAt?: number;
}

export interface PluginRecord {
  manifest: PluginManifest;
  builtin: boolean;
  /** What the user chose. Whether the plugin really works is `state`. */
  enabled: boolean;
  state: PluginState;
  /** Why the plugin does not work (incompatible, a missing dependency, a failure while loading). */
  reason?: string;
  handlers: FormatHandler[];
  /** The text files of the package (catalogs, help), by path. */
  files: Map<string, string>;
  source: PluginSource;
  /** A failure while the plugin was being prepared (its code did not load…). */
  loadError?: string;
  /** What went wrong while it was working: newest last, at most 20. */
  errors: { at: number; what: string }[];
}

export interface EngineInfo { plugin: string; id: string; label: string; description?: string; features: string[]; help?: string; dataFolders: string[]; detect?: EngineDetect; formats: string[]; state: PluginState; builtin: boolean }
export interface EngineMatch { engine: EngineInfo; score: number; matched: string[] }
export interface HelpTopic { plugin: string; id: string; title: string; body: string; order: number }

/**
 * Whether the files of a folder look like a game, by a plugin's own description (`files` all there, `anyFiles` at least `min` of them, `excludeFiles` none):
 * how well it fits (0..1) and which patterns matched; null when it does not fit. Paths are compared in lower case with `/`.
 */
export function matchDetect(d: EngineDetect, paths: readonly string[]): { score: number; matched: string[] } | null {
  if (!d.files?.length && !d.anyFiles?.length) return null;
  const low = paths.map(p => p.toLowerCase().replace(/\\/g, '/'));
  const hit = (globs: string[] | undefined): string[] => (globs ?? []).filter(g => { const test = globTest(g); return low.some(test); });
  if (hit(d.excludeFiles).length) return null;
  const need = hit(d.files);
  if (need.length !== (d.files?.length ?? 0)) return null;
  const any = hit(d.anyFiles);
  if ((d.anyFiles?.length ?? 0) > 0 && any.length < (d.min ?? 1)) return null;
  const total = (d.files?.length ?? 0) + (d.anyFiles?.length ?? 0);
  return { score: total ? (need.length + any.length) / total : 0, matched: [...need, ...any] };
}

/** The id the rest of the application uses for something a plugin names locally: the built-in ones keep their short names. */
export const qualified = (rec: Pick<PluginRecord, 'manifest' | 'builtin'>, local: string): string => (rec.builtin ? local : `${rec.manifest.id}/${local}`);

const MAX_ERRORS = 20;

/**
 * Every plugin the application knows, and what they bring. Everything that asks «what can read this file?» or «which engine is this?» asks here,
 * so a plugin that is switched off, does not fit this version, or lacks something it depends on simply is not asked. A plugin that fails is
 * isolated: the failure is recorded against it and the caller gets the same answer it would get if the plugin were not there.
 */
export class PluginRegistry {
  private recs = new Map<string, PluginRecord>();
  private active: FormatHandler[] = [];
  private listeners = new Set<() => void>();
  private applied = new Map<string, string>();
  private warned = new Set<string>();
  /** Told about a failure of a plugin (once per kind of failure): the interface shows it to the user. */
  onFailure: ((rec: PluginRecord, what: string) => void) | null = null;

  constructor(private readonly i18n: I18n = appI18n, private readonly app?: string, private readonly api?: string) {}

  /** Add a plugin (or replace the one with the same id). */
  add(rec: Omit<PluginRecord, 'state' | 'errors'> & { state?: PluginState; errors?: PluginRecord['errors'] }, refresh = true): PluginRecord {
    const full: PluginRecord = { ...rec, state: rec.state ?? 'disabled', errors: rec.errors ?? [] };
    this.recs.set(rec.manifest.id, full);
    if (refresh) this.refresh();
    return full;
  }

  remove(id: string): void {
    this.recs.delete(id);
    this.i18n.remove(id);
    this.applied.delete(id);
    this.refresh();
  }

  get(id: string): PluginRecord | undefined { return this.recs.get(id); }
  list(): PluginRecord[] { return [...this.recs.values()]; }

  setEnabled(id: string, on: boolean): void {
    const r = this.recs.get(id);
    if (!r || r.enabled === on) return;
    r.enabled = on;
    this.refresh();
  }

  /** Work out again which plugins work (the version they need, what they depend on), and what the working ones bring. */
  refresh(): void {
    const all = this.list();
    for (const r of all) {
      r.reason = undefined;
      if (r.loadError) { r.state = 'error'; r.reason = r.loadError; continue; }
      if (!r.enabled) { r.state = 'disabled'; continue; }
      const c = compatibility(r.manifest, this.app, this.api);
      if (!c.ok) { r.state = 'incompatible'; r.reason = c.reason; continue; }
      r.state = 'enabled';
    }
    // a plugin works only when what it depends on works (repeated until nothing changes, so a chain of them falls together)
    for (let changed = true, n = 0; changed && n < 64; n++) {
      changed = false;
      for (const r of all) {
        if (r.state !== 'enabled') continue;
        for (const [dep, range] of Object.entries(r.manifest.dependencies ?? {})) {
          const d = this.recs.get(dep);
          const why = !d ? t('Потрібне розширення «{id}», його не встановлено', { id: dep }) : d.state !== 'enabled' ? t('Потрібне розширення «{id}», воно не працює', { id: d.manifest.name }) : !satisfies(d.manifest.version, range) ? t('Потрібне розширення «{id}» версії {range}, встановлено {v}', { id: d.manifest.name, range, v: d.manifest.version }) : null;
          if (why) { r.state = 'missing-dependency'; r.reason = why; changed = true; break; }
        }
      }
    }
    const run = all.filter(r => r.state === 'enabled');
    // the formats of the working plugins: the higher priority first, the built-in ones before the others, then in the order the plugins were added
    const order = new Map(all.map((r, i) => [r.manifest.id, i]));
    this.active = run.flatMap(r => r.handlers).sort((a, b) => b.priority - a.priority || Number(this.isBuiltin(b.plugin)) - Number(this.isBuiltin(a.plugin)) || (order.get(a.plugin) ?? 0) - (order.get(b.plugin) ?? 0));
    this.syncLanguages(all);
    for (const cb of [...this.listeners]) { try { cb(); } catch { /* one listener must not stop the others */ } }
  }

  private isBuiltin(id: string): boolean { return this.recs.get(id)?.builtin ?? false; }
  /** Whether the handler belongs to a plugin that comes with the application (its answers are trusted as they are). */
  isBuiltinHandler(h: FormatHandler): boolean { return this.isBuiltin(h.plugin); }

  /** The catalogs of the working language packs are put in the interface's catalog, those of the others are taken out. */
  private syncLanguages(all: PluginRecord[]): void {
    const want = new Map<string, PluginRecord>();
    for (const r of all) if (r.state === 'enabled' && r.manifest.contributes?.languages?.length) want.set(r.manifest.id, r);
    for (const id of [...this.applied.keys()]) if (!want.has(id)) { this.i18n.remove(id); this.applied.delete(id); }
    for (const [id, r] of want) {
      const sig = JSON.stringify([r.manifest.version, r.manifest.contributes!.languages, r.files.size]);
      if (this.applied.get(id) === sig) continue;
      this.i18n.remove(id);
      for (const lang of r.manifest.contributes!.languages!) {
        const merged: CatalogData = { entries: new Map(), plural: lang.plural };
        for (const cat of lang.catalogs) {
          const text = r.files.get(cat.file);
          if (text === undefined) continue;
          const data = parseCatalog(cat.file, text);
          merged.plural ??= data.plural;
          for (const [k, v] of data.entries) {
            const at = k.indexOf('\u0004');
            // a file limited to one context keeps its entries there; a file without a limit keeps the contexts its entries name
            merged.entries.set(cat.context && k.slice(0, at) === 'core' ? `${cat.context}\u0004${k.slice(at + 1)}` : k, v);
          }
        }
        this.i18n.add(lang.code, merged, id, lang.nativeName ?? lang.name);
      }
      this.applied.set(id, sig);
    }
  }

  /** Be told when the set of working plugins changes. Returns the way to stop. */
  subscribe(cb: () => void): () => void { this.listeners.add(cb); return () => { this.listeners.delete(cb); }; }

  // ---------- formats ----------

  /** The handler of a file, or null when no working plugin reads it. */
  handlerOf(file: { name: string }): FormatHandler | null {
    for (const h of this.active) { try { if (h.matches(file)) return h; } catch { /* a handler that cannot even say whether it fits does not */ } }
    return null;
  }
  handler(id: string | null): FormatHandler | null { return id === null ? null : this.active.find(h => h.id === id) ?? null; }
  formats(): FormatHandler[] { return [...this.active]; }
  /** The extensions of the files the application can read now. */
  extensions(): string[] { return [...new Set(this.active.flatMap(h => h.extensions))]; }

  /** Run something of a plugin so that its failure stays with it: the failure is recorded, and `fallback` is what the caller gets. */
  guard<T>(h: FormatHandler, what: string, fn: () => T, fallback: () => T): T {
    const rec = this.recs.get(h.plugin);
    if (!rec || rec.builtin) return fn();
    try { return fn(); } catch (e) {
      this.fail(rec, `${what}: ${e instanceof Error ? e.message : String(e)}`);
      return fallback();
    }
  }

  fail(rec: PluginRecord, what: string): void {
    rec.errors.push({ at: Date.now(), what });
    if (rec.errors.length > MAX_ERRORS) rec.errors.shift();
    const key = `${rec.manifest.id}\u0000${what.replace(/\d+/g, '#')}`;
    if (this.warned.has(key)) return;
    this.warned.add(key);
    try { this.onFailure?.(rec, what); } catch { /* reporting must not fail the work */ }
  }

  // ---------- engines ----------

  engines(): EngineInfo[] {
    return this.list().flatMap(r => (r.manifest.contributes?.engines ?? []).map((e: EngineContribution): EngineInfo => ({
      plugin: r.manifest.id, id: qualified(r, e.id), label: e.label, description: e.description, features: e.features ?? [], help: e.help ? `${r.manifest.id}:${e.help}` : undefined,
      dataFolders: e.dataFolders ?? [], detect: e.detect, formats: (e.formats ?? []).map(f => qualified(r, f)), state: r.state, builtin: r.builtin,
    })));
  }

  /** Which engines the files of a picked folder look like (the best first). Plugins that are switched off are included: the answer to «what is this?» does not depend on it. */
  detect(paths: string[]): EngineMatch[] {
    const out: EngineMatch[] = [];
    for (const engine of this.engines()) {
      const m = engine.detect ? matchDetect(engine.detect, paths) : null;
      if (m) out.push({ engine, score: m.score, matched: m.matched });
    }
    return out.sort((a, b) => b.score - a.score);
  }

  /** The abilities offered by the engines of the plugins that work. */
  features(): Set<string> { return new Set(this.engines().filter(e => e.state === 'enabled').flatMap(e => e.features)); }

  // ---------- help ----------

  /** The help topics of a place (`general`, or `engine:<id>`), of the working plugins. */
  help(topic: string = 'general'): HelpTopic[] {
    const out: HelpTopic[] = [];
    for (const r of this.list()) {
      if (r.state !== 'enabled') continue;
      for (const h of r.manifest.contributes?.help ?? []) {
        if ((h.topic ?? 'general') !== topic) continue;
        const body = h.body ?? (h.file ? r.files.get(h.file) : undefined);
        if (body === undefined) continue;
        out.push({ plugin: r.manifest.id, id: h.id, title: h.title, body, order: h.order ?? 0 });
      }
    }
    return out.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
  }
  /** One topic by the id an engine names (`<plugin>:<id>`), wherever it is shown. */
  helpById(ref: string): HelpTopic | null {
    const at = ref.indexOf(':'), plugin = ref.slice(0, at), id = ref.slice(at + 1);
    const r = this.recs.get(plugin);
    const h: HelpContribution | undefined = r?.manifest.contributes?.help?.find(x => x.id === id);
    const body = h ? h.body ?? (h.file ? r?.files.get(h.file) : undefined) : undefined;
    return r && h && body !== undefined ? { plugin, id, title: h.title, body, order: h.order ?? 0 } : null;
  }

  /** The text of a file of a package (a catalog, a help page). */
  read(plugin: string, path: string): string | undefined { return this.recs.get(plugin)?.files.get(path); }

  /** A file the application is asked to read: a convenience for the callers that have a `GameFile`. */
  handlerOfFile(file: GameFile): FormatHandler | null { return this.handlerOf(file); }
}
