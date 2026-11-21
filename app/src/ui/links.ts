import { $ } from './dom';
import type { Ctx } from './state';

/**
 * Threads between the original and the translation. Every term of the row wears a small number, in the original and
 * (when the translation has it) on its word in the translation, so the pairs can be told at a glance, however long the
 * sentence is. A dashed line from the word to its place is drawn only while one of the pair is pointed at, and only for
 * a term that has a pair in the text: a term the translation lacks, or a lost code, has no line, only its number in the
 * warning look (the card of the word tells the rest).
 */

const NS = 'http://www.w3.org/2000/svg';

interface Link { key: string; ci?: string; primary: boolean; x1: number; y1: number; x2: number; y2: number }

/** The threads kept drawn by a click on their chip (`data-thp`); they belong to one row and are let go when another row opens. */
const pinned = new Set<string>();
let pinRow = '', rowNow = '';
export const isPinned = (en: string): boolean => pinned.has(en);
/** The row the lines are drawn for: the threads kept drawn for another row are let go. */
function rowIs(row: string): void {
  rowNow = row;
  if (row !== pinRow) { pinned.clear(); pinRow = row; }
}
/** Keeps the thread of `en` drawn (or lets it go); returns whether it is kept now. */
export function togglePin(ctx: Ctx, en: string): boolean {
  rowIs(ctx.s.cur ?? '');
  if (pinned.delete(en)) return false;
  pinned.add(en);
  return true;
}
/** Lines of the kept threads stay lit; the chips say so. */
export function showPinned(): void {
  rowIs(rowNow);
  document.querySelectorAll<HTMLElement | SVGPathElement>('#te-links path, #te-links .lk').forEach(p => p.classList.toggle('kept', pinned.has((p.dataset.link ?? '').replace(/^term/, ''))));
  document.querySelectorAll<HTMLElement>('.thc2[data-ck]').forEach(c => { const on = pinned.has(c.dataset.ck ?? ''); c.classList.toggle('on', on); c.querySelector('.thc2-b')?.setAttribute('aria-pressed', String(on)); });
}

const first = (el: Element): DOMRect => el.getClientRects()[0] ?? el.getBoundingClientRect();

/**
 * Number the terms of the open row in the order they stand in the original: the number is put on the word of the original,
 * on its place in the translation and on the dot of its chip. Returns the numbers by the term's key.
 */
export function numberTerms(): Map<string, number> {
  const nums = new Map<string, number>();
  document.querySelectorAll<HTMLElement>('#f-src [data-hc="term"]').forEach(el => {
    const hk = el.dataset.hk ?? '';
    if (!nums.has(hk)) nums.set(hk, nums.size + 1);
    // a pattern with several parts (take … off) is numbered once, at its first part
    if ((el.dataset.part ?? '0') === '0') el.dataset.tn = String(nums.get(hk)); else delete el.dataset.tn;
  });
  const seen = new Set<string>();
  document.querySelectorAll<HTMLElement>('#te-layer mark[data-hc="term"]').forEach(el => {
    const hk = el.dataset.hk ?? '', n = nums.get(hk);
    if (n !== undefined && !seen.has(hk)) { seen.add(hk); el.dataset.tn = String(n); } else delete el.dataset.tn;
  });
  document.querySelectorAll<HTMLElement>('.thc2[data-ck] .thc2-dot').forEach(d => { const n = nums.get(d.parentElement?.closest<HTMLElement>('.thc2')?.dataset.ck ?? ''); d.textContent = n === undefined ? '' : String(n); });
  return nums;
}

/** Draw the threads for the open row. Nothing is drawn while the translation is empty (there is nothing to pair yet); the numbers are put on regardless. */
export function drawLinks(ctx: Ctx): void {
  rowIs(ctx.s.cur ?? '');
  const host = document.getElementById('te-links');
  numberTerms();
  if (!host) return;
  host.replaceChildren();
  document.querySelector('.fc-in')?.classList.remove('weave');
  const ta = $('#i-tr') as HTMLTextAreaElement, layer = $('#te-layer');
  const base = host.getBoundingClientRect();
  if (!base.width || !ta.value.trim() || ta.disabled) return;
  const links: Link[] = [];
  const arcs: { key: string; ci?: string; x1: number; x2: number; y: number }[] = [];
  // The parts of one entry (a pattern like «take … off» has several) are grouped: each part gets its line to the place in the translation.
  const groups = new Map<string, HTMLElement[]>();
  document.querySelectorAll<HTMLElement>('#f-src [data-hc="term"]').forEach(el => {
    const id = el.dataset.hk ?? '';
    const g = groups.get(id);
    if (g) { if (el.dataset.part !== undefined && g[0]?.dataset.part !== undefined) g.push(el); } else groups.set(id, [el]);
  });
  for (const els of groups.values()) {
    const el0 = els[0]!, key = el0.dataset.hk ?? '', ci = el0.dataset.ci;
    const hit = layer.querySelector<HTMLElement>(`mark[data-hc="term"][data-hk="${CSS.escape(key)}"]`);
    // A term the translation lacks has no pair, so no line: its number tells it (see the warning look of the number).
    if (!hit) continue;
    els.forEach((el, n) => {
      const r = first(el), t = first(hit);
      links.push({ key, ...(ci === undefined ? {} : { ci }), primary: n === 0, x1: r.left + r.width / 2 - base.left, y1: r.bottom + 2 - base.top, x2: t.left + t.width / 2 - base.left, y2: t.top - base.top - 1 });
    });
    // The parts of a pattern are joined above the original by a dashed arc (when they stand on one line): the words between them are not part of it.
    if (els.length > 1) {
      const rs = els.map(first);
      const top = Math.min(...rs.map(r => r.top)), sameLine = rs.every(r => Math.abs(r.top - rs[0]!.top) < 6);
      if (sameLine) arcs.push({ key, ...(ci === undefined ? {} : { ci }), x1: rs[0]!.left + rs[0]!.width / 2 - base.left, x2: rs[rs.length - 1]!.left + rs[rs.length - 1]!.width / 2 - base.left, y: top - base.top - 1 });
    }
  }
  if (!links.length && !arcs.length) { showPinned(); return; }
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = '<defs><marker id="lk-ok" viewBox="0 0 8 8" refX="4" refY="4" markerWidth="6" markerHeight="6"><circle cx="4" cy="4" r="3.4" class="lk-h ok"/></marker></defs>';
  for (const l of links) {
    const ym = (l.y1 + l.y2) / 2;
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', `M${l.x1} ${l.y1} C${l.x1} ${ym}, ${l.x2} ${ym}, ${l.x2} ${l.y2}`);
    path.setAttribute('class', `lk-p ok${l.ci === undefined ? '' : ` sc${l.ci}`}`);
    path.setAttribute('marker-start', 'url(#lk-ok)');
    path.setAttribute('marker-end', 'url(#lk-ok)');
    path.dataset.link = 'term' + l.key;
    svg.appendChild(path);
  }
  for (const a of arcs) {
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', `M${a.x1} ${a.y} C${a.x1} ${a.y - 14}, ${a.x2} ${a.y - 14}, ${a.x2} ${a.y}`);
    path.setAttribute('class', `lk-arc${a.ci === undefined ? '' : ` sc${a.ci}`}`);
    path.dataset.link = 'term' + a.key;
    svg.appendChild(path);
  }
  host.appendChild(svg);
  showPinned();
}

/** Redraw when the layout changes, and light up the arrow of the word that is pointed at. */
export function wireLinks(ctx: Ctx): void {
  const redraw = (): void => { window.requestAnimationFrame(() => drawLinks(ctx)); };
  window.addEventListener('resize', redraw);
  const fc = document.querySelector('.fc-in');
  if (fc && typeof ResizeObserver !== 'undefined') new ResizeObserver(redraw).observe(fc);
  const lit = (e: Event, on: boolean): void => {
    const el = (e.target as Element).closest<HTMLElement>('[data-hc], .thc2[data-ck]');
    const hk = el?.dataset.hk ?? el?.dataset.ck;
    if (!el || !hk) return;
    const id = (el.dataset.hc ?? 'term') + hk;
    document.querySelectorAll<HTMLElement | SVGPathElement>('#te-links path, #te-links .lk').forEach(p => { if (p.dataset.link === id) p.classList.toggle('hot', on); });
    // the other threads step back, so the one that is pointed at can be followed from the word to its place
    if (el.dataset.hc === 'code' || el.dataset.hc === 'name') return;
    const root = document.querySelector('.fc-in');
    root?.classList.toggle('lit', on);
    root?.querySelectorAll<HTMLElement>('.th[data-hk], mark.tt[data-hk], .thc2[data-ck], #te-links path').forEach(n => {
      const k = n instanceof SVGElement ? (n.dataset.link ?? '').replace(/^term/, '') : n.dataset.hk ?? n.dataset.ck;
      n.classList.toggle('dim', on && k !== hk);
    });
  };
  document.addEventListener('mouseover', e => lit(e, true));
  document.addEventListener('mouseout', e => lit(e, false));
  document.addEventListener('focusin', e => lit(e, true));
  document.addEventListener('focusout', e => lit(e, false));
}

/**
 * While a card is open its words are joined to it: an arrow from the word in the original and one from the word in the
 * translation (when the translation has it) end at the card's edge, and both words are ringed. Words the card covers
 * get no arrow (the card is right under the word it was opened from).
 */
const cardLinks = (): SVGSVGElement => {
  let svg = document.getElementById('card-links') as SVGSVGElement | null;
  if (!svg) {
    svg = document.createElementNS(NS, 'svg') as SVGSVGElement;
    svg.id = 'card-links';
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = '<defs><marker id="cl-h" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L8 4L0 8z" class="cl-t"/></marker></defs><g id="card-links-g"></g>';
    document.body.appendChild(svg);
  }
  return svg;
};

export function clearCardLinks(): void {
  document.getElementById('card-links-g')?.replaceChildren();
  document.querySelectorAll('.pin').forEach(e => e.classList.remove('pin'));
}

/** `words` are the elements to join to `card`; `edge` says on which side of the column the card stands ('r', 'l' or null when it stands under the word). */
export function drawCardLinks(card: HTMLElement, words: HTMLElement[], edge: 'r' | 'l' | null, colEdge: number): void {
  clearCardLinks();
  const g = cardLinks().querySelector('#card-links-g')!;
  const c = card.getBoundingClientRect();
  for (const w of words) {
    w.classList.add('pin');
    const r = first(w);
    const covered = r.right > c.left - 2 && r.left < c.right + 2 && r.bottom > c.top - 2 && r.top < c.bottom + 2;
    if (covered) continue;
    const sx = r.left + r.width / 2, sy = r.bottom + 2;
    let d: string;
    if (edge) {
      const ex = edge === 'r' ? colEdge - 6 : colEdge + 6;
      const tx = edge === 'r' ? c.left : c.right, ty = Math.min(Math.max(sy, c.top + 16), c.bottom - 16);
      const dir = edge === 'r' ? 1 : -1;
      d = `M${sx} ${sy} H${ex} C${ex + 10 * dir} ${sy}, ${tx - 10 * dir} ${ty}, ${tx} ${ty}`;
    } else {
      const tx = Math.min(Math.max(sx, c.left + 16), c.right - 16), ty = r.top > c.bottom ? c.bottom + 1 : c.top - 1;
      d = `M${sx} ${r.top > c.bottom ? r.top - 2 : sy} C${sx} ${(sy + ty) / 2}, ${tx} ${(sy + ty) / 2}, ${tx} ${ty}`;
    }
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('class', 'cl-p');
    path.setAttribute('marker-end', 'url(#cl-h)');
    g.appendChild(path);
  }
}
