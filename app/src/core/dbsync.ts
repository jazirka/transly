import { gunzip, gzip } from './crypto';
import { EMPTY_FILES_STATE, b64, gitBlobSha, syncFiles, unb64 } from './filesync';
import type { FilesReport, FilesState, RemoteFiles } from './filesync';
import type { SavedProject } from './project';

/**
 * Sync through the artifact's own shared database (the `db` capability): both devices open the same artifact, so no
 * file picker, no outside server and no account are needed. Works where a phone cannot choose files at all.
 *
 *   sync/index   { rev, files: { path: { sha, n, z } } }       what the shared copy consists of
 *   blobs/<sha>_<i>   { i, n, data }                            content-addressed chunks (base64) of each file
 *
 * A document may hold 256 KiB, so every file is gzipped, base64-encoded and split into chunks. Chunks are written
 * before the index, so a reader never sees a file whose parts are missing; the index itself is changed under a short
 * lease so two devices do not overwrite each other.
 */

/** The part of the artifact's `db` handle this module uses. */
export interface DbDoc {
  get(): Promise<{ exists: boolean; data(): Record<string, unknown> | undefined }>;
  set(data: Record<string, unknown>): Promise<void>;
  delete(): Promise<void>;
  acquire(o: { holder: string; ttlMs?: number }): Promise<{ acquired: boolean }>;
}
export interface DbLike { doc(path: string): DbDoc }

export class DbSyncError extends Error {}

/** Characters of base64 per chunk document: well under the 256 KiB a document may hold. */
const CHUNK_CHARS = 180_000;
const INDEX = 'sync/index', LOCK = 'sync/lock';

interface Entry { sha: string; n: number; z: boolean }
const entriesOf = (data: Record<string, unknown> | undefined): Record<string, Entry> => {
  const f = data?.files;
  return f && typeof f === 'object' ? (f as Record<string, Entry>) : {};
};

function explain(e: unknown): DbSyncError {
  const code = (e as { code?: string } | null)?.code;
  const why = code === 'quota_exceeded' ? 'спільна база артефакта заповнена. Видаліть непотрібні дані або зробіть окремий артефакт'
    : code === 'resource_exhausted' ? 'забагато запитів, спробуйте за хвилину'
    : code === 'revoked' || code === 'not_granted' ? 'немає доступу до бази артефакта (відкрийте артефакт під своїм обліковим записом)'
    : code === 'invalid_argument' ? 'база відхилила запис. Записувати може лише власник артефакта'
    : code ? 'база тимчасово недоступна' : (e instanceof Error ? e.message : 'невідома помилка');
  return new DbSyncError(`Спільна база: ${why}`);
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/** One database call, retried a few times when the platform says it is busy; other failures become readable errors. */
async function call<T>(fn: () => Promise<T>, delayMs: number): Promise<T> {
  for (let i = 0; ; i++) {
    try { return await fn(); }
    catch (e) {
      const code = (e as { code?: string } | null)?.code;
      if (i < 3 && (code === 'resource_exhausted' || code === 'unavailable')) { await sleep(delayMs * 2 ** i * (0.5 + Math.random())); continue; }
      throw explain(e);
    }
  }
}

/** The shared database as a set of files. `holder` names this device for the lease. */
export function dbRemote(db: DbLike, holder: string, opts: { retryDelayMs?: number; lockWaitMs?: number } = {}): RemoteFiles {
  const delay = opts.retryDelayMs ?? 400, lockWait = opts.lockWaitMs ?? 8000;
  const index = db.doc(INDEX), lock = db.doc(LOCK);
  let seen: Record<string, Entry> = {};

  return {
    async head() {
      const d = (await call(() => index.get(), delay)).data();
      seen = entriesOf(d);
      return { id: String(typeof d?.rev === 'number' ? d.rev : 0), files: new Map(Object.entries(seen).map(([p, e]) => [p, e.sha])), isPrivate: true };
    },

    async read(path, sha) {
      const e = seen[path];
      if (!e || e.sha !== sha) throw new DbSyncError('Спільна база: файл змінився під час читання. Повторіть синхронізацію');
      const parts: string[] = new Array<string>(e.n);
      for (let i = 0; i < e.n; i += 6) {
        await Promise.all(Array.from({ length: Math.min(6, e.n - i) }, async (_, k) => {
          const d = (await call(() => db.doc(`blobs/${sha}_${i + k}`).get(), delay)).data();
          if (typeof d?.data !== 'string') throw new DbSyncError('Спільна база: частину файлу не знайдено. Синхронізуйте ще раз на пристрої, де ці дані є');
          parts[i + k] = d.data;
        }));
      }
      const bytes = unb64(parts.join(''));
      return e.z ? gunzip(bytes) : bytes;
    },

    async push(id, changes) {
      // 1. The chunks. They are named by content, so nothing existing is touched and a retry costs little.
      const added: Record<string, Entry> = {};
      for (const [path, bytes] of changes) {
        const sha = await gitBlobSha(bytes);
        const z = !path.endsWith('.gz'); // the originals are gzipped already
        const text = b64(z ? await gzip(bytes) : bytes);
        const n = Math.max(1, Math.ceil(text.length / CHUNK_CHARS));
        added[path] = { sha, n, z };
        const first = db.doc(`blobs/${sha}_0`);
        if ((await call(() => first.get(), delay)).exists) continue;
        for (let i = n - 1; i >= 0; i--) await call(() => db.doc(`blobs/${sha}_${i}`).set({ i, n, data: text.slice(i * CHUNK_CHARS, (i + 1) * CHUNK_CHARS) }), delay);
      }
      // 2. The index, under a short lease, and only if nobody wrote since we looked.
      const until = Date.now() + lockWait;
      for (;;) {
        const got = await call(() => lock.acquire({ holder, ttlMs: 20_000 }), delay);
        if (got.acquired) break;
        if (Date.now() > until) throw new DbSyncError('Спільна база: інший пристрій зараз синхронізує. Спробуйте за хвилину');
        await sleep(400);
      }
      try {
        const cur = (await call(() => index.get(), delay)).data();
        if (String(typeof cur?.rev === 'number' ? cur.rev : 0) !== id) return { ok: false };
        const before = entriesOf(cur);
        const files = { ...before, ...added };
        const rev = Number(id) + 1;
        await call(() => index.set({ rev, files, at: Date.now() }), delay);
        // 3. Chunks nothing refers to any more (best effort: the database has a size cap).
        const keep = new Set(Object.values(files).map(e => e.sha));
        for (const e of Object.values(before)) {
          if (keep.has(e.sha)) continue;
          keep.add(e.sha);
          for (let i = 0; i < e.n; i++) await db.doc(`blobs/${e.sha}_${i}`).delete().catch(() => undefined);
        }
        return { ok: true, id: String(rev) };
      } finally {
        // No release verb: renewing with the shortest lease frees it after a second.
        await lock.acquire({ holder, ttlMs: 1000 }).catch(() => undefined);
      }
    },
  };
}

export type ClaudeState = FilesState;
export type ClaudeReport = FilesReport;
export const EMPTY_CLAUDE_STATE = EMPTY_FILES_STATE;

export function claudeSync(db: DbLike, holder: string, state: ClaudeState, local: SavedProject, opts: { since?: number; maxTries?: number; retryDelayMs?: number; lockWaitMs?: number } = {}): Promise<ClaudeReport> {
  return syncFiles(dbRemote(db, holder, opts), { dir: '', originals: true }, state, local, opts);
}
