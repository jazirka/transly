import { describe, expect, it } from 'vitest';
import { API_VERSION, APP_VERSION, I18n, PluginRegistry, applyBySpec, checkManifest, compareVersions, compatibility, extractBySpec, globTest, parsePath, parsePoCatalog, parseJsonCatalog, pluralFn, registerBuiltins, satisfies, validRange } from '../src/core/ext';
import type { FormatHandler, FormatSpec, PluginManifest } from '../src/core/ext';
import { apply, extract, formatOf, formatInfos, isTextFormat, readableExtensions } from '../src/core/engine';
import { plugins } from '../src/core/ext';
import pkg from '../package.json';

const manifest = (over: Record<string, unknown> = {}): Record<string, unknown> => ({ manifestVersion: 1, id: 'acme.lang', name: 'Lang files', version: '1.0.0', contributes: { formats: [{ id: 'lang', label: 'Lang', extensions: ['.lang'], text: true, spec: { type: 'keyvalue' } }] }, ...over });
const ok = (m: Record<string, unknown>): PluginManifest => { const r = checkManifest(m); if (!r.ok) throw new Error(r.errors.join('; ')); return r.manifest; };

describe('versions', () => {
  it('knows the version of the application from package.json', () => { expect(APP_VERSION).toBe(pkg.version); });
  it('compares versions the way semver does', () => {
    expect(compareVersions('1.2.3', '1.2.10')).toBe(-1);
    expect(compareVersions('2.0.0', '1.99.99')).toBe(1);
    expect(compareVersions('1.0.0-beta.1', '1.0.0')).toBe(-1);
    expect(compareVersions('1.0.0-beta.2', '1.0.0-beta.10')).toBe(-1);
    expect(compareVersions('v1.0', '1.0.0')).toBe(0);
  });
  it('reads ranges: caret, tilde, comparators, wildcards, or', () => {
    expect(satisfies('1.4.0', '^1.2.0')).toBe(true);
    expect(satisfies('2.0.0', '^1.2.0')).toBe(false);
    expect(satisfies('0.2.5', '^0.2.1')).toBe(true);
    expect(satisfies('0.3.0', '^0.2.1')).toBe(false);
    expect(satisfies('1.2.9', '~1.2.3')).toBe(true);
    expect(satisfies('1.3.0', '~1.2.3')).toBe(false);
    expect(satisfies('1.5.0', '>=1.0.0 <2.0.0')).toBe(true);
    expect(satisfies('2.0.0', '>=1.0.0 <2.0.0')).toBe(false);
    expect(satisfies('3.1.0', '^1 || ^3')).toBe(true);
    expect(satisfies('1.9.0', '1.x')).toBe(true);
    expect(satisfies('2.0.0', '1.x')).toBe(false);
    expect(satisfies('1.0.0', '*')).toBe(true);
    expect(satisfies('2.0.0-beta', '^2.0.0')).toBe(false);
    expect(satisfies('not a version', '*')).toBe(false);
  });
  it('tells a range that cannot be read', () => { expect(validRange('^1.2.0')).toBe(true); expect(validRange('>= 1.0.0 < 2')).toBe(true); expect(validRange('banana')).toBe(false); });
});

describe('the manifest', () => {
  it('accepts a plain data plugin', () => { expect(checkManifest(manifest()).ok).toBe(true); });
  it('rejects what is not an object, not JSON, too big, for another version of the format', () => {
    expect(checkManifest('nope').ok).toBe(false);
    expect(checkManifest('[]').ok).toBe(false);
    expect(checkManifest('x'.repeat(300_000)).ok).toBe(false);
    expect(checkManifest(manifest({ manifestVersion: 2 })).ok).toBe(false);
  });
  it('rejects bad ids, versions, names and reserves the application\'s own prefix', () => {
    for (const id of ['x', 'Acme.Lang', 'acme..lang', 'acme.lang!', 'a'.repeat(70) + '.b', '../x.y']) expect(checkManifest(manifest({ id })).ok, id).toBe(false);
    expect(checkManifest(manifest({ version: 'banana' })).ok).toBe(false);
    expect(checkManifest(manifest({ name: '' })).ok).toBe(false);
    expect(checkManifest(manifest({ id: 'transly.evil' })).ok).toBe(false);
  });
  it('checks every contribution: formats, engines, languages, help, settings', () => {
    const bad = (contributes: unknown) => checkManifest(manifest({ contributes })).ok;
    expect(bad({ formats: [{ id: 'a', label: 'A', extensions: ['lang'], text: true, spec: { type: 'keyvalue' } }] })).toBe(false);
    expect(bad({ formats: [{ id: 'a', label: 'A', extensions: ['.a'], text: true }] })).toBe(false);
    expect(bad({ formats: [{ id: 'a', label: 'A', extensions: ['.a'], text: true, spec: { type: 'wild' } }] })).toBe(false);
    expect(bad({ formats: [{ id: 'a', label: 'A', extensions: ['.a'], text: true, handler: 'x' }] })).toBe(false);
    expect(bad({ formats: [{ id: 'a', label: 'A', extensions: ['.a'], text: true, spec: { type: 'json', rules: [{ path: '__proto__.x' }] } }] })).toBe(true);   // the path is refused later, when it is read
    expect(bad({ formats: [{ id: 'a', label: 'A', extensions: ['.a'], text: true, spec: { type: 'keyvalue' } }, { id: 'a', label: 'B', extensions: ['.b'], text: true, spec: { type: 'keyvalue' } }] })).toBe(false);
    expect(bad({ engines: [{ id: 'e', label: 'E', formats: ['nope'] }] })).toBe(false);
    expect(bad({ engines: [{ id: 'e', label: 'E', detect: { files: ['../../etc/passwd'] } }] })).toBe(false);
    expect(bad({ languages: [{ code: 'english', name: 'E', catalogs: [{ file: 'a.po' }] }] })).toBe(false);
    expect(bad({ languages: [{ code: 'en', name: 'E', catalogs: [{ file: '../a.po' }] }] })).toBe(false);
    expect(bad({ help: [{ id: 'h', title: 'T' }] })).toBe(false);
    expect(bad({ settings: [{ id: 's', title: 'S', fields: [{ key: 'a', type: 'select', label: 'A' }] }] })).toBe(false);
  });
  it('keeps what an older reader cannot understand as a warning, not an error', () => {
    const r = checkManifest(manifest({ contributes: { futureThing: [], formats: [] } }));
    expect(r.ok && r.warnings.length).toBe(1);
  });
  it('wants a checksum for the code and for every catalog and help file, and only safe paths', () => {
    expect(checkManifest(manifest({ main: 'plugin.js' })).ok).toBe(false);
    expect(checkManifest(manifest({ main: '../plugin.js', files: { '../plugin.js': 'sha256-' + 'a'.repeat(64) } })).ok).toBe(false);
    expect(checkManifest(manifest({ main: 'plugin.js', files: { 'plugin.js': 'sha256-' + 'a'.repeat(64) } })).ok).toBe(true);
    expect(checkManifest(manifest({ files: { 'a.txt': 'md5-abc' } })).ok).toBe(false);
    expect(checkManifest(manifest({ contributes: { languages: [{ code: 'en', name: 'English', catalogs: [{ file: 'en.po' }] }] } })).ok).toBe(false);
  });
  it('allows the network permission only for code with hosts', () => {
    expect(checkManifest(manifest({ permissions: ['network'] })).ok).toBe(false);
    expect(checkManifest(manifest({ main: 'p.js', files: { 'p.js': 'sha256-' + 'b'.repeat(64) }, permissions: ['network'] })).ok).toBe(false);
    expect(checkManifest(manifest({ main: 'p.js', files: { 'p.js': 'sha256-' + 'b'.repeat(64) }, permissions: ['network'], network: { hosts: ['api.example.com'] } })).ok).toBe(true);
    expect(checkManifest(manifest({ permissions: ['root'] })).ok).toBe(false);
  });
  it('checks the version of the application and of the API a plugin asks for', () => {
    expect(compatibility(ok(manifest({ requires: { transly: `>=${APP_VERSION}` } }))).ok).toBe(true);
    expect(compatibility(ok(manifest({ requires: { transly: '>=99.0.0' } }))).ok).toBe(false);
    expect(compatibility(ok(manifest({ requires: { api: '^2.0.0' } }))).ok).toBe(false);
    expect(compatibility(ok(manifest({ requires: { api: `^${API_VERSION}` } }))).ok).toBe(true);
  });
});

describe('the built-in plugins', () => {
  it('keep the formats and the order the application always had', () => {
    expect(formatOf({ name: 'Map001.json' })).toBe('rpgmaker');
    expect(formatOf({ name: 'System.json' })).toBe('rpgmaker');
    expect(formatOf({ name: 'en.json' })).toBe('locale-json');
    expect(formatOf({ name: 'random.json' })).toBeNull();
    expect(formatOf({ name: 'x.po' })).toBe('gettext');
    expect(formatOf({ name: 'x.pot' })).toBe('gettext');
    expect(formatOf({ name: 'x.csv' })).toBe('csv');
    expect(formatOf({ name: 'x.tsv' })).toBe('csv');
    expect(formatOf({ name: 'script.rpy' })).toBe('renpy');
    expect(formatOf({ name: 'x.txt' })).toBeNull();
    expect(isTextFormat('renpy') && isTextFormat('csv') && !isTextFormat('rpgmaker') && !isTextFormat('locale-json') && !isTextFormat(null)).toBe(true);
    expect(readableExtensions().sort()).toEqual(['.csv', '.json', '.po', '.pot', '.rpy', '.tsv']);
    expect(formatInfos().map(f => f.id)).toEqual(['rpgmaker', 'locale-json', 'gettext', 'csv', 'renpy']);
  });
  it('are on, cannot be told from the others by the callers, and show what RPG Maker offers', () => {
    expect(plugins.list().filter(p => p.builtin).every(p => p.state === 'enabled')).toBe(true);
    expect(plugins.features().has('scenes')).toBe(true);
    const found = plugins.detect(['www/data/System.json', 'www/data/MapInfos.json', 'www/data/Map001.json', 'Game.exe']);
    expect(found[0]?.engine.id).toBe('rpgmaker');
    expect(plugins.detect(['readme.txt'])).toEqual([]);
    expect(plugins.detect(['game/script.rpy', 'game/options.rpy'])[0]?.engine.id).toBe('renpy');
  });
});

const fresh = (): PluginRegistry => { const r = new PluginRegistry(new I18n(), APP_VERSION, API_VERSION); registerBuiltins(r); return r; };
const kv = (id = 'acme.lang', over: Record<string, unknown> = {}): { m: PluginManifest; h: FormatHandler[] } => {
  const m = ok(manifest({ id, ...over }));
  const f = m.contributes?.formats?.[0] ?? { id: 'lang', label: 'Lang', extensions: ['.lang'], text: true, spec: { type: 'keyvalue' as const } };
  const h: FormatHandler = { id: `${id}/lang`, plugin: id, label: f.label, extensions: f.extensions, text: true, priority: 0, matches: x => x.name.endsWith('.lang'), extract: file => extractBySpec(file, f.spec!), apply: (file, tr) => applyBySpec(file, tr, f.spec!) };
  return { m, h: [h] };
};

describe('the registry', () => {
  it('adds a format of a plugin, takes it away when the plugin is switched off, and brings it back', () => {
    const r = fresh();
    const { m, h } = kv();
    r.add({ manifest: m, builtin: false, enabled: true, handlers: h, files: new Map(), source: { kind: 'file' } });
    expect(r.handlerOf({ name: 'x.lang' })?.id).toBe('acme.lang/lang');
    r.setEnabled('acme.lang', false);
    expect(r.handlerOf({ name: 'x.lang' })).toBeNull();
    expect(r.get('acme.lang')?.state).toBe('disabled');
    r.setEnabled('acme.lang', true);
    expect(r.handlerOf({ name: 'x.lang' })).not.toBeNull();
    r.remove('acme.lang');
    expect(r.get('acme.lang')).toBeUndefined();
  });
  it('does not run a plugin that does not fit this version, lacks a dependency, or failed to load — and says why', () => {
    const r = fresh();
    const a = kv('acme.old', { requires: { transly: '>=99.0.0' } });
    r.add({ manifest: a.m, builtin: false, enabled: true, handlers: a.h, files: new Map(), source: { kind: 'file' } });
    expect(r.get('acme.old')?.state).toBe('incompatible');
    expect(r.get('acme.old')?.reason).toMatch(/99/);
    const b = kv('acme.needs', { dependencies: { 'acme.base': '^1.0.0' } });
    r.add({ manifest: b.m, builtin: false, enabled: true, handlers: b.h, files: new Map(), source: { kind: 'file' } });
    expect(r.get('acme.needs')?.state).toBe('missing-dependency');
    const base = kv('acme.base', { version: '1.2.0', contributes: {} });
    r.add({ manifest: base.m, builtin: false, enabled: true, handlers: [], files: new Map(), source: { kind: 'file' } });
    expect(r.get('acme.needs')?.state).toBe('enabled');
    r.setEnabled('acme.base', false);
    expect(r.get('acme.needs')?.state).toBe('missing-dependency');
    const c = kv('acme.broken');
    r.add({ manifest: c.m, builtin: false, enabled: true, handlers: c.h, files: new Map(), source: { kind: 'file' }, loadError: 'boom' });
    expect(r.get('acme.broken')?.state).toBe('error');
    expect(r.handlerOf({ name: 'x.lang' })).toBeNull();
  });
  it('a chain of dependencies falls together, a version that does not match is refused', () => {
    const r = fresh();
    const mk = (id: string, deps?: Record<string, string>, version = '1.0.0') => { const x = kv(id, { version, ...(deps ? { dependencies: deps } : {}), contributes: {} }); r.add({ manifest: x.m, builtin: false, enabled: true, handlers: [], files: new Map(), source: { kind: 'file' } }); };
    mk('acme.c'); mk('acme.b', { 'acme.c': '^1.0.0' }); mk('acme.a', { 'acme.b': '^1.0.0' });
    expect(r.get('acme.a')?.state).toBe('enabled');
    r.setEnabled('acme.c', false);
    expect(r.get('acme.a')?.state).toBe('missing-dependency');
    r.setEnabled('acme.c', true);
    mk('acme.d', { 'acme.c': '^2.0.0' });
    expect(r.get('acme.d')?.state).toBe('missing-dependency');
  });
  it('lets a built-in format win over a plugin that claims the same files, unless the plugin is asked first by priority among plugins', () => {
    const r = fresh();
    const m = ok(manifest({ id: 'acme.json', contributes: { formats: [{ id: 'j', label: 'J', extensions: ['.json'], text: false, spec: { type: 'json', rules: [{ path: 'a' }] } }] } }));
    const h: FormatHandler = { id: 'acme.json/j', plugin: 'acme.json', label: 'J', extensions: ['.json'], text: false, priority: 50, matches: () => true, extract: () => [], apply: f => f.json };
    r.add({ manifest: m, builtin: false, enabled: true, handlers: [h], files: new Map(), source: { kind: 'file' } });
    expect(r.handlerOf({ name: 'Map001.json' })?.id).toBe('rpgmaker');
    expect(r.handlerOf({ name: 'something.json' })?.id).toBe('acme.json/j');
  });
  it('isolates a failing plugin: the failure is recorded, the caller gets a safe answer, and it is reported once', () => {
    const r = fresh();
    const { m } = kv();
    const bad: FormatHandler = { id: 'acme.lang/lang', plugin: 'acme.lang', label: 'L', extensions: ['.lang'], text: true, priority: 0, matches: () => true, extract: () => { throw new Error('boom'); }, apply: () => { throw new Error('boom'); } };
    r.add({ manifest: m, builtin: false, enabled: true, handlers: [bad], files: new Map(), source: { kind: 'file' } });
    const told: string[] = [];
    r.onFailure = (_rec, what) => told.push(what);
    expect(r.guard(bad, 'x', () => bad.extract({ name: 'a.lang', json: null, text: '' }, {}), () => [])).toEqual([]);
    r.guard(bad, 'x', () => bad.extract({ name: 'a.lang', json: null, text: '' }, {}), () => []);
    expect(r.get('acme.lang')?.errors.length).toBe(2);
    expect(told.length).toBe(1);
  });
  it('tells the engine of a folder and the help of the working plugins only', () => {
    const r = fresh();
    const m = ok(manifest({ id: 'acme.wolf', contributes: { engines: [{ id: 'wolf', label: 'Wolf RPG', detect: { files: ['data/basicdata/*.wolf'], excludeFiles: ['**/system.json'] }, help: 'open' }], help: [{ id: 'open', topic: 'engine:wolf', title: 'Open', body: 'Pick the folder' }, { id: 'about', title: 'About', body: 'General help' }] } }));
    r.add({ manifest: m, builtin: false, enabled: true, handlers: [], files: new Map(), source: { kind: 'file' } });
    expect(r.detect(['Data/BasicData/Game.wolf'])[0]?.engine.id).toBe('acme.wolf/wolf');
    expect(r.detect(['Data/BasicData/Game.wolf', 'Data/System.json'])[0]?.engine.id).not.toBe('acme.wolf/wolf');
    expect(r.help('engine:wolf').map(h => h.title)).toEqual(['Open']);
    expect(r.help().map(h => h.title)).toContain('About');
    expect(r.helpById('acme.wolf:open')?.body).toBe('Pick the folder');
    r.setEnabled('acme.wolf', false);
    expect(r.help().map(h => h.title)).not.toContain('About');
    expect(r.detect(['Data/BasicData/Game.wolf'])[0]?.engine.state).toBe('disabled');
  });
});

describe('the format of a plugin in the engine', () => {
  it('reads and writes a data format end to end, and an unsafe plugin cannot hand back bad rows', () => {
    const { m, h } = kv();
    plugins.add({ manifest: m, builtin: false, enabled: true, handlers: h, files: new Map(), source: { kind: 'file' } });
    try {
      expect(formatOf({ name: 'ui.lang' })).toBe('acme.lang/lang');
      const text = '# comment\nhello=Hello\nbye = Goodbye\n';
      const units = extract({ name: 'ui.lang', json: null, text });
      expect(units.map(u => [u.key, u.source])).toEqual([['hello', 'Hello'], ['bye', 'Goodbye']]);
      const out = apply({ name: 'ui.lang', json: null, text }, { hello: { target: 'Привіт', status: 'done', mt: 1 } });
      expect(out).toBe('# comment\nhello=Привіт\nbye = Goodbye\n');
    } finally { plugins.remove('acme.lang'); }
    expect(formatOf({ name: 'ui.lang' })).toBeNull();
  });
});

describe('declarative formats', () => {
  it('keyvalue: duplicate keys, unescape, line endings, BOM, separators', () => {
    const spec: FormatSpec = { type: 'keyvalue', unescape: true };
    const text = '﻿a=One\\nTwo\r\nb: ignored\r\na=Again\r\n';
    const u = extractBySpec({ name: 'x', json: null, text }, spec);
    expect(u.map(x => [x.key, x.source])).toEqual([['a', 'One\nTwo'], ['a#2', 'Again']]);
    const out = applyBySpec({ name: 'x', json: null, text }, { a: { target: 'Один\nДва', status: 'done', mt: 1 }, 'a#2': { target: 'Знову', status: 'done', mt: 1 } }, spec);
    expect(out).toBe('﻿a=Один\\nДва\r\nb: ignored\r\na=Знову\r\n');
    expect(extractBySpec({ name: 'x', json: null, text: 'k: v' }, { type: 'keyvalue', separator: ': ' })[0]?.source).toBe('v');
  });
  it('table: header names, numbers, quotes, speaker, and writes the target column', () => {
    const spec: FormatSpec = { type: 'table', key: 'id', source: 'text', target: 'tr', speaker: 'who' };
    const text = 'id,who,text,tr\n1,Anna,"Hello, world",\n2,Bob,"Say ""hi""",Привіт\n3,,,\n';
    const u = extractBySpec({ name: 'x', json: null, text }, spec);
    expect(u.map(x => [x.key, x.source, x.speaker])).toEqual([['1', 'Hello, world', 'Anna'], ['2', 'Say "hi"', 'Bob']]);
    const out = String(applyBySpec({ name: 'x', json: null, text }, { '1': { target: 'Вітаю, світе', status: 'done', mt: 1 } }, spec));
    expect(out).toContain('1,Anna,"Hello, world","Вітаю, світе"');
    expect(out).toContain('2,Bob,"Say ""hi""",Привіт');
    expect(extractBySpec({ name: 'x', json: null, text }, { ...spec, key: 'nope' })).toEqual([]);
  });
  it('table: a missing target column is added to the header; auto delimiter', () => {
    const spec = { type: 'table', key: 0, source: 1, target: 'tr', delimiter: 'auto' } as const satisfies FormatSpec;
    const text = 'id;text\n1;Hello\n';
    expect(extractBySpec({ name: 'x', json: null, text }, { ...spec, key: 'id', source: 'text' }).length).toBe(1);
    const out = String(applyBySpec({ name: 'x', json: null, text }, { '1': { target: 'Привіт', status: 'done', mt: 1 } }, { ...spec, key: 'id', source: 'text' }));
    expect(out.split('\n')[0]).toBe('id;text;tr');
    expect(out.split('\n')[1]).toBe('1;Hello;Привіт');
  });
  it('json: wildcards, speaker beside the value, the input is not changed, prototype paths are refused', () => {
    const spec: FormatSpec = { type: 'json', rules: [{ path: 'scenes[*].lines[*].text', kind: 'dialogue', speaker: 'who' }, { path: 'title', kind: 'name' }] };
    const json = { title: 'Game', scenes: [{ lines: [{ who: 'Anna', text: 'Hi' }, { who: 'Bob', text: 'Yo' }, { text: '' }] }] };
    const keep = JSON.stringify(json);
    const u = extractBySpec({ name: 'x', json }, spec);
    expect(u.map(x => [x.key, x.source, x.speaker, x.kind])).toEqual([['scenes[0].lines[0].text', 'Hi', 'Anna', 'dialogue'], ['scenes[0].lines[1].text', 'Yo', 'Bob', 'dialogue'], ['title', 'Game', '', 'name']]);
    const out = applyBySpec({ name: 'x', json }, { 'scenes[0].lines[1].text': { target: 'Ей', status: 'done', mt: 1 } }, spec) as typeof json;
    expect(out.scenes[0]!.lines[1]!.text).toBe('Ей');
    expect(JSON.stringify(json)).toBe(keep);
    expect(parsePath('__proto__.polluted')).toBeNull();
    expect(parsePath('a.constructor.b')).toBeNull();
    expect(extractBySpec({ name: 'x', json: JSON.parse('{"__proto__":{"a":"x"}}') }, { type: 'json', rules: [{ path: '__proto__.a' }] })).toEqual([]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
  it('matches name patterns', () => {
    expect(globTest('*.lang')('Data/ui.LANG')).toBe(false);          // `*` stays inside one name
    expect(globTest('**/*.lang')('Data/ui.LANG')).toBe(true);
    expect(globTest('data/*.json')('data/a.json')).toBe(true);
    expect(globTest('data/*.json')('data/x/a.json')).toBe(false);
    expect(globTest('**/system.json')('System.json')).toBe(true);
  });
});

describe('localization', () => {
  const pack = (text: string, name = 'en.po') => { const d = text.startsWith('{') ? parseJsonCatalog(text) : parsePoCatalog(text); void name; return d; };
  it('reads a .po with contexts, plurals, a header and skips fuzzy and untranslated entries', () => {
    const d = pack('msgid ""\nmsgstr ""\n"Language: en\\n"\n"Plural-Forms: nplurals=2; plural=(n != 1);\\n"\n\nmsgid "Файл"\nmsgstr "File"\n\n#, fuzzy\nmsgid "Вікно"\nmsgstr "Window"\n\nmsgctxt "plugin:acme.x"\nmsgid "Привіт"\nmsgstr "Hello"\n\nmsgid "Пусто"\nmsgstr ""\n\nmsgid "{n} рядок"\nmsgid_plural "{n} рядки"\nmsgstr[0] "{n} row"\nmsgstr[1] "{n} rows"\n');
    expect(d.language).toBe('en');
    expect(d.plural).toBe('(n != 1)');
    expect([...d.entries.keys()].map(k => k.replace('\u0004', '|'))).toEqual(['core|Файл', 'plugin:acme.x|Привіт', 'core|{n} рядок']);
  });
  it('reads a JSON catalog too', () => {
    const d = pack('{"language":"pl","messages":{"Файл":"Plik"},"contexts":{"plugin:a.b":{"Так":["Tak"]}}}');
    expect(d.entries.size).toBe(2);
  });
  it('translates by context, falls back to the source, and a pack can translate a plugin of someone else', () => {
    const i = new I18n();
    i.add('en', pack('msgid "Файл"\nmsgstr "File"\n\nmsgctxt "plugin:acme.x"\nmsgid "Вікно"\nmsgstr "Window"\n'), 'pack.en');
    expect(i.t('Файл')).toBe('Файл');
    i.setLanguage('en');
    expect(i.t('Файл')).toBe('File');
    expect(i.t('Вікно')).toBe('Вікно');
    expect(i.t('Вікно', undefined, 'plugin:acme.x')).toBe('Window');
    expect(i.t('Невідомо')).toBe('Невідомо');
    expect(i.missing().map(m => m.id)).toContain('Невідомо');
  });
  it('fills in parameters, templates for numbers, and fr-CA → fr', () => {
    const i = new I18n();
    i.add('fr', pack('msgid "Перекладено {pct}% ({done} з {total})"\nmsgstr "Traduit {pct} % ({done} sur {total})"\n\nmsgid "Крок {1}"\nmsgstr "Étape {1}"\n'), 'fr');
    i.setLanguage('fr-CA');
    expect(i.language).toBe('fr');
    expect(i.translateText('Перекладено 22% (24 з 109)')).toBe('Traduit 22 % (24 sur 109)');
    expect(i.translateText('Крок 3')).toBe('Étape 3');
    expect(i.translateText('Щось інше')).toBeNull();
    expect(i.t('Перекладено {pct}% ({done} з {total})', { pct: 5, done: 1, total: 20 })).toBe('Traduit 5 % (1 sur 20)');
  });
  it('plural forms follow the language of the pack (Polish has three, English two)', () => {
    const i = new I18n();
    i.add('pl', pack('msgid ""\nmsgstr ""\n"Plural-Forms: nplurals=3; plural=(n==1 ? 0 : n%10>=2 && n%10<=4 && (n%100<10 || n%100>=20) ? 1 : 2);\\n"\n\nmsgid "{n} рядок"\nmsgstr[0] "{n} wiersz"\nmsgstr[1] "{n} wiersze"\nmsgstr[2] "{n} wierszy"\n'), 'pl');
    i.setLanguage('pl');
    const forms = ['{n} рядок', '{n} рядки', '{n} рядків'];
    expect([1, 3, 5, 22, 12].map(n => i.tn(forms, n))).toEqual(['1 wiersz', '3 wiersze', '5 wierszy', '22 wiersze', '12 wierszy']);
    const j = new I18n();
    expect([1, 3, 5, 21, 12].map(n => j.tn(forms, n))).toEqual(['1 рядок', '3 рядки', '5 рядків', '21 рядок', '12 рядків']);
  });
  it('switches the language at run time, takes a pack away with its plugin, and tells the listeners', () => {
    const i = new I18n();
    let changed = 0;
    i.onChange(() => changed++);
    i.add('en', pack('msgid "Файл"\nmsgstr "File"\n'), 'a');
    i.setLanguage('en'); expect(i.t('Файл')).toBe('File');
    i.setLanguage('uk'); expect(i.t('Файл')).toBe('Файл');
    i.setLanguage('en');
    i.remove('a');
    expect(i.language).toBe('uk');
    expect(i.t('Файл')).toBe('Файл');
    expect(changed).toBeGreaterThan(3);
    expect(i.languages().map(l => l.code)).toEqual(['uk']);
  });
  it('layers: the pack installed later wins, and a template of what is missing can be given to a translator', () => {
    const i = new I18n();
    i.add('en', pack('msgid "Файл"\nmsgstr "File"\n'), 'one');
    i.add('en', pack('msgid "Файл"\nmsgstr "Document"\n'), 'two');
    i.setLanguage('en');
    expect(i.t('Файл')).toBe('Document');
    i.translateText('Рядків 12');
    const pot = i.template('en');
    expect(pot).toContain('msgctxt "core"');
    expect(pot).toContain('msgid "Рядків {1}"');
    expect(parsePoCatalog(pot.replace('msgstr ""\n\n#.', 'msgstr "x"\n\n#.')).language).toBe('en');
  });
  it('reads a plural rule without running it as code', () => {
    expect(pluralFn('n != 1')!(1)).toBe(0);
    expect(pluralFn('n%10==1 && n%100!=11 ? 0 : n%10>=2 && n%10<=4 && (n%100<10 || n%100>=20) ? 1 : 2')!(21)).toBe(0);
    expect(pluralFn('process.exit(1)')).toBeNull();
    expect(pluralFn('constructor')).toBeNull();
    expect(pluralFn('(' .repeat(50))).toBeNull();
    expect(pluralFn('n/0')!(5)).toBe(0);
  });
  it('a language pack is a plugin: its catalogs enter the interface while it is on, leave when it is off', () => {
    const i = new I18n();
    const r = new PluginRegistry(i, APP_VERSION, API_VERSION);
    const m = ok({ manifestVersion: 1, id: 'acme.pl', name: 'Polski', version: '1.0.0', files: { 'pl.po': 'sha256-' + 'c'.repeat(64) }, contributes: { languages: [{ code: 'pl', name: 'Polish', nativeName: 'Polski', catalogs: [{ file: 'pl.po' }] }] } });
    r.add({ manifest: m, builtin: false, enabled: true, handlers: [], files: new Map([['pl.po', 'msgid "Файл"\nmsgstr "Plik"\n']]), source: { kind: 'file' } });
    expect(i.languages().map(l => l.name)).toContain('Polski');
    i.setLanguage('pl'); expect(i.t('Файл')).toBe('Plik');
    r.setEnabled('acme.pl', false);
    expect(i.language).toBe('uk'); expect(i.t('Файл')).toBe('Файл');
    r.setEnabled('acme.pl', true);
    expect(i.languages().map(l => l.code)).toContain('pl');
  });
});
