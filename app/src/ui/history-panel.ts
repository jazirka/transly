import { diffWords, historyRows, restoreNote } from '../core';
import type { DiffSeg, Entry, Unit } from '../core';
import { $, esc, toast } from './dom';
import type { Ctx } from './state';

/**
 * The history of the open row: every record with what changed in it (words taken out struck through, words added
 * underlined), and buttons to bring a version back, or what was there before a clearing or an overwrite. A restore is
 * itself written to the history with a snapshot, so it can be taken back the same way.
 */

const when = (t: number): string => new Date(t).toLocaleString('uk-UA', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/** Records shown against the text the row holds now (what a restore would change), instead of against their own past. */
const against = new Set<number>();
let shownRow = '';

const segs = (d: DiffSeg[]): string => d.map(s => (s.t === 'same' ? esc(s.text) : s.t === 'add' ? `<ins>${esc(s.text)}</ins>` : `<del>${esc(s.text)}</del>`)).join('');

export function renderHistory(ctx: Ctx, row: string, e: Entry | undefined): void {
  if (row !== shownRow) { shownRow = row; against.clear(); }
  const current = e?.target ?? '';
  const rows = historyRows(e?.history, current);
  $('#hist-list').innerHTML = rows.length ? rows.map(r => {
    const cmp = against.has(r.index);
    const body = !r.rec.text ? '<span class="hint">текст не змінювався</span>'
      : cmp ? segs(diffWords(current, r.rec.text))
      : r.before ? segs(r.diff) : esc(r.rec.text);
    return `<div class="hv ${r.isCurrent ? 'cur' : ''}" data-hi="${r.index}">
      <div class="h"><b>${esc(r.rec.who)}</b> · ${esc(r.rec.what)} · ${when(r.rec.at)}${r.isCurrent ? ' <span class="tagi">зараз у полі</span>' : ''}</div>
      <div class="t diff">${body}</div>
      ${cmp ? '<div class="hint">Закреслене зникне, підкреслене повернеться, якщо відновити цю версію.</div>' : ''}
      <div class="hv-acts">
        ${r.canRestore ? `<button class="lnk" data-hv="restore" data-i="${r.index}" title="Замінити переклад цим текстом (можна скасувати)">Відновити цю версію</button>` : ''}
        ${r.canRestoreBefore ? `<button class="lnk" data-hv="before" data-i="${r.index}" title="Повернути текст, що був перед цією дією">Було до цього</button>` : ''}
        ${r.rec.text && !r.isCurrent ? `<button class="lnk" data-hv="cmp" data-i="${r.index}">${cmp ? 'Показати зміну' : 'Порівняти з поточним'}</button>` : ''}
      </div>
    </div>`;
  }).join('') : '<div class="hint pn-empty">Попередніх версій немає. Тут з’являться надсилання, затвердження й масові дії з можливістю повернути текст.</div>';
}

/** Clicks in the history. `apply` writes a text into the open row as one change (with its own history record). */
export function historyClick(ctx: Ctx, t: HTMLElement, apply: (u: Unit, text: string, what: string) => void): boolean {
  const b = t.closest<HTMLElement>('[data-hv]');
  if (!b) return false;
  const { s } = ctx;
  const u = s.cur ? ctx.unit(s.cur) : undefined;
  if (!u || !s.current) return true;
  const i = Number(b.dataset.i);
  if (b.dataset.hv === 'cmp') { if (against.has(i)) against.delete(i); else against.add(i); ctx.render(); return true; }
  const e = ctx.entries(s.current)[u.key];
  const r = historyRows(e?.history, e?.target ?? '').find(x => x.index === i);
  if (!r) return true;
  const text = b.dataset.hv === 'before' ? r.before : r.rec.text;
  if (!text) { toast('Тут нічого відновлювати'); return true; }
  apply(u, text, restoreNote(r.rec, b.dataset.hv === 'before' ? 'before' : 'text', when(r.rec.at)));
  toast('Текст відновлено. Повернути попередній можна тут же, в історії');
  return true;
}
