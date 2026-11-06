/**
 * Long lists keep a place for every row but draw a row only when it comes near the screen. Each row starts as an empty
 * shell of the height the row is expected to have (the height it had the last time it was drawn, if it was), so the
 * scrollbar and the scroll position stand for the whole list; the cells are written when the shell is within reach of
 * the visible part. Nothing is cut off, a redraw does not throw the reader back to the top, and everything that looks a
 * row up by its key keeps working (`reveal` draws a row on demand).
 */
interface Rows {
  host: HTMLElement;
  scroller: HTMLElement;
  keys: string[];
  html: (i: number) => string;
  observer: IntersectionObserver | null;
  sizes: ResizeObserver | null;
  /** Heights of rows that were drawn, remembered across redraws. */
  heights: Map<string, number>;
  est: number;
  realized: number;
}

const lists = new Map<string, Rows>();
/** Heights remembered per list (id and what it shows), a few lists at most. */
const memory = new Map<string, { width: number; heights: Map<string, number> }>();
const MEMORY = 4;

/** How far from the visible part rows are drawn, in pixels. */
const AHEAD = 900;

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function realize(l: Rows, shell: HTMLElement): HTMLElement | null {
  if (!shell.classList.contains('lazy')) return null;
  const i = Number(shell.dataset.i);
  shell.insertAdjacentHTML('afterend', l.html(i));
  const row = shell.nextElementSibling as HTMLElement;
  l.observer?.unobserve(shell);
  shell.remove();
  l.sizes?.observe(row);
  l.realized++;
  return row;
}

/**
 * Put the rows `keys` into `host` after whatever it holds (a header row, say). `memKey` says which list this is (the
 * file shown): its remembered heights are used for the shells. Rows near the current scroll position are drawn at once,
 * the rest as they come near.
 */
export function mountRows(id: string, host: HTMLElement, scroller: HTMLElement, headerHtml: string, keys: string[], html: (i: number) => string, memKey: string, est = 52, shell = 'gr'): void {
  const prev = lists.get(id);
  prev?.observer?.disconnect();
  prev?.sizes?.disconnect();
  // Read the scroll position before anything is replaced: with the old rows gone and the new ones not in yet, the list is empty and would be scrolled to the top.
  const keepTop = scroller.scrollTop;
  const width = scroller.clientWidth;
  const mk = `${id}|${memKey}`;
  let mem = memory.get(mk);
  // The remembered heights are for one width of the list: when it changes the lines wrap differently.
  if (!mem || Math.abs(mem.width - width) > 24) { mem = { width, heights: new Map() }; }
  memory.delete(mk); memory.set(mk, mem);
  while (memory.size > MEMORY) memory.delete(memory.keys().next().value as string);

  const l: Rows = { host, scroller, keys, html, observer: null, sizes: null, heights: mem.heights, est, realized: 0 };
  lists.set(id, l);
  // Where each row will be, from the heights known so far: to draw the rows around the scroll position at once.
  const top = new Float64Array(keys.length + 1);
  let h = '';
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i]!;
    const px = mem.heights.get(k) ?? est;
    top[i + 1] = top[i]! + px;
    h += `<div class="${shell} lazy" aria-hidden="true" data-key="${esc(k)}" data-i="${i}" style="min-height:${px}px"></div>`;
  }
  host.innerHTML = headerHtml;
  const header = host.children.length;
  host.insertAdjacentHTML('beforeend', h);
  scroller.scrollTop = keepTop;

  if (typeof ResizeObserver !== 'undefined') {
    l.sizes = new ResizeObserver(es => {
      for (const e of es) {
        const key = (e.target as HTMLElement).dataset.key;
        const px = e.borderBoxSize?.[0]?.blockSize ?? e.contentRect.height;
        if (key && px > 0) l.heights.set(key, px);
      }
    });
  }
  const viewTop = keepTop, viewBottom = viewTop + (scroller.clientHeight || 700);
  if (scroller.getClientRects().length) {
    // First and last row that reach into [viewTop - AHEAD, viewBottom + AHEAD] (the header's height is not counted: close enough).
    let lo = 0, hi = keys.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (top[mid + 1]! < viewTop - AHEAD) lo = mid + 1; else hi = mid; }
    for (let i = lo; i < keys.length && top[i]! <= viewBottom + AHEAD; i++) realize(l, host.children[header + i] as HTMLElement);
  }
  if (typeof IntersectionObserver !== 'undefined') {
    l.observer = new IntersectionObserver(es => { for (const e of es) if (e.isIntersecting) realize(l, e.target as HTMLElement); }, { root: scroller, rootMargin: `${AHEAD}px 0px` });
    for (let i = header; i < host.children.length; i++) { const el = host.children[i] as HTMLElement; if (el.classList.contains('lazy')) l.observer.observe(el); }
  }
}

/** Make sure the row with this key is drawn (a row far down the list is only a shell until the list is scrolled to it). */
export function reveal(id: string, key: string): void {
  const l = lists.get(id);
  if (!l) return;
  const shell = l.host.querySelector<HTMLElement>(`.lazy[data-key="${CSS.escape(key)}"]`);
  if (shell) realize(l, shell);
}

/** How many rows of the list are drawn and how many it has (for tests). */
export const rowStats = (id: string): { drawn: number; total: number } | null => { const l = lists.get(id); return l ? { drawn: l.realized, total: l.keys.length } : null; };

/** Forget a list. */
export function dropRows(id: string): void {
  const l = lists.get(id);
  l?.observer?.disconnect(); l?.sizes?.disconnect();
  lists.delete(id);
}
