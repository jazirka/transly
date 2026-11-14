/**
 * Long lists keep a place for every row but draw a row only when it comes near the screen. Each row starts as an empty
 * shell of the height the row is expected to have (the height it had the last time it was drawn, if it was), so the
 * scrollbar and the scroll position stand for the whole list; the cells are written when the shell is within reach of
 * the visible part. Nothing is cut off, a redraw does not throw the reader back to the top, and everything that looks a
 * row up by its key keeps working (`reveal` draws a row on demand).
 */
interface Block {
  /** First row of the block and the one after its last. */
  s: number; e: number;
  /** The empty stand-in while the block is not drawn (null while its rows are drawn). */
  ph: HTMLElement | null;
  /** The drawn rows of the block. */
  rows: HTMLElement[];
}
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
  blocks: Block[];
  /** Which block a row is in. */
  at: Map<string, number>;
  shell: string;
}

const lists = new Map<string, Rows>();
/** Heights remembered per list (id and what it shows), a few lists at most. */
const memory = new Map<string, { width: number; heights: Map<string, number> }>();
const MEMORY = 4;

/** How far from the visible part rows are drawn, in pixels. */
const AHEAD = 900;
/**
 * The list is cut into blocks of this many rows. A block that is not drawn is one empty element of the height its rows have (or are
 * expected to have), so a list of a hundred thousand rows is a few thousand elements, not a hundred thousand.
 */
const BLOCK = 40;
/** Blocks farther than this many blocks from the one that was drawn last are taken out again (their height stays), so the page does not grow with every screen scrolled. */
const KEEP = 8;


const blockHeight = (l: Rows, b: Block): number => { let h = 0; for (let i = b.s; i < b.e; i++) h += l.heights.get(l.keys[i]!) ?? l.est; return h; };
const placeholder = (l: Rows, bi: number, px: number): string => `<div class="${l.shell}-blk lazy" aria-hidden="true" data-blk="${bi}" style="min-height:${px}px"></div>`;

/** Draw the rows of block `bi` in place of its stand-in. */
function realizeBlock(l: Rows, bi: number): void {
  const blk = l.blocks[bi];
  const ph = blk?.ph;
  if (!blk || !ph) return;
  let h = '';
  for (let i = blk.s; i < blk.e; i++) h += l.html(i);
  const prev = ph.previousElementSibling;
  ph.insertAdjacentHTML('beforebegin', h);
  const rows: HTMLElement[] = [];
  for (let el = (prev ? prev.nextElementSibling : l.host.firstElementChild); el && el !== ph; el = el.nextElementSibling) rows.push(el as HTMLElement);
  const grid = l.host.getAttribute('role') === 'grid';
  rows.forEach((r, k) => {
    // in a grid every drawn row says which one of all the rows it is (the stand-ins are hidden from screen readers)
    if (grid) r.setAttribute('aria-rowindex', String(blk.s + k + 2));
    l.sizes?.observe(r);
  });
  l.observer?.unobserve(ph);
  ph.remove();
  blk.ph = null; blk.rows = rows;
  l.realized += rows.length;
}

/** Take the rows of block `bi` out and put its stand-in back, as tall as the rows were. */
function unrealizeBlock(l: Rows, bi: number): void {
  const blk = l.blocks[bi];
  if (!blk || blk.ph || !blk.rows.length) return;
  // a row that has the focus (an open cell, a field) is not taken away from under the reader
  if (blk.rows.some(r => r.contains(document.activeElement))) return;
  let px = 0;
  for (const r of blk.rows) { const key = r.dataset.key; const hgt = r.getBoundingClientRect().height; if (key && hgt > 0) l.heights.set(key, hgt); l.sizes?.unobserve(r); }
  px = blockHeight(l, blk);
  const first = blk.rows[0]!;
  first.insertAdjacentHTML('beforebegin', placeholder(l, bi, px));
  const ph = first.previousElementSibling as HTMLElement;
  for (const r of blk.rows) r.remove();
  l.realized -= blk.rows.length;
  blk.rows = []; blk.ph = ph;
  l.observer?.observe(ph);
}

/** After the block `near` was drawn: the blocks far from it go. */
function trim(l: Rows, near: number): void {
  for (let bi = 0; bi < l.blocks.length; bi++) if (!l.blocks[bi]!.ph && Math.abs(bi - near) > KEEP) unrealizeBlock(l, bi);
}

/**
 * Put the rows `keys` into `host` after whatever it holds (a header row, say). `memKey` says which list this is (the
 * file shown): its remembered heights are used for the stand-ins. Rows near the current scroll position are drawn at once,
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

  const l: Rows = { host, scroller, keys, html, observer: null, sizes: null, heights: mem.heights, est, realized: 0, blocks: [], at: new Map(), shell };
  lists.set(id, l);
  // Where each block will be, from the heights known so far: to draw the blocks around the scroll position at once.
  const nb = Math.ceil(keys.length / BLOCK);
  const top = new Float64Array(nb + 1);
  let h = '';
  for (let bi = 0; bi < nb; bi++) {
    const s0 = bi * BLOCK, e0 = Math.min(keys.length, s0 + BLOCK);
    const blk: Block = { s: s0, e: e0, ph: null, rows: [] };
    l.blocks.push(blk);
    for (let i = s0; i < e0; i++) l.at.set(keys[i]!, bi);
    const px = blockHeight(l, blk);
    top[bi + 1] = top[bi]! + px;
    h += placeholder(l, bi, px);
  }
  host.innerHTML = headerHtml;
  const header = host.children.length;
  if (host.getAttribute('role') === 'grid') {
    // the size of the whole grid, not of the part that is drawn (one header row comes first)
    host.setAttribute('aria-rowcount', String(keys.length + header));
    const hr = host.firstElementChild;
    if (hr) { hr.setAttribute('aria-rowindex', '1'); host.setAttribute('aria-colcount', String(hr.children.length)); }
  }
  host.insertAdjacentHTML('beforeend', h);
  for (let bi = 0; bi < nb; bi++) l.blocks[bi]!.ph = host.children[header + bi] as HTMLElement;
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
    // First and last block that reach into [viewTop - AHEAD, viewBottom + AHEAD] (the header's height is not counted: close enough).
    let lo = 0, hi = nb;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (top[mid + 1]! < viewTop - AHEAD) lo = mid + 1; else hi = mid; }
    for (let bi = lo; bi < nb && top[bi]! <= viewBottom + AHEAD; bi++) realizeBlock(l, bi);
  }
  if (typeof IntersectionObserver !== 'undefined') {
    l.observer = new IntersectionObserver(es => {
      for (const e of es) {
        if (!e.isIntersecting) continue;
        const bi = Number((e.target as HTMLElement).dataset.blk);
        realizeBlock(l, bi);
        trim(l, bi);
      }
    }, { root: scroller, rootMargin: `${AHEAD}px 0px` });
    for (const blk of l.blocks) if (blk.ph) l.observer.observe(blk.ph);
  }
}

/** Make sure the row with this key is drawn (a row far down the list is only a shell until the list is scrolled to it). */
export function reveal(id: string, key: string): void {
  const l = lists.get(id);
  if (!l) return;
  const bi = l.at.get(key);
  if (bi === undefined) return;
  if (l.blocks[bi]!.ph) { realizeBlock(l, bi); trim(l, bi); }
}

/**
 * Replace one drawn row by new markup (the row's text or state changed) without touching the other rows or the scroll
 * position. False when the row is not drawn (a shell, or not in the list): the caller then redraws the list.
 */
export function patchRow(id: string, key: string, html: string): boolean {
  const l = lists.get(id);
  if (!l) return false;
  const row = l.host.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]:not(.lazy)`);
  if (!row) return false;
  // The element itself stays and only its attributes and cells are rewritten: taking a row out of a list of thousands makes the browser lay the whole list out again.
  const box = document.createElement('div');
  box.innerHTML = html;
  const fresh = box.firstElementChild as HTMLElement | null;
  if (!fresh) return false;
  for (const a of [...row.attributes]) if (!fresh.hasAttribute(a.name) && a.name !== 'style' && a.name !== 'aria-rowindex') row.removeAttribute(a.name);
  for (const a of [...fresh.attributes]) row.setAttribute(a.name, a.value);
  row.replaceChildren(...fresh.childNodes);
  return true;
}

/** How many rows of the list are drawn and how many it has (for tests). */
export const rowStats = (id: string): { drawn: number; total: number } | null => { const l = lists.get(id); return l ? { drawn: l.realized, total: l.keys.length } : null; };

/** Forget a list. */
export function dropRows(id: string): void {
  const l = lists.get(id);
  l?.observer?.disconnect(); l?.sizes?.disconnect();
  lists.delete(id);
}
