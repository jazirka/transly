import { safeKey } from '../keys';
import type { GameFile, Translations, Unit, UnitKind } from '../model';
import type { FormatSpec, JsonSpec, KeyValueSpec, TableSpec } from './types';

/**
 * Formats described by data. A plugin that brings a `.lang` file or a spreadsheet format says what the file looks like (`spec`), and these
 * functions, which belong to the application and are tested with it, read and write it. No code of the plugin runs, so there is nothing to trust.
 * All of them follow the same rules as the built-in formats: the input is never changed, the text a translator did not touch comes out as it came in.
 */

const unit = (key: string, source: string, kind: UnitKind, speaker: string, context: string): Unit => ({ key: safeKey(key), source, speaker, kind, context });
/** Every row of a file is at most this long (a file of a game has no line of a megabyte of text). */
const MAX_CELL = 200_000;

// ---------- keyvalue ----------

const eolOf = (text: string): string => (text.includes('\r\n') ? '\r\n' : '\n');
const unesc = (s: string): string => s.replace(/\\(n|t|\\)/g, (_m, c: string) => (c === 'n' ? '\n' : c === 't' ? '\t' : '\\'));
const esc = (s: string): string => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\t/g, '\\t');

interface KvLine { key: string; head: string; value: string; line: number }
function kvLines(text: string, spec: KeyValueSpec): KvLine[] {
  const sep = spec.separator ?? '=', comments = spec.comments ?? ['#', ';', '//'];
  const out: KvLine[] = [];
  text.replace(/^﻿/, '').split(/\r?\n/).forEach((raw, i) => {
    const t = raw.trimStart();
    if (!t || comments.some(c => t.startsWith(c)) || raw.length > MAX_CELL) return;
    const at = raw.indexOf(sep);
    if (at <= 0) return;
    const key = raw.slice(0, at).trim();
    if (!key) return;
    const rest = raw.slice(at + sep.length), lead = /^\s*/.exec(rest)![0];
    out.push({ key, head: raw.slice(0, at + sep.length) + lead, value: rest.slice(lead.length), line: i + 1 });
  });
  return out;
}
/** A key that appears twice gets `#2`, `#3`… so every row has its own place. */
function uniqueKeys<T extends { key: string }>(rows: T[]): string[] {
  const seen = new Map<string, number>();
  return rows.map(r => { const n = (seen.get(r.key) ?? 0) + 1; seen.set(r.key, n); return n === 1 ? r.key : `${r.key}#${n}`; });
}

function extractKv(text: string, spec: KeyValueSpec): Unit[] {
  const rows = kvLines(text, spec), keys = uniqueKeys(rows);
  return rows.flatMap((r, i) => (r.value.trim() ? [unit(keys[i]!, spec.unescape ? unesc(r.value) : r.value, 'message', '', `рядок ${r.line}`)] : []));
}
function applyKv(text: string, tr: Translations, spec: KeyValueSpec): string {
  const bom = text.startsWith('\uFEFF') ? '\uFEFF' : '', body = bom ? text.slice(1) : text;
  const eol = eolOf(body), rows = kvLines(body, spec), keys = uniqueKeys(rows);
  const by = new Map<number, string>();
  rows.forEach((r, i) => { const e = tr[safeKey(keys[i]!)]; if (e?.target.trim()) by.set(r.line, r.head + (spec.unescape ? esc(e.target) : e.target)); });
  return bom + body.split(/\r?\n/).map((raw, i) => by.get(i + 1) ?? raw).join(eol);
}

// ---------- table ----------

function parseTable(text: string, delim: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (q) { if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"' && cell === '') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
    if (cell.length > MAX_CELL) throw new Error('cell too long');
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => !(r.length === 1 && r[0] === ''));
}
const cellOut = (v: string, d: string): string => (/["\r\n]/.test(v) || v.includes(d) ? `"${v.replace(/"/g, '""')}"` : v);
function delimiterOf(text: string, want: TableSpec['delimiter']): string {
  if (want && want !== 'auto') return want;
  const first = text.split(/\r?\n/, 1)[0] ?? '';
  const n = (d: string): number => first.split(d).length;
  return [',', ';', '\t'].reduce((a, d) => (n(d) > n(a) ? d : a), ',');
}

interface TableView { rows: string[][]; head: string[] | null; delim: string; at: (c: string | number) => number }
function viewTable(text: string, spec: TableSpec): TableView {
  const delim = delimiterOf(text, spec.delimiter), rows = parseTable(text, delim), header = spec.header !== false;
  const head = header ? (rows.shift() ?? []) : null;
  const at = (c: string | number): number => (typeof c === 'number' ? c : head ? head.findIndex(h => h.trim() === c) : -1);
  return { rows, head, delim, at };
}
function extractTable(text: string, spec: TableSpec): Unit[] {
  const v = viewTable(text, spec);
  const keyCols = (Array.isArray(spec.key) ? spec.key : [spec.key]).map(v.at), src = v.at(spec.source);
  if (src < 0 || keyCols.some(c => c < 0)) return [];
  const sp = spec.speaker !== undefined ? v.at(spec.speaker) : -1, cx = spec.context !== undefined ? v.at(spec.context) : -1;
  const out: Unit[] = [], seen = new Map<string, number>();
  v.rows.forEach((r, i) => {
    const source = r[src] ?? '';
    if (!source.trim()) return;
    const base = keyCols.map(c => r[c] ?? '').join(':') || `#${i + 1}`;
    const n = (seen.get(base) ?? 0) + 1; seen.set(base, n);
    out.push(unit(n === 1 ? base : `${base}#${n}`, source, spec.kind ?? 'message', sp >= 0 ? r[sp] ?? '' : '', cx >= 0 ? r[cx] ?? '' : `рядок ${i + 1 + (v.head ? 1 : 0)}`));
  });
  return out;
}
function applyTable(text: string, tr: Translations, spec: TableSpec): string {
  const v = viewTable(text, spec), eol = eolOf(text);
  const keyCols = (Array.isArray(spec.key) ? spec.key : [spec.key]).map(v.at), src = v.at(spec.source);
  if (src < 0 || keyCols.some(c => c < 0)) return text;
  let tgt = v.at(spec.target);
  const head = v.head ? [...v.head] : null;
  if (tgt < 0) { if (!head || typeof spec.target !== 'string') return text; tgt = head.length; head.push(spec.target); }
  const seen = new Map<string, number>();
  const rows = v.rows.map((r, i) => {
    const source = r[src] ?? '';
    if (!source.trim()) return r;
    const base = keyCols.map(c => r[c] ?? '').join(':') || `#${i + 1}`;
    const n = (seen.get(base) ?? 0) + 1; seen.set(base, n);
    const e = tr[safeKey(n === 1 ? base : `${base}#${n}`)];
    if (!e?.target.trim()) return r;
    const next = [...r]; while (next.length <= tgt) next.push('');
    next[tgt] = e.target;
    return next;
  });
  return (text.startsWith('\uFEFF') ? '\uFEFF' : '') + [...(head ? [head] : []), ...rows].map(r => r.map(c => cellOut(c, v.delim)).join(v.delim)).join(eol) + (text.endsWith('\n') ? eol : '');
}

// ---------- json ----------

type Seg = string | number | '*';
const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_DEPTH = 64;

/** `a.b[0].c` → ['a','b',0,'c']; `[*]` and `*` are wildcards. Null when the path is not written in that form. */
export function parsePath(path: string): Seg[] | null {
  const segs: Seg[] = [];
  const re = /\s*(?:\.?([A-Za-z_$][\w$ -]*|\*)|\[(\d+|\*)\])/y;
  let i = 0;
  while (i < path.length) {
    re.lastIndex = i;
    const m = re.exec(path);
    if (!m) return null;
    if (m[1] !== undefined) { if (FORBIDDEN.has(m[1].trim())) return null; segs.push(m[1] === '*' ? '*' : m[1].trim()); }
    else segs.push(m[2] === '*' ? '*' : Number(m[2]));
    i = re.lastIndex;
  }
  return segs.length ? segs : null;
}
const show = (segs: (string | number)[]): string => segs.map((s, i) => (typeof s === 'number' ? `[${s}]` : i ? `.${s}` : s)).join('');
const own = (o: unknown, k: string | number): boolean => !!o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);

/** The concrete paths a pattern with wildcards reaches in `root`, with the object that holds the value. */
function reach(root: unknown, segs: Seg[]): { path: (string | number)[]; parent: Record<string, unknown> | unknown[]; key: string | number }[] {
  const out: { path: (string | number)[]; parent: Record<string, unknown> | unknown[]; key: string | number }[] = [];
  const go = (node: unknown, i: number, path: (string | number)[]): void => {
    if (i > MAX_DEPTH || !node || typeof node !== 'object') return;
    const s = segs[i]!, last = i === segs.length - 1;
    const keys: (string | number)[] = s === '*' ? (Array.isArray(node) ? node.map((_, k) => k) : Object.keys(node)) : own(node, s) ? [s] : [];
    for (const k of keys) {
      const next = (node as Record<string | number, unknown>)[k];
      if (last) { if (typeof next === 'string') out.push({ path: [...path, k], parent: node as Record<string, unknown>, key: k }); }
      else go(next, i + 1, [...path, k]);
    }
  };
  go(root, 0, []);
  return out;
}

function extractJson(json: unknown, spec: JsonSpec): Unit[] {
  const out: Unit[] = [], seen = new Set<string>();
  for (const rule of spec.rules) {
    const segs = parsePath(rule.path);
    if (!segs) continue;
    for (const h of reach(json, segs)) {
      const key = show(h.path), value = (h.parent as Record<string | number, unknown>)[h.key] as string;
      if (!value.trim() || seen.has(key)) continue;
      seen.add(key);
      const sib = (name?: string): string => { const v = name && !Array.isArray(h.parent) && own(h.parent, name) ? (h.parent as Record<string, unknown>)[name] : ''; return typeof v === 'string' ? v : ''; };
      out.push(unit(key, value, rule.kind ?? 'message', sib(rule.speaker), sib(rule.context) || key));
    }
  }
  return out;
}
function applyJson(json: unknown, tr: Translations, spec: JsonSpec): unknown {
  const copy = structuredClone(json);
  for (const rule of spec.rules) {
    const segs = parsePath(rule.path);
    if (!segs) continue;
    for (const h of reach(copy, segs)) {
      const e = tr[safeKey(show(h.path))];
      if (e?.target.trim()) (h.parent as Record<string | number, unknown>)[h.key] = e.target;
    }
  }
  return copy;
}

// ---------- entry points ----------

export function extractBySpec(file: GameFile, spec: FormatSpec): Unit[] {
  switch (spec.type) {
    case 'keyvalue': return file.text === undefined ? [] : extractKv(file.text, spec);
    case 'table': return file.text === undefined ? [] : extractTable(file.text, spec);
    case 'json': return extractJson(file.json, spec);
  }
}
export function applyBySpec(file: GameFile, tr: Translations, spec: FormatSpec): unknown {
  switch (spec.type) {
    case 'keyvalue': return applyKv(file.text ?? '', tr, spec);
    case 'table': return applyTable(file.text ?? '', tr, spec);
    case 'json': return applyJson(file.json, tr, spec);
  }
}

/** A name pattern (`*.lang`, `data/**\/*.json`) as a test on a path; `*` is any characters in a name, `**` any folders. Case does not matter. */
export function globTest(pattern: string): (path: string) => boolean {
  let src = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === '*' && pattern[i + 1] === '*') { if (pattern[i + 2] === '/') { src += '(?:.*/)?'; i += 2; } else { src += '.*'; i++; } }
    else if (c === '*') src += '[^/]*';
    else if (c === '?') src += '[^/]';
    else src += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  const re = new RegExp(`^${src}$`, 'i');
  return p => re.test(p.replace(/\\/g, '/'));
}
