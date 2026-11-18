import { linkModeOf, linkView, planLinkSync, relinkRow, setMain, clearMain, unlinkRow } from '../core';
import type { LinkView, Unit } from '../core';
import { esc, plural, toast } from './dom';
import { oneLine, realOf } from './hintcards';
import { LINK_LABEL, openLinkRows } from './links-dialog';
import type { Ctx } from './state';

/** The cluster the panel shows now: its buttons point into it by the row's number. */
let shown: { view: LinkView } | null = null;
/** Whether the card of the differences stands open under the chip of the row it was opened for (it is let go when another row opens). */
let pop: { key: string } | null = null;

/** The words of `text` that `base` does not have are marked: the rows that share an original are read for what differs. */
function diffText(text: string, base: string): string {
  const have = new Set((base.toLowerCase().match(/[\p{L}\p{N}’'-]+/gu)) ?? []);
  const t = oneLine(text, 90);
  if (!have.size) return esc(t);
  return t.split(/([\p{L}\p{N}’'-]+)/u).map((x, i) => (i % 2 && !have.has(x.toLowerCase()) ? `<mark class="df">${esc(x)}</mark>` : esc(x))).join('');
}

/** More rows than this are summed up in a line (the dialog «Зв’язані рядки» lists them all): a repeated line must not push the terms and the discussion out of the panel. */
const MAX_ROWS = 3;

/**
 * The section «Зв’язані рядки» of the right panel: the rows that have the same original, what each of them holds, and
 * what the translator can do — make this row the main one, unlink a row, update the others. Empty when the row has no twin.
 */
export function linksHtml(ctx: Ctx, u: Unit): string {
  const r = realOf(ctx, u);
  const view = linkView(ctx.s.saved, ctx.links(), r.file, r.key);
  shown = view ? { view } : null;
  if (!view) return '';
  const mode = linkModeOf(ctx.s.saved.settings);
  const plan = planLinkSync(ctx.s.saved, ctx.links(), r.file, r.key);
  const todo = plan ? plan.fills.length + plan.updates.length + plan.edited.length : 0;
  const ordered = [view.self, ...view.rows.filter(x => x !== view.self)];
  const rows = ordered.slice(0, MAX_ROWS).map(row => {
    const i = view.rows.indexOf(row), self = row === view.self, isMain = view.main?.ref === row.ref;
    const label = isMain ? 'головний ★' : LINK_LABEL[row.state];
    const where = self ? 'цей рядок' : ctx.fileTitle(row.file);
    const acts = [
      self ? '' : `<button type="button" class="pn-lb" data-lk="open" data-i="${i}">Відкрити</button>`,
      self && row.target.trim() ? (isMain ? `<button type="button" class="pn-lb" data-lk="clearmain" data-i="${i}">Скинути головний</button>` : `<button type="button" class="pn-lb" data-lk="main" data-i="${i}" title="Інші рядки порівнюються з цим перекладом">Зробити головним</button>`) : '',
      row.state === 'unlinked' ? `<button type="button" class="pn-lb" data-lk="relink" data-i="${i}">Зв’язати</button>` : `<button type="button" class="pn-lb" data-lk="unlink" data-i="${i}" title="Рядок більше не змінюватиметься разом з іншими">Відв’язати</button>`,
    ].join('');
    return `<div class="pn-lrow${self ? ' me' : ''}"><div class="pn-lt"><span class="pn-ls lk-${row.state}">${esc(label)}</span><span class="hint">${esc(where)}</span></div>${row.target.trim() ? `<div class="pn-lx">${self ? esc(oneLine(row.target, 90)) : diffText(row.target, view.self.target)}</div>` : ''}<div class="pn-la">${acts}</div></div>`;
  }).join('');
  const more = ordered.length > MAX_ROWS ? `<div class="hint">І ще ${ordered.length - MAX_ROWS} · <button type="button" class="pn-lb" data-lk="review">Показати всі</button></div>` : '';
  const head = `${plural(view.rows.length - 1, ['зв’язаний рядок', 'зв’язані рядки', 'зв’язаних рядків'])}${mode === 'off' ? ' · зв’язування вимкнено в налаштуваннях' : view.main ? ' · є головний переклад' : ''}`;
  const update = todo && plan?.view.reference ? `<button type="button" class="btn" data-lk="review">Оновити зв’язані (${todo})</button>` : '';
  return `<div class="pn-lh hint">${head}</div>${rows}${more}${update}`;
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
  const card = open ? `<div class="rows-pop" role="group" aria-label="Однакові оригінали"><div class="rows-pop-h"><b>Однаковий оригінал</b><button type="button" class="pn-lb" data-lk="pop" aria-label="Закрити">✕</button></div>${linksHtml(ctx, u)}</div>` : '';
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
  const now = Date.now(), { saved } = ctx.s;
  const redraw = (): void => { ctx.persist(); ctx.render(); };
  switch (b.dataset.lk) {
    case 'pop': { const u = ctx.s.cur ? ctx.unit(ctx.s.cur) : undefined; pop = !u || pop?.key === u.key ? null : { key: u.key }; redrawPop(ctx); break; }
    case 'open': if (row) { pop = null; ctx.open(row.file, row.key); } break;
    case 'unlink': if (row) { unlinkRow(saved, row, now); redraw(); toast('Рядок відв’язано', { action: { label: 'Скасувати', run: () => { relinkRow(saved, row, Date.now()); redraw(); } } }); } break;
    case 'relink': if (row) { relinkRow(saved, row, now); redraw(); toast('Рядок знову зв’язано'); } break;
    case 'main':
      if (row) {
        setMain(saved, row, now); redraw();
        const plan = r ? planLinkSync(saved, ctx.links(), r.file, r.key) : null;
        const n = plan ? plan.fills.length + plan.updates.length + plan.edited.length : 0;
        toast(n ? `Головний переклад обрано. Інших рядків: ${n}` : 'Головний переклад обрано', n && r ? { action: { label: 'Переглянути', run: () => openLinkRows(ctx, r.file, r.key) } } : {});
      }
      break;
    case 'clearmain': if (row) { clearMain(saved, row.source, now); redraw(); toast('Головний переклад скинуто: еталоном знову буде рядок, надісланий останнім'); } break;
    case 'review': if (r) openLinkRows(ctx, r.file, r.key); break;
    default: return false;
  }
  return true;
}
