import { test } from 'vitest';
import { I18n } from '../../src/core/ext/i18n';
import { catalogAddress, catalogStatus, checkCatalog, entryOfManifest, filterCatalog, mergeCatalogs, parseCatalogRef, suggestFromCatalog } from '../../src/core/ext/catalog';
import type { CatalogEntry, CatalogIndex } from '../../src/core/ext/catalog';
import { PluginRegistry } from '../../src/core/ext/registry';
import { allowedUrl, fetchFromFiles, parseGithubRef } from '../../src/core/ext/sources';
import { rng, writeVectors } from './util';
import type { Rng } from './util';

const REFS = ['owner/repo', 'owner/repo@v1.0', 'owner/repo#sub/dir', 'owner/repo@main#a b/c', 'https://github.com/owner/repo', 'https://github.com/owner/repo.git', 'https://github.com/owner/repo/tree/main', 'https://github.com/owner/repo/tree/v1/some/dir', 'https://github.com/owner/repo/tree/main/a..b', ' owner/repo ', 'a', '/x/y', 'owner/', 'owner/repo@', 'owner/repo@a..b', 'owner/repo#../x', 'owner/repo#a/./b', '-bad/repo', 'owner/re po', 'owner/repo@v1#dir', 'o/r@feature/x+1', 'https://github.com/owner', 'https://gitlab.com/owner/repo', 'x'.repeat(41) + '/repo', 'owner/' + 'r'.repeat(101), 'own er/repo', 'owner/repo/'];
const URLS = ['https://example.com/a.json', 'http://example.com/a.json', 'http://localhost:8080/x', 'http://127.0.0.1/x', 'http://[::1]/x', 'https://user:pw@example.com/', 'https://user@example.com/', 'ftp://x.example/', 'not a url', '', 'HTTPS://EXAMPLE.COM/Path?q=1#h', 'https://example.com/a b', 'https://例え.jp/', 'https://example.com:444/x/'];

function genEntry(r: Rng, i: number): unknown {
  const e: Record<string, unknown> = { id: r.pick([`acme.p${i}`, `acme.p${i}`, 'acme.dup', 'BadId', 'x', 'acme.' + 'a'.repeat(70), 5, undefined]), name: r.pick(['Plugin', ' Spaced ', '', '   ', 'n'.repeat(81), 5, undefined]) };
  if (r.chance(0.5)) e.repo = r.pick(['acme/p', 'acme/p@v1', 'bad repo', 5, null, '']);
  if (r.chance(0.5)) e.url = r.pick(['https://acme.example/p/transly-plugin.json', 'http://acme.example/x', 'http://localhost/x', 'https://u:p@h/x', 5, null]);
  if (r.chance(0.5)) e.description = r.pick(['desc', '', ' ', 'd'.repeat(601), 5, 'ok text']);
  if (r.chance(0.4)) e.author = r.pick(['Me', '', 'a'.repeat(81), 3]);
  if (r.chance(0.5)) e.version = r.pick(['1.0.0', '2.1.3-beta', 'x', 5, '1.2', '']);
  if (r.chance(0.3)) e.homepage = r.pick(['https://acme.example', 'http://acme.example', 5, '']);
  if (r.chance(0.5)) e.tags = r.pick([['language'], ['engine', 'format'], ['nope'], [], 'x', Array.from({ length: 9 }, () => 'qa'), ['help', 'glossary', 'commands']]);
  if (r.chance(0.3)) e.languages = r.pick([['pl'], ['pt-BR', 'de'], ['x'], [5], 'pl', [], Array.from({ length: 17 }, () => 'en')]);
  if (r.chance(0.4)) e.detect = r.pick([{ files: ['**/a'] }, { anyFiles: ['**/*.rpy'], min: 2 }, { excludeFiles: ['x'], files: [] }, { min: 0 }, { min: 17 }, { min: 1.5 }, { files: 'x' }, { files: [5] }, 5, null, [], {}, { files: Array.from({ length: 17 }, () => 'a') }, { anyFiles: ['a'.repeat(121)] }]);
  if (r.chance(0.3)) e.requires = r.pick([{ transly: '>=0.1.0' }, { transly: 'bad' }, { transly: 5 }, {}, 5, null, { transly: '^1' }, { transly: '>=9.0.0' }]);
  return e;
}

const reg = (r: Rng): PluginRegistry => {
  const g = new PluginRegistry(new I18n());
  for (const [id, v] of [['acme.p1', '1.0.0'], ['acme.p2', '2.0.0'], ['acme.p3', '0.5.0']] as const) if (r.chance(0.7)) g.add({ manifest: { manifestVersion: 1, id, name: id, version: v } as never, builtin: false, enabled: true, handlers: [], files: new Map(), source: { kind: 'file' } }, false);
  return g;
};

test('export catalog vectors', () => {
  const r = rng(654321);
  const out: Record<string, { input: unknown; output: unknown }[]> = {};
  const add = (name: string, input: unknown, output: unknown) => (out[name] ??= []).push({ input, output });

  for (const s of REFS) add('githubRef', s, parseGithubRef(s));
  for (const u of URLS) { const a = allowedUrl(u); add('allowedUrl', u, a ? a.href : null); }
  for (const s of [...REFS, ...URLS, 'https://example.com/cat.json', 'https://github.com/o/r', 'HTTPS://x.example/c.json']) { const c = parseCatalogRef(s); add('catalogRef', s, { ref: c, addr: c ? catalogAddress(c) : null }); }
  for (const loc of ['owner/repo', 'owner/repo@v1', 'owner/repo#sub dir/x', 'owner/repo@main#a/b/']) add('address', loc, catalogAddress({ id: 'g', kind: 'github', location: loc }));
  add('address', 'bad', catalogAddress({ id: 'g', kind: 'github', location: 'bad' }));
  add('address', 'http://x.example/c.json', catalogAddress({ id: 'u', kind: 'url', location: 'http://x.example/c.json' }));

  // check
  for (let i = 0; i < 150; i++) {
    const n = r.int(8);
    const raw = { ...(r.chance(0.9) ? { catalogVersion: r.pick([1, 1, 1, 2, '1', undefined, null]) } : {}), ...(r.chance(0.8) ? { name: r.pick(['My catalog', ' x ', '', 5, 'n'.repeat(100)]) } : {}), plugins: r.chance(0.95) ? Array.from({ length: n }, (_, k) => r.chance(0.1) ? r.pick([null, 5, 'x', []]) : genEntry(r, k)) : r.pick(['x', {}, null]) };
    const input = r.chance(0.8) ? raw : r.pick([null, 5, [], 'junk-not-json']);
    const res = checkCatalog(input as never, 'fallback');
    add('check', input, res.ok ? { ok: true, index: res.index } : (typeof input === 'string' ? { ok: false, errors: 'string' } : { ok: false, errors: res.errors }));
  }
  const big = { catalogVersion: 1, plugins: Array.from({ length: 502 }, (_, k) => ({ id: `acme.p${k}`, name: 'n', repo: 'a/b' })) };
  { const res = checkCatalog(big as never, 'fallback'); add('check', big, res.ok ? { ok: true, index: { name: res.index.name, entries: res.index.entries.length, warnings: res.index.warnings } } : res); }

  // entry of manifest
  for (let i = 0; i < 60; i++) {
    const c = (k: string, v: unknown, p = 0.5): Record<string, unknown> => (r.chance(p) ? { [k]: v } : {});
    const m = { manifestVersion: 1, id: 'acme.x', name: 'X', version: '1.0.0', ...c('description', r.pick(['d', ''])), ...c('author', r.pick(['A', { name: 'B' }, { name: '' }, ''])), ...c('homepage', 'https://h.example'), ...c('requires', { transly: '>=0.1.0' }),
      contributes: { ...c('languages', [{ code: 'pl', name: 'P', catalogs: [{ file: 'a' }] }, { code: 'de', name: 'D', catalogs: [] }]), ...c('engines', [{ id: 'e', label: 'E' }, { id: 'f', label: 'F', detect: { anyFiles: ['**/x'] } }]), ...c('formats', [{ id: 'f', label: 'F', extensions: ['.x'], text: true }]), ...c('qaRules', []), ...c('commands', [{ id: 'c', title: 'C', action: 'help', help: 'h' }]), ...c('glossaries', [{ id: 'g', title: 'G', terms: [] }]), ...c('help', [{ id: 'h', title: 'H', body: 'b' }]) } };
    const src = r.pick([{ kind: 'github', ref: 'a/b' }, { kind: 'url', url: 'https://x.example/p' }, { kind: 'bundled', key: 'k' }] as const);
    add('entryOfManifest', { m, src }, entryOfManifest(m as never, src as never));
  }

  // merge, status, suggest, filter
  for (let i = 0; i < 80; i++) {
    const mkIndex = (name: string): CatalogIndex => ({ name, warnings: [], entries: Array.from({ length: r.int(5) }, (_, k) => ({ id: `acme.p${1 + r.int(4)}`, name: r.pick(['Zeta', 'alpha', 'Beta', 'Ґанок', 'Мова']), tags: r.pick([['language'], ['engine'], ['qa', 'help'], []]) as never, ...(r.chance(0.7) ? { version: r.pick(['1.0.0', '2.0.0', '0.9.0', '1.5.0']) } : {}), ...(r.chance(0.5) ? { description: r.pick(['Some tools', 'Polish language']) } : {}), ...(r.chance(0.4) ? { author: 'Anna' } : {}), ...(r.chance(0.3) ? { languages: ['pl'] } : {}), ...(r.chance(0.6) ? { detect: r.pick([{ anyFiles: ['**/*.rpy'] }, { files: ['**/system.json'] }, { anyFiles: ['**/*.zzz'], min: 1 }]) } : {}), ...(r.chance(0.3) ? { requires: { transly: r.pick(['>=0.1.0', '>=9.0.0']) } } : {}), source: { kind: 'github', ref: 'a/b' } })) as CatalogEntry[] });
    const indexes = [mkIndex('One'), mkIndex('Two'), mkIndex('Three')].slice(0, 1 + r.int(3));
    const g = reg(r);
    const merged = mergeCatalogs(indexes);
    const paths = r.pick([['game/script.rpy'], ['data/System.json'], ['a.zzz', 'b.zzz'], []]);
    const app = r.chance(0.2) ? '9.1.0' : undefined;
    const sug = suggestFromCatalog(merged, paths, g, app);
    const status = merged.map(e => catalogStatus(e, g, undefined));
    const filt = [undefined, 'language', 'qa'].flatMap(tag => ['', 'alpha', 'polish lang', 'anna', 'pl', 'zzz'].map(q => filterCatalog(merged, { tag: tag as never, q }).map(e => e.id + e.name)));
    add('catalog', { indexes, installed: g.list().map(x => [x.manifest.id, x.manifest.version]), paths, app: app ?? null }, { merged, sug: sug.map(s => ({ id: s.entry.id, score: s.score, matched: s.matched })), status, filt });
  }

  // fetchFromFiles
  const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);
  const FILESETS: { name: string; data: string }[][] = [[{ name: 'transly-plugin.json', data: '{}' }, { name: 'a.txt', data: 'x' }], [{ name: 'dir/transly-plugin.json', data: '{}' }, { name: 'dir/a.txt', data: 'x' }, { name: 'other.txt', data: 'y' }], [{ name: 'a\\b\\transly-plugin.json', data: '{}' }, { name: 'a\\b\\c.txt', data: 'x' }], [{ name: 'only.txt', data: 'x' }], []];
  return (async () => {
    for (const fs of FILESETS) { const res = await fetchFromFiles(fs.map(f => ({ name: f.name, data: bytes(f.data) }))); add('files', fs, { names: [...res.entries.keys()], kind: res.source.kind }); }
    writeVectors('catalog', out);
  })();
});
