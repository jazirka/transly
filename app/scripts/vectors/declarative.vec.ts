import { test } from 'vitest';
import type { GameFile, Translations } from '../../src/core/model';
import { applyBySpec, extractBySpec, globTest, parsePath } from '../../src/core/ext/declarative';
import type { FormatSpec } from '../../src/core/ext/types';
import { rng, writeVectors } from './util';
import type { Rng } from './util';

const W = ['Hello', 'Hi there', 'Take it', 'Run!', '', ' ', 'line1\\nline2', 'tab\\there', 'a=b', 'q"uote', 'Привіт', '😀', 'x, y', 'a;b'];
const KEYS = ['k1', 'k2', 'k1', 'menu.start', 'constructor', 'ключ', 'a b'];
const tr = (r: Rng, keys: string[]): Translations => Object.fromEntries(keys.filter(() => r.chance(0.7)).map(k => [k, { target: r.pick(['Привіт', 'Так\nНі', '  ', '', 'a\\b', 'q"x', 'x,y', 'tab\tx', '=eq']), status: 'done' as const, mt: 1 }]));

function genKv(r: Rng): { text: string; spec: FormatSpec } {
  const sep = r.pick(['=', ':', '=>', '|']), eol = r.pick(['\n', '\r\n']);
  const lines: string[] = [];
  for (let i = 0; i < 2 + r.int(8); i++) {
    const roll = r.next();
    if (roll < 0.12) lines.push(r.pick(['# comment', '; note', '// x', '', '   ', '#' + sep + 'x']));
    else if (roll < 0.2) lines.push(r.pick(['novalue', `${sep}nokey`, `  ${sep}  `, `key${sep}`, `key${sep}   `]));
    else lines.push(`${r.chance(0.2) ? '  ' : ''}${r.pick(KEYS)}${r.chance(0.2) ? ' ' : ''}${sep}${r.pick(['', ' ', '  ', '\t'])}${r.pick(W)}`);
  }
  const text = (r.chance(0.15) ? '﻿' : '') + lines.join(eol) + (r.chance(0.5) ? eol : '');
  const spec: FormatSpec = { type: 'keyvalue', ...(sep !== '=' || r.chance(0.3) ? { separator: sep } : {}), ...(r.chance(0.3) ? { comments: r.pick([['#'], ['//', ';'], []]) } : {}), ...(r.chance(0.5) ? { unescape: true } : {}) };
  return { text, spec };
}
function genTable(r: Rng): { text: string; spec: FormatSpec } {
  const delim = r.pick([',', ';', '\t']), eol = r.pick(['\n', '\r\n']), header = r.chance(0.8);
  const head = ['id', 'text', 'tr', 'who', 'ctx'];
  const q = (c: string) => (c.includes(delim) || /["\r\n]/.test(c) || r.chance(0.1) ? `"${c.replace(/"/g, '""')}"` : c);
  const rows: string[][] = header ? [head.slice(0, r.pick([2, 3, 4, 5]))] : [];
  for (let i = 0; i < 1 + r.int(7); i++) rows.push([r.pick(KEYS), r.pick(W), r.pick(['', 'old']), r.pick(['A', 'B', '']), r.pick(['c1', ''])].slice(0, r.pick([2, 3, 5])));
  if (r.chance(0.1)) rows.push(['']);
  const text = (r.chance(0.1) ? '﻿' : '') + rows.map(x => x.map(q).join(delim)).join(eol) + (r.chance(0.6) ? eol : '');
  const col = (name: string, idx: number) => (header && r.chance(0.7) ? name : idx);
  const spec: FormatSpec = { type: 'table', ...(r.chance(0.5) ? { delimiter: r.pick([',', ';', '\t', 'auto'] as const) } : {}), ...(header ? {} : { header: false }), key: r.chance(0.2) ? [col('id', 0), col('who', 3)] : col('id', 0), source: col('text', 1), target: r.chance(0.2) && header ? 'newcol' : col('tr', 2), ...(r.chance(0.4) ? { speaker: col('who', 3) } : {}), ...(r.chance(0.4) ? { context: col('ctx', 4) } : {}), ...(r.chance(0.3) ? { kind: 'dialogue' as const } : {}) };
  return { text, spec };
}
function genJsonDoc(r: Rng, d = 0): unknown {
  if (d > 3 || r.chance(0.3)) return r.pick(['Hello', 'Привіт', '', ' ', 5, null, true, 'x']);
  if (r.chance(0.35)) return Array.from({ length: r.int(4) }, () => genJsonDoc(r, d + 1));
  return Object.fromEntries(Array.from({ length: 1 + r.int(4) }, () => [r.pick(['text', 'name', 'items', 'a', 'b', 'who', 'ctx', 'constructor', 'my key']), genJsonDoc(r, d + 1)]));
}
const PATHS = ['text', 'a.text', 'a.b[*].text', '*.name', '*', '[0].text', '[*].text', 'items[*]', 'items[*].name', 'a[*].b[*]', 'my key', '.a', '__proto__.x', 'constructor', '', '..a', 'a..b', 'a[', 'a[x]', 'a . b', 'a.*.text', '[*][*]', 'items[0]', 'a b'];
function genJson(r: Rng): { json: unknown; spec: FormatSpec } {
  const json = r.chance(0.5) ? { a: { b: [genJsonDoc(r), genJsonDoc(r)], text: 'T', name: 'N' }, items: [{ name: 'x', text: 'y' }, 'plain', ''], text: 'Top', name: 'Name', who: 'Bob', ctx: 'C' } : genJsonDoc(r);
  return { json, spec: { type: 'json', rules: Array.from({ length: 1 + r.int(3) }, () => ({ path: r.pick(PATHS), ...(r.chance(0.3) ? { kind: 'dialogue' as const } : {}), ...(r.chance(0.3) ? { speaker: 'who' } : {}), ...(r.chance(0.3) ? { context: 'ctx' } : {}) })) } };
}

test('export declarative vectors', () => {
  const r = rng(7007);
  const out: Record<string, { input: unknown; output: unknown }[]> = {};
  const add = (name: string, input: unknown, output: unknown) => (out[name] ??= []).push({ input, output });

  for (const p of PATHS) add('parsePath', p, parsePath(p));
  const globs = ['*.lang', 'data/**/*.json', '**/x.json', 'a?.txt', '**', '*', 'data/*', 'A.B', 'x+y(1)', '[a].txt', 'a/**'];
  const paths = ['a.lang', 'dir/a.lang', 'data/x.json', 'data/sub/x.json', 'x.json', 'a/b/x.json', 'ab.txt', 'a.txt', 'data\\y.json', 'A.LANG', 'A.B', 'x+y(1)', '[a].txt', 'a/b/c', 'a'];
  for (const g of globs) { const f = globTest(g); add('glob', { g, paths }, paths.map(p => f(p))); }

  for (let i = 0; i < 90; i++) {
    const { text, spec } = i % 2 ? genKv(r) : genTable(r);
    const file: GameFile = { name: 'f.txt', json: null, text };
    const units = extractBySpec(file, spec);
    const t = tr(r, [...units.map(u => u.key), 'nope']);
    add('spec', { file, spec, tr: t }, { units, applied: applyBySpec(file, t, spec) });
  }
  for (let i = 0; i < 70; i++) {
    const { json, spec } = genJson(r);
    const file: GameFile = { name: 'f.json', json };
    const units = extractBySpec(file, spec);
    const t = tr(r, [...units.map(u => u.key), 'nope']);
    const before = JSON.stringify(json);
    add('spec', { file, spec, tr: t }, { units, applied: applyBySpec(file, t, spec), intact: JSON.stringify(json) === before });
  }
  add('spec', { file: { name: 'x', json: null }, spec: { type: 'keyvalue' }, tr: {} }, { units: extractBySpec({ name: 'x', json: null }, { type: 'keyvalue' }), applied: applyBySpec({ name: 'x', json: null }, {}, { type: 'keyvalue' }) });
  writeVectors('declarative', out);
});
