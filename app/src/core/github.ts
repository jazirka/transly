import { gunzip, gzip } from './crypto';
import type { Translations } from './model';
import { deserialize, mergeProjects } from './project';
import type { SavedProject } from './project';

/**
 * Sync through a GitHub repository the translator owns. The project is stored as plain, diff-friendly files:
 *
 *   project.json                    glossary, memory, speakers, settings (everything but the per-file work)
 *   translations/<file>.tr.json     one file per game file: unit key → translation, status, comments, history
 *   originals/snapshot.json.gz      the game's original strings (so a phone without the game can show them)
 *   originals/reference.json.gz     the reference-language texts
 *
 * Several devices push to the same branch; each sync downloads what changed, merges it unit by unit (the newer
 * edit wins, like every other merge here) and pushes the result as one commit. Only the git data API is used, so a
 * sync is a handful of requests however many files changed.
 */

export interface GithubApi {
  request(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown): Promise<{ status: number; json: unknown }>;
}

export interface GithubSettings {
  /** `owner/name` */
  repo: string;
  /** Empty = the repository's default branch. A branch that does not exist yet is created from the default one. */
  branch: string;
  /** Folder inside the repository; empty = the root. */
  dir: string;
  /** Keep the game's original strings in the repository. Only done for a private repository. */
  originals: boolean;
}

/** What this device saw in the repository last time; lets the next sync download only what changed. */
export interface GithubState {
  shas: Record<string, string>;
  commit: string;
  /** Revision of the game's originals as stored in the repository. */
  assetsRev: number;
}
export const EMPTY_GITHUB_STATE: GithubState = { shas: {}, commit: '', assetsRev: 0 };

export interface GithubReport {
  project: SavedProject;
  /** Files downloaded from the repository. */
  pulled: number;
  /** Files written to the repository (0 = nothing to push, no commit). */
  pushed: number;
  conflicts: number;
  gotSnapshot: boolean;
  /** The repository is public, so the game's original strings were left out of it. */
  skippedOriginals: boolean;
  state: GithubState;
}

export class GithubError extends Error {
  constructor(message: string, readonly status = 0) { super(message); }
}

const enc = new TextEncoder();
const dec = new TextDecoder();

/** Same JSON for the same data on every device (keys sorted at every level), so unchanged work is never re-pushed. */
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, x]) => [k, canonical(x)]));
  return v;
}
const pretty = (v: unknown): string => JSON.stringify(canonical(v), null, 1) + '\n';

const toHex = (b: ArrayBuffer): string => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');

/** The id git gives a file: SHA-1 of "blob <size>\0" and the bytes. Lets us tell what changed without downloading. */
export async function gitBlobSha(bytes: Uint8Array): Promise<string> {
  const head = enc.encode(`blob ${bytes.length}\0`);
  const all = new Uint8Array(head.length + bytes.length);
  all.set(head); all.set(bytes, head.length);
  return toHex(await crypto.subtle.digest('SHA-1', all));
}

const normDir = (d: string): string => { const t = d.trim().replace(/^\/+|\/+$/g, ''); return t ? t + '/' : ''; };

/** The repository files for a project. Binary assets are included only when asked. */
export async function projectFiles(p: SavedProject, dirIn: string, withAssets: boolean): Promise<Map<string, Uint8Array>> {
  const dir = normDir(dirIn);
  const out = new Map<string, Uint8Array>();
  const { files, snapshot: _s, reference: _r, ...manifest } = p;
  out.set(`${dir}project.json`, enc.encode(pretty(manifest)));
  for (const [name, entries] of Object.entries(files)) if (Object.keys(entries).length) out.set(`${dir}translations/${name}.tr.json`, enc.encode(pretty(entries)));
  if (withAssets && p.snapshot) out.set(`${dir}originals/snapshot.json.gz`, await gzip(enc.encode(JSON.stringify(p.snapshot))));
  if (withAssets && p.reference) out.set(`${dir}originals/reference.json.gz`, await gzip(enc.encode(JSON.stringify(p.reference))));
  return out;
}

const b64 = (bytes: Uint8Array): string => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s: string): Uint8Array => Uint8Array.from(atob(s.replace(/\s/g, '')), c => c.charCodeAt(0));

function explain(status: number, what: string): GithubError {
  const why = status === 401 ? 'токен недійсний або прострочений'
    : status === 403 ? 'немає прав або вичерпано ліміт запитів (токен має мати доступ «Contents: Read and write» до цього репозиторію)'
    : status === 404 ? 'репозиторій не знайдено (для приватного токен має мати до нього доступ)'
    : status === 409 ? 'репозиторій порожній: створіть у ньому будь-який файл (наприклад README) і повторіть'
    : status === 422 ? 'GitHub відхилив запит'
    : status === 0 ? 'немає з’єднання з GitHub'
    : `помилка ${status}`;
  return new GithubError(`GitHub: ${what}: ${why}`, status);
}

type Json = Record<string, unknown>;
const asObj = (v: unknown): Json => (v && typeof v === 'object' ? (v as Json) : {});

/** Tree creation is split so one request never carries more than this many bytes of text. */
const CHUNK_BYTES = 6_000_000;

export async function githubSync(api: GithubApi, cfg: GithubSettings, state: GithubState, local: SavedProject, opts: { since?: number; maxTries?: number } = {}): Promise<GithubReport> {
  const repo = cfg.repo.trim();
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new GithubError('Репозиторій вкажіть як «власник/назва», наприклад ivan/my-translation');
  const dir = normDir(cfg.dir);
  const base = `/repos/${repo}`;
  const since = opts.since ?? 0, maxTries = opts.maxTries ?? 4;
  const call = async (method: 'GET' | 'POST' | 'PATCH', path: string, what: string, body?: unknown, okStatus: number[] = [200, 201]): Promise<Json> => {
    let r: { status: number; json: unknown };
    try { r = await api.request(method, path, body); } catch { throw explain(0, what); }
    if (!okStatus.includes(r.status)) throw explain(r.status, what);
    return asObj(r.json);
  };
  const getRef = async (branch: string): Promise<string | null> => {
    const r = await api.request('GET', `${base}/git/ref/heads/${branch}`).catch(() => { throw explain(0, 'читання гілки'); });
    if (r.status === 404 || r.status === 409) return null;
    if (r.status !== 200) throw explain(r.status, 'читання гілки');
    return String(asObj(asObj(r.json).object).sha ?? '');
  };

  let project = local;
  let pulled = 0, conflicts = 0, gotSnapshot = false, skippedOriginals = false;

  for (let attempt = 0; attempt < maxTries; attempt++) {
    const info = await call('GET', base, 'відкриття репозиторію');
    const isPrivate = info.private === true;
    const branch = cfg.branch.trim() || String(info.default_branch ?? 'main');
    const withAssets = cfg.originals && isPrivate;
    skippedOriginals = cfg.originals && !isPrivate;

    let head = await getRef(branch);
    if (!head) {
      const def = await getRef(String(info.default_branch ?? 'main'));
      if (!def) throw explain(409, 'читання гілки');
      await call('POST', `${base}/git/refs`, 'створення гілки', { ref: `refs/heads/${branch}`, sha: def });
      head = def;
    }
    const commit = await call('GET', `${base}/git/commits/${head}`, 'читання коміту');
    const rootTree = String(asObj(commit.tree).sha ?? '');
    const tree = await call('GET', `${base}/git/trees/${rootTree}?recursive=1`, 'читання списку файлів');
    if (tree.truncated === true) throw new GithubError('GitHub: у репозиторії забагато файлів. Вкажіть окрему папку або новий репозиторій');
    const remote = new Map<string, string>();
    for (const t of (Array.isArray(tree.tree) ? tree.tree : []) as Json[]) if (t.type === 'blob' && typeof t.path === 'string' && t.path.startsWith(dir)) remote.set(t.path, String(t.sha));

    // ---- download what changed since this device last looked, and what differs from what we would write
    const mine = await projectFiles(project, dir, withAssets);
    const mineSha = new Map<string, string>();
    for (const [path, bytes] of mine) mineSha.set(path, await gitBlobSha(bytes));
    const wanted = (path: string) => path === `${dir}project.json` || (path.startsWith(`${dir}translations/`) && path.endsWith('.tr.json'));
    // A file we already hold (same content) or saw last time needs no download, unless this device lost its copy.
    const toGet = [...remote].filter(([path, sha]) => wanted(path) && (state.shas[path] !== sha || !mine.has(path)) && mineSha.get(path) !== sha).map(([path]) => path);
    const blobs = new Map<string, Uint8Array>();
    const fetchBlob = async (path: string) => {
      const sha = remote.get(path)!;
      const b = await call('GET', `${base}/git/blobs/${sha}`, `читання ${path.slice(dir.length)}`);
      blobs.set(path, unb64(String(b.content ?? '')));
    };
    await inBatches(toGet, 6, fetchBlob);
    pulled += toGet.length;

    const pj = `${dir}project.json`;
    // The revision of the originals the repository holds: from its project.json when we read it, else what we knew.
    let remoteRev = remote.get(pj) === mineSha.get(pj) ? (project.assetsRev ?? 0) : state.assetsRev;
    if (toGet.length) {
      const files: Record<string, Translations> = {};
      for (const path of toGet) if (path.startsWith(`${dir}translations/`)) files[path.slice(`${dir}translations/`.length, -'.tr.json'.length)] = JSON.parse(dec.decode(blobs.get(path)!)) as Translations;
      const manifestBytes = blobs.get(pj);
      // Without a changed project.json the repository has nothing new but per-file work: merge it onto our own manifest.
      const manifest: Json = manifestBytes ? asObj(JSON.parse(dec.decode(manifestBytes))) : (() => { const { files: _f, snapshot: _s, reference: _r, ...m } = project; return m as Json; })();
      const theirs = deserialize(JSON.stringify({ ...manifest, files }));
      if (manifestBytes) remoteRev = theirs.assetsRev ?? 0;
      const myRev = project.assetsRev ?? 0;
      let remoteProject = theirs;
      let gotAssets = false;
      if (remoteRev > myRev && withAssets) {
        const read = async (path: string, what: string) => JSON.parse(dec.decode(await gunzip(unb64(String((await call('GET', `${base}/git/blobs/${remote.get(path)}`, what)).content ?? ''))))) as unknown;
        const snapPath = `${dir}originals/snapshot.json.gz`, refPath = `${dir}originals/reference.json.gz`;
        const assets: Json = {};
        if (remote.has(snapPath)) { assets.snapshot = await read(snapPath, 'читання оригінальних рядків'); pulled++; }
        if (remote.has(refPath)) { assets.reference = await read(refPath, 'читання довідкової мови'); pulled++; }
        if (assets.snapshot || assets.reference) { remoteProject = { ...theirs, ...assets } as SavedProject; gotAssets = gotSnapshot = true; }
      }
      const m = mergeProjects(project, remoteProject, since);
      conflicts += m.conflicts.length;
      project = m.project;
      // Do not claim a newer revision of the originals than we actually hold.
      if (remoteRev > myRev && !gotAssets && !project.snapshot) { const { assetsRev: _a, ...rest } = project; project = { ...rest, ...(myRev ? { assetsRev: myRev } : {}) }; }
    }

    // ---- what to write: files whose content differs from the repository; originals only when they are new there
    const out = await projectFiles(project, dir, withAssets);
    const outSha = new Map<string, string>();
    for (const [path, bytes] of out) outSha.set(path, await gitBlobSha(bytes));
    const isAsset = (p: string) => p.startsWith(`${dir}originals/`);
    const newer = (project.assetsRev ?? 0) > remoteRev;
    const changed = [...out.keys()].filter(p => (isAsset(p) ? !remote.has(p) || newer : outSha.get(p) !== remote.get(p)));
    const pushedAssets = changed.some(isAsset);

    const nextShas: Record<string, string> = {};
    for (const [p, sha] of remote) if (wanted(p) || isAsset(p)) nextShas[p] = sha;
    if (!changed.length) return { project, pulled, pushed: 0, conflicts, gotSnapshot, skippedOriginals, state: { shas: nextShas, commit: head, assetsRev: remoteRev } };

    // ---- push: text files go inline into the new tree, binary ones as blobs first
    let baseTree = rootTree;
    let batch: { path: string; mode: string; type: string; content?: string; sha?: string }[] = [];
    let size = 0;
    const flush = async () => {
      if (!batch.length) return;
      baseTree = String((await call('POST', `${base}/git/trees`, 'запис файлів', { base_tree: baseTree, tree: batch })).sha);
      batch = []; size = 0;
    };
    for (const path of changed) {
      const bytes = out.get(path)!;
      if (isAsset(path)) {
        const blob = await call('POST', `${base}/git/blobs`, 'запис файлу', { content: b64(bytes), encoding: 'base64' });
        batch.push({ path, mode: '100644', type: 'blob', sha: String(blob.sha) });
      } else {
        if (size + bytes.length > CHUNK_BYTES) await flush();
        batch.push({ path, mode: '100644', type: 'blob', content: dec.decode(bytes) });
        size += bytes.length;
      }
    }
    await flush();
    const made = await call('POST', `${base}/git/commits`, 'створення коміту', { message: `Transly: синхронізація (${changed.length} ${changed.length === 1 ? 'файл' : 'файлів'})`, tree: baseTree, parents: [head] });
    const newHead = String(made.sha);
    const upd = await api.request('PATCH', `${base}/git/refs/heads/${branch}`, { sha: newHead, force: false }).catch(() => { throw explain(0, 'оновлення гілки'); });
    if (upd.status === 422) continue; // someone pushed in between: merge their work and try again
    if (upd.status !== 200) throw explain(upd.status, 'оновлення гілки');
    for (const p of changed) nextShas[p] = outSha.get(p)!;
    return { project, pulled, pushed: changed.length, conflicts, gotSnapshot, skippedOriginals, state: { shas: nextShas, commit: newHead, assetsRev: pushedAssets ? project.assetsRev ?? 0 : remoteRev } };
  }
  throw new GithubError('GitHub: інший пристрій постійно змінює дані. Спробуйте ще раз');
}

async function inBatches<T>(items: T[], n: number, fn: (x: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += n) await Promise.all(items.slice(i, i + n).map(fn));
}
