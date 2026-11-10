import { linkModeOf, linkView, planLinkSync, relinkRow, setMain, clearMain, unlinkRow } from '../core';
import type { LinkView, Unit } from '../core';
import { esc, plural, toast } from './dom';
import { oneLine, realOf } from './hintcards';
import { LINK_LABEL, openLinkRows } from './links-dialog';
import type { Ctx } from './state';

/** The cluster the panel shows now: its buttons point into it by the row's number. */
let shown: { view: LinkView } | null = null;
/** More rows than this are summed up in a line. */
const MAX_ROWS = 8;

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
    return `<div class="pn-lrow${self ? ' me' : ''}"><div class="pn-lt"><span class="pn-ls lk-${row.state}">${esc(label)}</span><span class="hint">${esc(where)}</span></div>${row.target.trim() ? `<div class="pn-lx">${esc(oneLine(row.target, 90))}</div>` : ''}<div class="pn-la">${acts}</div></div>`;
  }).join('');
  const more = ordered.length > MAX_ROWS ? `<div class="hint">І ще ${ordered.length - MAX_ROWS}</div>` : '';
  const head = `${plural(view.rows.length - 1, ['зв’язаний рядок', 'зв’язані рядки', 'зв’язаних рядків'])}${mode === 'off' ? ' · зв’язування вимкнено в налаштуваннях' : view.main ? ' · є головний переклад' : ''}`;
  const update = todo && plan?.view.reference ? `<button type="button" class="btn" data-lk="review">Оновити зв’язані (${todo})</button>` : '';
  return `<div class="pn-lh hint">${head}</div>${rows}${more}${update}`;
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
    case 'open': if (row) ctx.open(row.file, row.key); break;
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
