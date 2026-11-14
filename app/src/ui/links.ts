import { $ } from './dom';
import type { Ctx } from './state';

/**
 * Arrows between the original and the translation: from each glossary term of the original to where the translation
 * renders it, with a mark in the middle that says whether it is right (a tick), and for a term the translation lacks an
 * arrow that stops at the field with a warning. The mark is the way into the card of the term. A control code the
 * translation lost gets the same kind of arrow with a cross. Codes that are in place get no arrow: they would only be noise.
 */

const NS = 'http://www.w3.org/2000/svg';

interface Link { key: string; kind: 'term' | 'code'; ok: boolean; x1: number; y1: number; x2: number; y2: number; mx?: number; my?: number }

/** A point of the arrow's curve (t from 0 at the original to 1 at the translation). */
function at(l: Link, t: number): { x: number; y: number } {
  const ym = (l.y1 + l.y2) / 2, u = 1 - t;
  return { x: u * u * u * l.x1 + 3 * u * u * t * l.x1 + 3 * u * t * t * l.x2 + t * t * t * l.x2, y: u * u * u * l.y1 + 3 * u * u * t * ym + 3 * u * t * t * ym + t * t * t * l.y2 };
}

const first = (el: Element): DOMRect => el.getClientRects()[0] ?? el.getBoundingClientRect();

/** Draw the arrows for the open row. Nothing is drawn while the translation is empty (there is nothing to check yet). */
export function drawLinks(_ctx: Ctx): void {
  const host = document.getElementById('te-links');
  if (!host) return;
  host.replaceChildren();
  const ta = $('#i-tr') as HTMLTextAreaElement, layer = $('#te-layer');
  const base = host.getBoundingClientRect();
  if (!base.width || !ta.value.trim() || ta.disabled) return;
  const field = ta.getBoundingClientRect();
  const srcBottom = $('#f-src').getBoundingClientRect().bottom;
  const links: Link[] = [];
  const seen = new Set<string>();
  document.querySelectorAll<HTMLElement>('#f-src [data-hc="term"], #f-src [data-hc="code"]').forEach(el => {
    const kind = el.dataset.hc as 'term' | 'code', key = el.dataset.hk ?? '', id = kind + key;
    if (seen.has(id)) return;
    seen.add(id);
    const hit = layer.querySelector<HTMLElement>(`mark[data-hc="${kind}"][data-hk="${CSS.escape(key)}"]`);
    // A code that is in place needs no arrow.
    if (kind === 'code' && hit) return;
    const r = first(el);
    // The arrow leaves from under the word, at the lower edge of the original's box (a word in the middle of a long text would otherwise have a line drawn across the lines below it).
    const x1 = r.left + r.width / 2 - base.left, y1 = Math.max(r.bottom, srcBottom) - base.top + 2;
    if (hit) {
      const t = first(hit);
      // A word on a later line of the translation is pointed at from above the field: the arrow does not cross the lines in between.
      const firstLine = t.top - field.top < 32;
      links.push({ key, kind, ok: true, x1, y1, x2: t.left + t.width / 2 - base.left, y2: firstLine ? t.top - base.top - 3 : field.top - base.top - 2 });
    }
    else links.push({ key, kind, ok: false, x1, y1, x2: Math.min(Math.max(x1, field.left - base.left + 14), field.right - base.left - 14), y2: field.top - base.top - 2 });
  });
  if (!links.length) return;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = `<defs><marker id="lk-ok" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L8 4L0 8z" class="lk-h ok"/></marker><marker id="lk-warn" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L8 4L0 8z" class="lk-h warn"/></marker></defs>`;
  for (const l of links) {
    const ym = (l.y1 + l.y2) / 2;
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', `M${l.x1} ${l.y1} C${l.x1} ${ym}, ${l.x2} ${ym}, ${l.x2} ${l.y2}`);
    path.setAttribute('class', `lk-p ${l.ok ? 'ok' : 'warn'}`);
    path.setAttribute('marker-end', `url(#lk-${l.ok ? 'ok' : 'warn'})`);
    path.dataset.link = l.kind + l.key;
    svg.appendChild(path);
  }
  host.appendChild(svg);
  // Marks close to each other would sit on top of one another: spread them out to the right.
  let lastX = -99;
  for (const l of [...links].sort((a, b) => a.x1 - b.x1)) { const m = at(l, 0.24); l.mx = Math.max(m.x, lastX + 24); lastX = l.mx; l.my = m.y; }
  for (const l of links) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `lk ${l.ok ? 'ok' : l.kind === 'code' ? 'bad' : 'warn'}`;
    b.dataset.hc = l.kind; b.dataset.hk = l.key; b.dataset.link = l.kind + l.key;
    const m = at(l, 0.24);
    b.style.left = `${l.mx}px`; b.style.top = `${l.my}px`;
    b.textContent = l.ok ? '✔' : l.kind === 'code' ? '✖' : '▲';
    b.setAttribute('aria-label', l.ok ? `«${l.key}»: у перекладі є, відкрити картку` : l.kind === 'code' ? `Код ${l.key} загублено в перекладі, відкрити картку` : `«${l.key}»: у перекладі немає, відкрити картку`);
    host.appendChild(b);
  }
}

/** Redraw when the layout changes, and light up the arrow of the word that is pointed at. */
export function wireLinks(ctx: Ctx): void {
  const redraw = (): void => { window.requestAnimationFrame(() => drawLinks(ctx)); };
  window.addEventListener('resize', redraw);
  const fc = document.querySelector('.fc-in');
  if (fc && typeof ResizeObserver !== 'undefined') new ResizeObserver(redraw).observe(fc);
  const lit = (e: Event, on: boolean): void => {
    const el = (e.target as Element).closest<HTMLElement>('[data-hc]');
    if (!el?.dataset.hk) return;
    const id = (el.dataset.hc ?? '') + el.dataset.hk;
    document.querySelectorAll<SVGPathElement>('#te-links path').forEach(p => { if (p.dataset.link === id) p.classList.toggle('hot', on); });
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
