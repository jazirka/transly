import { test } from 'vitest';
import type { GameFile } from '../../src/core/model';
import { readGame, labelsOf } from '../../src/core/project';
import { compareVersions, parseVersion, satisfies, validRange } from '../../src/core/ext/semver';
import { KNOWN_PLURALS, pluralFn } from '../../src/core/ext/plural-expr';
import { I18n, parseCatalog, parseJsonCatalog, parsePoCatalog } from '../../src/core/ext/i18n';
import type { CatalogData } from '../../src/core/ext/i18n';
import { rng, writeVectors } from './util';
import type { Rng } from './util';

const entries = (c: CatalogData) => ({ language: c.language ?? null, name: c.name ?? null, plural: c.plural ?? null, entries: [...c.entries] });

const VERSIONS = ['1', '1.2', '1.2.3', 'v1.2.3', '1.2.3-beta', '1.2.3-beta.1', '1.2.3-beta.2', '1.2.3-rc.1', '1.2.3-1', '1.2.3-alpha', '1.2.3+build', '1.2.3-x+b', '0.0.1', '0.1.0', '2.0.0', '10.0.0', '1.10.0', '1.2.10', 'x', '', '1.2.3.4', ' 1.2.3 ', '1.', '1234567890.0.0', '999999999.1.1', '1.0.0-0', '1.0.0-a.b.c', '1.0.0-1.2', '1.0.0-a.1'];
const RANGES = ['*', '', 'x', '1.x', '1.2.x', '1', '1.2', '^1.2.3', '^0.2.3', '^0.0.3', '~1.2.3', '~0.2', '>=1.0.0', '>1.0.0', '<=2.0.0', '<2', '=1.2.3', '1.2.3', '>= 1.0.0', '>=1.0.0 <2.0.0', '^1 || ^3', '>=1.2.3-beta', '^1.2.3-beta.1', '>=a', 'foo', '>=1.0.0 || <0.5', '<', '>=', '^', '1.2.3 - 2.0.0', 'v1.2', '1.X', '1.*'];

const WORDS = ['Привіт', 'Закрити', 'Відкрити файл', 'Збережено: {n}', 'Рядків: {count} з {total}', 'Перекладено {1}%', 'Назва', 'ґанок', 'Помилка', 'Ok'];
const LANGS: [string, string][] = [['en', 'English'], ['pl', 'Polski'], ['pt-BR', 'Português'], ['fr', 'Français'], ['ru', 'Русский'], ['xx', 'Zed']];

function genPo(r: Rng, lang: string): string {
  const eol = r.pick(['\n', '\r\n']);
  const parts: string[] = [];
  if (r.chance(0.9)) parts.push(`msgid ""${eol}msgstr ""${eol}"Language: ${r.pick([lang, lang.replace('-', '_')])}\\n"${eol}${r.chance(0.7) ? `"Plural-Forms: nplurals=${r.pick([2, 3])}; plural=${r.pick(['(n != 1)', '(n%10==1 && n%100!=11 ? 0 : 1)', '(n > 1);', 'bad expr', '(n==1 ? 0 : n%10>=2 && n%10<=4 && (n%100<10 || n%100>=20) ? 1 : 2)'])}\\n"${eol}` : ''}${r.chance(0.5) ? `"Language-Team: Team ${lang}\\n"${eol}` : ''}`.trimEnd());
  for (const w of WORDS) if (r.chance(0.6)) {
    const lines: string[] = [];
    if (r.chance(0.15)) lines.push('#, fuzzy');
    else if (r.chance(0.1)) lines.push('# comment');
    if (r.chance(0.3)) lines.push(`msgctxt "${r.pick(['plugin:acme.x', 'core', 'other'])}"`);
    lines.push(`msgid "${w}"`);
    if (r.chance(0.25)) { lines.push(`msgid_plural "${w}s"`); lines.push(`msgstr[0] "${r.pick(['one', ''])}"`); lines.push('msgstr[1] "many"'); if (r.chance(0.5)) lines.push('msgstr[2] "lots"'); }
    else lines.push(`msgstr "${r.pick(['T:' + w, '', 'Line\\nBreak', 'q\\"uote'])}"${r.chance(0.2) ? `${eol}"cont"` : ''}`);
    parts.push(lines.join(eol));
  }
  if (r.chance(0.2)) parts.push(`#~ msgid "old"${eol}#~ msgstr "стара"`);
  return parts.join(eol + eol) + eol;
}
function genJson(r: Rng, lang: string): string {
  const messages: Record<string, unknown> = {}, ctx: Record<string, unknown> = {};
  for (const w of WORDS) if (r.chance(0.5)) messages[w] = r.pick(['T:' + w, ['one', 'few', 'many'], '', ['', ''], 5]);
  for (const c of ['plugin:acme.x', 'plugin:y']) if (r.chance(0.4)) ctx[c] = Object.fromEntries(WORDS.filter(() => r.chance(0.4)).map(w => [w, `C:${w}`]));
  return JSON.stringify({ ...(r.chance(0.8) ? { language: lang } : {}), ...(r.chance(0.3) ? { name: 'Named' } : {}), ...(r.chance(0.4) ? { plural: r.pick(['n != 1', 'n > 1', 'junk']) } : {}), messages, contexts: ctx });
}

test('export ext vectors', () => {
  const r = rng(31415);
  const out: Record<string, { input: unknown; output: unknown }[]> = {};
  const add = (name: string, input: unknown, output: unknown) => (out[name] ??= []).push({ input, output });

  for (const v of VERSIONS) add('parseVersion', v, parseVersion(v));
  for (let i = 0; i < 400; i++) { const a = r.pick(VERSIONS), b = r.pick(VERSIONS); add('compare', { a, b }, compareVersions(a, b)); }
  for (const rg of RANGES) add('validRange', rg, validRange(rg));
  for (let i = 0; i < 500; i++) { const v = r.pick(VERSIONS), rg = r.pick(RANGES); add('satisfies', { v, rg }, satisfies(v, rg)); }

  const exprs = [...Object.values(KNOWN_PLURALS), '(n != 1)', 'n != 1;', '0', '1', 'n', '(n)', 'n%3', 'n/2', 'n/0', 'n%0', '-n', '!n', '!!n', '(n', 'n)', '', 'abc', 'n ? 1 : 2', 'n==1?0:n==2?1:2', 'n>=2&&n<=4', '1 +', '+ 1', 'n = 1', 'x'.repeat(301), 'n % 10 == 1 && n % 100 != 11 ? 0 : 1'];
  for (const e of exprs) { const f = pluralFn(e); add('plural', e, f ? Array.from({ length: 130 }, (_, n) => f(n)).concat([f(1000), f(1001), f(-3), f(2.7)]) : null); }

  for (let i = 0; i < 60; i++) {
    const [code] = r.pick(LANGS);
    const t = r.chance(0.5) ? genPo(r, code) : genJson(r, code), name = r.pick(['a.po', 'b.pot', 'c.json', 'D.JSON']);
    add('catalog', { name, text: t }, { parsed: entries(parseCatalog(name, t)), po: entries(parsePoCatalog(t)), json: entries(parseJsonCatalog(t)) });
  }
  add('catalog', { name: 'x.json', text: '{broken' }, { parsed: entries(parseCatalog('x.json', '{broken')), po: entries(parsePoCatalog('{broken')), json: entries(parseJsonCatalog('{broken')) });
  add('catalog', { name: 'x.json', text: '[1]' }, { parsed: entries(parseCatalog('x.json', '[1]')), po: entries(parsePoCatalog('[1]')), json: entries(parseJsonCatalog('[1]')) });

  // сценарії мови інтерфейсу
  for (let n = 0; n < 60; n++) {
    const i18n = new I18n();
    const log: unknown[] = [], ops: Record<string, unknown>[] = [];
    for (let k = 0; k < 3 + r.int(10); k++) {
      const kind = r.pick(['add', 'add', 'add', 'remove', 'set', 'set', 'ask', 'ask', 'ask']);
      if (kind === 'add') {
        const [code, nm] = r.pick(LANGS), origin = r.pick(['pack1', 'pack2', 'pack3']), text = r.chance(0.5) ? genPo(r, code) : genJson(r, code), file = text.trimStart().startsWith('{') ? 'x.json' : 'x.po', withName = r.chance(0.5);
        ops.push({ kind, code, origin, file, text, name: withName ? nm : null });
        i18n.add(code, parseCatalog(file, text), origin, withName ? nm : undefined);
        log.push(null);
      } else if (kind === 'remove') { const origin = r.pick(['pack1', 'pack2', 'pack3']); ops.push({ kind, origin }); i18n.remove(origin); log.push({ lang: i18n.language }); }
      else if (kind === 'set') { const code = r.pick(['en', 'pl', 'pt-BR', 'pt', 'fr-CA', 'fr', 'uk', 'xx', 'zz']), fb = r.chance(0.3) ? [r.pick(['en', 'pl', 'xx'])] : []; ops.push({ kind, code, fb }); i18n.setLanguage(code, fb); log.push({ lang: i18n.language }); }
      else {
        const word = r.pick(WORDS), ctx = r.pick(['core', 'core', 'plugin:acme.x', 'plugin:y']), num = r.pick([0, 1, 2, 3, 5, 11, 21, 22, 100]), params = r.chance(0.5) ? { n: num, name: 'Zed', count: 3, total: 9 } : undefined;
        ops.push({ kind, word, ctx, num, withParams: !!params });
        log.push({ t: i18n.t(word, params, ctx), tn: i18n.tn([word, word + 'и', word + 'ів'], num, params, ctx), has: i18n.has(word, ctx) });
      }
    }
    add('i18n', { ops }, { log, language: i18n.language, languages: i18n.languages(), missing: i18n.missing(), template: i18n.template('xx') });
  }

  // читання гри
  const mk = (name: string, json: unknown): GameFile => ({ name, json });
  const unitsMap = (k: string) => ({ events: [null, { id: 1, name: 'E', x: 1, y: 2, pages: [{ conditions: {}, trigger: 0, list: [{ code: 101, indent: 0, parameters: ['', 0, 0, 2, ''] }, { code: 401, indent: 0, parameters: [k] }] }] }] });
  for (let i = 0; i < 40; i++) {
    const files: GameFile[] = [];
    const names = [1, 2, 3].filter(() => r.chance(0.7));
    const infos = [null, ...names.map(id => ({ id, name: r.pick(['Ліс', '', 'Дім', 5, null, undefined]) }))].concat(r.chance(0.2) ? [5 as never, {} as never] : []);
    if (r.chance(0.8)) files.push(mk(r.pick(['MapInfos.json', 'data/MapInfos.json']), infos));
    for (const id of names) files.push(mk(r.pick([`Map00${id}.json`, `data/Map00${id}.json`, `Map00${id}.json`]), { ...unitsMap(r.pick(['Hello', '...', 'Hi'])), ...(r.chance(0.4) ? { displayName: r.pick(['  Display ', '', '  ', 'Ґанок']) } : {}) }));
    if (r.chance(0.5)) files.push(mk('Items.json', [null, { id: 1, name: 'Potion', description: 'Heals' }]));
    if (r.chance(0.3)) files.push(mk('System.json', { gameTitle: 'T', terms: {} }));
    if (r.chance(0.3)) files.push({ name: 'a.csv', json: null, text: 'key,source\nk,Hello\n' });
    const opts = r.chance(0.3) ? { pluginCommands: ['GabText'] } : {};
    const views = readGame(files, opts);
    add('readGame', { files, opts }, { views, labels: labelsOf(views) });
  }
  writeVectors('ext', out);
});
