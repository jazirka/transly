import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { API_VERSION, APP_VERSION, ExtHost, I18n, InstallError, MemoryPluginStore, PluginRegistry, buildPackage, createZip, fetchFromFiles, parseGithubRef, readZip, registerBuiltins, sha256Hex } from '../src/core';
import { crc32 } from '../src/core/zip';
import type { Fetcher } from '../src/core';

const enc = new TextEncoder();
const bytes = (s: string): Uint8Array => enc.encode(s);

/** The files of a plugin package with the manifest that lists their checksums. */
async function pack(over: Record<string, unknown> = {}, files: Record<string, string> = { 'help.md': 'Hello' }, contributes?: unknown): Promise<Map<string, Uint8Array>> {
  const sums: Record<string, string> = {};
  for (const [p, t] of Object.entries(files)) sums[p] = `sha256-${await sha256Hex(bytes(t))}`;
  const manifest = { manifestVersion: 1, id: 'acme.lang', name: 'Lang', version: '1.0.0', files: sums, contributes: contributes ?? { formats: [{ id: 'lang', label: 'Lang', extensions: ['.lang'], text: true, spec: { type: 'keyvalue' } }], help: [{ id: 'h', title: 'Help', file: 'help.md' }] }, ...over };
  const m = new Map<string, Uint8Array>([['transly-plugin.json', bytes(JSON.stringify(manifest))]]);
  for (const [p, t] of Object.entries(files)) m.set(p, bytes(t));
  return m;
}
const host = (fetcher?: Fetcher) => {
  const reg = new PluginRegistry(new I18n(), APP_VERSION, API_VERSION);
  registerBuiltins(reg);
  const store = new MemoryPluginStore();
  const h = new ExtHost(reg, store, fetcher ?? (async () => { throw new Error('no network'); }), () => 1000);
  h.setStorage(null);
  return { reg, store, h };
};
const zipOf = (m: Map<string, Uint8Array>): Uint8Array => createZip([...m].map(([name, data]) => ({ name, data })));

/** A zip whose entries are deflated (what a real archiver writes). */
function deflatedZip(m: Map<string, Uint8Array>): Uint8Array {
  const parts: Uint8Array[] = [], central: Uint8Array[] = [];
  let off = 0;
  const u16 = (n: number) => new Uint8Array([n & 255, (n >> 8) & 255]);
  const u32 = (n: number) => new Uint8Array([n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255]);
  const cat = (...a: Uint8Array[]) => { const o = new Uint8Array(a.reduce((s, x) => s + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };
  for (const [name, data] of m) {
    const n = bytes(name), c = new Uint8Array(deflateRawSync(data)), crc = crc32(data);
    const local = cat(u32(0x04034b50), u16(20), u16(0x0800), u16(8), u16(0), u16(0x21), u32(crc), u32(c.length), u32(data.length), u16(n.length), u16(0), n, c);
    central.push(cat(u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(8), u16(0), u16(0x21), u32(crc), u32(c.length), u32(data.length), u16(n.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(off), n));
    parts.push(local); off += local.length;
  }
  const cd = cat(...central);
  return cat(...parts, cd, u32(0x06054b50), u16(0), u16(0), u16(m.size), u16(m.size), u32(cd.length), u32(off), u16(0));
}

describe('reading a zip', () => {
  it('reads stored and deflated entries and takes off the folder an archive of a repository puts everything in', async () => {
    const m = await pack();
    expect([...(await readZip(zipOf(m))).keys()].sort()).toEqual(['help.md', 'transly-plugin.json']);
    expect([...(await readZip(deflatedZip(m))).keys()].sort()).toEqual(['help.md', 'transly-plugin.json']);
    const nested = new Map([...m].map(([k, v]) => [`repo-1a2b3c/${k}`, v] as const));
    expect([...(await readZip(deflatedZip(nested))).keys()].sort()).toEqual(['help.md', 'transly-plugin.json']);
  });
  it('refuses what is not a zip, a name that climbs out, a damaged checksum, an entry that unpacks into more than it says', async () => {
    await expect(readZip(bytes('not a zip at all'))).rejects.toThrow();
    await expect(readZip(createZip([{ name: '../evil.txt', data: bytes('x') }]))).rejects.toThrow();
    await expect(readZip(createZip([{ name: '/abs.txt', data: bytes('x') }]))).rejects.toThrow();
    const z = createZip([{ name: 'a.txt', data: bytes('hello world') }]);
    const bad = new Uint8Array(z); bad[z.indexOf(104)] = bad[z.indexOf(104)]! ^ 1;     // a byte of the data
    await expect(readZip(bad)).rejects.toThrow();
    // a lie about the size: it says 5 bytes, the data is 4000
    const big = new Map([['a.txt', bytes('A'.repeat(4000))]]);
    const z2 = deflatedZip(big);
    const dv = new DataView(z2.buffer);
    const cd = z2.length - 22 - 46 - 'a.txt'.length;
    dv.setUint32(cd + 24, 5, true);
    await expect(readZip(z2)).rejects.toThrow();
  });
});

describe('checking a package', () => {
  it('accepts a package whose files match the manifest', async () => { expect((await buildPackage(await pack())).ok).toBe(true); });
  it('refuses a changed file, a file nobody listed, a listed file that is missing, binary data, and a manifest that is missing', async () => {
    const changed = await pack(); changed.set('help.md', bytes('Tampered'));
    expect((await buildPackage(changed)).ok).toBe(false);
    const extra = await pack(); extra.set('evil.js', bytes('alert(1)'));
    expect((await buildPackage(extra)).ok).toBe(false);
    const missing = await pack(); missing.delete('help.md');
    expect((await buildPackage(missing)).ok).toBe(false);
    const bin = await pack({}, { 'help.md': 'a\0b' });
    expect((await buildPackage(bin)).ok).toBe(false);
    expect((await buildPackage(new Map())).ok).toBe(false);
  });
});

describe('installing', () => {
  it('plans first (nothing is written), then installs, and the format works', async () => {
    const { h, store, reg } = host();
    const plan = await h.plan({ kind: 'files', files: [{ name: 'p.zip', data: zipOf(await pack()) }] });
    expect(plan.action).toBe('install');
    expect(plan.hasCode).toBe(false);
    expect(await store.all()).toEqual([]);
    const rec = await h.install(plan);
    expect(rec.state).toBe('enabled');
    expect((await store.all()).length).toBe(1);
    expect(reg.handlerOf({ name: 'ui.lang' })?.id).toBe('acme.lang/lang');
    expect(reg.help().map(x => x.body)).toEqual(['Hello']);
  });
  it('survives a restart: the plugins in the store are loaded again, and a stored file that was changed is refused', async () => {
    const a = host();
    await a.h.install(await a.h.plan({ kind: 'files', files: [{ name: 'p.zip', data: zipOf(await pack()) }] }));
    const b = host();
    for (const s of await a.store.all()) await b.store.put(s);
    const r = await b.h.init();
    expect(r.problems).toEqual([]);
    expect(b.reg.get('acme.lang')?.state).toBe('enabled');
    const c = host();
    for (const s of await a.store.all()) await c.store.put({ ...s, files: { ...s.files, 'help.md': 'changed behind our back' } });
    const r2 = await c.h.init();
    expect(r2.problems.length).toBe(1);
    expect(c.reg.get('acme.lang')?.state).toBe('error');
    expect(c.reg.handlerOf({ name: 'ui.lang' })).toBeNull();
  });
  it('tells an update from a reinstall and a downgrade, and notices another source for the same id', async () => {
    const { h } = host();
    await h.install(await h.plan({ kind: 'files', files: [{ name: 'p.zip', data: zipOf(await pack()) }] }));
    expect((await h.plan({ kind: 'files', files: [{ name: 'p.zip', data: zipOf(await pack()) }] })).action).toBe('reinstall');
    expect((await h.plan({ kind: 'files', files: [{ name: 'p.zip', data: zipOf(await pack({ version: '1.1.0' })) }] })).action).toBe('update');
    await h.install(await h.plan({ kind: 'files', files: [{ name: 'p.zip', data: zipOf(await pack({ version: '2.0.0' })) }] }));
    expect((await h.plan({ kind: 'files', files: [{ name: 'p.zip', data: zipOf(await pack({ version: '1.0.0' })) }] })).action).toBe('downgrade');
    const other = await h.plan({ kind: 'files', files: [{ name: 'a.transly-plugin', data: zipOf(await pack({ version: '2.1.0' })) }] });
    expect(other.sourceChanged).toBe(false);
    const viaUrl = await new ExtHost(host().reg, new MemoryPluginStore(), async () => new Response('x')).planFrom({ entries: await pack(), source: { kind: 'url', location: 'https://x.test/transly-plugin.json' } });
    expect(viaUrl.sourceChanged).toBe(false);
  });
  it('does not let a plugin take the place of a built-in one, or install one that does not fit this version', async () => {
    const { h } = host();
    await expect(h.plan({ kind: 'files', files: [{ name: 'p.zip', data: zipOf(await pack({ id: 'transly.rpgmaker' })) }] })).rejects.toBeInstanceOf(InstallError);
    const old = await h.plan({ kind: 'files', files: [{ name: 'p.zip', data: zipOf(await pack({ requires: { transly: '>=99.0.0' } })) }] });
    expect(old.compat.ok).toBe(false);
    await expect(h.install(old)).rejects.toBeInstanceOf(InstallError);
  });
  it('a plugin with code is installed switched off and asks for the permissions; its code does not run without a runner', async () => {
    const { h, reg } = host();
    const m = await pack({ main: 'plugin.js', permissions: ['storage'] }, { 'plugin.js': 'export default {}' }, { formats: [{ id: 'f', label: 'F', extensions: ['.f'], text: true, handler: 'format' }] });
    const plan = await h.plan({ kind: 'files', files: [{ name: 'p.zip', data: zipOf(m) }] });
    expect(plan.hasCode).toBe(true);
    expect(plan.newPermissions).toEqual(['storage']);
    const rec = await h.install(plan);
    expect(rec.enabled).toBe(false);
    expect(rec.state).toBe('disabled');
    await h.setEnabled('acme.lang', true, ['storage']);
    expect(reg.get('acme.lang')?.state).toBe('error');           // no sandbox here
    expect(reg.get('acme.lang')?.reason).toMatch(/код/);
  });
  it('removes a plugin, refuses to remove a built-in one, and says who depends on it', async () => {
    const { h, reg, store } = host();
    await h.install(await h.plan({ kind: 'files', files: [{ name: 'p.zip', data: zipOf(await pack({ id: 'acme.base', contributes: {} })) }] }));
    await h.install(await h.plan({ kind: 'files', files: [{ name: 'p.zip', data: zipOf(await pack({ id: 'acme.user', dependencies: { 'acme.base': '^1.0.0' }, contributes: {} })) }] }));
    expect(h.dependents('acme.base').map(m => m.id)).toEqual(['acme.user']);
    await h.uninstall('acme.base');
    expect(reg.get('acme.base')).toBeUndefined();
    expect(reg.get('acme.user')?.state).toBe('missing-dependency');
    expect((await store.all()).map(s => s.id)).toEqual(['acme.user']);
    await expect(h.uninstall('transly.rpgmaker')).rejects.toBeInstanceOf(InstallError);
  });
  it('can switch a built-in plugin off, remembers it, and the app still has the others', async () => {
    const a = host();
    const mem = new Map<string, string>();
    a.h.setStorage({ getItem: k => mem.get(k) ?? null, setItem: (k, v) => { mem.set(k, v); } });
    await a.h.setEnabled('transly.rpgmaker', false);
    expect(a.reg.handlerOf({ name: 'Map001.json' })).toBeNull();
    expect(a.reg.handlerOf({ name: 'x.po' })?.id).toBe('gettext');
    const b = host(); b.h.setStorage({ getItem: k => mem.get(k) ?? null, setItem: () => {} });
    b.h.restoreBuiltinState();
    expect(b.reg.get('transly.rpgmaker')?.state).toBe('disabled');
  });
  it('rolls back when the registry cannot take the plugin', async () => {
    const { h, store, reg } = host();
    const plan = await h.plan({ kind: 'files', files: [{ name: 'p.zip', data: zipOf(await pack()) }] });
    const orig = reg.add.bind(reg);
    reg.add = () => { throw new Error('boom'); };
    await expect(h.install(plan)).rejects.toBeInstanceOf(InstallError);
    reg.add = orig;
    expect(await store.all()).toEqual([]);
  });
});

describe('sources', () => {
  it('reads GitHub addresses and refuses odd ones', () => {
    expect(parseGithubRef('acme/transly-wolf')).toEqual({ owner: 'acme', repo: 'transly-wolf' });
    expect(parseGithubRef('acme/wolf@v1.2.0')).toEqual({ owner: 'acme', repo: 'wolf', ref: 'v1.2.0' });
    expect(parseGithubRef('acme/mono#plugins/wolf')).toEqual({ owner: 'acme', repo: 'mono', dir: 'plugins/wolf' });
    expect(parseGithubRef('https://github.com/acme/wolf')).toEqual({ owner: 'acme', repo: 'wolf' });
    expect(parseGithubRef('https://github.com/acme/wolf/tree/dev/plugins/w')).toEqual({ owner: 'acme', repo: 'wolf', ref: 'dev', dir: 'plugins/w' });
    for (const bad of ['', 'acme', 'a/b/c', '../x/y', 'acme/wolf@..', 'acme/wolf#../x', 'https://evil.com/acme/wolf', 'acme/wo lf', '-acme/wolf']) expect(parseGithubRef(bad), bad).toBeNull();
  });
  const net = (files: Record<string, string>): { f: Fetcher; calls: string[] } => {
    const calls: string[] = [];
    const sha = 'a'.repeat(40);
    const f: Fetcher = async url => {
      calls.push(url);
      const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200 });
      if (url.endsWith('/releases/latest')) return new Response('{}', { status: 404 });
      if (url === 'https://api.github.com/repos/acme/wolf') return json({ default_branch: 'main' });
      if (url.includes('/commits/')) return json({ sha });
      const m = /raw\.githubusercontent\.com\/acme\/wolf\/[0-9a-f]{40}\/(.+)$/.exec(url);
      if (m && files[decodeURIComponent(m[1]!)] !== undefined) return new Response(files[decodeURIComponent(m[1]!)]);
      return new Response('nope', { status: 404 });
    };
    return { f, calls };
  };
  it('installs from a GitHub repository at one commit and remembers where it came from', async () => {
    const pk = await pack();
    const files: Record<string, string> = {}; for (const [k, v] of pk) files[k] = new TextDecoder().decode(v);
    const { f, calls } = net(files);
    const { h, reg } = host(f);
    const plan = await h.plan({ kind: 'github', ref: 'acme/wolf' });
    expect(plan.source).toMatchObject({ kind: 'github', location: 'acme/wolf', ref: 'a'.repeat(40) });
    expect(calls.some(c => c.includes('raw.githubusercontent.com'))).toBe(true);
    await h.install(plan);
    expect(reg.get('acme.lang')?.source.kind).toBe('github');
  });
  it('checks for a newer version by the manifest alone, and plans the update', async () => {
    const v1 = await pack(), v2 = await pack({ version: '1.3.0' });
    const toFiles = (m: Map<string, Uint8Array>) => { const o: Record<string, string> = {}; for (const [k, v] of m) o[k] = new TextDecoder().decode(v); return o; };
    let cur = toFiles(v1);
    const f: Fetcher = async url => { const { f: g } = net(cur); return g(url); };
    const { h } = host(f);
    await h.install(await h.plan({ kind: 'github', ref: 'acme/wolf' }));
    expect(await h.checkUpdate('acme.lang')).toEqual({ available: null });
    cur = toFiles(v2);
    expect(await h.checkUpdate('acme.lang')).toEqual({ available: '1.3.0' });
    const plan = await h.planUpdate('acme.lang');
    expect(plan.action).toBe('update');
    await h.install(plan);
    expect(h.registry.get('acme.lang')?.manifest.version).toBe('1.3.0');
  });
  it('refuses http, odd addresses, a repository that answers with garbage, and files that do not match the manifest', async () => {
    const { h } = host(async () => new Response('garbage'));
    await expect(h.plan({ kind: 'url', url: 'http://evil.test/transly-plugin.json' })).rejects.toBeInstanceOf(InstallError);
    await expect(h.plan({ kind: 'url', url: 'https://user:pw@evil.test/transly-plugin.json' })).rejects.toBeInstanceOf(InstallError);
    await expect(h.plan({ kind: 'url', url: 'https://x.test/transly-plugin.json' })).rejects.toBeInstanceOf(InstallError);
    await expect(h.plan({ kind: 'github', ref: 'not a repo' })).rejects.toBeInstanceOf(InstallError);
    const pk = await pack();
    const f: Fetcher = async url => (url.endsWith('transly-plugin.json') ? new Response(new TextDecoder().decode(pk.get('transly-plugin.json')!)) : new Response('swapped content'));
    const bad = host(f);
    await expect(bad.h.plan({ kind: 'url', url: 'https://x.test/p/transly-plugin.json' })).rejects.toBeInstanceOf(InstallError);
    const local = host(async () => new Response('x'));
    await expect(local.h.plan({ kind: 'url', url: 'http://localhost:9/transly-plugin.json' })).rejects.toBeInstanceOf(InstallError);   // allowed address, but the answer is not a manifest
  });
  it('reads files picked as a folder (with the folder name in front)', async () => {
    const pk = await pack();
    const fetched = await fetchFromFiles([...pk].map(([name, data]) => ({ name: `myplugin/${name}`, data })));
    expect([...fetched.entries.keys()].sort()).toEqual(['help.md', 'transly-plugin.json']);
  });
});
