import { approveEntry, sendBack } from '../core';
import type { BatchKind, Entry, Unit } from '../core';
import { $, esc, toast } from './dom';
import { realOf } from './hintcards';
import { renderHistory } from './history-panel';
import { linksClick } from './links-panel';
import { clearStrands, renderStrands, strandsClick } from './strands-panel';
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
  sec('ac', 'Активність', '<div class="pn-b"><div class="act" id="hist-list"></div></div>'),
  sec('th', 'Пов’язане', '<div class="pn-b" id="pn-th"></div>'),
  sec('cm', 'Обговорення', `<div class="pn-b" id="pn-cm"><div id="cm-list" class="cm-list"></div>
    <div class="cm-new"><textarea class="cmin" id="cm-in" placeholder="Нове обговорення цього рядка…" aria-label="Новий коментар"></textarea>
    <div class="actions" style="margin-top:0"><button class="btn" id="cm-add">Коментувати</button><span class="hint">Ctrl+Enter</span></div></div></div>`, '<span class="cnt" id="pn-cm-n" hidden>0</span>'),
].join('');

/** The three tabs of the panel, on the rail beside it: the activity of the row, what is related to it, and its discussion. */
export type RowTab = 'act' | 'rel' | 'cm';
export const ROW_TAB_TITLE: Record<RowTab, string> = { act: 'Активність', rel: 'Пов’язане', cm: 'Обговорення' };
let rtab: RowTab = (() => { try { const v = localStorage.getItem('transly.rtab'); return v === 'act' || v === 'cm' ? v : 'rel'; } catch { return 'rel'; } })();
export const getRowTab = (): RowTab => rtab;
export const setRowTab = (t: RowTab): void => { rtab = t; try { localStorage.setItem('transly.rtab', t); } catch { /* private mode */ } };


/** Fill the panel for the open row. */
export function renderRowPanel(ctx: Ctx, u: Unit | undefined, e: Entry | undefined): void {
  const pane = $('#s-pn');
  pane.classList.toggle('no-row', !u);
  // One section for each tab of the rail.
  document.querySelector<HTMLElement>('.pn-sec[data-sec="ac"]')!.hidden = rtab !== 'act';
  document.querySelector<HTMLElement>('.pn-sec[data-sec="th"]')!.hidden = rtab !== 'rel';
  document.querySelector<HTMLElement>('.pn-sec[data-sec="cm"]')!.hidden = rtab !== 'cm';
  if (!u) { clearStrands(); return; }
  const target = e?.target ?? '';
  // The related things (the words and constructions, the names, the memory, the rows with the same original) stand here, in the editing view too: they follow the text of the field there.
  const ta = document.getElementById('i-tr') as HTMLTextAreaElement | null;
  renderStrands(ctx, u, ctx.s.mode === 'edit' && ta && ta.dataset.key === u.key ? ta.value : target);
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
/** Send the open row back to the translator (a proofread or sent one becomes a draft again). */
export function sendBackOpenRow(ctx: Ctx, u: Unit): void {
  const { s } = ctx, cur = ctx.entries(s.current!)[u.key];
  if (!cur) return;
  const batch = ctx.commit([{ file: s.current!, key: u.key, next: sendBack(cur, Date.now()), text: cur.target }], 'back');
  ctx.persist(); ctx.render(); undoToast(ctx, 'Повернено на доопрацювання', batch);
}

/** Clicks in the panel's own parts (the related things); the others are handled by their own modules. */
export const rowPanelClick = (ctx: Ctx, t: HTMLElement): boolean => strandsClick(ctx, t) || linksClick(ctx, t);
