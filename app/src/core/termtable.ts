import type { GlossaryTerm } from './glossary';

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s: string): string =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });

/** Cells of every row of the first table in an HTML page (Google Sheets "Web page" export works). */
export function parseHtmlTable(html: string): string[][] {
  const table = /<table[\s\S]*?<\/table>/i.exec(html)?.[0] ?? html;
  const rows: string[][] = [];
  for (const tr of table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...tr[1]!.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(c =>
      decode(c[1]!.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')).replace(/[ \t]+/g, ' ').trim());
    rows.push(cells);
  }
  return rows;
}

/** CSV / TSV with quotes. The delimiter is detected from the first line (tab, semicolon or comma). */
export function parseDelimited(text: string): string[][] {
  const first = text.split(/\r?\n/, 1)[0] ?? '';
  const delim = first.includes('\t') ? '\t' : first.split(';').length > first.split(',').length ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"' && cell === '') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some(x => x.trim())) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some(x => x.trim())) rows.push(row);
  return rows.map(r => r.map(x => x.trim()));
}

export interface TermTable { terms: GlossaryTerm[]; skipped: number }

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Turn table rows into glossary terms. The header row is found by its "Оригінал"/"Original" cell; columns:
 * `Переклад 1…n` / `Translation` → uk (first) and alternatives, `Опис`/`Коментар`/`Description` → note,
 * `Розділ…`/`Тип`/`Category` → kind. Without a header, column 1 is the original and column 2 the translation.
 * Rows with the same original are merged: later senses become alternatives.
 */
export function termsFromTable(rows: string[][], now = Date.now(), qa = false): TermTable {
  let head = -1;
  for (let i = 0; i < Math.min(rows.length, 12); i++) {
    if (rows[i]!.some(c => /^(оригінал|original|english|source|en)$/i.test(c.trim()))) { head = i; break; }
  }
  let en = 0;
  let tr: number[] = [1];
  let note = -1, kind = -1;
  if (head >= 0) {
    const h = rows[head]!.map(norm);
    en = h.findIndex(c => /^(оригінал|original|english|source|en)$/.test(c));
    tr = h.map((c, i) => [c, i] as const).filter(([c]) => /^(переклад|translation|ukrainian|uk|переклад \d+|translation \d+)$/.test(c)).map(([, i]) => i);
    note = h.findIndex(c => /^(опис|description|коментар|comment|note)/.test(c));
    kind = h.findIndex(c => /^(розділ|тип|category|type|section)/.test(c));
    if (!tr.length) return { terms: [], skipped: rows.length - head - 1 };
  }
  const out = new Map<string, GlossaryTerm>();
  let skipped = 0;
  for (const r of rows.slice(head + 1)) {
    const e = (r[en] ?? '').trim();
    const variants = tr.map(i => (r[i] ?? '').trim()).filter(Boolean);
    if (!e || !variants.length || /^[A-Z]{1,2}$/.test(e)) { if (e || variants.length) skipped++; continue; }
    const key = e.toLowerCase();
    const prev = out.get(key);
    if (prev) {
      const have = new Set([prev.uk, ...(prev.alt ?? [])].map(norm));
      const more = variants.filter(v => !have.has(norm(v)));
      if (more.length) prev.alt = [...(prev.alt ?? []), ...more];
      continue;
    }
    const t: GlossaryTerm = { en: e, uk: variants[0]!, mt: now };
    if (variants.length > 1) t.alt = [...new Set(variants.slice(1).filter(v => norm(v) !== norm(variants[0]!)))];
    const n = note >= 0 ? (r[note] ?? '').trim() : '';
    const k = kind >= 0 ? (r[kind] ?? '').trim() : '';
    if (n) t.note = n.slice(0, 400);
    if (k) t.kind = k;
    if (!qa) t.qa = false;
    if (!t.alt?.length) delete t.alt;
    out.set(key, t);
  }
  return { terms: [...out.values()], skipped };
}
