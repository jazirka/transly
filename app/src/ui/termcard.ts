import { $ } from './dom';
import { cardHtml } from './hintcards';
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
  shown = null;
}

/** Show the card of `kind` / `key` over `anchor` (below it, or above when there is no room). */
export function showCard(ctx: Ctx, anchor: HTMLElement, kind: string, key: string): void {
  const html = cardHtml(ctx, kind, key);
  if (!html) return;
  window.clearTimeout(hideTimer);
  const el = cardEl();
  el.innerHTML = html;
  el.hidden = false;
  shown = { kind, key, anchor };
  const r = anchor.getBoundingClientRect(), c = el.getBoundingClientRect();
  const below = r.bottom + 6 + c.height <= window.innerHeight - 8;
  el.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - c.width - 8))}px`;
  el.style.top = `${below ? r.bottom + 6 : Math.max(8, r.top - c.height - 6)}px`;
}

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
      if (b.dataset.hca === 'insert') act.insert(v);
      else if (b.dataset.hca === 'goto') act.goto(b.dataset.file ?? '', b.dataset.key ?? '');
      else if (b.dataset.hca === 'edit') act.edit(v);
      hideTermCard();
      return;
    }
    const rb = target.closest<HTMLElement>('#termcard [data-fix], #termcard [data-ign], #termcard [data-unign]');
    if (rb && shown) { const key = shown.key; act.remark(rb, key); hideTermCard(); return; }
    const w = wordOf(target);
    if (w && !w.el.closest('.te-layer')) { e.preventDefault(); if (shown?.anchor === w.el) hideTermCard(); else showCard(ctx, w.el, w.kind, w.key); return; }
    if (!target.closest('#termcard')) hideTermCard();
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
