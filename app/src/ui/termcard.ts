import { $ } from './dom';
import { cardHtml, termView } from './hintcards';
import { clearCardLinks, drawCardLinks } from './links';
import type { Ctx } from './state';

/**
 * The card over a word of the original or of the translation (a term, a control code, a name from the game) or over a
 * chip of the header. It opens when the pointer rests on the word or the word is chosen with the keyboard, and goes
 * away when the pointer leaves, on Esc, or when the row changes. What its buttons do is up to the shell (`CardActions`).
 */
export interface CardActions {
  /** Put a text into the translation at the caret. */
  insert(text: string): void;
  /** Open the row `key` of `file`. */
  goto(file: string, key: string): void;
  /** Open the glossary form for the term with this original word. */
  edit(en: string): void;
  /** A button of a remark in the card (fix, ignore, bring back) of the row `key`. */
  remark(button: HTMLElement, key: string): void;
}

let card: HTMLElement | null = null;
let showTimer = 0, hideTimer = 0;
let shown: { kind: string; key: string; anchor: HTMLElement } | null = null;

const cardEl = (): HTMLElement => {
  if (!card) {
    card = document.createElement('div');
    card.id = 'termcard';
    card.className = 'termcard';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', 'Підказка');
    card.hidden = true;
    document.body.appendChild(card);
  }
  return card;
};

export function hideTermCard(): void {
  window.clearTimeout(showTimer); window.clearTimeout(hideTimer);
  if (card) card.hidden = true;
  clearCardLinks();
  shown = null;
}

/** Whether the card stands open over `el` now (a second click on the button that opened it puts it away). */
export const cardOpenOver = (el: Element): boolean => !!shown && shown.anchor === el && !!card && !card.hidden;

/** Show the card of `kind` / `key` over `anchor` (below it, or above when there is no room). */
export function showCard(ctx: Ctx, anchor: HTMLElement, kind: string, key: string, keepView = false): void {
  if (!keepView && !(shown?.kind === kind && shown.key === key)) termView.key = '';
  const html = cardHtml(ctx, kind, key);
  if (!html) return;
  window.clearTimeout(hideTimer);
  const el = cardEl();
  el.innerHTML = html;
  el.hidden = false;
  shown = { kind, key, anchor };
  const r = anchor.getBoundingClientRect(), c = el.getBoundingClientRect();
  // A word of the open row has its twin on the other side (the term in the original and in the translation): the card
  // then stands beside the column and an arrow runs to it from each of the two.
  const pair = anchor.closest('.fc-in') ? pairOf(kind, key) : null;
  const col = document.querySelector('.fc-in')?.getBoundingClientRect();
  const edge: 'r' | 'l' | null = pair && col && col.right + 14 + c.width <= window.innerWidth - 8 ? 'r' : pair && col && col.left - 14 - c.width >= 8 ? 'l' : null;
  el.classList.toggle('side', !!edge);
  if (edge && col && pair) {
    const ys = [pair.src, pair.tr].filter((x): x is HTMLElement => !!x).map(x => { const b = x.getBoundingClientRect(); return b.top + b.height / 2; });
    const mid = ys.reduce((a, b) => a + b, 0) / ys.length;
    el.style.left = `${edge === 'r' ? col.right + 14 : col.left - 14 - c.width}px`;
    el.style.top = `${Math.max(8, Math.min(window.innerHeight - c.height - 8, mid - c.height / 2))}px`;
    el.classList.remove('above');
    drawCardLinks(el, [pair.src, pair.tr].filter((x): x is HTMLElement => !!x), edge, edge === 'r' ? col.right : col.left);
    return;
  }
  const below = r.bottom + 6 + c.height <= window.innerHeight - 8;
  const left = Math.max(8, Math.min(r.left, window.innerWidth - c.width - 8));
  el.style.left = `${left}px`;
  el.style.top = `${below ? r.bottom + 8 : Math.max(8, r.top - c.height - 8)}px`;
  // The little arrow of the card points at the word (or the mark) it belongs to.
  el.classList.toggle('above', !below);
  el.style.setProperty('--ax', `${Math.max(14, Math.min(c.width - 24, r.left + r.width / 2 - left - 5))}px`);
  // The twin of the word, if it is not under the card, gets an arrow too.
  if (pair) drawCardLinks(el, [pair.src, pair.tr].filter((x): x is HTMLElement => !!x && x !== anchor), null, 0);
}

/** The word of the original and the word of the translation that belong to the same term or code. */
const pairOf = (kind: string, key: string): { src: HTMLElement | null; tr: HTMLElement | null } | null => {
  if (kind !== 'term' && kind !== 'code') return null;
  const k = CSS.escape(key);
  const src = document.querySelector<HTMLElement>(`#f-src [data-hc="${kind}"][data-hk="${k}"]`);
  const tr = document.querySelector<HTMLElement>(`#te-layer mark[data-hc="${kind}"][data-hk="${k}"]`);
  return src || tr ? { src, tr } : null;
};

/** The word a pointed-at element belongs to: `data-hc` says which kind of card it opens, `data-hk` which one. */
const wordOf = (el: Element | null): { el: HTMLElement; kind: string; key: string } | null => {
  const h = el?.closest<HTMLElement>('[data-hc]');
  return h?.dataset.hc ? { el: h, kind: h.dataset.hc, key: h.dataset.hk ?? '' } : null;
};

export function wireTermCard(ctx: Ctx, act: CardActions): void {
  const plan = (el: HTMLElement, kind: string, key: string, delay: number): void => {
    window.clearTimeout(showTimer); window.clearTimeout(hideTimer);
    if (shown?.kind === kind && shown.key === key && shown.anchor === el) return;
    showTimer = window.setTimeout(() => showCard(ctx, el, kind, key), delay);
  };
  const leave = (): void => { window.clearTimeout(showTimer); window.clearTimeout(hideTimer); hideTimer = window.setTimeout(hideTermCard, 220); };
  // Chips open on a click (they are buttons); words open when the pointer rests on them.
  const hoverable = (el: HTMLElement): boolean => !el.classList.contains('cc');

  document.addEventListener('mouseover', e => { const w = wordOf(e.target as Element); if (w && hoverable(w.el) && !w.el.closest('.te-layer')) plan(w.el, w.kind, w.key, 260); });
  document.addEventListener('mouseout', e => { const w = wordOf(e.target as Element); if (w && hoverable(w.el) && !w.el.closest('.te-layer') && !(e.relatedTarget as Element | null)?.closest('#termcard')) leave(); });
  document.addEventListener('click', e => {
    const target = e.target as Element;
    const b = target.closest<HTMLElement>('#termcard [data-hca]');
    if (b) {
      const v = b.dataset.v ?? '';
      // Moves inside the card keep it open.
      if (b.dataset.hca === 'tab' && shown) { termView.tab = v === 'c' ? 'c' : 'a'; termView.i = 0; showCard(ctx, shown.anchor, shown.kind, shown.key, true); return; }
      if (b.dataset.hca === 'forms' && shown) { termView.forms = !termView.forms; showCard(ctx, shown.anchor, shown.kind, shown.key, true); return; }
      if (b.dataset.hca === 'step' && shown) { termView.i += Number(v); showCard(ctx, shown.anchor, shown.kind, shown.key, true); return; }
      if (b.dataset.hca === 'insert') act.insert(v);
      else if (b.dataset.hca === 'goto') act.goto(b.dataset.file ?? '', b.dataset.key ?? '');
      else if (b.dataset.hca === 'edit') act.edit(v);
      hideTermCard();
      return;
    }
    const rb = target.closest<HTMLElement>('#termcard [data-fix], #termcard [data-ign], #termcard [data-unign]');
    if (rb && shown) { const key = shown.key; act.remark(rb, key); hideTermCard(); return; }
    const w = wordOf(target);
    // a click on a term or a code of the original puts it into the translation at once (after the last character); its card is the hover, not the click
    if (w && !w.el.closest('.te-layer') && (w.kind === 'code' || w.kind === 'term')) {
      const text = w.kind === 'code' ? w.key : ctx.s.saved.terms.find(t => t.en.trim().toLowerCase() === w.key.trim().toLowerCase())?.uk ?? '';
      if (text && ctx.s.cur) { e.preventDefault(); hideTermCard(); act.insert(text); return; }
    }
    if (w && !w.el.closest('.te-layer')) { e.preventDefault(); if (shown?.anchor === w.el) hideTermCard(); else showCard(ctx, w.el, w.kind, w.key); return; }
    if (!target.closest('#termcard, [data-th="card"], [data-th="name"]')) hideTermCard();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && card && !card.hidden) { hideTermCard(); e.stopPropagation(); }
    else if ((e.key === 'Enter' || e.key === ' ') && (e.target as Element).hasAttribute?.('data-hc') && (e.target as HTMLElement).tagName !== 'BUTTON') { e.preventDefault(); const w = wordOf(e.target as Element); if (w) showCard(ctx, w.el, w.kind, w.key); }
  }, true);
  cardEl().addEventListener('mouseenter', () => window.clearTimeout(hideTimer));
  cardEl().addEventListener('mouseleave', leave);
  window.addEventListener('scroll', hideTermCard, true);

  // The translation: the layer is under the field, so the pointer position is looked up in the layer.
  const ta = $('#i-tr') as HTMLTextAreaElement, layer = $('#te-layer');
  let last: HTMLElement | null = null;
  ta.addEventListener('mousemove', e => {
    let hit: HTMLElement | null = null;
    for (const el of document.elementsFromPoint(e.clientX, e.clientY)) if (el.tagName === 'MARK' && layer.contains(el)) { hit = el as HTMLElement; break; }
    const w = wordOf(hit);
    if (w) { last = w.el; ta.style.cursor = 'help'; plan(w.el, w.kind, w.key, 320); }
    else if (last) { last = null; ta.style.cursor = ''; leave(); }
  });
  ta.addEventListener('mouseleave', () => { last = null; ta.style.cursor = ''; leave(); });
}
