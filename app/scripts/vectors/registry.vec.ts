import { test } from 'vitest';
import { languagePlugin, rpgMakerPlugin, textFormatsPlugin } from '../../src/core/ext/builtin';
import { declarativeHandler } from '../../src/core/ext/host';
import { I18n } from '../../src/core/ext/i18n';
import { parseJsonCatalog } from '../../src/core/ext/i18n';
import { pluginCommands } from '../../src/core/ext/commands';
import { matchDetect, PluginRegistry } from '../../src/core/ext/registry';
import type { PluginRecord } from '../../src/core/ext/registry';
import type { FormatHandler } from '../../src/core/ext/types';
import { rng, writeVectors } from './util';
import type { Rng } from './util';

const PATHS = [
  ['data/System.json', 'data/MapInfos.json', 'data/Actors.json'], ['data/system.json'], ['game/script.rpy', 'game/x.rpy'], ['a.rpy'], ['x.zzz', 'y.zzz'], ['x.zzz'], ['dir\\SYSTEM.JSON', 'dir\\Actors.json', 'dir\\CommonEvents.json'], [], ['data/a.lang', 'data/b.zzz', 'skip.bad'],
];
const NAMES = ['a.lang', 'data/x.lang', 'x/y.lang', 'Map001.json', 'System.json', 'en.json', 'x.po', 'x.pot', 'x.csv', 'x.tsv', 'x.rpy', 'data\\z.lang', 'q.txt', 'Some.JSON', 'DATA/X.LANG', 'x.zzz', 'z.dat'];
const IDS = ['acme.one', 'acme.two', 'acme.three', 'acme.four'];
const VER = ['1.0.0', '1.2.0', '2.0.0', '0.9.0'];
const RANGES = ['^1.0.0', '>=1.0.0', '^2.0.0', '*', '~1.2.0', '>=3.0.0'];

const LANG_PO = 'msgid ""\nmsgstr ""\n"Language: xx\\n"\n\nmsgid "Привіт"\nmsgstr "Xx hi"\n';
const probes: [string, string?][] = [['Привіт'], ['Збережено'], ['Hello msg', 'plugin:acme.one'], ['Потрібне розширення'], ['Title', 'plugin:acme.two']];

function genManifest(r: Rng, id: string): Record<string, unknown> {
  const deps: Record<string, string> = {};
  for (const d of IDS) if (d !== id && r.chance(0.25)) deps[d] = r.pick(RANGES);
  const formats = Array.from({ length: r.int(3) }, (_, i) => ({ id: `f${i}`, label: `Fmt ${i}`, extensions: r.pick([['.lang'], ['.lang', '.zzz'], ['.TXT'], ['.json'], ['.rpy']]), text: true, ...(r.chance(0.5) ? { files: r.pick([['data/*.lang'], ['**/x.lang', '*.zzz'], ['a.lang']]) } : {}), spec: { type: 'keyvalue' }, ...(r.chance(0.7) ? { priority: r.pick([-80, -5, 0, 5, 10, 80, 100]) } : {}), ...(r.chance(0.3) ? { help: 'h1' } : {}) }));
  const engines = Array.from({ length: r.int(3) }, (_, i) => ({ id: `e${i}`, label: `Eng ${i}`, ...(r.chance(0.5) ? { description: 'd' } : {}), ...(r.chance(0.6) ? { features: r.pick([['scenes'], ['a', 'b'], ['a'], []]) } : {}), ...(r.chance(0.5) ? { help: 'h1' } : {}), ...(r.chance(0.5) ? { dataFolders: ['data'] } : {}), formats: formats.map(f => f.id).slice(0, r.int(3)), ...(r.chance(0.8) ? { detect: r.pick([{ anyFiles: ['**/*.zzz'] }, { files: ['**/system.json'], anyFiles: ['**/actors.json', '**/mapinfos.json'], min: 2 }, { anyFiles: ['**/*.rpy', '**/*.lang'], min: 1 }, { files: ['x.zzz'], excludeFiles: ['y.zzz'] }, { files: [], anyFiles: [] }, { files: ['**/*.rpy'] }]) } : {}) }));
  const help = Array.from({ length: r.int(4) }, (_, i) => ({ id: i === 0 ? 'h1' : `h${i + 1}`, title: r.pick(['Бета', 'Alpha', 'Гама', 'alpha', 'Єнот']), ...(r.chance(0.5) ? { body: r.pick(['Body', '', 'Текст']) } : {}), ...(r.chance(0.5) ? { file: r.pick(['help/a.md', 'help/none.md']) } : {}), ...(r.chance(0.6) ? { topic: r.pick(['general', 'engine:e0', 'engine:rpgmaker']) } : {}), ...(r.chance(0.5) ? { order: r.pick([-1, 0, 1, 5]) } : {}) }));
  const commands = Array.from({ length: r.int(3) }, (_, i) => r.pick([{ id: `c${i}`, title: 'Title', action: 'replace', steps: [{ find: 'a', replace: 'b' }] }, { id: `c${i}`, title: 'Hello msg', description: 'Title', action: 'help', help: 'h1' }, { id: `c${i}`, title: 'Привіт', action: 'link', url: 'https://x.example/a' }]));
  const languages = r.chance(0.4) ? [{ code: r.pick(['pl', 'de']), name: 'Lang', ...(r.chance(0.5) ? { nativeName: 'Native' } : {}), ...(r.chance(0.5) ? { plural: 'n != 1' } : {}), catalogs: [{ file: 'lang/a.json' }, ...(r.chance(0.5) ? [{ file: 'lang/b.json', context: 'plugin:' + id }] : []), ...(r.chance(0.2) ? [{ file: 'lang/none.json' }] : [])] }] : [];
  return {
    manifestVersion: 1, id, name: `Plugin ${id}`, version: r.pick(VER),
    ...(r.chance(0.3) ? { requires: { ...(r.chance(0.7) ? { transly: r.pick(['>=0.1.0', '^0.1.0', '>=1.0.0']) } : {}), ...(r.chance(0.5) ? { api: r.pick(['^1', '^2', '>=1.0.0']) } : {}) } } : {}),
    ...(Object.keys(deps).length ? { dependencies: deps } : {}),
    contributes: { ...(formats.length ? { formats } : {}), ...(engines.length ? { engines } : {}), ...(help.length ? { help } : {}), ...(languages.length ? { languages } : {}), ...(commands.length ? { commands } : {}) },
  };
}

const catalog = (r: Rng, id: string): string => JSON.stringify({ language: 'pl', messages: { Привіт: r.pick(['Cześć', 'Hallo']), Збережено: 'Zapisano' }, contexts: { [`plugin:${id}`]: { 'Hello msg': 'Witaj', Title: 'Tytuł' } } });

function handlersOf(m: Record<string, unknown>): FormatHandler[] {
  const fs = ((m.contributes as { formats?: never[] })?.formats ?? []) as { spec?: unknown }[];
  return fs.filter(f => f.spec).map(f => declarativeHandler(m.id as string, f as never));
}

function snapshot(reg: PluginRegistry, i18n: I18n): unknown {
  const st = reg.list().map(x => [x.manifest.id, x.state, x.reason ?? null]);
  const eng = reg.engines().map(e => ({ plugin: e.plugin, id: e.id, label: e.label, description: e.description ?? null, features: e.features, help: e.help ?? null, dataFolders: e.dataFolders, detect: e.detect ?? null, formats: e.formats, state: e.state, builtin: e.builtin }));
  const detect = PATHS.map(p => reg.detect(p).map(m => ({ id: m.engine.id, score: m.score, matched: m.matched })));
  const helps = ['general', 'engine:e0', 'engine:rpgmaker'].map(t => reg.help(t));
  const refs = ['acme.one:h1', 'acme.two:h2', 'acme.one:none', 'nope:h1', 'noColon', 'transly.rpgmaker:rpgmaker-open'].map(x => reg.helpById(x));
  const langs = i18n.languages().map(l => [l.code, l.name]);
  const prev = i18n.language;
  const tr = langs.map(([code]) => { i18n.setLanguage(code, []); return probes.map(([m, c]) => i18n.t(m, undefined, c)); });
  i18n.setLanguage(prev, []);
  return {
    states: st, handlers: reg.formats().map(h => h.id), extensions: reg.extensions(), engines: eng, features: [...reg.features()], detect, helps, refs,
    handlerOf: NAMES.map(n => reg.handlerOf({ name: n })?.id ?? null), handler: ['rpgmaker', 'acme.one/f0', 'nope'].map(i => reg.handler(i)?.id ?? null), langs, tr,
    cmds: pluginCommands(reg.list()),
    revisionBump: true,
  };
}

test('export registry vectors', () => {
  const r = rng(60606);
  const out: Record<string, { input: unknown; output: unknown }[]> = {};
  const add = (name: string, input: unknown, output: unknown) => (out[name] ??= []).push({ input, output });

  // matchDetect on its own
  const DETECT = [{ anyFiles: ['**/*.zzz'] }, { files: ['**/system.json'], anyFiles: ['**/actors.json', '**/mapinfos.json'], min: 2 }, { anyFiles: ['**/*.rpy', '**/*.lang'] }, { files: ['x.zzz'], excludeFiles: ['y.zzz'] }, { files: [], anyFiles: [] }, {}, { files: ['**/*.rpy'], min: 0 }, { anyFiles: ['*.lang', 'a?.lang'], min: 3 }];
  for (const d of DETECT) for (const p of PATHS) add('matchDetect', { d, paths: p }, matchDetect(d as never, p) ?? null);

  for (let i = 0; i < 60; i++) {
    const i18n = new I18n();
    const reg = new PluginRegistry(i18n, r.chance(0.2) ? '2.0.0' : undefined, r.chance(0.2) ? '2.0.0' : undefined);
    const recs: { kind: string; manifest?: Record<string, unknown>; builtin: boolean; enabled: boolean; files: Record<string, string>; loadError?: string }[] = [];
    const steps: unknown[] = [];
    const log: unknown[] = [];
    const nrec = 1 + r.int(4);
    const pool: typeof recs = [];
    if (r.chance(0.5)) pool.push({ kind: 'rpgmaker', builtin: true, enabled: r.chance(0.9), files: {} });
    if (r.chance(0.5)) pool.push({ kind: 'text', builtin: true, enabled: r.chance(0.9), files: {} });
    if (r.chance(0.3)) pool.push({ kind: 'lang', builtin: true, enabled: true, files: {} });
    const ids = r.chance(0.5) ? IDS : [...IDS].reverse();
    for (let n = 0; n < nrec; n++) {
      const id = ids[n]!;
      const m = genManifest(r, id);
      pool.push({ kind: 'user', manifest: m, builtin: r.chance(0.15), enabled: r.chance(0.8), files: { 'help/a.md': r.pick(['Help A', '']), 'lang/a.json': catalog(r, id), 'lang/b.json': catalog(r, id) }, ...(r.chance(0.1) ? { loadError: 'broken' } : {}) });
    }
    const mk = (x: (typeof pool)[number]): PluginRecord => {
      if (x.kind === 'rpgmaker' || x.kind === 'text') { const p = x.kind === 'rpgmaker' ? rpgMakerPlugin() : textFormatsPlugin(); return { manifest: p.manifest, builtin: true, enabled: x.enabled, handlers: p.handlers, files: new Map(), source: { kind: 'builtin' }, state: 'disabled', errors: [] }; }
      if (x.kind === 'lang') { const p = languagePlugin({ code: 'xx', name: 'Xx', nativeName: 'Иксы', po: 'msgid ""\nmsgstr ""\n"Language: xx\\n"\n\nmsgid "Привіт"\nmsgstr "Xx hi"\n' }); return { manifest: p.manifest, builtin: true, enabled: true, handlers: p.handlers, files: p.files, source: { kind: 'builtin' }, state: 'disabled', errors: [] }; }
      const m = x.manifest as never;
      return { manifest: m, builtin: x.builtin, enabled: x.enabled, handlers: handlersOf(x.manifest!), files: new Map(Object.entries(x.files)), source: { kind: 'file' }, state: 'disabled', errors: [], ...(x.loadError ? { loadError: x.loadError } : {}) };
    };
    const recIds = pool.map(x => (x.kind === 'user' ? (x.manifest!.id as string) : x.kind === 'rpgmaker' ? 'transly.rpgmaker' : x.kind === 'text' ? 'transly.text-formats' : 'transly.lang-xx'));
    // build: add each (refresh on the last one or not), then random later operations
    pool.forEach((x, idx) => { const refresh = idx === pool.length - 1 || r.chance(0.4); steps.push({ op: 'add', at: idx, refresh }); reg.add(mk(x) as never, refresh); if (refresh) log.push(snapshot(reg, i18n)); });
    for (let k = 0; k < 3 + r.int(4); k++) {
      const id = r.pick(recIds);
      const roll = r.next();
      if (roll < 0.5) { const on = r.chance(0.5); steps.push({ op: 'enable', id, on }); reg.setEnabled(id, on); }
      else if (roll < 0.65) { steps.push({ op: 'remove', id }); reg.remove(id); }
      else if (roll < 0.8) { const at = r.int(pool.length); steps.push({ op: 'add', at, refresh: true }); reg.add(mk(pool[at]!) as never, true); }
      else { const what = r.pick(['boom 12', 'boom 13', 'other', 'x 1 y 2']); steps.push({ op: 'fail', id, what }); const rec = reg.get(id); let warned = false; reg.onFailure = () => { warned = true; }; if (rec) reg.fail(rec, what); log.push({ failed: { warned, errors: rec?.errors.map(e => e.what) ?? null } }); continue; }
      log.push(snapshot(reg, i18n));
    }
    // stringify/parse drops undefined, as the saved vector would
    add('scenario', { pool, steps, paths: PATHS, names: NAMES, probes, lang: { code: 'xx', name: 'Xx', nativeName: 'Иксы', po: LANG_PO }, app: (reg as unknown as { app?: string }).app ?? null, api: (reg as unknown as { api?: string }).api ?? null }, log);
  }

  // builtins
  const i18n = new I18n();
  const reg = new PluginRegistry(i18n);
  const po = 'msgid ""\nmsgstr ""\n"Language: xx\\n"\n\nmsgid "Привіт"\nmsgstr "Xx hi"\n';
  const lang = { code: 'xx', name: 'Xx', nativeName: 'Иксы', po: LANG_PO };
  for (const p of [rpgMakerPlugin(), textFormatsPlugin()]) reg.add({ manifest: p.manifest, handlers: p.handlers, builtin: true, enabled: true, files: new Map(), source: { kind: 'builtin' } }, false);
  const lp = languagePlugin(lang);
  reg.add({ manifest: lp.manifest, handlers: [], builtin: true, enabled: true, files: lp.files, source: { kind: 'builtin' } }, false);
  reg.refresh();
  add('builtins', { lang, paths: PATHS, names: NAMES, probes }, {
    manifests: reg.list().map(x => x.manifest),
    handlers: reg.formats().map(h => ({ id: h.id, plugin: h.plugin, label: h.label, extensions: h.extensions, text: h.text, priority: h.priority, help: h.help ?? null })),
    snapshot: snapshot(reg, i18n),
  });
  writeVectors('registry', out);
});
