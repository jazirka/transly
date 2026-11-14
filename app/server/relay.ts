/**
 * Transly relay: a tiny temporary mailbox for syncing a project between your own devices.
 * It stores only encrypted blobs (the passphrase never leaves the devices) and forgets them after a while.
 *
 *   node server/relay.ts --port 7421            # in memory, gone when you stop it
 *   node server/relay.ts --port 7421 --dir ./relay-data   # survives restarts
 *
 * Put it behind HTTPS (Caddy, nginx, a tunnel) when reaching it over the internet.
 */
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface RelayOptions {
  /** Max size of one blob in bytes. */
  maxBytes?: number;
  /** Blobs older than this are dropped (ms). */
  ttlMs?: number;
  maxRooms?: number;
  /** Everything stored together may not exceed this many bytes (a full relay refuses new data instead of growing without end). */
  maxTotalBytes?: number;
  /** How many new rooms one client address may open per hour: nobody can fill all the rooms of an own relay in a moment. */
  newRoomsPerHour?: number;
  /** Requests per minute per client address. */
  rateLimit?: number;
  /** Persist blobs here so they survive a restart. */
  dir?: string;
  /** Value of Access-Control-Allow-Origin. Data is end-to-end encrypted, so "*" is safe for reading. */
  origin?: string;
  now?: () => number;
}

interface Blob { bytes: Buffer; etag: string; at: number }

const ROOM = /^[0-9a-f]{64}$/;
const KINDS = new Set(['data', 'snap']);

export function createRelay(opts: RelayOptions = {}): Server {
  const maxBytes = opts.maxBytes ?? 64 * 1024 * 1024;
  const ttl = opts.ttlMs ?? 30 * 24 * 3600 * 1000;
  const maxRooms = opts.maxRooms ?? 100;
  const maxTotal = opts.maxTotalBytes ?? 512 * 1024 * 1024;
  const newRooms = opts.newRoomsPerHour ?? 10;
  const rate = opts.rateLimit ?? 240;
  const now = opts.now ?? Date.now;
  const store = new Map<string, Blob>();
  const hits = new Map<string, { n: number; t: number }>();
  const opened = new Map<string, { n: number; t: number }>();

  if (opts.dir) {
    mkdirSync(opts.dir, { recursive: true });
    for (const f of readdirSync(opts.dir)) {
      const bytes = readFileSync(join(opts.dir, f));
      store.set(f, { bytes, etag: etagOf(bytes), at: statSync(join(opts.dir, f)).mtimeMs });
    }
  }

  const sweep = () => {
    const t = now();
    for (const [k, b] of store) if (t - b.at > ttl) { store.delete(k); if (opts.dir) try { unlinkSync(join(opts.dir, k)); } catch { /* already gone */ } }
  };

  const send = (res: ServerResponse, code: number, body: string | Buffer = '', headers: Record<string, string> = {}) => {
    res.writeHead(code, { 'Access-Control-Allow-Origin': opts.origin ?? '*', 'Access-Control-Allow-Headers': 'If-Match, Content-Type', 'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS', 'Access-Control-Expose-Headers': 'ETag', 'Cache-Control': 'no-store', ...headers });
    res.end(body);
  };

  const readBody = (req: IncomingMessage): Promise<Buffer | null> => new Promise(resolve => {
    const parts: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > maxBytes) { resolve(null); req.destroy(); return; }
      parts.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(parts)));
    req.on('error', () => resolve(null));
  });

  return createServer(async (req, res) => {
    try {
      if (req.method === 'OPTIONS') return send(res, 204);
      const url = new URL(req.url ?? '/', 'http://x');
      if (url.pathname === '/health') return send(res, 200, 'ok');

      const who = req.socket.remoteAddress ?? '?';
      const h = hits.get(who);
      if (!h || now() - h.t > 60_000) hits.set(who, { n: 1, t: now() });
      else if (++h.n > rate) return send(res, 429, 'Забагато запитів');

      const m = /^\/r\/([^/]+)\/([^/]+)$/.exec(url.pathname);
      if (!m || !ROOM.test(m[1]!) || !KINDS.has(m[2]!)) return send(res, 404, 'Not found');
      const key = `${m[1]}.${m[2]}`;
      sweep();

      if (req.method === 'GET') {
        const b = store.get(key);
        return b ? send(res, 200, b.bytes, { ETag: b.etag, 'Content-Type': 'application/octet-stream' }) : send(res, 404, 'Not found');
      }
      if (req.method === 'PUT') {
        const body = await readBody(req);
        if (!body) return send(res, 413, 'Занадто великий файл');
        if (!body.length) return send(res, 400, 'Порожнє тіло');
        const cur = store.get(key);
        const ifMatch = req.headers['if-match'] ?? null;
        // Optimistic concurrency: a writer must name the version it merged; a stale or missing name is refused.
        if (cur && ifMatch !== cur.etag) return send(res, 412, 'Дані вже змінено іншим пристроєм');
        if (!cur && ifMatch) return send(res, 412, 'Немає такої версії');
        const total = [...store.values()].reduce((n, x) => n + x.bytes.length, 0) - (cur?.bytes.length ?? 0) + body.length;
        if (total > maxTotal) return send(res, 507, 'Сховище реле заповнене');
        const rooms = new Set([...store.keys()].map(k => k.split('.')[0]));
        if (!rooms.has(m[1]!)) {
          if (rooms.size >= maxRooms) return send(res, 507, 'Забагато кімнат');
          // a new room: one client address opens only a few per hour (a client that cannot be told apart behind a proxy shares the limit)
          const o = opened.get(who);
          if (!o || now() - o.t > 3_600_000) opened.set(who, { n: 1, t: now() });
          else if (++o.n > newRooms) return send(res, 429, 'Забагато нових кімнат з цієї адреси');
        }
        const b: Blob = { bytes: body, etag: etagOf(body), at: now() };
        store.set(key, b);
        if (opts.dir) writeFileSync(join(opts.dir, key), body);
        return send(res, 200, '', { ETag: b.etag });
      }
      return send(res, 405, 'Method not allowed');
    } catch {
      return send(res, 500, 'Помилка сервера');
    }
  });
}

function etagOf(b: Buffer): string {
  return `"${createHash('sha256').update(b).digest('hex').slice(0, 32)}"`;
}

// CLI
const arg = (n: string) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined; };
if (process.argv[1] && /relay\.ts$/.test(process.argv[1])) {
  const port = Number(arg('--port') ?? 7421);
  const dir = arg('--dir');
  const origin = arg('--origin');
  createRelay({ ...(dir ? { dir } : {}), ...(origin ? { origin } : {}) }).listen(port, () => console.log(`Transly relay на порту ${port}${dir ? `, дані в ${dir}` : ' (у пам’яті)'}`));
}
