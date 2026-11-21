import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { I18n, PluginRegistry, catalogAddress, entryOfManifest, catalogStatus, checkCatalog, checkManifest, fetchCatalog, filterCatalog, mergeCatalogs, parseCatalogRef, suggestFromCatalog } from '../src/core';
import type { CatalogEntry } from '../src/core';

/** A catalog only describes plugins: it is checked like any untrusted text, and what is wrong in one entry costs that entry only. */
const cat = (plugins: unknown[], extra: Record<string, unknown> = {}) => JSON.stringify({ catalogVersion: 1, name: 'Community', plugins, ...extra });
const wolf = { id: 'acme.wolf', name: 'Wolf RPG', description: 'Wolf RPG Editor games', version: '1.2.0', author: 'Acme', tags: ['engine', 'format'], repo: 'acme/transly-wolf@v1.2.0', detect: { anyFiles: ['**/*.wolf', '**/data.wolf'], min: 1 } };
const polish = { id: 'pl.lang', name: 'Polski', version: '0.3.0', tags: ['language'], languages: ['pl'], url: 'https://example.com/pl/transly-plugin.json' };

describe('checkCatalog', () => {
  it('reads a good catalog', () => {
    const r = checkCatalog(cat([wolf, polish]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.index.name).toBe('Community');
    expect(r.index.entries.map(e => [e.id, e.source.kind])).toEqual([['acme.wolf', 'github'], ['pl.lang', 'url']]);
    expect(r.index.entries[0]?.detect).toEqual({ anyFiles: ['**/*.wolf', '**/data.wolf'], min: 1 });
    expect(r.index.warnings).toEqual([]);
  });

  it('leaves out a bad entry with a warning and keeps the rest', () => {
    const r = checkCatalog(cat([
      wolf, { ...polish, id: 'Bad Id' }, { ...polish, id: 'pl.two', url: 'http://example.com/x' }, { ...polish, id: 'pl.three', repo: 'a/b' },
      { ...polish, id: 'pl.four', tags: ['evil'] }, { ...polish, id: 'pl.five', version: 'x' }, { ...wolf, name: 'Wolf again' }, 5, { id: 'x.y' },
      { ...polish, id: 'pl.six', homepage: 'javascript:alert(1)' }, { ...polish, id: 'pl.seven', detect: { files: 'all' } }, { ...polish, id: 'pl.eight', requires: { transly: 'newest' } },
    ]));
    expect(r.ok && r.index.entries.map(e => e.id)).toEqual(['acme.wolf']);
    expect(r.ok && r.index.warnings.length).toBe(11);
  });

  it('refuses what is not a catalog: not JSON, no version, a newer format, too big', () => {
    expect(checkCatalog('{oops').ok).toBe(false);
    expect(checkCatalog('[]').ok).toBe(false);
    expect(checkCatalog(JSON.stringify({ plugins: [] })).ok).toBe(false);
    const newer = checkCatalog(JSON.stringify({ catalogVersion: 2, plugins: [] }));
    expect(!newer.ok && newer.errors[0]).toMatch(/формат 2/);
    expect(checkCatalog('x'.repeat(1_000_001)).ok).toBe(false);
  });

  it('cuts a very long list and says so', () => {
    const many = Array.from({ length: 600 }, (_, i) => ({ ...polish, id: `pl.p${i}` }));
    const r = checkCatalog(cat(many));
    expect(r.ok && r.index.entries.length).toBe(500);
    expect(r.ok && r.index.warnings[0]).toMatch(/500/);
  });
});

describe('where a catalog is', () => {
  it('knows a GitHub repository and an https address, nothing else', () => {
    expect(parseCatalogRef('acme/catalog')).toMatchObject({ kind: 'github', location: 'acme/catalog' });
    expect(parseCatalogRef('acme/catalog#plugins')).toMatchObject({ kind: 'github' });
    expect(parseCatalogRef('https://example.com/c.json')).toMatchObject({ kind: 'url', location: 'https://example.com/c.json' });
    expect(parseCatalogRef('http://example.com/c.json')).toBeNull();
    expect(parseCatalogRef('file:///etc/passwd')).toBeNull();
    expect(parseCatalogRef('just words')).toBeNull();
  });

  it('reads the file from raw.githubusercontent.com, in a folder when asked', () => {
    expect(catalogAddress(parseCatalogRef('acme/catalog')!)).toBe('https://raw.githubusercontent.com/acme/catalog/HEAD/transly-catalog.json');
    expect(catalogAddress(parseCatalogRef('acme/catalog@v2#lists/main')!)).toBe('https://raw.githubusercontent.com/acme/catalog/v2/lists/main/transly-catalog.json');
  });

  it('fetches through the application\'s fetcher, with the name of the catalog', async () => {
    const asked: string[] = [];
    const f = (url: string) => { asked.push(url); return Promise.resolve(new Response(cat([wolf], { name: undefined }))); };
    const idx = await fetchCatalog({ id: 'g', kind: 'github', location: 'acme/catalog', name: 'Acme list' }, f);
    expect(asked).toEqual(['https://raw.githubusercontent.com/acme/catalog/HEAD/transly-catalog.json']);
    expect(idx.name).toBe('Acme list');
    expect(idx.entries).toHaveLength(1);
  });

  it('refuses a bad answer and an unsafe address', async () => {
    await expect(fetchCatalog({ id: 'u', kind: 'url', location: 'http://example.com/c.json' }, () => Promise.resolve(new Response('{}')))).rejects.toThrow();
    await expect(fetchCatalog({ id: 'u', kind: 'url', location: 'https://example.com/c.json' }, () => Promise.resolve(new Response('nope', { status: 404 })))).rejects.toThrow(/404/);
    await expect(fetchCatalog({ id: 'u', kind: 'url', location: 'https://example.com/c.json' }, () => Promise.resolve(new Response('not json')))).rejects.toThrow();
  });
});

describe('what a catalog says about a plugin', () => {
  const entries = (): CatalogEntry[] => { const r = checkCatalog(cat([wolf, polish])); if (!r.ok) throw new Error('bad'); return r.index.entries; };
  const reg = (installed?: { id: string; version: string }) => {
    const r = new PluginRegistry(new I18n());
    if (installed) { const m = checkManifest({ manifestVersion: 1, id: installed.id, name: 'X', version: installed.version }); if (!m.ok) throw new Error('bad'); r.add({ manifest: m.manifest, builtin: false, enabled: true, handlers: [], files: new Map(), source: { kind: 'file' } }); }
    return r;
  };

  it('available, installed, update, incompatible', () => {
    const [w] = entries();
    expect(catalogStatus(w!, reg()).status).toBe('available');
    expect(catalogStatus(w!, reg({ id: 'acme.wolf', version: '1.2.0' }))).toEqual({ status: 'installed', installed: '1.2.0' });
    expect(catalogStatus(w!, reg({ id: 'acme.wolf', version: '1.0.0' }))).toEqual({ status: 'update', installed: '1.0.0' });
    expect(catalogStatus({ ...w!, requires: { transly: '>=9.0.0' } }, reg()).status).toBe('incompatible');
    expect(catalogStatus({ ...w!, requires: { transly: '>=0.1.0' } }, reg()).status).toBe('available');
  });

  it('puts catalogs together: the newer version of a plugin wins, each entry knows its catalog', () => {
    const a = checkCatalog(cat([wolf]), 'A'), b = checkCatalog(cat([{ ...wolf, version: '1.3.0' }, polish], { name: 'B' }));
    if (!a.ok || !b.ok) throw new Error('bad');
    const merged = mergeCatalogs([a.index, b.index]);
    expect(merged.map(e => [e.id, e.version, e.origin])).toEqual([['acme.wolf', '1.3.0', 'B'], ['pl.lang', '0.3.0', 'B']]);
  });

  it('suggests a plugin for a folder it does not understand, from the file list', () => {
    const paths = ['Game.exe', 'Data/BasicData/Game.wolf', 'Data.wolf'];
    const s = suggestFromCatalog(entries(), paths, reg());
    expect(s.map(x => x.entry.id)).toEqual(['acme.wolf']);
    expect(s[0]?.matched).toContain('**/*.wolf');
    // not for a folder that is something else, nor for what is installed already
    expect(suggestFromCatalog(entries(), ['data/Map001.json'], reg())).toEqual([]);
    expect(suggestFromCatalog(entries(), paths, reg({ id: 'acme.wolf', version: '1.2.0' }))).toEqual([]);
  });

  it('filters by tag and by words', () => {
    const e = entries();
    expect(filterCatalog(e, { tag: 'language' }).map(x => x.id)).toEqual(['pl.lang']);
    expect(filterCatalog(e, { q: 'wolf editor' }).map(x => x.id)).toEqual(['acme.wolf']);
    expect(filterCatalog(e, { q: 'pl' }).map(x => x.id)).toEqual(['pl.lang']);
    expect(filterCatalog(e, {})).toHaveLength(2);
  });
});

describe('the documented example', () => {
  it('examples/catalog is a good catalog and follows its schema', () => {
    const text = readFileSync(join(__dirname, '..', 'examples', 'catalog', 'transly-catalog.json'), 'utf8');
    const r = checkCatalog(text);
    expect(r.ok && r.index.warnings).toEqual([]);
    expect(r.ok && r.index.entries.map(e => e.id)).toEqual(['acme.wolf', 'pl.interface']);
    const schema = JSON.parse(readFileSync(join(__dirname, '..', 'docs', 'plugins', 'catalog.schema.json'), 'utf8')) as { required: string[] };
    for (const k of schema.required) expect(JSON.parse(text), k).toHaveProperty(k);
  });

  it('an entry made from a manifest says what the manifest says', () => {
    const m = checkManifest({ manifestVersion: 1, id: 'acme.x', name: 'X', version: '2.0.0', author: { name: 'Ann' }, description: 'd',
      contributes: { engines: [{ id: 'e', label: 'E', detect: { anyFiles: ['**/*.x'] } }], languages: [{ code: 'pl', name: 'Polski', catalogs: [{ file: 'pl.po' }] }], qaRules: [{ id: 'r', title: 'R', check: { type: 'sameAsSource' } }] }, files: { 'pl.po': 'sha256-' + 'a'.repeat(64) } });
    if (!m.ok) throw new Error(m.errors.join(';'));
    const e = entryOfManifest(m.manifest, { kind: 'bundled', key: 'x' });
    expect(e).toMatchObject({ id: 'acme.x', name: 'X', version: '2.0.0', author: 'Ann', description: 'd', tags: ['language', 'engine', 'qa'], languages: ['pl'], detect: { anyFiles: ['**/*.x'] }, source: { kind: 'bundled', key: 'x' } });
  });
});
