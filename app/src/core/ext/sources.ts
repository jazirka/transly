import { withTimeout } from '../net';
import { t } from './i18n';
import { LIMITS, MANIFEST_FILE, checkManifest } from './manifest';
import type { PluginSource } from './registry';
import { readZip } from './zipread';

/** What a source hands over: the files of a package as bytes (not yet checked) and where they came from. */
export interface Fetched { entries: Map<string, Uint8Array>; source: PluginSource }

/** The way the application reaches the net; tests give their own. */
export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
export const defaultFetcher: Fetcher = (url, init) => fetch(url, withTimeout(init));

const isLocal = (u: URL): boolean => u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]');
/** An address a plugin may be taken from: https (and a local development server over http). */
export function allowedUrl(raw: string): URL | null {
  try { const u = new URL(raw); return (u.protocol === 'https:' || isLocal(u)) && !u.username && !u.password ? u : null; } catch { return null; }
}

async function readLimited(res: Response, max: number): Promise<Uint8Array> {
  const len = Number(res.headers.get('content-length') ?? '0');
  if (len > max) throw new Error(t('Файл завеликий'));
  if (!res.body) { const b = new Uint8Array(await res.arrayBuffer()); if (b.length > max) throw new Error(t('Файл завеликий')); return b; }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) { await reader.cancel(); throw new Error(t('Файл завеликий')); }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

async function get(f: Fetcher, url: string, max: number, accept?: string): Promise<Uint8Array> {
  const u = allowedUrl(url);
  if (!u) throw new Error(t('Адреса «{url}» не підходить: потрібен https', { url }));
  let res: Response;
  try { res = await f(u.href, accept ? { headers: { Accept: accept } } : undefined); } catch (e) { throw new Error(t('Не вдалося завантажити «{url}»: {why}', { url: u.href, why: e instanceof Error ? e.message : '' })); }
  if (res.url && !allowedUrl(res.url)) throw new Error(t('Адресу перенаправлено на небезпечну'));
  if (!res.ok) throw new Error(t('«{url}»: відповідь {status}', { url: u.href, status: res.status }));
  return readLimited(res, max);
}

/** Download the files a manifest lists, a few at a time, from `base` (a directory address ending with `/`). */
async function filesOf(f: Fetcher, base: string, files: string[]): Promise<Map<string, Uint8Array>> {
  const out = new Map<string, Uint8Array>();
  let total = 0;
  const queue = [...files];
  const worker = async (): Promise<void> => {
    for (let p = queue.shift(); p !== undefined; p = queue.shift()) {
      const bytes = await get(f, base + p.split('/').map(encodeURIComponent).join('/'), LIMITS.fileBytes);
      total += bytes.length;
      if (total > LIMITS.totalBytes) throw new Error(t('Пакет завеликий'));
      out.set(p, bytes);
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, files.length) }, worker));
  return out;
}

// ---------- a manifest address (any server) ----------

/** A plugin on any server: the address of its `transly-plugin.json` (the files lie beside it), or of a `.zip` / `.transly-plugin` package. */
export async function fetchFromUrl(url: string, f: Fetcher = defaultFetcher): Promise<Fetched> {
  const u = allowedUrl(url);
  if (!u) throw new Error(t('Адреса не підходить: потрібен https'));
  const source: PluginSource = { kind: 'url', location: u.href, installedAt: Date.now() };
  if (/\.(zip|transly-plugin)$/i.test(u.pathname)) return { entries: await readZip(await get(f, u.href, LIMITS.totalBytes)), source };
  const manifest = await get(f, u.href, LIMITS.manifestBytes);
  const text = new TextDecoder().decode(manifest);
  const m = checkManifest(text);
  if (!m.ok) throw new Error(m.errors.join('; '));
  const base = u.href.slice(0, u.href.lastIndexOf('/') + 1);
  const entries = await filesOf(f, base, Object.keys(m.manifest.files ?? {}));
  entries.set(MANIFEST_FILE, manifest);
  return { entries, source };
}

// ---------- GitHub ----------

export interface GithubSpec { owner: string; repo: string; ref?: string; dir?: string }

/** `owner/repo`, `owner/repo@ref`, `owner/repo#folder`, or a `https://github.com/owner/repo[/tree/ref[/folder]]` address. */
export function parseGithubRef(input: string): GithubSpec | null {
  const s = input.trim();
  const name = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/, repoName = /^[\w.-]{1,100}$/;
  const refOk = (r: string): boolean => /^[\w./+-]{1,100}$/.test(r) && !r.includes('..');
  const dirOk = (d: string): boolean => /^[\w. -]+(\/[\w. -]+)*$/.test(d) && !d.split('/').some(x => x === '..' || x === '.');
  const url = /^https:\/\/github\.com\/([^/]+)\/([^/#?]+?)(?:\.git)?(?:\/tree\/([^/]+)(?:\/(.+?))?)?\/?$/.exec(s);
  if (url) {
    const [, o, r, ref, dir] = url;
    return name.test(o!) && repoName.test(r!) && (!ref || refOk(ref)) && (!dir || dirOk(dir)) ? { owner: o!, repo: r!, ...(ref ? { ref } : {}), ...(dir ? { dir } : {}) } : null;
  }
  const m = /^([^/\s@#]+)\/([^/\s@#]+?)(?:@([^#\s]+))?(?:#(.+))?$/.exec(s);
  if (!m) return null;
  const [, o, r, ref, dir] = m;
  return name.test(o!) && repoName.test(r!) && (!ref || refOk(ref)) && (!dir || dirOk(dir)) ? { owner: o!, repo: r!, ...(ref ? { ref } : {}), ...(dir ? { dir } : {}) } : null;
}

const API = 'https://api.github.com';
async function json<T>(f: Fetcher, url: string): Promise<T> { return JSON.parse(new TextDecoder().decode(await get(f, url, 2_000_000, 'application/vnd.github+json'))) as T; }

/**
 * A plugin in a GitHub repository: the files named by its `transly-plugin.json` are read at one commit. Without `@ref` the latest release is taken, or
 * the default branch when the repository has no releases; the commit is looked up and kept, so what was installed can be told later.
 */
export async function fetchFromGithub(spec: GithubSpec, f: Fetcher = defaultFetcher): Promise<Fetched> {
  const repo = `${API}/repos/${encodeURIComponent(spec.owner)}/${encodeURIComponent(spec.repo)}`;
  let ref = spec.ref, tag: string | undefined;
  if (!ref) {
    try { tag = (await json<{ tag_name?: string }>(f, `${repo}/releases/latest`)).tag_name; } catch { /* no release: the default branch */ }
    ref = tag ?? (await json<{ default_branch?: string }>(f, repo)).default_branch ?? 'main';
  }
  const commit = (await json<{ sha?: string }>(f, `${repo}/commits/${encodeURIComponent(ref)}`)).sha;
  if (!commit || !/^[0-9a-f]{40}$/.test(commit)) throw new Error(t('Не вдалося визначити версію «{ref}» у репозиторії', { ref }));
  const dir = spec.dir ? `${spec.dir.replace(/\/+$/, '')}/` : '';
  const base = `https://raw.githubusercontent.com/${spec.owner}/${spec.repo}/${commit}/${dir.split('/').map(encodeURIComponent).join('/')}`.replace(/%2F/g, '/');
  const manifest = await get(f, base + MANIFEST_FILE, LIMITS.manifestBytes);
  const m = checkManifest(new TextDecoder().decode(manifest));
  if (!m.ok) throw new Error(m.errors.join('; '));
  const entries = await filesOf(f, base, Object.keys(m.manifest.files ?? {}));
  entries.set(MANIFEST_FILE, manifest);
  return { entries, source: { kind: 'github', location: `${spec.owner}/${spec.repo}${spec.dir ? `#${spec.dir}` : ''}`, ref: commit, installedAt: Date.now() } };
}

/** Only the manifest of a plugin on GitHub or on a server (to see whether a newer version is there), without the files. */
export async function fetchManifestText(source: PluginSource, f: Fetcher = defaultFetcher): Promise<string> {
  if (source.kind === 'github' && source.location) {
    const spec = parseGithubRef(source.location.replace('#', '#'));
    if (!spec) throw new Error(t('Не вдалося розпізнати репозиторій'));
    const repo = `${API}/repos/${encodeURIComponent(spec.owner)}/${encodeURIComponent(spec.repo)}`;
    let tag: string | undefined;
    try { tag = (await json<{ tag_name?: string }>(f, `${repo}/releases/latest`)).tag_name; } catch { /* the default branch */ }
    const ref = tag ?? (await json<{ default_branch?: string }>(f, repo)).default_branch ?? 'main';
    const commit = (await json<{ sha?: string }>(f, `${repo}/commits/${encodeURIComponent(ref)}`)).sha;
    const dir = spec.dir ? `${spec.dir.replace(/\/+$/, '')}/` : '';
    return new TextDecoder().decode(await get(f, `https://raw.githubusercontent.com/${spec.owner}/${spec.repo}/${commit}/${dir}${MANIFEST_FILE}`, LIMITS.manifestBytes));
  }
  if (source.kind === 'url' && source.location && !/\.(zip|transly-plugin)$/i.test(source.location)) return new TextDecoder().decode(await get(f, source.location, LIMITS.manifestBytes));
  throw new Error(t('Для цього розширення не можна перевірити оновлення'));
}

// ---------- local files ----------

/** Files the user chose: one zip or `.transly-plugin`, or the files of a package picked together (a folder). */
export async function fetchFromFiles(files: { name: string; data: Uint8Array }[]): Promise<Fetched> {
  const source: PluginSource = { kind: 'file', installedAt: Date.now() };
  if (files.length === 1 && /\.(zip|transly-plugin)$/i.test(files[0]!.name)) return { entries: await readZip(files[0]!.data), source };
  const entries = new Map<string, Uint8Array>();
  for (const f of files) entries.set(f.name.replace(/\\/g, '/'), f.data);
  // files picked as a folder come with the folder name in front: it is not part of the package
  if (!entries.has(MANIFEST_FILE)) {
    const hit = [...entries.keys()].find(p => p.endsWith(`/${MANIFEST_FILE}`));
    if (hit) { const dir = hit.slice(0, hit.length - MANIFEST_FILE.length); const moved = new Map<string, Uint8Array>(); for (const [p, b] of entries) if (p.startsWith(dir)) moved.set(p.slice(dir.length), b); return { entries: moved, source }; }
  }
  return { entries, source };
}
