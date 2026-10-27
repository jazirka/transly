import { open, seal } from './crypto';
import type { SyncKeys } from './crypto';
import { deserialize, mergeProjects, serialize } from './project';
import type { SavedProject } from './project';

export type Blob_ = 'data' | 'snap';

/** What the relay offers. `etag` changes on every write; `put` fails with `conflict` when `ifMatch` is stale. */
export interface Transport {
  get(room: string, kind: Blob_): Promise<{ etag: string; bytes: Uint8Array } | null>;
  put(room: string, kind: Blob_, bytes: Uint8Array, ifMatch: string | null): Promise<{ ok: true; etag: string } | { ok: false; conflict: true }>;
}

export interface SyncReport {
  project: SavedProject;
  pulled: boolean;
  pushed: boolean;
  conflicts: number;
  /** Original strings were fetched from the relay (this device had none). */
  gotSnapshot: boolean;
}

/** The translator's data without the (large, rarely changing) game snapshot. */
const lite = (p: SavedProject): SavedProject => { const { snapshot: _s, ...rest } = p; return rest; };

/**
 * One round trip: download the shared copy, merge it with ours (newer edit per unit wins),
 * upload the result. Retries when another device wrote in between. The relay stores only encrypted bytes.
 */
export async function syncOnce(t: Transport, keys: SyncKeys, local: SavedProject, opts: { since?: number; maxTries?: number } = {}): Promise<SyncReport> {
  const since = opts.since ?? 0, maxTries = opts.maxTries ?? 4;
  let project = local;
  let gotSnapshot = false;
  let pulled = false, conflicts = 0;

  // Original strings: fetch when we lack them, publish when the relay lacks them.
  const snap = await t.get(keys.room, 'snap');
  if (!project.snapshot && snap) {
    const r = deserialize(await open(keys, snap.bytes));
    if (r.snapshot) { project = { ...project, snapshot: r.snapshot }; gotSnapshot = true; }
  } else if (project.snapshot && !snap) {
    await t.put(keys.room, 'snap', await seal(keys, serialize({ ...lite(project), snapshot: project.snapshot })), null);
  }

  for (let i = 0; i < maxTries; i++) {
    const remote = await t.get(keys.room, 'data');
    let etag: string | null = null;
    if (remote) {
      const theirs = deserialize(await open(keys, remote.bytes));
      const m = mergeProjects(project, theirs, since);
      conflicts += m.conflicts.length;
      project = { ...m.project, ...(project.snapshot ? { snapshot: project.snapshot } : {}) };
      etag = remote.etag;
      pulled = true;
    }
    const res = await t.put(keys.room, 'data', await seal(keys, serialize(lite(project))), etag);
    if (res.ok) return { project, pulled, pushed: true, conflicts, gotSnapshot };
  }
  throw new Error('Не вдалося синхронізувати: інший пристрій постійно змінює дані. Спробуйте ще раз');
}

/** Transport over HTTP to a Transly relay (see server/relay.ts). */
export function httpTransport(baseUrl: string, fetchFn: typeof fetch = fetch): Transport {
  const base = baseUrl.replace(/\/+$/, '');
  const url = (room: string, kind: Blob_) => `${base}/r/${room}/${kind}`;
  const fail = (what: string, status: number): never => { throw new Error(`Сервер синхронізації: ${what} (${status})`); };
  return {
    async get(room, kind) {
      const r = await fetchFn(url(room, kind));
      if (r.status === 404) return null;
      if (!r.ok) return fail('не вдалося отримати дані', r.status);
      return { etag: r.headers.get('ETag') ?? '', bytes: new Uint8Array(await r.arrayBuffer()) };
    },
    async put(room, kind, bytes, ifMatch) {
      const r = await fetchFn(url(room, kind), { method: 'PUT', body: bytes as BodyInit, headers: ifMatch ? { 'If-Match': ifMatch } : {} });
      if (r.status === 412) return { ok: false, conflict: true };
      if (!r.ok) return fail('не вдалося надіслати дані', r.status);
      return { ok: true, etag: r.headers.get('ETag') ?? '' };
    },
  };
}
