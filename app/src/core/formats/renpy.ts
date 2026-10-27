import type { Translations, Unit } from '../model';
import { hasText } from '../rpgmaker';

/** Statements that start with a quoted-looking token but are not dialogue. */
const NOT_SPEECH = /^(define|default|image|label|menu|python|init|scene|show|hide|play|queue|stop|pause|return|jump|call|if|elif|else|while|transform|screen|style|translate|voice|nvl|window|with|pass|renpy|config|gui|text|textbutton|action|add|use|key|layout|at|on|label|old|new)\b/;

const STR = String.raw`"((?:[^"\\]|\\.)*)"`;
// The `d` flag gives exact positions of the string bodies, so the original line is edited in place.
const SPEECH = new RegExp(String.raw`^(\s*)(?:([A-Za-z_][\w.]*)\s+|${STR}\s+)?${STR}(\s+with\s+\w+)?\s*$`, 'd');
const CHOICE = new RegExp(String.raw`^(\s*)${STR}(\s+if\s+.+?)?\s*:\s*$`, 'd');

/** Ren'Py string escapes ↔ the text the translator edits (real quotes and line breaks). */
export const unescapeRenpy = (s: string): string => s.replace(/\\(n|"|\\|')/g, (_m, c: string) => (c === 'n' ? '\n' : c));
export const escapeRenpy = (s: string): string => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');

interface Hit { line: number; kind: 'dialogue' | 'choice'; speaker: string; text: string; start: number; end: number }

function scan(text: string): { lines: string[]; eol: string; hits: Hit[] } {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const hits: Hit[] = [];
  let triple = false, pyIndent = -1;
  lines.forEach((raw, i) => {
    if ((raw.match(/"""/g) ?? []).length % 2 === 1) { triple = !triple; return; }
    if (triple) return;
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const indent = raw.length - raw.trimStart().length;
    if (pyIndent >= 0) { if (indent > pyIndent) return; pyIndent = -1; }
    if (/^(init\s+(-?\d+\s+)?)?python\b.*:\s*$/.test(trimmed)) { pyIndent = indent; return; }
    if (trimmed.startsWith('$')) return;
    const c = CHOICE.exec(raw);
    if (c && !NOT_SPEECH.test(trimmed)) {
      const [start, end] = c.indices![2]!;
      hits.push({ line: i, kind: 'choice', speaker: '', text: unescapeRenpy(c[2]!), start, end });
      return;
    }
    const m = SPEECH.exec(raw);
    if (m && !(m[2] && NOT_SPEECH.test(trimmed))) {
      const [start, end] = m.indices![4]!;
      hits.push({ line: i, kind: 'dialogue', speaker: m[2] ?? (m[3] !== undefined ? unescapeRenpy(m[3]) : ''), text: unescapeRenpy(m[4]!), start, end });
    }
  });
  return { lines, eol, hits };
}

export function extractRenpy(text: string): Unit[] {
  return scan(text).hits.filter(h => hasText(h.text)).map(h => ({
    key: `L${h.line + 1}`, source: h.text, speaker: h.speaker, kind: h.kind === 'choice' ? 'choice' : 'dialogue', context: `рядок ${h.line + 1}`,
  }));
}

export function applyRenpy(text: string, tr: Translations): string {
  const { lines, eol, hits } = scan(text);
  for (const h of hits) {
    const t = tr[`L${h.line + 1}`]?.target;
    if (!t || !t.trim()) continue;
    const raw = lines[h.line]!;
    lines[h.line] = raw.slice(0, h.start) + escapeRenpy(t) + raw.slice(h.end);
  }
  return lines.join(eol);
}
