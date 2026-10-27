import type { Translations, Unit } from '../model';

interface Table { rows: string[][]; delim: string; eol: string; bom: boolean; hasHeader: boolean; key: number; source: number; target: number }

function split(text: string): { rows: string[][]; delim: string; eol: string; bom: boolean } {
  const bom = text.startsWith('﻿');
  const t = bom ? text.slice(1) : text;
  const eol = t.includes('\r\n') ? '\r\n' : '\n';
  const first = t.split(/\r?\n/, 1)[0] ?? '';
  const delim = first.includes('\t') ? '\t' : first.split(';').length > first.split(',').length ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false, started = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i]!;
    if (quoted) {
      if (c === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
      else cell += c;
    } else if (c === '"' && cell === '') { quoted = true; started = true; }
    else if (c === delim) { row.push(cell); cell = ''; started = true; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      row.push(cell); cell = ''; started = false;
      rows.push(row); row = [];
    } else { cell += c; started = true; }
  }
  if (started || cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return { rows, delim, eol, bom };
}

const KEY = /^(key|id|name|identifier|ключ)$/i;
const SRC = /^(source|original|text|english|en|msgid|оригінал|string)$/i;
const TGT = /^(target|translation|translated|uk|ukrainian|переклад)$/i;

function analyse(text: string): Table {
  const s = split(text);
  const head = (s.rows[0] ?? []).map(c => c.trim());
  const src = head.findIndex(c => SRC.test(c));
  const hasHeader = src >= 0;
  if (hasHeader) {
    const key = head.findIndex(c => KEY.test(c));
    const tgt = head.findIndex((c, i) => TGT.test(c) && i !== src);
    return { ...s, hasHeader, key, source: src, target: tgt };
  }
  return { ...s, hasHeader: false, key: s.rows[0] && s.rows[0].length >= 3 ? 0 : -1, source: s.rows[0] && s.rows[0].length >= 3 ? 1 : 0, target: s.rows[0] && s.rows[0].length >= 3 ? 2 : 1 };
}

const keyOf = (t: Table, row: string[], i: number) => (t.key >= 0 && row[t.key]?.trim() ? row[t.key]!.trim() : `row${i + 1}`);

export function extractCsv(text: string): Unit[] {
  const t = analyse(text);
  const out: Unit[] = [];
  const seen = new Set<string>();
  t.rows.forEach((row, i) => {
    if (t.hasHeader && i === 0) return;
    const source = row[t.source] ?? '';
    if (!source.trim()) return;
    let key = keyOf(t, row, i);
    if (seen.has(key)) key = `${key}#${i + 1}`; // duplicate keys must not collide
    seen.add(key);
    out.push({ key, source, speaker: '', kind: 'message', context: t.key >= 0 ? 'рядок ' + (i + 1) : '' });
  });
  return out;
}

const cellOut = (c: string, delim: string) => (c.includes(delim) || /["\n\r]/.test(c) || c !== c.trim() ? `"${c.replace(/"/g, '""')}"` : c);

export function applyCsv(text: string, tr: Translations): string {
  const t = analyse(text);
  let target = t.target;
  const rows = t.rows.map(r => [...r]);
  if (target < 0) {
    target = Math.max(...rows.map(r => r.length), t.source + 1);
    if (t.hasHeader) rows[0]![target] = 'translation';
  }
  const seen = new Set<string>();
  rows.forEach((row, i) => {
    if (t.hasHeader && i === 0) return;
    if (!(row[t.source] ?? '').trim()) return;
    let key = keyOf(t, row, i);
    if (seen.has(key)) key = `${key}#${i + 1}`;
    seen.add(key);
    const v = tr[key]?.target;
    if (v && v.trim()) { while (row.length <= target) row.push(''); row[target] = v; }
  });
  const width = Math.max(...rows.map(r => r.length));
  const body = rows.map(r => { const full = [...r]; while (full.length < width) full.push(''); return full.map(c => cellOut(c, t.delim)).join(t.delim); }).join(t.eol) + t.eol;
  return (t.bom ? '﻿' : '') + body;
}
