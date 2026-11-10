import { CODE_SOURCE, displayLength } from './controlCodes';
import { hyphenPoints, isHyphenatable } from './hyphen';
import type { FileView } from './project';

/** Width of the longest line, not counting control codes. */
export const maxLineWidth = (text: string): number => Math.max(0, ...text.split('\n').map(displayLength));

/** Greedy word wrap with no breaking of words. The old entry point: the whole text is re-flowed, control codes take no width. */
export function wrapLines(text: string, width: number): string {
  return planWrap(text, { width, hyphen: 'off', keep: 'reflow' }).text;
}

export interface WrapOptions {
  /** The room one line has, in what `measure` counts (characters unless it measures pixels). 0 or less = do not wrap. */
  width: number;
  /** Width of a piece of text; control codes must take none. Default: `displayLength` (characters). */
  measure?: (text: string) => number;
  /** Breaking a word by syllables: `needed` only when the line would be too short or the word does not fit the window at all, `fill` whenever it fills the line better. */
  hyphen?: 'off' | 'needed' | 'fill';
  hyphenChar?: string;
  minLeft?: number;
  minRight?: number;
  /** `long`: a message whose lines all fit is left as it is; `reflow` (default): always re-flowed. */
  keep?: 'reflow' | 'long';
  /** The window shows this many lines; `tooMany` says the text has more (0 or missing = not counted). */
  maxLines?: number;
}

export interface WrapResult {
  text: string;
  lines: number;
  /** Indexes of the lines that still are wider than the window (a word that cannot be broken). */
  over: number[];
  /** How many hyphens were put in. */
  hyphenated: number;
  changed: boolean;
  tooMany: boolean;
}

const WORD_PARTS = new RegExp(`^((?:${CODE_SOURCE})*)([\\s\\S]*?)((?:${CODE_SOURCE})*)$`);

/** The places where a word can be cut with a hyphen: the head (with the hyphen) and the tail, longest head first. Control codes at the edges go with their end of the word. */
function breakCandidates(word: string, hc: string, minLeft: number, minRight: number): { head: string; tail: string }[] {
  const m = WORD_PARTS.exec(word);
  if (!m) return [];
  const [, lead = '', core = '', trail = ''] = m;
  if (!isHyphenatable(core)) return [];
  return hyphenPoints(core, minLeft, minRight).reverse().map(p => ({ head: lead + core.slice(0, p) + hc, tail: core.slice(p) + trail }));
}

/**
 * Break a message into lines for the game window. Control codes are not counted and never torn; a word is broken by
 * syllables with a hyphen when `hyphen` allows it (a word with a control code in the middle, with digits or Latin letters is not).
 * The text is first put back into one flow (`unwrap`), so a text wrapped before is wrapped again from scratch.
 */
export function planWrap(text: string, o: WrapOptions): WrapResult {
  const measure = o.measure ?? displayLength;
  const width = o.width, maxLines = o.maxLines ?? 0;
  const count = (s: string): number => (s ? s.split('\n').length : 0);
  const tooMany = (n: number): boolean => maxLines > 0 && n > maxLines;
  if (!(width > 0) || !text.trim()) return { text, lines: count(text), over: [], hyphenated: 0, changed: false, tooMany: tooMany(count(text)) };
  if (o.keep === 'long') {
    const ls = text.split('\n');
    if (ls.every(l => measure(l) <= width)) return { text, lines: ls.length, over: [], hyphenated: 0, changed: false, tooMany: tooMany(ls.length) };
  }
  const hyphen = o.hyphen ?? 'off', hc = o.hyphenChar ?? '-', minLeft = o.minLeft ?? 2, minRight = o.minRight ?? 2;
  const lines: string[] = [];
  let cur = '', hyphenated = 0;
  for (const word of unwrap(text).split(/\s+/).filter(Boolean)) {
    let rest = word;
    while (rest) {
      const joined = cur ? `${cur} ${rest}` : rest;
      if (measure(joined) <= width) { cur = joined; rest = ''; break; }
      // It does not fit. Break the word if that is allowed and helps.
      const forced = !cur && measure(rest) > width;
      let cut: { head: string; tail: string } | undefined;
      if (hyphen !== 'off' && (hyphen === 'fill' || forced || (cur && measure(cur) < 0.55 * width))) {
        cut = breakCandidates(rest, hc, minLeft, minRight).find(c => measure(cur ? `${cur} ${c.head}` : c.head) <= width);
      }
      if (cut) { lines.push(cur ? `${cur} ${cut.head}` : cut.head); hyphenated++; cur = ''; rest = cut.tail; continue; }
      if (cur) { lines.push(cur); cur = ''; continue; }
      lines.push(rest); rest = '';   // alone on its line and cannot be broken: it leaves the window
    }
  }
  if (cur) lines.push(cur);
  const out = lines.join('\n');
  return { text: out, lines: lines.length, over: lines.flatMap((l, i) => (measure(l) > width ? [i] : [])), hyphenated, changed: out !== text, tooMany: tooMany(lines.length) };
}

/** How many lines of a text are wider than `width`, and how many lines it has: the facts the QA advice is made of. */
export function lineFacts(text: string, width: number, measure: (s: string) => number = displayLength): { lines: number; over: number } {
  const ls = text.split('\n');
  return { lines: ls.length, over: width > 0 ? ls.filter(l => measure(l) > width).length : 0 };
}

/**
 * How wide a message line can be before it leaves the window: the 95th percentile of the original's own lines,
 * since the authors wrapped by hand to fit. Returns 0 when there is not enough text to tell.
 */
export function autoLineLimit(views: FileView[]): number {
  const widths: number[] = [];
  for (const v of views) for (const u of v.units) {
    if (u.kind !== 'dialogue' && u.kind !== 'scroll') continue;
    if (u.source.includes('\n')) for (const l of u.source.split('\n')) widths.push(displayLength(l));
    if (widths.length > 200_000) break;
  }
  if (widths.length < 200) return 0;
  widths.sort((a, b) => a - b);
  return Math.min(120, Math.max(20, widths[Math.floor(widths.length * 0.95)]!));
}

/** Limit for one unit: a message with a face picture has a narrower text area. */
export const limitFor = (limit: number, face?: string): number => (limit && face ? Math.floor(limit * 0.8) : limit);

/**
 * The text as one flowing paragraph, for comparing and searching (translation memory, links, QA, search): line breaks
 * only shaped the text for the game window. A word broken with a hyphen at the end of a line is joined again.
 */
export function unwrap(text: string): string {
  return text.replace(/([\p{L}'’ʼ])[-‐‑\u00AD]\n(\p{Ll})/gu, '$1$2').replace(/[ \t]*\n[ \t]*/g, ' ').trim();
}
