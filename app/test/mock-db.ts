import type { DbDoc, DbLike } from '../src/core';

/**
 * An in-memory stand-in for the artifact's `db` capability, with its documented limits: a document is a plain
 * object of at most 256 KiB, paths have an even number of segments, leases expire and only the same holder renews.
 * Not a Firestore clone: only what the sync code uses.
 */
export class MockDb implements DbLike {
  docs = new Map<string, Record<string, unknown>>();
  leases = new Map<string, { holder: string; until: number }>();
  /** Seconds a test lets pass between actions (real syncs are minutes apart; leases last a second). */
  skew = 0;
  get now(): number { return Date.now() + this.skew; }
  writes = 0;
  /** Runs before a `set`; lets a test act as another device at that exact moment, or fail a write. */
  beforeSet: ((path: string) => void | Promise<void>) | null = null;
  maxDocs = Infinity;

  private fail(code: string): never { throw Object.assign(new Error(code), { code }); }

  doc(path: string): DbDoc {
    if (path.split('/').length % 2 !== 0) throw new TypeError(`odd path: ${path}`);
    const self = this;
    return {
      async get() { const d = self.docs.get(path); return { exists: !!d, data: () => (d ? structuredClone(d) : undefined) }; },
      async set(data) {
        await self.beforeSet?.(path);
        if (JSON.stringify(data).length > 256 * 1024) self.fail('invalid_argument');
        if (!self.docs.has(path) && self.docs.size >= self.maxDocs) self.fail('quota_exceeded');
        self.docs.set(path, structuredClone(data)); self.writes++;
      },
      async delete() { self.docs.delete(path); },
      async acquire({ holder, ttlMs }) {
        const cur = self.leases.get(path);
        if (cur && cur.until > self.now && cur.holder !== holder) return { acquired: false };
        self.leases.set(path, { holder, until: self.now + Math.min(600_000, Math.max(1000, ttlMs ?? 30_000)) });
        return { acquired: true };
      },
    };
  }
}
