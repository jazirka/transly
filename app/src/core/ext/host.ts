import { applyBySpec, extractBySpec, globTest } from './declarative';
import { t } from './i18n';
import { compatibility } from './manifest';
import { buildPackage, buildPackageFromText } from './package';
import type { PluginPackage } from './package';
import { PluginRegistry } from './registry';
import type { PluginRecord, PluginSource } from './registry';
import { defaultFetcher, fetchFromFiles, fetchFromGithub, fetchFromUrl, fetchManifestText, parseGithubRef } from './sources';
import type { Fetched, Fetcher } from './sources';
import type { PluginStore, StoredPlugin } from './store';
import type { FormatContribution, FormatHandler, PluginManifest, PluginPermission } from './types';
import { checkManifest } from './manifest';
import { compareVersions } from './semver';

/** An install that cannot go on: what is wrong, in words for the user. */
export class InstallError extends Error {
  constructor(readonly errors: string[]) { super(errors.join('\n')); this.name = 'InstallError'; }
}

/** Where a plugin may come from. */
export type SourceInput = { kind: 'github'; ref: string } | { kind: 'url'; url: string } | { kind: 'files'; files: { name: string; data: Uint8Array }[] };

/** What installing would do, shown to the user before anything is written. */
export interface InstallPlan {
  pkg: PluginPackage;
  source: PluginSource;
  action: 'install' | 'update' | 'reinstall' | 'downgrade';
  existing?: StoredPlugin;
  /** The package comes from another place than the one installed before (a plugin must not be replaced by someone else's under the same id without the user knowing). */
  sourceChanged: boolean;
  hasCode: boolean;
  permissions: PluginPermission[];
  /** Permissions the user has not given yet (all of them for a new plugin). */
  newPermissions: PluginPermission[];
  compat: { ok: true } | { ok: false; reason: string };
  /** Plugins this one needs that are not here (it will not work until they are). */
  missing: string[];
  /** Things worth knowing: another plugin reads the same files, an unknown part of the manifest was skipped. */
  warnings: string[];
}

/** The code of plugins that have code runs somewhere safe (see `sandbox.ts`); the host only asks for the handlers. */
export interface CodeRunner {
  supported(): boolean;
  load(pkg: PluginPackage, grants: PluginPermission[]): Promise<{ handlers: FormatHandler[]; dispose(): void }>;
}

const MAX_PRIORITY = 50;
const extOf = (n: string): string => /\.[^./\\]+$/.exec(n)?.[0].toLowerCase() ?? '';

/** The handler of a format that is described by data. */
export function declarativeHandler(pluginId: string, f: FormatContribution): FormatHandler {
  const exts = new Set(f.extensions.map(e => e.toLowerCase())), tests = (f.files ?? []).map(globTest), spec = f.spec!;
  return {
    id: `${pluginId}/${f.id}`, plugin: pluginId, label: f.label, extensions: f.extensions, text: f.text, priority: Math.max(-MAX_PRIORITY, Math.min(MAX_PRIORITY, f.priority ?? 0)), help: f.help ? `${pluginId}:${f.help}` : undefined,
    matches: file => {
      if (!exts.has(extOf(file.name))) return false;
      if (!tests.length) return true;
      const norm = file.name.replace(/\\/g, '/'), base = norm.split('/').pop()!;
      return tests.some(x => x(norm) || x(base));
    },
    extract: file => extractBySpec(file, spec),
    apply: (file, tr) => applyBySpec(file, tr, spec),
  };
}

/** Installs, updates, removes and loads plugins, and keeps the registry in step with what is installed. */
export class ExtHost {
  codeRunner: CodeRunner | null = null;
  private disposers = new Map<string, () => void>();

  constructor(readonly registry: PluginRegistry, readonly store: PluginStore, readonly fetcher: Fetcher = defaultFetcher, private readonly now: () => number = Date.now) {}

  // ---------- loading ----------

  /** The record the registry keeps for a stored plugin. The package is checked again (the stored files may have been changed behind the application's back). */
  private async record(s: StoredPlugin): Promise<Omit<PluginRecord, 'state' | 'errors'>> {
    const base = { manifest: s.manifest, builtin: false, enabled: s.enabled, handlers: [] as FormatHandler[], files: new Map(Object.entries(s.files)), source: s.source };
    const built = await buildPackageFromText(s.manifestText, s.files);
    if (!built.ok) return { ...base, loadError: t('Файли розширення змінено або пошкоджено: {why}', { why: built.errors[0] ?? '' }) };
    const pkg = built.pkg, m = pkg.manifest;
    const handlers: FormatHandler[] = [];
    let loadError: string | undefined;
    const codeFormats = (m.contributes?.formats ?? []).filter(f => f.handler);
    for (const f of m.contributes?.formats ?? []) if (f.spec) handlers.push(declarativeHandler(m.id, f));
    if (m.main && s.enabled) {
      if (!this.codeRunner?.supported()) loadError = t('Розширення має код, а безпечного середовища для нього тут немає');
      else {
        try { const run = await this.codeRunner.load(pkg, s.grants); handlers.push(...run.handlers); this.disposers.set(m.id, run.dispose); }
        catch (e) { loadError = t('Код розширення не запустився: {why}', { why: e instanceof Error ? e.message : String(e) }); }
      }
    } else if (codeFormats.length && !m.main) loadError = t('Формат вказує на код, якого в пакеті немає');
    return { ...base, manifest: m, handlers, ...(loadError ? { loadError } : {}) };
  }

  /** Put every installed plugin into the registry. One that cannot be loaded stays in the list with its reason; it does not stop the others. */
  async init(): Promise<{ loaded: number; problems: { id: string; message: string }[] }> {
    const problems: { id: string; message: string }[] = [];
    let stored: StoredPlugin[] = [];
    try { stored = await this.store.all(); } catch (e) { problems.push({ id: '*', message: t('Не вдалося прочитати встановлені розширення: {why}', { why: e instanceof Error ? e.message : String(e) }) }); }
    for (const s of stored) {
      try {
        const rec = await this.record(s);
        this.registry.add(rec, false);
        if (rec.loadError) problems.push({ id: s.id, message: rec.loadError });
      } catch (e) { problems.push({ id: s.id, message: e instanceof Error ? e.message : String(e) }); }
    }
    this.registry.refresh();
    return { loaded: stored.length - problems.filter(p => p.id !== '*').length, problems };
  }

  // ---------- installing ----------

  /** Fetch a package and say what installing it would do. Nothing is written. */
  async plan(input: SourceInput): Promise<InstallPlan> {
    let fetched: Fetched;
    try {
      if (input.kind === 'github') {
        const spec = parseGithubRef(input.ref);
        if (!spec) throw new InstallError([t('Не вдалося розпізнати репозиторій. Напишіть автор/репозиторій, наприклад acme/transly-wolf')]);
        fetched = await fetchFromGithub(spec, this.fetcher);
      } else if (input.kind === 'url') fetched = await fetchFromUrl(input.url, this.fetcher);
      else fetched = await fetchFromFiles(input.files);
    } catch (e) { throw e instanceof InstallError ? e : new InstallError([e instanceof Error ? e.message : String(e)]); }
    return this.planFrom(fetched);
  }

  async planFrom(fetched: Fetched): Promise<InstallPlan> {
    const built = await buildPackage(fetched.entries);
    if (!built.ok) throw new InstallError(built.errors);
    const { pkg } = built, m = pkg.manifest;
    const have = this.registry.get(m.id);
    if (have?.builtin) throw new InstallError([t('Розширення «{id}» вбудоване в застосунок, його не можна замінити', { id: m.id })]);
    const existing = (await this.store.all().catch(() => [])).find(s => s.id === m.id);
    const action: InstallPlan['action'] = !existing ? 'install' : compareVersions(m.version, existing.manifest.version) > 0 ? 'update' : compareVersions(m.version, existing.manifest.version) < 0 ? 'downgrade' : 'reinstall';
    const permissions = m.permissions ?? [];
    const warnings = [...pkg.warnings];
    const claimed = new Set(this.registry.formats().filter(h => h.plugin !== m.id).flatMap(h => h.extensions));
    for (const f of m.contributes?.formats ?? []) { const over = f.extensions.filter(e => claimed.has(e)); if (over.length) warnings.push(t('Формат «{label}» читає й файли {ext}, які вже читає інше розширення: першим питатимуть вбудовані, потім за пріоритетом', { label: f.label, ext: over.join(', ') })); }
    if (m.network) warnings.push(t('Розширення просить доступ до мережі: {hosts}', { hosts: m.network.hosts.join(', ') }));
    return {
      pkg, source: fetched.source, action, existing,
      sourceChanged: !!existing && (existing.source.kind !== fetched.source.kind || (existing.source.location ?? '') !== (fetched.source.location ?? '')),
      hasCode: !!m.main, permissions, newPermissions: permissions.filter(p => !(existing?.grants ?? []).includes(p)),
      compat: compatibility(m),
      missing: Object.entries(m.dependencies ?? {}).filter(([id]) => !this.registry.get(id)).map(([id]) => id),
      warnings,
    };
  }

  /**
   * Write the plugin and bring it to life. A plugin with code is switched on only when `enable` is given (the user has seen what it asks for);
   * a failure leaves things as they were.
   */
  async install(plan: InstallPlan, opts: { enable?: boolean; grants?: PluginPermission[] } = {}): Promise<PluginRecord> {
    const m = plan.pkg.manifest;
    if (!plan.compat.ok) throw new InstallError([plan.compat.reason]);
    const grants = (opts.grants ?? []).filter(g => plan.permissions.includes(g));
    const at = this.now();
    const stored: StoredPlugin = { id: m.id, manifest: m, manifestText: plan.pkg.manifestText, files: plan.pkg.files, enabled: opts.enable ?? (plan.existing?.enabled ?? !plan.hasCode), grants, source: { ...plan.source, installedAt: plan.existing?.installedAt ?? at }, installedAt: plan.existing?.installedAt ?? at, updatedAt: at };
    const before = plan.existing;
    const old = this.registry.get(m.id);
    this.disposers.get(m.id)?.(); this.disposers.delete(m.id);
    await this.store.put(stored);
    try {
      const rec = await this.record(stored);
      return this.registry.add(rec);
    } catch (e) {
      if (before) await this.store.put(before); else await this.store.remove(m.id);
      if (old) this.registry.add({ manifest: old.manifest, builtin: false, enabled: old.enabled, handlers: old.handlers, files: old.files, source: old.source, loadError: old.loadError });
      throw new InstallError([e instanceof Error ? e.message : String(e)]);
    }
  }

  /** The plugins that need this one. */
  dependents(id: string): PluginManifest[] { return this.registry.list().filter(r => r.manifest.id !== id && r.manifest.dependencies && id in r.manifest.dependencies).map(r => r.manifest); }

  async uninstall(id: string): Promise<void> {
    const rec = this.registry.get(id);
    if (rec?.builtin) throw new InstallError([t('Вбудоване розширення не можна видалити (його можна вимкнути)')]);
    this.disposers.get(id)?.(); this.disposers.delete(id);
    await this.store.remove(id);
    this.registry.remove(id);
  }

  async setEnabled(id: string, on: boolean, grants?: PluginPermission[]): Promise<void> {
    const rec = this.registry.get(id);
    if (!rec) return;
    if (rec.builtin) { this.registry.setEnabled(id, on); this.saveBuiltinState(); return; }
    const s = (await this.store.all()).find(x => x.id === id);
    if (!s) return;
    const next: StoredPlugin = { ...s, enabled: on, grants: grants ?? s.grants, updatedAt: this.now() };
    await this.store.put(next);
    if (!on) { this.disposers.get(id)?.(); this.disposers.delete(id); }
    const fresh = await this.record(next);
    this.registry.add(fresh);
  }

  // ---------- built-in plugins can be switched off: the choice is kept apart from the installed ones ----------

  private static readonly BUILTIN_KEY = 'transly.ext.builtin-off';
  private storage: Pick<Storage, 'getItem' | 'setItem'> | null = (() => { try { return globalThis.localStorage ?? null; } catch { return null; } })();
  setStorage(s: Pick<Storage, 'getItem' | 'setItem'> | null): void { this.storage = s; }
  private saveBuiltinState(): void {
    const off = this.registry.list().filter(r => r.builtin && !r.enabled).map(r => r.manifest.id);
    try { this.storage?.setItem(ExtHost.BUILTIN_KEY, JSON.stringify(off)); } catch { /* the choice is not kept this time */ }
  }
  /** Apply what the user chose earlier about the built-in plugins. */
  restoreBuiltinState(): void {
    let off: unknown = [];
    try { off = JSON.parse(this.storage?.getItem(ExtHost.BUILTIN_KEY) ?? '[]'); } catch { /* none */ }
    if (Array.isArray(off)) for (const id of off) if (typeof id === 'string' && this.registry.get(id)?.builtin) this.registry.setEnabled(id, false);
  }

  // ---------- updates ----------

  /** Whether a newer version is published where the plugin came from (only its manifest is fetched). */
  async checkUpdate(id: string): Promise<{ available: string | null; error?: string }> {
    const rec = this.registry.get(id);
    if (!rec || rec.builtin || (rec.source.kind !== 'github' && rec.source.kind !== 'url')) return { available: null };
    try {
      const m = checkManifest(await fetchManifestText(rec.source, this.fetcher));
      if (!m.ok) return { available: null, error: m.errors[0] };
      if (m.manifest.id !== id) return { available: null, error: t('Автор змінив id розширення') };
      return { available: compareVersions(m.manifest.version, rec.manifest.version) > 0 ? m.manifest.version : null };
    } catch (e) { return { available: null, error: e instanceof Error ? e.message : String(e) }; }
  }

  /** Fetch the newest version from the place the plugin came from and say what the update would do. */
  async planUpdate(id: string): Promise<InstallPlan> {
    const rec = this.registry.get(id);
    if (!rec || rec.builtin) throw new InstallError([t('Це розширення не оновлюється')]);
    const s = rec.source;
    if (s.kind === 'github' && s.location) { const spec = parseGithubRef(s.location); if (spec) return this.planFrom(await fetchFromGithub(spec, this.fetcher)); }
    if (s.kind === 'url' && s.location) return this.planFrom(await fetchFromUrl(s.location, this.fetcher));
    throw new InstallError([t('Невідомо, де шукати оновлення цього розширення')]);
  }
}
