import { $ } from './dom';
import type { Ctx } from './state';

/**
 * Arrows between the original and the translation: from each glossary term of the original to where the translation
 * renders it, with a mark in the middle that says whether it is right (a tick), and for a term the translation lacks an
 * arrow that stops at the field with a warning. The mark is the way into the card of the term. A control code the
 * translation lost gets the same kind of arrow with a cross. Codes that are in place get no arrow: they would only be noise.
 */

const NS = 'http://www.w3.org/2000/svg';

interface Link { key: string; kind: 'term' | 'code'; ok: boolean; ci?: string; primary: boolean; x1: number; y1: number; x2: number; y2: number; mx?: number; my?: number }

/** A point of the arrow's curve (t from 0 at the original to 1 at the translation). */
function at(l: Link, t: number): { x: number; y: number } {
  const ym = (l.y1 + l.y2) / 2, u = 1 - t;
  return { x: u * u * u * l.x1 + 3 * u * u * t * l.x1 + 3 * u * t * t * l.x2 + t * t * t * l.x2, y: u * u * u * l.y1 + 3 * u * u * t * ym + 3 * u * t * t * ym + t * t * t * l.y2 };
}

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

/** Draw the arrows for the open row. Nothing is drawn while the translation is empty (there is nothing to check yet). */
export function drawLinks(ctx: Ctx): void {
  rowIs(ctx.s.cur ?? '');
  const host = document.getElementById('te-links');
  if (!host) return;
  host.replaceChildren();
  document.querySelector('.fc-in')?.classList.remove('weave');
  const ta = $('#i-tr') as HTMLTextAreaElement, layer = $('#te-layer');
  const base = host.getBoundingClientRect();
  if (!base.width || !ta.value.trim() || ta.disabled) return;
  const field = ta.getBoundingClientRect();
  const srcBottom = $('#f-src').getBoundingClientRect().bottom;
  const links: Link[] = [];
  const arcs: { key: string; ci?: string; x1: number; x2: number; y: number }[] = [];
  // The parts of one entry (a pattern like «take … off» has several) are grouped: each part gets its arrow to the place in the translation.
  const groups = new Map<string, HTMLElement[]>();
  document.querySelectorAll<HTMLElement>('#f-src [data-hc="term"], #f-src [data-hc="code"]').forEach(el => {
    const id = (el.dataset.hc ?? '') + (el.dataset.hk ?? '');
    const g = groups.get(id);
    if (g) { if (el.dataset.hc === 'term' && el.dataset.part !== undefined && g[0]?.dataset.part !== undefined) g.push(el); } else groups.set(id, [el]);
  });
  for (const els of groups.values()) {
    const el0 = els[0]!, kind = el0.dataset.hc as 'term' | 'code', key = el0.dataset.hk ?? '', ci = el0.dataset.ci;
    const hit = layer.querySelector<HTMLElement>(`mark[data-hc="${kind}"][data-hk="${CSS.escape(key)}"]`);
    // A code that is in place needs no arrow.
    if (kind === 'code' && hit) continue;
    els.forEach((el, n) => {
      const r = first(el);
      // The arrow leaves from under the word, at the lower edge of the original's box (a word in the middle of a long text would otherwise have a line drawn across the lines below it).
      // A word on the last line of the original is left from its own underline; a word higher up would have the line drawn across the text below it, so that one leaves from the lower edge of the box.
      const lastLine = srcBottom - r.bottom < 18;
      const x1 = r.left + r.width / 2 - base.left, y1 = (lastLine ? r.bottom + 1 : Math.max(r.bottom, srcBottom) + 2) - base.top;
      if (hit) {
        const t = first(hit);
        // A word on a later line of the translation is pointed at from above the field: the arrow does not cross the lines in between.
        const firstLine = t.top - field.top < 32;
        links.push({ key, kind, ok: true, ...(ci === undefined ? {} : { ci }), primary: n === 0, x1, y1, x2: t.left + t.width / 2 - base.left, y2: firstLine ? t.top - base.top - 1 : field.top - base.top - 2 });
      }
      else links.push({ key, kind, ok: false, ...(ci === undefined ? {} : { ci }), primary: n === 0, x1, y1, x2: Math.min(Math.max(x1, field.left - base.left + 14), field.right - base.left - 14), y2: field.top - base.top - 2 });
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
  svg.innerHTML = `<defs><marker id="lk-ok" viewBox="0 0 8 8" refX="4" refY="4" markerWidth="6" markerHeight="6"><circle cx="4" cy="4" r="3.4" class="lk-h ok"/></marker><marker id="lk-warn" viewBox="0 0 8 8" refX="4" refY="4" markerWidth="6" markerHeight="6"><circle cx="4" cy="4" r="3.4" class="lk-h warn"/></marker></defs>`;
  for (const l of links) {
    const ym = (l.y1 + l.y2) / 2;
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', `M${l.x1} ${l.y1} C${l.x1} ${ym}, ${l.x2} ${ym}, ${l.x2} ${l.y2}`);
    path.setAttribute('class', `lk-p ${l.ok ? 'ok' : 'warn'}${l.ci === undefined ? '' : ` sc${l.ci}`}`);
    // What is right needs no mark: a line that reaches its word is enough. A word the translation lacks ends in a dot of the warning colour.
    if (!l.ok) path.setAttribute('marker-end', 'url(#lk-warn)');
    path.dataset.link = l.kind + l.key;
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
  // Marks close to each other would sit on top of one another: spread them out to the right.
  // Only what needs a look gets a mark (a term the translation lacks, a lost code): what is right is told by the card under the translation.
  const marked = links.filter(l => l.primary && !l.ok);
  let lastX = -99;
  for (const l of [...marked].sort((a, b) => a.x1 - b.x1)) { const m = at(l, 0.5); l.mx = Math.max(m.x, lastX + 22); lastX = l.mx; l.my = m.y; }
  for (const l of marked) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `lk ${l.ok ? 'ok' : l.kind === 'code' ? 'bad' : 'warn'}`;
    b.dataset.hc = l.kind; b.dataset.hk = l.key; b.dataset.link = l.kind + l.key;
    b.style.left = `${l.mx}px`; b.style.top = `${l.my}px`;
    b.textContent = l.ok ? '✔' : l.kind === 'code' ? '✖' : '▲';
    b.setAttribute('aria-label', l.ok ? `«${l.key}»: у перекладі є, відкрити картку` : l.kind === 'code' ? `Код ${l.key} загублено в перекладі, відкрити картку` : `«${l.key}»: у перекладі немає, відкрити картку`);
    host.appendChild(b);
  }
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
