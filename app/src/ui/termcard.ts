import { targetHasTerm } from '../core';
import type { GlossaryTerm } from '../core';
import { $, esc } from './dom';
import { insertAtCursor } from './text-editor';
import type { Ctx } from './state';

/**
 * The card of a glossary term, shown over the term where it stands in the original or in the translation: the
 * rendering and its alternatives, the category, the note, whether the translation uses it, and what can be done with
 * it (put it into the translation, change it in the glossary). It opens when the pointer rests on the term or the term
 * is chosen with the keyboard, and goes away when the pointer leaves, on Esc, or when the row changes.
 */

let card: HTMLElement | null = null;
let showTimer = 0, hideTimer = 0;
/** The term the card is about. */
let shown: { en: string; anchor: HTMLElement } | null = null;

const cardEl = (): HTMLElement => {
  if (!card) {
    card = document.createElement('div');
    card.id = 'termcard';
    card.className = 'termcard';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', 'Термін глосарію');
    card.hidden = true;
    document.body.appendChild(card);
  }
  return card;
};

const find = (ctx: Ctx, en: string): GlossaryTerm | undefined => ctx.s.saved.terms.find(t => t.en.toLowerCase() === en.toLowerCase());

function html(ctx: Ctx, t: GlossaryTerm): string {
  const u = ctx.s.cur ? ctx.unit(ctx.s.cur) : undefined;
  const ents = ctx.s.current ? ctx.entries(ctx.s.current) : {};
  const target = u ? ents[u.key]?.target ?? '' : '';
  const used = target ? targetHasTerm(target, t.uk, t.alt) : null;
  const tags = [
    t.kind ? `<span class="tg k" title="Категорія терміна">${esc(t.kind)}</span>` : '',
    t.qa === false ? '<span class="tg">лише підказка</span>' : '<span class="tg ok" title="Відсутність терміна в перекладі буде позначено в QA">перевіряється в QA</span>',
    used === null ? '' : used ? '<span class="tg ok">є в перекладі</span>' : '<span class="tg warn">немає в перекладі</span>',
  ].join('');
  return `<div class="tc-row"><span class="tc-lang">UK</span><div class="tc-main"><b>${esc(t.uk)}</b>${t.alt?.length ? `<div class="tc-alt">також: ${t.alt.map(a => `<span>${esc(a)}</span>`).join('')}</div>` : ''}<div class="tc-tags">${tags}</div></div></div>
    <div class="tc-row tc-en"><span class="tc-lang">EN</span><div class="tc-main"><b>${esc(t.en)}</b>${t.note ? `<div class="tc-note">${esc(t.note)}</div>` : ''}</div></div>
    <div class="tc-acts"><button type="button" class="btn p" data-tc="insert" ${u ? '' : 'disabled'} title="Вставити в переклад на місці курсора">Вставити «${esc(t.uk)}»</button><button type="button" class="btn" data-tc="edit">Змінити термін</button></div>`;
}

export function hideTermCard(): void {
  window.clearTimeout(showTimer); window.clearTimeout(hideTimer);
  if (card) card.hidden = true;
  shown = null;
}

/** Show the card over `anchor` (below it, or above when there is no room). */
export function showTermCard(ctx: Ctx, anchor: HTMLElement, en: string): void {
  const t = find(ctx, en);
  if (!t) return;
  window.clearTimeout(hideTimer);
  const el = cardEl();
  el.innerHTML = html(ctx, t);
  el.hidden = false;
  shown = { en: t.en, anchor };
  const r = anchor.getBoundingClientRect(), c = el.getBoundingClientRect();
  const below = r.bottom + 6 + c.height <= window.innerHeight - 8;
  el.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - c.width - 8))}px`;
  el.style.top = `${below ? r.bottom + 6 : Math.max(8, r.top - c.height - 6)}px`;
}

/** The term of a marked word: `.th` in the original, <mark> in the layer of the translation field. */
const termOf = (el: Element | null): { el: HTMLElement; en: string } | null => {
  const h = el?.closest<HTMLElement>('.th, mark[data-term]');
  return h?.dataset.term ? { el: h, en: h.dataset.term } : null;
};

export function wireTermCard(ctx: Ctx, onEdit: (en: string) => void): void {
  const plan = (el: HTMLElement, en: string, delay: number): void => {
    window.clearTimeout(showTimer); window.clearTimeout(hideTimer);
    if (shown?.en === en && shown.anchor === el) return;
    showTimer = window.setTimeout(() => showTermCard(ctx, el, en), delay);
  };
  const leave = (): void => { window.clearTimeout(showTimer); window.clearTimeout(hideTimer); hideTimer = window.setTimeout(hideTermCard, 220); };

  // The original: the word itself.
  document.addEventListener('mouseover', e => { const t = termOf(e.target as Element); if (t && t.el.classList.contains('th')) plan(t.el, t.en, 260); });
  document.addEventListener('mouseout', e => { const t = termOf(e.target as Element); if (t && t.el.classList.contains('th') && !(e.relatedTarget as Element | null)?.closest('#termcard')) leave(); });
  document.addEventListener('click', e => {
    const t = termOf(e.target as Element);
    if (t && t.el.classList.contains('th')) { e.preventDefault(); showTermCard(ctx, t.el, t.en); return; }
    const b = (e.target as Element).closest<HTMLElement>('#termcard [data-tc]');
    if (b && shown) {
      const en = shown.en, term = find(ctx, en);
      if (b.dataset.tc === 'insert' && term) { const ta = document.getElementById('i-tr') as HTMLTextAreaElement | null; if (ta) insertAtCursor(ta, term.uk); }
      else if (b.dataset.tc === 'edit') onEdit(en);
      hideTermCard();
    } else if (!(e.target as Element).closest('#termcard')) hideTermCard();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && card && !card.hidden) { hideTermCard(); e.stopPropagation(); }
    else if ((e.key === 'Enter' || e.key === ' ') && (e.target as Element).classList?.contains('th')) { e.preventDefault(); const t = termOf(e.target as Element); if (t) showTermCard(ctx, t.el, t.en); }
  }, true);
  cardEl().addEventListener('mouseenter', () => window.clearTimeout(hideTimer));
  cardEl().addEventListener('mouseleave', leave);
  window.addEventListener('scroll', hideTermCard, true);

  // The translation: the layer is under the field, so the pointer position is looked up in the layer.
  return void ((): void => {
    const ta = $('#i-tr') as HTMLTextAreaElement, layer = $('#te-layer');
    let last: HTMLElement | null = null;
    ta.addEventListener('mousemove', e => {
      const m = (() => { for (const el of document.elementsFromPoint(e.clientX, e.clientY)) if (el.tagName === 'MARK' && layer.contains(el)) return el as HTMLElement; return null; })();
      const t = termOf(m);
      if (t) { last = t.el; ta.style.cursor = 'help'; plan(t.el, t.en, 320); }
      else if (last) { last = null; ta.style.cursor = ''; leave(); }
    });
    ta.addEventListener('mouseleave', () => { last = null; ta.style.cursor = ''; leave(); });
  })();
}
