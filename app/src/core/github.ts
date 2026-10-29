import { b64, dec, syncFiles, unb64 } from './filesync';
import type { FilesReport, FilesState, RemoteFiles } from './filesync';
import type { SavedProject } from './project';

/**
 * Sync through a GitHub repository the translator owns (see `syncFiles` for the file layout). Several devices
 * push to the same branch; a sync is a handful of git-data API requests however many files changed.
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

export type GithubState = FilesState;
export type GithubReport = FilesReport;
export { EMPTY_FILES_STATE as EMPTY_GITHUB_STATE } from './filesync';

export class GithubError extends Error {
  readonly status: number;
  constructor(message: string, status = 0) { super(message); this.status = status; }
}

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

/** The repository as a set of files: a branch head, its tree, and commits made with the git data API. */
export function githubRemote(api: GithubApi, cfg: GithubSettings): RemoteFiles {
  const repo = cfg.repo.trim();
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new GithubError('Репозиторій вкажіть як «власник/назва», наприклад ivan/my-translation');
  const base = `/repos/${repo}`;
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
  // What the last `head()` saw: the push builds on it.
  let branch = '', rootTree = '';

  return {
    async head() {
      const info = await call('GET', base, 'відкриття репозиторію');
      branch = cfg.branch.trim() || String(info.default_branch ?? 'main');
      let head = await getRef(branch);
      if (!head) {
        const def = await getRef(String(info.default_branch ?? 'main'));
        if (!def) throw explain(409, 'читання гілки');
        await call('POST', `${base}/git/refs`, 'створення гілки', { ref: `refs/heads/${branch}`, sha: def });
        head = def;
      }
      const commit = await call('GET', `${base}/git/commits/${head}`, 'читання коміту');
      rootTree = String(asObj(commit.tree).sha ?? '');
      const tree = await call('GET', `${base}/git/trees/${rootTree}?recursive=1`, 'читання списку файлів');
      if (tree.truncated === true) throw new GithubError('GitHub: у репозиторії забагато файлів. Вкажіть окрему папку або новий репозиторій');
      const files = new Map<string, string>();
      for (const t of (Array.isArray(tree.tree) ? tree.tree : []) as Json[]) if (t.type === 'blob' && typeof t.path === 'string') files.set(t.path, String(t.sha));
      return { id: head, files, isPrivate: info.private === true };
    },

    async read(path, sha) {
      const b = await call('GET', `${base}/git/blobs/${sha}`, `читання ${path}`);
      return unb64(String(b.content ?? ''));
    },

    // Text files go inline into the new tree, binary ones (the gzipped originals) as blobs first.
    async push(id, changes, message) {
      let baseTree = rootTree;
      let batch: { path: string; mode: string; type: string; content?: string; sha?: string }[] = [];
      let size = 0;
      const flush = async () => {
        if (!batch.length) return;
        baseTree = String((await call('POST', `${base}/git/trees`, 'запис файлів', { base_tree: baseTree, tree: batch })).sha);
        batch = []; size = 0;
      };
      for (const [path, bytes] of changes) {
        if (path.endsWith('.gz')) {
          const blob = await call('POST', `${base}/git/blobs`, 'запис файлу', { content: b64(bytes), encoding: 'base64' });
          batch.push({ path, mode: '100644', type: 'blob', sha: String(blob.sha) });
        } else {
          if (size + bytes.length > CHUNK_BYTES) await flush();
          batch.push({ path, mode: '100644', type: 'blob', content: dec.decode(bytes) });
          size += bytes.length;
        }
      }
      await flush();
      const made = await call('POST', `${base}/git/commits`, 'створення коміту', { message, tree: baseTree, parents: [id] });
      const newHead = String(made.sha);
      const upd = await api.request('PATCH', `${base}/git/refs/heads/${branch}`, { sha: newHead, force: false }).catch(() => { throw explain(0, 'оновлення гілки'); });
      if (upd.status === 422) {
        // A real race leaves the branch somewhere else than where we built on; anything else is GitHub refusing the update.
        // When even the re-read fails (network, 5xx) we cannot tell a race from a refusal: try again instead of aborting.
        const now = await getRef(branch).then(r => ({ r }), () => null);
        if (now === null || (now.r !== null && now.r !== id)) return { ok: false };
        throw new GithubError(`GitHub: оновлення гілки відхилено: ${String(asObj(upd.json).message ?? 'без пояснення')}`, 422);
      }
      if (upd.status !== 200) throw explain(upd.status, 'оновлення гілки');
      return { ok: true, id: newHead };
    },
  };
}

export function githubSync(api: GithubApi, cfg: GithubSettings, state: GithubState, local: SavedProject, opts: { since?: number; maxTries?: number } = {}): Promise<GithubReport> {
  return syncFiles(githubRemote(api, cfg), { dir: cfg.dir, originals: cfg.originals }, state, local, opts).catch(e => {
    // The generic loop knows nothing about GitHub: keep every message recognisable as coming from it.
    if (e instanceof GithubError || !(e instanceof Error) || e.message.startsWith('GitHub:')) throw e;
    throw new GithubError(`GitHub: ${e.message}`);
  });
}

