/**
 * What the translator chose about line wrapping (the tool «Перенесення рядків»). It lives in the project settings as an
 * optional `wrap` object: a project saved before it existed, or a copy that comes from another device without it, simply
 * gets the defaults for every field that is missing or has a value this build does not know.
 */
export type WrapMode = 'build' | 'text' | 'off';
export type WrapUnit = 'chars' | 'px';
export type HyphenMode = 'off' | 'needed' | 'fill';
export type WrapKeep = 'reflow' | 'long';

export interface WrapSettings {
  /** When lines are broken: in the game files when the game is built or run (the text of the project stays whole), in the text when a row is sent, or never by itself. */
  mode: WrapMode;
  /** The width is counted in characters (the same on every device) or in pixels of the game window (measured in the browser, approximate). */
  unit: WrapUnit;
  /** Breaking a word by syllables with a hyphen: never, only when the line would be too short or the word does not fit the window, or whenever it fills the line better. */
  hyphen: HyphenMode;
  hyphenChar: string;
  /** The fewest letters that must stay before and after a hyphen. */
  minLeft: number;
  minRight: number;
  /** `long`: a message is re-flowed only when one of its lines is too wide (a neat text is not touched); `reflow`: always. */
  keep: WrapKeep;
  /** The message window shows this many lines; more is only warned about (the game pages it). 0 = not counted. */
  maxLines: number;
  /** The game window for the width in pixels. */
  px: { width: number; font: number };
}

export const DEFAULT_WRAP: WrapSettings = { mode: 'build', unit: 'chars', hyphen: 'needed', hyphenChar: '-', minLeft: 2, minRight: 2, keep: 'long', maxLines: 4, px: { width: 816, font: 28 } };

const pick = <T extends string>(v: unknown, ok: readonly T[], d: T): T => (ok.includes(v as T) ? (v as T) : d);
const num = (v: unknown, lo: number, hi: number, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d);

/** The wrap settings of a project, every field checked and filled in from the defaults. */
export function wrapOf(settings: { wrap?: Partial<WrapSettings> | undefined } | undefined): WrapSettings {
  const w: Partial<WrapSettings> = settings?.wrap ?? {};
  const hc = typeof w.hyphenChar === 'string' && [...w.hyphenChar].length === 1 && !/\s/.test(w.hyphenChar) ? w.hyphenChar : DEFAULT_WRAP.hyphenChar;
  return {
    mode: pick(w.mode, ['build', 'text', 'off'], DEFAULT_WRAP.mode),
    unit: pick(w.unit, ['chars', 'px'], DEFAULT_WRAP.unit),
    hyphen: pick(w.hyphen, ['off', 'needed', 'fill'], DEFAULT_WRAP.hyphen),
    hyphenChar: hc,
    minLeft: num(w.minLeft, 1, 6, DEFAULT_WRAP.minLeft),
    minRight: num(w.minRight, 1, 6, DEFAULT_WRAP.minRight),
    keep: pick(w.keep, ['reflow', 'long'], DEFAULT_WRAP.keep),
    maxLines: num(w.maxLines, 0, 12, DEFAULT_WRAP.maxLines),
    px: { width: num(w.px?.width, 320, 4096, DEFAULT_WRAP.px.width), font: num(w.px?.font, 10, 96, DEFAULT_WRAP.px.font) },
  };
}
