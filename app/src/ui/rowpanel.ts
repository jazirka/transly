import { approveEntry, sendBack } from '../core';
import type { BatchKind, Entry, Unit } from '../core';
import { $, esc, toast } from './dom';
import { realOf } from './hintcards';
import { renderHistory } from './history-panel';
import { linksClick } from './links-panel';
import { clearStrands, strandsClick, strandsHtml } from './strands-panel';
import { STATUS_CAP, shownStatus } from './state';
import { undoToast } from './undo-toast';
import type { Ctx } from './state';

/**
 * The right panel of the open row, built like Crowdin's: the translation the row holds (who wrote it, when, in what
 * state) with the ✓ that approves it, the earlier versions, the automatic proposals (translation memory, identical
 * rows), the terms and the names the game defines, and the discussion. It follows the selected row in the table and in
 * the editor alike. There is no separate "review" mode: a translation is approved here.
 */

/** One section: a folding header and its body (the ids are written out so a test can find them). */
const sec = (id: string, title: string, body: string, extra = ''): string => `<section class="pn-sec" data-sec="${id}"><button class="pn-h" type="button" data-pn="${id}" aria-expanded="true"><span class="pn-c" aria-hidden="true">▾</span><span>${title}</span>${extra}</button>${body}</section>`;

/** Static markup of the panel (the discussion keeps its own field so what is typed in it survives redraws). */
export const ROW_PANEL_HTML = ['<div class="pn-empty-all hint">Оберіть рядок</div>',
  sec('tr', 'Переклад: українська', '<div class="pn-b" id="pn-tr"></div>'),
  sec('th', 'Нитки: слова, конструкції, назви, однакові рядки', '<div class="pn-b" id="pn-th"></div>'),
  sec('cm', 'Обговорення', `<div class="pn-b" id="pn-cm"><div id="cm-list" class="cm-list"></div>
    <div class="cm-new"><textarea class="cmin" id="cm-in" placeholder="Нове обговорення цього рядка…" aria-label="Новий коментар"></textarea>
    <div class="actions" style="margin-top:0"><button class="btn" id="cm-add">Коментувати</button><span class="hint">Ctrl+Enter</span></div></div></div>`, '<span class="cnt" id="pn-cm-n" hidden>0</span>'),
].join('');

/** Which of the two tabs of the panel is open: the row, or its discussion. */
export type RowTab = 'row' | 'cm';
let rtab: RowTab = (() => { try { return localStorage.getItem('transly.rtab') === 'cm' ? 'cm' : 'row'; } catch { return 'row'; } })();
export const getRowTab = (): RowTab => rtab;
export const setRowTab = (t: RowTab): void => { rtab = t; try { localStorage.setItem('transly.rtab', t); } catch { /* private mode */ } };

/** Sections the translator folded. */
const folded = new Set<string>();
/** Rows whose translation card is shown in full (the card shows three lines of a long text). */
const expanded = new Set<string>();
/** A text longer than this (characters, or lines) is cut to three lines until «Показати повністю». */
const LONG = 150;

const when = (t: number): string => new Date(t).toLocaleString('uk-UA', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const ICON = {
  ok: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3.2 3.2L13 4.8"/></svg>',
  back: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4L2.5 7.5 6 11M3 7.5h6.5a3.5 3.5 0 0 1 0 7H8"/></svg>',
  clear: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4.5h10M6.5 4.5v-1.5h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5"/></svg>',
};

/** The translation the row holds now, as a card. */
function versionCard(ctx: Ctx, u: Unit, e: Entry | undefined): string {
  if (!e?.target) return '<div class="hint pn-none">Немає перекладу</div>';
  const st = shownStatus(ctx, u, e);
  const last = e.history?.[e.history.length - 1];
  const who = last?.who ?? ctx.s.who, at = last?.at ?? e.mt;
  const label = e.returned && e.status === 'draft' ? 'Повернено на доопрацювання' : st === 'appr' ? 'Вичитано' : STATUS_CAP[st];
  const long = e.target.length > LONG || e.target.split('\n').length > 3;
  const open = expanded.has(`${ctx.s.current}|${u.key}`);
  return `<div class="pn-ver ${st}">
    <div class="pn-text ${long && !open ? 'clamp' : ''}">${esc(e.target)}</div>
    ${long ? `<button class="pn-more" type="button" data-pa="more" aria-expanded="${open}">${open ? 'Згорнути' : 'Показати повністю'}</button>` : ''}
    <div class="pn-meta"><b>${esc(who)}</b><span class="dot" aria-hidden="true"></span>${when(at)}<span class="pn-st ${st}">${st === 'appr' ? '✔ ' : ''}${esc(label)}</span>
    <span class="pn-acts">
      ${st === 'appr' ? '' : `<button class="pn-ic ok" type="button" data-pa="approve" title="Вичитати переклад" aria-label="Вичитати переклад">${ICON.ok}</button>`}
      ${e.status === 'done' || e.status === 'appr' ? `<button class="pn-ic" type="button" data-pa="back" title="Повернути на доопрацювання" aria-label="Повернути на доопрацювання">${ICON.back}</button>` : ''}
      <button class="pn-ic" type="button" data-pa="clear" title="Очистити переклад" aria-label="Очистити переклад">${ICON.clear}</button>
    </span></div>
  </div>`;
}

/** Fill the panel for the open row. */
export function renderRowPanel(ctx: Ctx, u: Unit | undefined, e: Entry | undefined): void {
  document.querySelectorAll<HTMLElement>('.pn-sec').forEach(sec => {
    const id = sec.dataset.sec!, open = !folded.has(id);
    sec.classList.toggle('folded', !open);
    sec.querySelector('.pn-h')?.setAttribute('aria-expanded', String(open));
    const c = sec.querySelector('.pn-c'); if (c) c.textContent = open ? '▾' : '▸';
  });
  const pane = $('#s-pn');
  pane.classList.toggle('no-row', !u);
  // Two tabs, on the rail beside the panel: the row (its translation, versions, threads) and the discussion.
  for (const id of ['tr']) document.querySelector<HTMLElement>(`.pn-sec[data-sec="${id}"]`)!.hidden = rtab !== 'row';
  document.querySelector<HTMLElement>('.pn-sec[data-sec="cm"]')!.hidden = rtab !== 'cm';
  if (!u) return;
  const target = e?.target ?? '';
  $('#pn-tr').innerHTML = `${versionCard(ctx, u, e)}<div class="pn-sub">Попередні версії</div><div class="hist" id="hist-list"></div>`;
  // The cards of the threads stand under the editor in the editing view; where there is no editor (the table, the scenes) they stand here.
  if (ctx.s.mode !== 'edit') clearStrands();
  const th = ctx.s.mode === 'edit' ? '' : strandsHtml(ctx, u, target);
  $('#pn-th').innerHTML = th;
  document.querySelector<HTMLElement>('.pn-sec[data-sec="th"]')!.hidden = !th || rtab !== 'row';
  const file = ctx.s.current;
  if (file) renderHistory(ctx, `${file}|${u.key}`, e);
}

/** Approve the open row (a draft is sent first, so the history says both). */
export function approveOpenRow(ctx: Ctx, u: Unit): boolean {
  const { s } = ctx, file = s.current!, ents = ctx.entries(file), cur = ents[u.key];
  if (!cur?.target.trim()) { toast('Переклад порожній'); return false; }
  const opts = { blockErrors: s.saved.settings.blockErrors, qa: ctx.qaOpts() };
  const now = Date.now();
  const r2 = approveEntry(cur, u, now, opts);
  if (!r2.ok) { toast(r2.reason, { sticky: true }); return false; }
  const batch = ctx.commit([{ file, key: u.key, next: r2.entry, text: r2.entry.target }], 'approve', 'вичитано');
  ctx.persist(); ctx.invalidateTm(); ctx.render();
  undoToast(ctx, 'Вичитано', batch);
  return true;
}
const approve = (ctx: Ctx, u: Unit): void => { approveOpenRow(ctx, u); };

/** Clicks in the panel's own parts. `setText` writes a text into the row as one change (see `focus.ts`). */
export function rowPanelClick(ctx: Ctx, t: HTMLElement, setText: (u: Unit, text: string, what: string, kind?: BatchKind) => string | undefined): boolean {
  if (strandsClick(ctx, t) || linksClick(ctx, t)) return true;
  const h = t.closest<HTMLElement>('[data-pn]');
  if (h) { const id = h.dataset.pn!; if (folded.has(id)) folded.delete(id); else folded.add(id); ctx.render(); return true; }
  const a = t.closest<HTMLElement>('[data-pa]');
  if (!a) return false;
  const { s } = ctx;
  const u = s.cur ? ctx.unit(s.cur) : undefined;
  if (!u || !s.current) return true;
  const ents = ctx.entries(s.current), cur = ents[u.key];
  switch (a.dataset.pa) {
    case 'approve': approve(ctx, u); break;
    case 'more': { const k = `${s.current}|${u.key}`; if (expanded.has(k)) expanded.delete(k); else expanded.add(k); ctx.render(); break; }
    case 'back':
      if (cur) { const batch = ctx.commit([{ file: s.current, key: u.key, next: sendBack(cur, Date.now()), text: cur.target }], 'back'); ctx.persist(); ctx.render(); undoToast(ctx, 'Повернено на доопрацювання', batch); }
      break;
    case 'clear':
      if (!cur?.target) { toast('Переклад уже порожній'); break; }
      undoToast(ctx, 'Переклад очищено', setText(u, '', 'очищено', 'clear'));
      break;
    default: return false;
  }
  return true;
}
