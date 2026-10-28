import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { GithubApi } from '../src/core';

const sha1 = (b: Buffer): string => createHash('sha1').update(b).digest('hex');
const blobSha = (b: Buffer): string => sha1(Buffer.concat([Buffer.from(`blob ${b.length}\0`), b]));

interface Commit { sha: string; tree: string; parents: string[]; message: string }

/**
 * Just enough of GitHub's REST git-data API to test syncing: one repository, branches, commits, flat trees.
 * Trees are stored flat (path → blob), which is also how `?recursive=1` shows them.
 */
export class MockGithub implements GithubApi {
  blobs = new Map<string, Buffer>();
  trees = new Map<string, Map<string, string>>();
  commits = new Map<string, Commit>();
  refs = new Map<string, string>();
  requests: string[] = [];
  /** Called before a PATCH of a ref: lets a test push from "another device" at exactly that moment. */
  beforeRefUpdate: (() => void) | null = null;
  /** Test switch: GitHub refuses every ref update with 422 although the branch did not move. */
  rejectRefUpdates = false;
  readonly repo: string;
  isPrivate: boolean;
  readonly token: string;
  readonly defaultBranch: string;
  // Plain fields, not parameter properties: Node's type stripping (used to run this mock over HTTP) does not support those.
  constructor(repo = 'me/tr', isPrivate = true, token = 'tok', defaultBranch = 'main', init = true) {
    this.repo = repo; this.isPrivate = isPrivate; this.token = token; this.defaultBranch = defaultBranch;
    if (init) this.commitFiles(this.defaultBranch, { 'README.md': '# translations\n' }, 'init');
  }

  /** Test helper: add a commit with these files on a branch, as another device would. */
  commitFiles(branch: string, files: Record<string, string | Buffer>, message = 'test'): string {
    const parent = this.refs.get(branch);
    const tree = new Map(parent ? this.trees.get(this.commits.get(parent)!.tree)! : []);
    for (const [path, content] of Object.entries(files)) { const b = Buffer.from(content); const s = blobSha(b); this.blobs.set(s, b); tree.set(path, s); }
    const treeSha = this.putTree(tree);
    const c = this.putCommit(treeSha, parent ? [parent] : [], message);
    this.refs.set(branch, c);
    return c;
  }
  files(branch = this.defaultBranch): Map<string, string> { return this.trees.get(this.commits.get(this.refs.get(branch)!)!.tree)!; }
  text(path: string, branch = this.defaultBranch): string | undefined { const s = this.files(branch).get(path); return s ? this.blobs.get(s)!.toString('utf8') : undefined; }
  commitCount(branch = this.defaultBranch): number { let n = 0; for (let c = this.refs.get(branch); c; c = this.commits.get(c)!.parents[0]) n++; return n; }

  private putTree(t: Map<string, string>): string {
    const sha = sha1(Buffer.from([...t].sort(([a], [b]) => (a < b ? -1 : 1)).map(([p, s]) => `${p}\0${s}`).join('\n')));
    this.trees.set(sha, t);
    return sha;
  }
  private putCommit(tree: string, parents: string[], message: string): string {
    const sha = sha1(Buffer.from(`${tree}\n${parents.join(',')}\n${message}\n${this.commits.size}`));
    this.commits.set(sha, { sha, tree, parents, message });
    return sha;
  }
  private isAncestor(a: string, of: string): boolean { for (let c: string | undefined = of; c; c = this.commits.get(c)!.parents[0]) if (c === a) return true; return false; }

  async request(method: string, path: string, body?: unknown, token = this.token): Promise<{ status: number; json: unknown }> {
    this.requests.push(`${method} ${path}`);
    return this.handle(method, path, body as Record<string, unknown> | undefined, token);
  }

  handle(method: string, rawPath: string, body: Record<string, unknown> | undefined, token: string): { status: number; json: unknown } {
    const [path, query = ''] = rawPath.split('?');
    if (token !== this.token) return { status: 401, json: { message: 'Bad credentials' } };
    const m = new RegExp(`^/repos/${this.repo}(/.*)?$`).exec(path!);
    if (!m) return { status: 404, json: { message: 'Not Found' } };
    const sub = m[1] ?? '';
    if (method === 'GET' && sub === '') return { status: 200, json: { private: this.isPrivate, default_branch: this.defaultBranch } };
    let x: RegExpExecArray | null;
    if (method === 'GET' && (x = /^\/git\/ref\/heads\/(.+)$/.exec(sub))) {
      const sha = this.refs.get(x[1]!);
      if (!sha) return this.refs.size ? { status: 404, json: { message: 'Not Found' } } : { status: 409, json: { message: 'Git Repository is empty.' } };
      return { status: 200, json: { object: { sha } } };
    }
    if (method === 'POST' && sub === '/git/refs') {
      const ref = String(body!.ref).replace(/^refs\/heads\//, '');
      if (this.refs.has(ref)) return { status: 422, json: { message: 'Reference already exists' } };
      this.refs.set(ref, String(body!.sha));
      return { status: 201, json: {} };
    }
    if (method === 'GET' && (x = /^\/git\/commits\/(.+)$/.exec(sub))) { const c = this.commits.get(x[1]!); return c ? { status: 200, json: { sha: c.sha, tree: { sha: c.tree }, parents: c.parents.map(sha => ({ sha })) } } : { status: 404, json: {} }; }
    if (method === 'GET' && (x = /^\/git\/trees\/(.+)$/.exec(sub))) {
      const t = this.trees.get(x[1]!);
      if (!t) return { status: 404, json: {} };
      void query;
      return { status: 200, json: { sha: x[1], truncated: false, tree: [...t].map(([p, s]) => ({ path: p, mode: '100644', type: 'blob', sha: s, size: this.blobs.get(s)!.length })) } };
    }
    if (method === 'GET' && (x = /^\/git\/blobs\/(.+)$/.exec(sub))) { const b = this.blobs.get(x[1]!); return b ? { status: 200, json: { sha: x[1], encoding: 'base64', size: b.length, content: b.toString('base64') } } : { status: 404, json: {} }; }
    if (method === 'POST' && sub === '/git/blobs') {
      const b = body!.encoding === 'base64' ? Buffer.from(String(body!.content), 'base64') : Buffer.from(String(body!.content));
      const s = blobSha(b); this.blobs.set(s, b);
      return { status: 201, json: { sha: s } };
    }
    if (method === 'POST' && sub === '/git/trees') {
      const t = new Map(body!.base_tree ? this.trees.get(String(body!.base_tree)) : []);
      for (const e of body!.tree as { path: string; sha?: string; content?: string }[]) {
        if (e.content !== undefined) { const b = Buffer.from(e.content); const s = blobSha(b); this.blobs.set(s, b); t.set(e.path, s); }
        else if (e.sha) t.set(e.path, e.sha);
      }
      return { status: 201, json: { sha: this.putTree(t) } };
    }
    if (method === 'POST' && sub === '/git/commits') return { status: 201, json: { sha: this.putCommit(String(body!.tree), body!.parents as string[], String(body!.message)) } };
    if (method === 'PATCH' && (x = /^\/git\/refs\/heads\/(.+)$/.exec(sub))) {
      this.beforeRefUpdate?.();
      if (this.rejectRefUpdates) return { status: 422, json: { message: 'Required status check is expected' } };
      const cur = this.refs.get(x[1]!);
      if (!cur) return { status: 404, json: {} };
      if (!this.isAncestor(cur, String(body!.sha)) && !body!.force) return { status: 422, json: { message: 'Update is not a fast forward' } };
      this.refs.set(x[1]!, String(body!.sha));
      return { status: 200, json: {} };
    }
    return { status: 404, json: { message: `unhandled ${method} ${sub}` } };
  }
}

/** The same mock over HTTP with CORS, for driving the real UI in a browser. */
export function serveMock(mock: MockGithub, port: number): Promise<Server> {
  const server = createServer((req, res) => {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,OPTIONS' };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors).end(); return; }
    const chunks: Buffer[] = [];
    req.on('data', c => chunks.push(c as Buffer));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const token = /^Bearer (.+)$/.exec(String(req.headers.authorization ?? ''))?.[1] ?? '';
      const r = mock.handle(req.method ?? 'GET', req.url ?? '/', raw ? (JSON.parse(raw) as Record<string, unknown>) : undefined, token);
      mock.requests.push(`${req.method} ${req.url}`);
      res.writeHead(r.status, { 'Content-Type': 'application/json', ...cors }).end(JSON.stringify(r.json));
    });
  });
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve(server)));
}
