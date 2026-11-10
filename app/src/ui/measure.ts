import { visibleText } from '../core';

/**
 * Width of text in pixels in the browser, for the line width counted in pixels of the game window. The game's own font is
 * not known, so the browser's `sans-serif` at the size of the game's font stands in for it: an estimate, good enough to
 * tell a line that clearly fits from one that clearly does not. Without a canvas (a test, a worker) it falls back to
 * half the font size per character.
 */
const cache = new Map<number, (text: string) => number>();

export function pxMeasure(font: number): (text: string) => number {
  const hit = cache.get(font);
  if (hit) return hit;
  let c: CanvasRenderingContext2D | null | undefined;
  const fn = (text: string): number => {
    try {
      if (c === undefined) c = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
    } catch { c = null; }
    const t = visibleText(text);
    if (!c) return t.length * font * 0.5;
    c.font = `${font}px sans-serif`;
    return c.measureText(t).width;
  };
  cache.set(font, fn);
  return fn;
}
