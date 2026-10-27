import type { Translations, Unit } from '../model';

/** gettext catalog entry (the header entry has an empty msgid). */
interface Entry {
  /** Lines before msgid: translator/extracted comments, references, flags. Kept as is. */
  lead: string[];
  ctxt: string | null;
  id: string;
  plural: string | null;
  strs: string[];
  obsolete: boolean;
}

const unq = (s: string): string => {
  const body = s.trim().slice(1, -1);
  return body.replace(/\\(n|t|r|"|\\)/g, (_m, c: string) => ({ n: '\n', t: '\t', r: '\r', '"': '"', '\\': '\\' })[c] ?? c);
};
const q = (s: string): string => '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\t/g, '\\t').replace(/\r/g, '\\r') + '"';

function parse(text: string): { entries: Entry[]; eol: string } {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const entries: Entry[] = [];
  let cur: Entry | null = null;
  let field: 'ctxt' | 'id' | 'plural' | number | null = null;
  const flush = () => { if (cur && (cur.id !== '' || cur.strs.length || cur.lead.length)) entries.push(cur); cur = null; field = null; };
  const fresh = (): Entry => ({ lead: [], ctxt: null, id: '', plural: null, strs: [], obsolete: false });
  for (const raw of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    if (line.startsWith('#~')) { cur ??= fresh(); cur.lead.push(raw); cur.obsolete = true; continue; }
    if (line.startsWith('#')) {
      if (cur && cur.strs.length) flush();
      cur ??= fresh(); cur.lead.push(raw); continue;
    }
    const m = /^(msgctxt|msgid_plural|msgid|msgstr(?:\[(\d+)\])?)\s+(".*")$/.exec(line);
    if (m) {
      if (cur && cur.strs.length && (m[1] === 'msgid' || m[1] === 'msgctxt')) flush();
      cur ??= fresh();
      const val = unq(m[3]!);
      if (m[1] === 'msgctxt') { cur.ctxt = val; field = 'ctxt'; }
      else if (m[1] === 'msgid') { cur.id = val; field = 'id'; }
      else if (m[1] === 'msgid_plural') { cur.plural = val; field = 'plural'; }
      else { const i = m[2] ? Number(m[2]) : 0; cur.strs[i] = val; field = i; }
      continue;
    }
    if (line.startsWith('"') && cur && field !== null) {
      const val = unq(line);
      if (field === 'ctxt') cur.ctxt = (cur.ctxt ?? '') + val;
      else if (field === 'id') cur.id += val;
      else if (field === 'plural') cur.plural = (cur.plural ?? '') + val;
      else cur.strs[field] = (cur.strs[field] ?? '') + val;
    }
  }
  flush();
  return { entries, eol };
}

function serialize(entries: Entry[], eol: string): string {
  return entries.map(e => {
    const out = [...e.lead];
    if (e.obsolete) return out.join(eol);
    if (e.ctxt !== null) out.push(`msgctxt ${q(e.ctxt)}`);
    out.push(`msgid ${q(e.id)}`);
    if (e.plural !== null) {
      out.push(`msgid_plural ${q(e.plural)}`);
      e.strs.forEach((s, i) => out.push(`msgstr[${i}] ${q(s ?? '')}`));
    } else out.push(`msgstr ${q(e.strs[0] ?? '')}`);
    return out.join(eol);
  }).join(eol + eol) + eol;
}

const baseKey = (e: Entry) => (e.ctxt !== null ? `${e.ctxt}::` : '') + e.id;
const isHeader = (e: Entry) => e.id === '' && e.ctxt === null;
const nplurals = (entries: Entry[]): number => Number(/nplurals\s*=\s*(\d+)/.exec(entries.find(isHeader)?.strs[0] ?? '')?.[1] ?? 2);

export function extractPo(text: string): Unit[] {
  const { entries } = parse(text);
  const out: Unit[] = [];
  for (const e of entries) {
    if (isHeader(e) || e.obsolete || !e.id.trim()) continue;
    const ref = e.lead.find(l => l.startsWith('#:'))?.slice(2).trim() ?? '';
    const base = { speaker: '', context: e.ctxt ?? ref } as const;
    if (e.plural !== null) {
      out.push({ ...base, key: `${baseKey(e)}#0`, source: e.id, kind: 'message' });
      out.push({ ...base, key: `${baseKey(e)}#1`, source: e.plural, kind: 'message' });
    } else out.push({ ...base, key: baseKey(e), source: e.id, kind: 'message' });
  }
  return out;
}

/** Fill msgstr from translations; everything else in the catalog is kept. Plural forms beyond the 2nd reuse the 2nd text. */
export function applyPo(text: string, tr: Translations): string {
  const { entries, eol } = parse(text);
  const n = nplurals(entries);
  const get = (k: string) => { const t = tr[k]?.target; return t && t.trim() ? t : null; };
  for (const e of entries) {
    if (isHeader(e) || e.obsolete) continue;
    if (e.plural !== null) {
      const one = get(`${baseKey(e)}#0`), many = get(`${baseKey(e)}#1`);
      if (one === null && many === null) continue;
      e.strs = Array.from({ length: Math.max(n, 2) }, (_x, i) => i === 0 ? (one ?? e.strs[0] ?? '') : (many ?? e.strs[i] ?? e.strs[1] ?? ''));
    } else {
      const t = get(baseKey(e));
      if (t !== null) e.strs = [t];
    }
  }
  return serialize(entries, eol);
}
