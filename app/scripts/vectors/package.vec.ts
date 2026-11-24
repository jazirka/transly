import { deflateRawSync } from 'node:zlib';
import { test } from 'vitest';
import { crc32, createZip } from '../../src/core/zip';
import { buildPackage, sha256Hex } from '../../src/core/ext/package';
import { readZip } from '../../src/core/ext/zipread';
import { rng, writeVectors } from './util';

const enc = new TextEncoder();
const arr = (b: Uint8Array): number[] => [...b];

interface Ent { name: string; data: Uint8Array; method?: 0 | 8 | 9; flags?: number; crc?: number; usize?: number; csize?: number; raw?: Uint8Array }

/** A zip writer that can also make broken archives (wrong sizes, checksums, flags). */
function zip(ents: Ent[], o: { count?: number; noEocd?: boolean; cdAt?: number } = {}): Uint8Array {
  const chunks: Uint8Array[] = [], central: Uint8Array[] = [];
  let off = 0;
  const push = (b: Uint8Array): void => { chunks.push(b); off += b.length; };
  for (const e of ents) {
    const name = enc.encode(e.name), method = e.method ?? 0;
    const body = e.raw ?? (method === 8 ? deflateRawSync(e.data) : e.data);
    const crc = e.crc ?? crc32(e.data), usize = e.usize ?? e.data.length, csize = e.csize ?? body.length;
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(8, method, true); local.setUint32(14, crc, true); local.setUint32(18, csize, true); local.setUint32(22, usize, true); local.setUint16(26, name.length, true);
    const h = new DataView(new ArrayBuffer(46));
    h.setUint32(0, 0x02014b50, true); h.setUint16(8, e.flags ?? 0, true); h.setUint16(10, method, true); h.setUint32(16, crc, true); h.setUint32(20, csize, true); h.setUint32(24, usize, true); h.setUint16(28, name.length, true); h.setUint32(42, off, true);
    central.push(new Uint8Array(h.buffer), name);
    push(new Uint8Array(local.buffer)); push(name); push(body);
  }
  const start = off;
  for (const c of central) push(c);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, o.noEocd ? 0 : 0x06054b50, true); end.setUint16(10, o.count ?? ents.length, true); end.setUint32(12, off - start, true); end.setUint32(16, o.cdAt ?? start, true);
  push(new Uint8Array(end.buffer));
  const out = new Uint8Array(off);
  let p = 0;
  for (const c of chunks) { out.set(c, p); p += c.length; }
  return out;
}

const body = (r: ReturnType<typeof rng>): Uint8Array => enc.encode(r.pick(['hello', 'Привіт світе', '', 'line\nline', 'x'.repeat(200), '😀', 'a'.repeat(100)]));

async function res<T>(f: () => Promise<T>): Promise<{ ok: unknown } | { error: string }> {
  try { return { ok: await f() }; } catch (e) { return { error: (e as Error).message }; }
}

test('export package vectors', async () => {
  const r = rng(8080);
  const out: Record<string, { input: unknown; output: unknown }[]> = {};
  const add = (name: string, input: unknown, output: unknown) => (out[name] ??= []).push({ input, output });

  // ---- zip
  const names = ['a.txt', 'dir/b.txt', 'dir/c.json', 'transly-plugin.json', 'top/a.txt', 'top/b/c.txt', '__MACOSX/x', 'dir/', '.DS_Store', 'sub/Thumbs.db', '../evil', 'a/../b', '/abs', 'back\\slash', 'Ключ.txt', 'x\u0000y'];
  for (let i = 0; i < 300; i++) {
    const ents: Ent[] = Array.from({ length: r.int(6) }, () => {
      const data = body(r), method = r.pick([0, 0, 8, 8, 9] as const);
      const e: Ent = { name: r.pick(names), data, method };
      if (method === 9) e.raw = data;
      if (r.chance(0.08)) e.crc = 12345;
      if (r.chance(0.06)) e.usize = data.length + 1;
      if (r.chance(0.04)) e.usize = Math.max(0, data.length - 1);
      if (r.chance(0.04)) e.flags = 1;
      if (r.chance(0.03)) e.usize = 2_000_001;
      return e;
    });
    let bytes: Uint8Array;
    const roll = r.next();
    if (roll < 0.04) bytes = zip(ents, { noEocd: true });
    else if (roll < 0.08) bytes = zip(ents, { count: 0xffff });
    else if (roll < 0.12) bytes = zip(ents, { count: 300 });
    else if (roll < 0.16) bytes = zip(ents, { cdAt: 0xffffff00 });
    else if (roll < 0.2) bytes = new Uint8Array(r.int(30));
    else if (roll < 0.24) bytes = zip(ents).subarray(0, 30 + r.int(80));
    else if (roll < 0.28) bytes = createZip(ents.map(e => ({ name: e.name, data: e.data })));
    else bytes = zip(ents);
    add('readZip', arr(bytes), await res(async () => [...(await readZip(bytes)).entries()].map(([n, b]) => [n, arr(b)])));
  }
  // folder of an archive, duplicates, and a big bomb
  const folder = ['pkg-1/a.txt', 'pkg-1/b/c.txt'].map(name => ({ name, data: enc.encode(name) }));
  for (const es of [folder, [...folder, { name: 'other/x', data: enc.encode('x') }], [{ name: 'pkg/transly-plugin.json', data: enc.encode('{}') }], [{ name: 'a', data: enc.encode('1') }, { name: 'a', data: enc.encode('2') }], [{ name: 'only', data: enc.encode('1') }]]) {
    const b = zip(es);
    add('readZip', arr(b), await res(async () => [...(await readZip(b)).entries()].map(([n, x]) => [n, arr(x)])));
  }
  const big = new Uint8Array(1_500_000);
  const bomb = zip([{ name: 'bomb.txt', data: big, method: 8, usize: 1000 }]);
  add('readZip', arr(bomb), await res(async () => [...(await readZip(bomb)).entries()].map(([n, b]) => [n, arr(b)])));

  // ---- package
  for (let i = 0; i < 250; i++) {
    const files: Record<string, Uint8Array> = {};
    for (const n of ['a.txt', 'b/c.md', 'd.tsv', 'e.json']) if (r.chance(0.7)) files[n] = r.chance(0.1) ? new Uint8Array(r.pick([[0xff, 0xfe], [0x68, 0, 0x69], [0xef, 0xbb, 0xbf, 0x68]])) : body(r);
    const listed: Record<string, string> = {};
    for (const [n, b] of Object.entries(files)) listed[n] = r.chance(0.07) ? 'sha256-' + 'b'.repeat(64) : 'sha256-' + await sha256Hex(b);
    if (r.chance(0.15)) listed['missing.txt'] = 'sha256-' + 'c'.repeat(64);
    const entries: [string, Uint8Array][] = Object.entries(files);
    if (r.chance(0.15)) entries.push(['extra.txt', body(r)]);
    const m: Record<string, unknown> = { manifestVersion: 1, id: 'acme.wolf', name: r.pick(['Wolf', 'Вовк']), version: '1.0.0', ...(r.chance(0.5) ? { description: 'd' } : {}), ...(r.chance(0.8) ? { files: listed } : {}) };
    let text = JSON.stringify(m);
    let mb: Uint8Array | undefined = enc.encode(text);
    if (r.chance(0.08)) mb = new Uint8Array([...enc.encode('﻿'), ...mb]);
    if (r.chance(0.05)) mb = new Uint8Array([0xff, 0xfe, 0x7b]);
    if (r.chance(0.05)) mb = undefined;
    if (r.chance(0.04)) { text = JSON.stringify({ ...m, manifestVersion: 99 }); mb = enc.encode(text); }
    const map = new Map<string, Uint8Array>(entries);
    if (mb) { const re = new Map<string, Uint8Array>([['transly-plugin.json', mb]]); for (const [k, v] of map) re.set(k, v); if (r.chance(0.3)) { map.set('transly-plugin.json', mb); add('package', { entries: [...map].map(([k, v]) => [k, arr(v)]) }, await shape(map)); continue; } add('package', { entries: [...re].map(([k, v]) => [k, arr(v)]) }, await shape(re)); continue; }
    add('package', { entries: [...map].map(([k, v]) => [k, arr(v)]) }, await shape(map));
  }
  // too many files
  { const ok: Record<string, string> = {}; const map = new Map<string, Uint8Array>(); for (let i = 0; i < 205; i++) { const b = enc.encode('f' + i); map.set(`f${i}.txt`, b); ok[`f${i}.txt`] = 'sha256-' + await sha256Hex(b); }
    const mm = new Map<string, Uint8Array>([['transly-plugin.json', enc.encode(JSON.stringify({ manifestVersion: 1, id: 'acme.wolf', name: 'W', version: '1.0.0', files: ok }))], ...map]);
    add('package', { entries: [...mm].map(([k, v]) => [k, arr(v)]) }, await shape(mm)); }
  writeVectors('package', out);
});

async function shape(map: Map<string, Uint8Array>): Promise<unknown> {
  const b = await buildPackage(map);
  return b.ok ? { ok: true, manifest: b.pkg.manifest, manifestText: b.pkg.manifestText, files: Object.entries(b.pkg.files), warnings: b.pkg.warnings } : { ok: false, errors: b.errors };
}
