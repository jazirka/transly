import { test } from 'vitest';
import { parseDelimited, parseHtmlTable, termsFromTable } from '../../src/core/termtable';
import { rng, writeVectors } from './util';
import type { Rng } from './util';

const EN = ['sword', 'Sword', 'SWORD', 'cat', 'Fire Ball', 'ab', 'A', 'XY', 'Hello world', '', ' ', 'Ґанок', 'item'];
const UK = ['меч', 'клинок', 'Меч', 'кіт', 'вогняна куля', '', ' ', 'ґанок', 'x', 'пес'];
const CELLS = ['plain', 'a &amp; b', '&lt;tag&gt;', '&quot;q&quot; &apos;s&apos;', 'x&nbsp;y', '&#65;&#x42;&#x1F600;', '&#0;', '&#1114112;', '&#xZZ;', '&unknown;', '&AMP;', 'two\nlines', 'tab\tinside', '  spaced   out  ', 'ё', 'Привіт'];

function genRows(r: Rng): string[][] {
  const header = r.pick([
    () => ['Оригінал', 'Переклад', 'Опис', 'Розділ'], () => ['Original', 'Translation 1', 'Translation 2', 'Comment', 'Category'], () => ['English', 'Ukrainian', 'Note'],
    () => ['source', 'переклад 1', 'переклад 2', 'тип'], () => ['EN', 'UK', 'Description'], () => ['Оригінал', 'Foo'], () => null, () => null,
  ])();
  const rows: string[][] = [];
  if (header) { for (let k = r.int(3); k > 0; k--) rows.push(['junk', 'x']); rows.push(header); }
  for (let k = 0; k < 1 + r.int(8); k++) {
    const n = header ? header.length : 2 + r.int(2);
    rows.push(Array.from({ length: r.pick([n, n, Math.max(1, n - 1), n + 1]) }, (_, i) => (i === 0 ? r.pick(EN) : r.chance(0.3) ? '' : r.pick([...UK, 'опис ' + 'o'.repeat(r.pick([1, 450])), 'Предмет']))));
  }
  return rows;
}

const quote = (c: string, d: string, r: Rng): string => (c.includes(d) || /["\n\r]/.test(c) || r.chance(0.1) ? `"${c.replace(/"/g, '""')}"` : c);

test('export termtable vectors', () => {
  const r = rng(515151);
  const out: Record<string, { input: unknown; output: unknown }[]> = {};
  const add = (name: string, input: unknown, output: unknown) => (out[name] ??= []).push({ input, output });

  for (let i = 0; i < 150; i++) {
    const rows = genRows(r);
    const now = 1000 + i, qa = r.chance(0.5);
    add('terms', { rows, now, qa }, termsFromTable(rows, now, qa));
    // as a delimited text
    const d = r.pick([',', ';', '\t']), eol = r.pick(['\n', '\r\n', '\r']);
    const text = (r.chance(0.1) ? '' : '') + rows.map(row => row.map(c => quote(c, d, r)).join(d)).join(eol) + (r.chance(0.5) ? eol : '');
    add('delimited', text, parseDelimited(text));
    // as an html table
    const html = (r.chance(0.5) ? '<html><body><p>x</p>' : '') + '<TABLE class="x">' + rows.map(row => '<tr class="r">' + row.map(c => `<${r.pick(['td', 'th', 'TD'])} class="c">${r.pick(['', '<b>', '<span>'])}${c.replace(/&(?!(#|[a-z]+;))/gi, '&amp;').replace(/</g, '&lt;').replace(/\n/g, r.pick(['<br>', '<br/>', '<BR />']))}${r.pick(['', '</b>', '</span>'])}</${r.pick(['td', 'th']) === 'td' ? 'td' : 'td'}>`).join('') + '</tr>').join('\n') + '</TABLE><table><tr><td>second</td></tr></table>';
    add('html', html, parseHtmlTable(html));
  }
  for (const c of CELLS) { const h = `<table><tr><td>${c}</td><td>${c}</td></tr></table>`; add('html', h, parseHtmlTable(h)); }
  for (const t of ['', 'a', 'a,b\n"c,d",e', 'a;b;c\n1;2;3', 'a\tb\n1\t2', '"x""y",z', '"unterminated', 'a,b\r\n\r\n\r\nc,d', ',,\n,,', ' , \n x ,y', 'x\n', '\n\n', '"a"b,c', 'a,"b\nc"', 'a;b,c;d']) add('delimited', t, parseDelimited(t));
  add('html', '<p>no table</p>', parseHtmlTable('<p>no table</p>'));
  add('html', '<tr><td>bare</td><th>row</th></tr>', parseHtmlTable('<tr><td>bare</td><th>row</th></tr>'));
  writeVectors('termtable', out);
});
