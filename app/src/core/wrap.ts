import { displayLength } from './controlCodes';
import type { FileView } from './project';

/** Width of the longest line, not counting control codes. */
export const maxLineWidth = (text: string): number => Math.max(0, ...text.split('\n').map(displayLength));

/** Greedy word wrap. Existing line breaks are dropped first, so the whole text is re-flowed. Control codes take no width. */
export function wrapLines(text: string, width: number): string {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '', curW = 0;
  for (const w of words) {
    const ww = displayLength(w);
    if (cur && curW + 1 + ww > width) { lines.push(cur); cur = w; curW = ww; }
    else { cur = cur ? cur + ' ' + w : w; curW = cur === w ? ww : curW + 1 + ww; }
  }
  if (cur) lines.push(cur);
  return lines.join('\n');
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
  return text.replace(/(\p{L})-\n(\p{Ll})/gu, '$1$2').replace(/[ \t]*\n[ \t]*/g, ' ').trim();
}
