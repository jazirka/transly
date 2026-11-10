import { CODE_SOURCE, displayLength, visibleText } from './controlCodes';
import { hyphenPoints, isHyphenatable } from './hyphen';
import type { FileView } from './project';
import type { WrapSettings } from './wrapconfig';
import { MV_WINDOW, pixelBudget } from './gamewindow';

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

/**
 * Everything the wrapping of a project's messages depends on, resolved once: the settings of the tool «Перенесення
 * рядків», the width in characters (the project's line limit, or the original's own), and, for a width in pixels, the
 * function that measures text in the browser (the core has no DOM).
 */
export interface WrapPlan {
  settings: WrapSettings;
  /** Width in characters of a line without a face picture; 0 = the original gives no hint to take it from. */
  limit: number;
  /** The translator turned the width off: nothing is wrapped and no line is called too wide. */
  disabled?: boolean;
  /** Width of text in pixels of the game's font at `settings.px.font`; without it a width in pixels falls back to characters. */
  measure?: (text: string) => number;
}

type MessageLike = { kind?: string | undefined; key?: string | undefined; face?: string | undefined };

/** A unit that is a message in the game's window (RPG Maker dialogue and scrolling text). Ren'Py lines (`L12`) are shaped by their engine. */
export const isMessageUnit = (u: MessageLike): boolean => (u.kind === 'dialogue' || u.kind === 'scroll') && !/^L\d+$/.test(u.key ?? '');

/** True when the width is counted in pixels and there is a way to measure them. */
export const usesPixels = (plan: WrapPlan): boolean => plan.settings.unit === 'px' && !!plan.measure;

/** The width of one message in what `measureOf` counts; 0 = nothing to wrap by. A face picture takes room from the text. */
export function widthOf(plan: WrapPlan, unit: MessageLike): number {
  if (plan.disabled) return 0;
  if (usesPixels(plan)) return pixelBudget(!!unit.face, { ...MV_WINDOW, width: plan.settings.px.width, font: plan.settings.px.font });
  return limitFor(plan.limit, unit.face);
}

/** How a plan measures a piece of text: pixels through the browser's function, otherwise characters. Control codes take no room either way. */
export const measureOf = (plan: WrapPlan): ((text: string) => number) => {
  const m = plan.measure;
  return usesPixels(plan) && m ? (s: string) => m(visibleText(s)) : displayLength;
};

/** Wrap one message the way the project is set up; the text is returned as it was when there is no width to wrap by. */
export function wrapMessage(plan: WrapPlan, unit: MessageLike, text: string): WrapResult {
  const s = plan.settings;
  return planWrap(text, { width: widthOf(plan, unit), measure: measureOf(plan), hyphen: s.hyphen, hyphenChar: s.hyphenChar, minLeft: s.minLeft, minRight: s.minRight, keep: s.keep, maxLines: unit.kind === 'dialogue' ? s.maxLines : 0 });
}

/** The parts of a plan that change the result, as one short text (for caches). */
export const planSig = (p: WrapPlan | undefined): string => {
  if (!p) return '';
  const s = p.settings;
  return [s.mode, s.unit, s.hyphen, s.hyphenChar, s.minLeft, s.minRight, s.keep, s.maxLines, s.px.width, s.px.font, p.limit, p.disabled ? 1 : 0, p.measure ? 'm' : ''].join(',');
};

/** What the width of a plan is counted in, as a word for a sentence («символів», «пікселів»). */
export const unitWord = (plan: WrapPlan): string => (usesPixels(plan) ? 'пікселів' : 'символів');

/** How many lines of text one message of a unit has once the game shows it: wrapped when the project wraps (at build or on send), as written when wrapping is off. */
export function linesShown(plan: WrapPlan, unit: MessageLike, text: string): number {
  if (plan.settings.mode === 'off' || widthOf(plan, unit) <= 0) return text ? text.split('\n').length : 0;
  return wrapMessage(plan, unit, text).lines;
}

/** The lines of a message that are wider than the window: how many, and the widest one in the plan's own measure. */
export function tooWide(plan: WrapPlan, unit: MessageLike, text: string): { count: number; widest: number; width: number } {
  const width = isMessageUnit(unit) ? widthOf(plan, unit) : 0, measure = measureOf(plan);
  if (width <= 0) return { count: 0, widest: 0, width: 0 };
  const widths = text.split('\n').map(measure);
  return { count: widths.filter(w => w > width).length, widest: Math.max(0, ...widths), width };
}

/** `unwrap` for searching: a text with no line break is returned as it is, without the cost of a regular expression. */
export const flowText = (text: string): string => (text.includes('\n') ? unwrap(text) : text);
