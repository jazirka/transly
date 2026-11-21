import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { API_VERSION, APP_VERSION, ExtHost, check, declarativeRules, glossaryTerms, pluginCommands, qaOf, setPluginQaRules, I18n, MemoryPluginStore, PluginRegistry, apply, extract, registerBuiltins } from '../src/core';
import type { Translations } from '../src/core';
import { plugins } from '../src/core';
import schema from '../docs/plugins/plugin.schema.json';

const ROOT = join(__dirname, '..', 'examples', 'plugins');
const names = readdirSync(ROOT).filter(n => statSync(join(ROOT, n)).isDirectory());

function filesOf(dir: string): { name: string; data: Uint8Array }[] {
  const out: { name: string; data: Uint8Array }[] = [];
  (function walk(d: string): void { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else out.push({ name: relative(dir, p).split(sep).join('/'), data: new Uint8Array(readFileSync(p)) }); } })(dir);
  return out;
}
const host = () => { const reg = new PluginRegistry(new I18n(), APP_VERSION, API_VERSION); registerBuiltins(reg); const h = new ExtHost(reg, new MemoryPluginStore()); h.setStorage(null); return { reg, h }; };

describe('the example plugins', () => {
  it('exist', () => { expect(names.sort()).toEqual(['json-dialogs', 'lang-english', 'lang-files', 'style-pack']); });
  for (const name of names) {
    it(`${name}: installs (so its checksums are up to date) and is enabled`, async () => {
      const { h, reg } = host();
      const plan = await h.plan({ kind: 'files', files: filesOf(join(ROOT, name)) });
      expect(plan.compat.ok).toBe(true);
      // the only thing worth a warning is a format that reads .json files, which the built-in formats read too
      expect(plan.warnings.filter(w => !/\.json/.test(w))).toEqual([]);
      const rec = await h.install(plan);
      expect(rec.state).toBe('enabled');
      expect(reg.get(rec.manifest.id)).toBeDefined();
    });
    it(`${name}: the manifest follows the documented schema`, () => {
      const m = JSON.parse(readFileSync(join(ROOT, name, 'transly-plugin.json'), 'utf8')) as Record<string, unknown>;
      for (const k of schema.required) expect(m, k).toHaveProperty(k);
      expect(m.manifestVersion).toBe(1);
    });
  }
  it('lang-files reads and writes .lang files', async () => {
    const { h } = host();
    await h.install(await h.plan({ kind: 'files', files: filesOf(join(ROOT, 'lang-files')) }));
    plugins.add({ ...(h.registry.get('example.lang-files')!), state: undefined } as never);
    try {
      const text = '# menu\nhello=Hello\nbye=Goodbye\\nfriend\n';
      const units = extract({ name: 'menu.lang', json: null, text });
      expect(units.map(u => [u.key, u.source])).toEqual([['hello', 'Hello'], ['bye', 'Goodbye\nfriend']]);
      const tr: Translations = { bye: { target: 'Бувай\nдрузю', status: 'done', mt: 1 } };
      expect(apply({ name: 'menu.lang', json: null, text }, tr)).toBe('# menu\nhello=Hello\nbye=Бувай\\nдрузю\n');
    } finally { plugins.remove('example.lang-files'); }
  });
  it('json-dialogs recognises its folder and reads a scene', async () => {
    const { h } = host();
    await h.install(await h.plan({ kind: 'files', files: filesOf(join(ROOT, 'json-dialogs')) }));
    const found = h.registry.detect(['scenes/intro.json', 'scenes/town.json', 'game.json']);
    expect(found[0]?.engine.id).toBe('example.json-dialogs/json-dialogs');
    expect(h.registry.detect(['Map001.json', 'System.json', 'MapInfos.json'])[0]?.engine.id).toBe('rpgmaker');
    plugins.add({ ...(h.registry.get('example.json-dialogs')!), state: undefined } as never);
    try {
      const json = { title: 'Intro', lines: [{ who: 'Anna', text: 'Hello', choices: [{ label: 'Hi' }, { label: 'Bye' }] }] };
      const units = extract({ name: 'scenes/intro.json', json });
      expect(units.map(u => [u.key, u.kind, u.speaker])).toEqual([['title', 'name', ''], ['lines[0].text', 'dialogue', 'Anna'], ['lines[0].choices[0].label', 'choice', ''], ['lines[0].choices[1].label', 'choice', '']]);
      expect(extract({ name: 'other/intro.json', json })).toEqual([]);     // outside `scenes/`: not this format
    } finally { plugins.remove('example.json-dialogs'); }
  });
  it('lang-english puts English on the screen strings and translates a string of another plugin', async () => {
    const { h, reg } = host();
    const i = (reg as unknown as { i18n: I18n }).i18n;
    await h.install(await h.plan({ kind: 'files', files: filesOf(join(ROOT, 'lang-english')) }));
    i.setLanguage('en');
    expect(i.t('Файл')).toBe('File');
    expect(i.t('Рядків без перекладу: {n}', { n: 3 })).toBe('Strings without a translation: 3');
    expect(i.t('Lang file (.lang)', undefined, 'plugin:example.lang-files')).toBe('Файл .lang');
  });
  it('style-pack brings rules of QA, commands and glossaries that work', async () => {
    const { h, reg } = host();
    const rec = await h.install(await h.plan({ kind: 'files', files: filesOf(join(ROOT, 'style-pack')) }));
    try {
      setPluginQaRules(declarativeRules(reg.list()));
      const run = (source: string, target: string, kind?: 'name') => check({ source, ...(kind ? { kind } : {}) }, target, { tolerancePct: 100, terms: [], rules: qaOf(undefined) }).filter(i => i.key.startsWith('example.style-pack:'));
      expect(run('Cool!', 'Це круто!').map(i => i.key)).toEqual(['example.style-pack:no-slang']);
      expect(run('Yes, Sir.', 'Так.').map(i => i.key)).toEqual(['example.style-pack:address-sir']);
      expect(run('Yes, Sir.', 'Так, пане.')).toEqual([]);
      const long = run('Sword', 'Дуже довга назва предмета для вузької колонки', 'name');
      expect(long.map(i => [i.key, i.severity])).toEqual([['example.style-pack:short-names', 'bad']]);
      expect(run('Hello there', 'Hello there').map(i => i.key)).toEqual(['example.style-pack:not-translated']);
      const cmds = pluginCommands(reg.list());
      expect(cmds.map(c => [c.title, c.action])).toEqual([['Tidy punctuation', 'replace'], ['House style guide', 'help'], ['Ukrainian orthography (pravopys.net)', 'link']]);
      expect(reg.helpById(cmds[1]!.help!)?.title).toBe('About this style');
      const [inline, file] = rec.manifest.contributes!.glossaries!;
      expect(glossaryTerms(rec, inline!).terms.map(t => t.en)).toEqual(['Sir', 'Madam']);
      expect(glossaryTerms(rec, file!).terms.map(t => [t.en, t.uk, t.alt ?? []])).toEqual([['sword', 'меч', ['клинок']], ['shield', 'щит', ['буклер', 'тарч']], ['elf', 'ельф', []], ['dwarf', 'гном', []]]);
    } finally { setPluginQaRules([]); }
  });
});
