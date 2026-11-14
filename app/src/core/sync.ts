import { open, seal } from './crypto';
import { REQUEST_TIMEOUT_MS, isTimeout, withTimeout } from './net';
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
  /** Rows a reset of the project dropped although they were marked within a day before it (see `ProjectMerge`). */
  droppedByReset?: number;
  /** Original strings were fetched from the relay (this device had none). */
  gotSnapshot: boolean;
}

/** The translator's data without the (large, rarely changing) game snapshot and reference language. */
const lite = (p: SavedProject): SavedProject => { const { snapshot: _s, reference: _r, ...rest } = p; return rest; };
const assetsOf = (p: SavedProject): SavedProject => ({ ...lite(p), ...(p.snapshot ? { snapshot: p.snapshot } : {}), ...(p.reference ? { reference: p.reference } : {}) });

/**
 * One round trip: download the shared copy, merge it with ours (newer edit per unit wins),
 * upload the result. Retries when another device wrote in between. The relay stores only encrypted bytes.
 * The large game assets (original strings, reference language) travel in a separate blob and only when their
 * revision differs, so ordinary syncs stay small.
 */
export async function syncOnce(t: Transport, keys: SyncKeys, local: SavedProject, opts: { since?: number; maxTries?: number } = {}): Promise<SyncReport> {
  const since = opts.since ?? 0, maxTries = opts.maxTries ?? 4;
  let project = local;
  let gotSnapshot = false;
  let pulled = false, conflicts = 0, droppedByReset = 0;

  for (let i = 0; i < maxTries; i++) {
    const remote = await t.get(keys.room, 'data');
    let etag: string | null = null;
    let theirRev = 0;
    if (remote) {
      const theirs = deserialize(await open(keys, remote.bytes), Date.now());
      theirRev = theirs.assetsRev ?? 0;
      const m = mergeProjects(project, theirs, since);
      conflicts += m.conflicts.length; droppedByReset += m.droppedByReset;
      project = m.project;
      etag = remote.etag;
      pulled = true;
    }
    const myRev = local.assetsRev ?? 0;
    if (theirRev > myRev && !gotSnapshot) {
      // Another device has newer game assets: fetch them.
      const snap = await t.get(keys.room, 'snap');
      if (snap) {
        const a = deserialize(await open(keys, snap.bytes), Date.now());
        project = { ...project, ...(a.snapshot ? { snapshot: a.snapshot } : {}), ...(a.reference ? { reference: a.reference } : {}), assetsRev: theirRev };
        gotSnapshot = true;
      }
    } else if (myRev > theirRev && (project.snapshot || project.reference)) {
      await t.put(keys.room, 'snap', await seal(keys, serialize(assetsOf(project))), null).then(async res => {
        if (!res.ok) { const cur = await t.get(keys.room, 'snap'); await t.put(keys.room, 'snap', await seal(keys, serialize(assetsOf(project))), cur?.etag ?? null); }
      });
    }
    const res = await t.put(keys.room, 'data', await seal(keys, serialize(lite(project))), etag);
    if (res.ok) return { project, pulled, pushed: true, conflicts, gotSnapshot, droppedByReset };
  }
  throw new Error('Не вдалося синхронізувати: інший пристрій постійно змінює дані. Спробуйте ще раз');
}

/** Transport over HTTP to a Transly relay (see server/relay.ts). */
export function httpTransport(baseUrl: string, fetchFn: typeof fetch = fetch): Transport {
  const base = baseUrl.replace(/\/+$/, '');
  const url = (room: string, kind: Blob_) => `${base}/r/${room}/${kind}`;
  const timedOut = (e: unknown): never => { throw isTimeout(e) ? new Error(`Сервер синхронізації не відповів за ${REQUEST_TIMEOUT_MS / 1000} с: перевірте адресу й з’єднання`) : e; };
  const fail = (what: string, status: number): never => { throw new Error(`Сервер синхронізації: ${what} (${status})`); };
  return {
    async get(room, kind) {
      const r = await fetchFn(url(room, kind), withTimeout()).catch(timedOut);
      if (r.status === 404) return null;
      if (!r.ok) return fail('не вдалося отримати дані', r.status);
      return { etag: r.headers.get('ETag') ?? '', bytes: new Uint8Array(await r.arrayBuffer()) };
    },
    async put(room, kind, bytes, ifMatch) {
      const r = await fetchFn(url(room, kind), withTimeout({ method: 'PUT', body: bytes as BodyInit, headers: ifMatch ? { 'If-Match': ifMatch } : {} })).catch(timedOut);
      if (r.status === 412) return { ok: false, conflict: true };
      if (!r.ok) return fail('не вдалося надіслати дані', r.status);
      return { ok: true, etag: r.headers.get('ETag') ?? '' };
    },
  };
}
