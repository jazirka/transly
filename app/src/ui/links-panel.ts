import { linkModeOf, linkView, planLinkSync } from '../core';
import type { LinkView, Unit } from '../core';
import { esc, plural } from './dom';
import { oneLine, realOf } from './hintcards';
import { openLinkRows } from './links-dialog';
import type { Ctx } from './state';

/** The cluster the panel shows now: its buttons point into it by the row's number. */
let shown: { view: LinkView } | null = null;
/** Whether the card of the differences stands open under the chip of the row it was opened for (it is let go when another row opens). */
let pop: { key: string } | null = null;

/** The words of `text` that `base` does not have are marked: the rows that share an original are read for what differs. */
export function diffText(text: string, base: string): string {
  const have = new Set((base.toLowerCase().match(/[\p{L}\p{N}’'-]+/gu)) ?? []);
  const t = oneLine(text, 90);
  if (!have.size) return esc(t);
  return t.split(/([\p{L}\p{N}’'-]+)/u).map((x, i) => (i % 2 && !have.has(x.toLowerCase()) ? `<mark class="df">${esc(x)}</mark>` : esc(x))).join('');
}

/** The rows that do not agree with the others: another translation, one changed later, one that is empty or only a draft. */
const NOT_AGREE = new Set(['differs', 'edited', 'empty', 'draft']);

/**
 * The page of the rows with the same original: what the translator wants to know and one button for what to do about it.
 * Everything agrees: a tick, and «Показати всі» (the rows are listed in the table). Something does not: how many, and «Звірити» (the dialog that
 * puts the rows side by side with the reference, the differences marked, to be updated or left).
 */
function pageHtml(ctx: Ctx, u: Unit): string {
  const r = realOf(ctx, u), view = shown?.view;
  if (!view) return '';
  const others = view.rows.filter(x => x !== view.self), bad = others.filter(x => NOT_AGREE.has(x.state));
  const plan = planLinkSync(ctx.s.saved, ctx.links(), r.file, r.key);
  const ref = plan?.view.reference;
  const off = linkModeOf(ctx.s.saved.settings) === 'off' ? '<p class="hint">Зв’язування вимкнено в налаштуваннях.</p>' : '';
  if (bad.length && ref) {
    return `<p class="lk-st warn"><b>Не сходяться ${bad.length} з ${others.length}</b></p>
      <p class="lk-ref">Еталон: «${esc(oneLine(ref.target, 90))}»</p>${off}
      <button type="button" class="btn p lk-one" data-lk="review">Звірити (${bad.length})</button>`;
  }
  return `<p class="lk-st ok"><b>✓ ${ref ? 'Переклад усюди однаковий' : 'Однаковий оригінал'}</b></p>
    <p class="lk-ref">${ref ? `«${esc(oneLine(ref.target, 90))}»` : 'Жоден із цих рядків ще не надіслано'}</p>${off}
    <button type="button" class="btn lk-one" data-lk="all">Показати всі ${others.length + 1}</button>`;
}

/**
 * The chip «≡ N» beside the label of the translation (and first among the threads in the panel when there is no editor): the row has N
 * others with the same original. It is not a thread (there is no word it stands under), so it has no line in the text; a click opens a card
 * with what the others hold, the differences marked, and what can be done (see `linksHtml`).
 */
export function eqChipHtml(ctx: Ctx, u: Unit): string {
  const r = realOf(ctx, u);
  const view = linkView(ctx.s.saved, ctx.links(), r.file, r.key);
  shown = view ? { view } : null;
  if (!view) { pop = null; return ''; }
  if (pop && pop.key !== u.key) pop = null;
  const n = view.rows.length - 1, open = pop?.key === u.key;
  const differs = view.rows.some(x => x !== view.self && (x.state === 'differs' || x.state === 'edited'));
  const chip = `<button type="button" class="eqchip${differs ? ' diff' : ''}${open ? ' on' : ''}" data-lk="pop" aria-expanded="${open}" title="${plural(n, ['рядок', 'рядки', 'рядків'])} з таким самим оригіналом${differs ? ': переклади різні' : ''}"><span aria-hidden="true">≡</span> ${n}</button>`;
  const card = open ? `<div class="rows-pop" role="group" aria-label="Однакові оригінали"><div class="rows-pop-h"><b>Однаковий оригінал</b><button type="button" class="pn-lb" data-lk="pop" aria-label="Закрити">✕</button></div>${pageHtml(ctx, u)}</div>` : '';
  return `<span class="eqwrap">${chip}${card}</span>`;
}

/** The chip beside the label of the translation is drawn again (the row, its links or its translation changed). */
export function renderRowsChip(ctx: Ctx, u: Unit | undefined): void {
  const box = document.getElementById('f-eq');
  if (!box) return;
  const html = u && ctx.s.mode === 'edit' ? eqChipHtml(ctx, u) : '';
  if (box.dataset.html !== html) { box.dataset.html = html; box.innerHTML = html; }
}

/** The card opened or closed: the chip is drawn again where it stands (beside the label of the translation, or among the threads in the panel). */
function redrawPop(ctx: Ctx): void {
  if (ctx.s.mode === 'edit') renderRowsChip(ctx, ctx.s.cur ? ctx.unit(ctx.s.cur) : undefined);
  else ctx.render();
}

/** Clicking elsewhere puts the card away. */
let wired = false;
export function wireRowsChip(ctx: Ctx): void {
  if (wired) return;
  wired = true;
  document.addEventListener('mousedown', e => {
    if (!pop || (e.target as Element).closest('.eqwrap')) return;
    pop = null;
    redrawPop(ctx);
  });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || !pop) return;
    pop = null;
    redrawPop(ctx);
  });
}

/** Clicks on the section's buttons. */
export function linksClick(ctx: Ctx, t: HTMLElement): boolean {
  const b = t.closest<HTMLElement>('[data-lk]');
  if (!b) return false;
  const view = shown?.view, row = view?.rows[Number(b.dataset.i)];
  const r = ctx.s.cur ? realOf(ctx, ctx.unit(ctx.s.cur)!) : null;
  switch (b.dataset.lk) {
    case 'pop': { const u = ctx.s.cur ? ctx.unit(ctx.s.cur) : undefined; pop = !u || pop?.key === u.key ? null : { key: u.key }; redrawPop(ctx); break; }
    case 'all': if (view) { pop = null; ctx.openRows('Однаковий оригінал', view.rows.map(x => ({ file: x.file, key: x.key }))); } break;
    case 'review': if (r) openLinkRows(ctx, r.file, r.key); break;
    default: return false;
  }
  return true;
}
