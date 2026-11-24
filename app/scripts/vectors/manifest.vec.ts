import { test } from 'vitest';
import { authorOf, checkManifest, compatibility, isHttps, safePath } from '../../src/core/ext/manifest';
import { rng, writeVectors } from './util';
import type { Rng } from './util';

const SHA = 'sha256-' + 'a'.repeat(64);
const base = (): Record<string, unknown> => ({
  manifestVersion: 1, id: 'acme.wolf', name: 'Wolf', version: '1.2.3', description: 'Text', sourceLanguage: 'en', author: { name: 'Acme', url: 'https://acme.example/a' }, license: 'MIT',
  homepage: 'https://acme.example', repository: 'acme/wolf', keywords: ['a', 'b'], requires: { transly: '>=0.1.0', api: '^1' }, dependencies: { 'other.plug': '^1.0.0' },
  permissions: [], files: { 'lang/pl.po': SHA, 'terms.tsv': SHA, 'help/a.md': SHA, 'main.js': SHA },
  contributes: {
    formats: [
      { id: 'lang', label: 'Lang', extensions: ['.lang'], text: true, spec: { type: 'keyvalue', separator: '=', comments: ['#'] }, priority: 5 },
      { id: 'tab', label: 'Tab', extensions: ['.tab', '.tsv'], files: ['data/*.tab'], text: true, spec: { type: 'table', key: 'id', source: 'text', target: 1, delimiter: 'auto', kind: 'message' } },
      { id: 'js', label: 'Json', extensions: ['.dat'], text: false, spec: { type: 'json', rules: [{ path: 'a.b[*].text', kind: 'dialogue' }] } },
    ],
    engines: [{ id: 'eng', label: 'Eng', description: 'd', formats: ['lang'], detect: { files: ['a/b'], anyFiles: ['**/x.json'], min: 2, excludeFiles: ['z'] }, dataFolders: ['data'], features: ['scenes'], help: 'h1' }],
    languages: [{ code: 'pl', name: 'Polski', plural: 'n != 1', fallback: ['en'], catalogs: [{ file: 'lang/pl.po' }, { file: 'lang/pl.po', context: 'plugin:acme.wolf' }] }],
    help: [{ id: 'h1', title: 'Help', body: 'Body', topic: 'general' }, { id: 'h2', title: 'Help2', file: 'help/a.md', topic: 'engine:eng' }],
    settings: [{ id: 's1', title: 'S', fields: [{ key: 'a', type: 'boolean', label: 'A', scope: 'project' }, { key: 'b', type: 'select', label: 'B', options: [{ value: 'x', label: 'X' }] }] }],
    commands: [{ id: 'c1', title: 'Rep', action: 'replace', steps: [{ find: 'a', replace: 'b', wholeWord: true }] }, { id: 'c2', title: 'Hlp', action: 'help', help: 'h1' }, { id: 'c3', title: 'Lnk', action: 'link', url: 'https://acme.example/x' }],
    qaRules: [{ id: 'q1', title: 'Q', severity: 'warn', kinds: ['dialogue'], check: { type: 'forbid', items: [{ find: 'x', replace: 'y' }], message: 'No x' } }, { id: 'q2', title: 'Q2', check: { type: 'require', when: { find: 'a' }, then: { find: 'b' } } }, { id: 'q3', title: 'Q3', check: { type: 'maxLength', max: 50 } }, { id: 'q4', title: 'Q4', check: { type: 'sameAsSource' } }],
    glossaries: [{ id: 'g1', title: 'G', terms: [{ en: 'sword', uk: 'меч', alt: ['клинок'], note: 'n' }] }, { id: 'g2', title: 'G2', file: 'terms.tsv' }],
  },
});

const JUNK: unknown[] = [null, 5, -1, 0, 1.5, '', 'x', 'x'.repeat(700), true, false, [], {}, ['a'], { a: 1 }, 'не-id', '../x', '/abs', 'a\\b', 'https://u:p@h.example/', 'http://h.example', 'pt-BR', '.lang', ['.lang'], 'sha256-zz'];

function paths(v: unknown, prefix: (string | number)[] = [], out: (string | number)[][] = []): (string | number)[][] {
  out.push(prefix);
  if (Array.isArray(v)) v.forEach((x, i) => paths(x, [...prefix, i], out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) paths(x, [...prefix, k], out);
  return out;
}
function mutate(r: Rng, m: Record<string, unknown>): void {
  const all = paths(m).filter(p => p.length);
  for (let n = 1 + r.int(2); n > 0; n--) {
    const p = r.pick(all);
    let cur: any = m;
    for (const k of p.slice(0, -1)) { cur = cur?.[k]; if (cur === undefined || cur === null || typeof cur !== 'object') break; }
    if (cur === undefined || cur === null || typeof cur !== 'object') continue;
    const last = p[p.length - 1]!;
    const roll = r.next();
    if (roll < 0.3) { if (Array.isArray(cur)) cur.splice(Number(last), 1); else delete cur[last]; }
    else if (roll < 0.9) cur[last] = r.pick(JUNK);
    else cur['extraKey'] = r.pick(JUNK);
  }
}

test('export manifest vectors', () => {
  const r = rng(5150);
  const out: Record<string, { input: unknown; output: unknown }[]> = {};
  const add = (name: string, input: unknown, output: unknown) => (out[name] ??= []).push({ input, output });
  const res = (input: unknown, builtin: boolean) => { const c = checkManifest(input, { builtin }); return c; };

  add('check', { input: base(), builtin: false }, res(base(), false));
  add('check', { input: JSON.stringify(base()), builtin: false }, res(JSON.stringify(base()), false));
  add('check', { input: { ...base(), id: 'transly.rpg' }, builtin: true }, res({ ...base(), id: 'transly.rpg' }, true));
  add('check', { input: { ...base(), id: 'transly.rpg' }, builtin: false }, res({ ...base(), id: 'transly.rpg' }, false));
  for (const x of [5, null, [], 'x'.repeat(200_001), '[]', '"s"']) add('check', { input: x, builtin: false }, (() => { const c = res(x, false); return c; })());
  // код: main, permissions, network
  const withCode = { ...base(), main: 'main.js', permissions: ['network', 'storage', 'storage'], network: { hosts: ['api.acme.example'] } };
  add('check', { input: withCode, builtin: false }, res(withCode, false));
  add('check', { input: { ...withCode, files: {} }, builtin: false }, res({ ...withCode, files: {} }, false));
  add('check', { input: { ...withCode, network: undefined }, builtin: false }, res({ ...withCode, network: undefined }, false));
  for (let i = 0; i < 350; i++) {
    const m = base() as Record<string, unknown>;
    if (r.chance(0.2)) Object.assign(m, { main: 'main.js', permissions: r.pick([[], ['storage'], ['network']]), ...(r.chance(0.5) ? { network: { hosts: ['a.example'] } } : {}) });
    mutate(r, m);
    const builtin = r.chance(0.15), input = r.chance(0.2) ? JSON.stringify(m) : m;
    add('check', { input, builtin }, res(input, builtin));
  }

  for (const p of ['a/b.txt', '', '/a', 'a/../b', 'a//b', '.hidden/x', 'a/.x', 'C:/x', 'a\\b', 'a b/c (1).po', 'x'.repeat(161), 'ґ/ї.po', 'a/b$c', 5, null]) add('safePath', p, safePath(p));
  for (const u of ['https://a.example', 'http://a.example', 'https://u@a.example', 'https://u:p@a.example', 'ftp://x', 'x', '', 5, null, 'https://' + 'a'.repeat(300) + '.com', 'HTTPS://A.EXAMPLE/x']) add('https', u, isHttps(u));
  for (const m of [{ requires: { transly: '>=0.1.0', api: '^1' } }, { requires: { transly: '>=9.0.0' } }, { requires: { api: '^2' } }, {}, { requires: { transly: '' } }, { requires: {} }]) add('compat', m, { a: compatibility(m as never), b: compatibility(m as never, '9.1.0', '2.0.0') });
  for (const m of [{ author: 'A' }, { author: { name: 'B', url: 'https://x.example' } }, {}, { author: { url: 'x' } }]) add('author', m, authorOf(m as never));
  writeVectors('manifest', out);
});
