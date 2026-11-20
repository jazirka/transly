import { activityKind, dayLabel, diffWords, historyRows, restoreNote } from '../core';
import type { ActivityKind } from '../core';
import type { DiffSeg, Entry, Unit } from '../core';
import { $, esc, toast } from './dom';
import type { Ctx } from './state';

/**
 * The history of the open row: every record with what changed in it (words taken out struck through, words added
 * underlined), and buttons to bring a version back, or what was there before a clearing or an overwrite. A restore is
 * itself written to the history with a snapshot, so it can be taken back the same way.
 */

const when = (t: number): string => new Date(t).toLocaleString('uk-UA', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const clock = (t: number): string => new Date(t).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });

const svg = (d: string): string => `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="${d}"/></svg>`;
const ICON: Record<ActivityKind, string> = {
  send: svg('M14 2L7 9M14 2l-4.5 12-2.5-5.5L1.5 6z'),
  approve: svg('M3 8.5l3.2 3.2L13 4.8'),
  restore: svg('M6 4L2.5 7.5 6 11M3 7.5h6.5a3.5 3.5 0 0 1 0 7H8'),
  back: svg('M6 4L2.5 7.5 6 11M3 7.5h6.5a3.5 3.5 0 0 1 0 7H8'),
  edit: svg('M10.5 2.5l3 3L5.5 13.5l-3.5.5.5-3.5z'),
};
const TOOL = {
  restore: svg('M6 4L2.5 7.5 6 11M3 7.5h6.5a3.5 3.5 0 0 1 0 7H8'),
  before: svg('M8 4.5V8l2.5 1.5M2.5 8A5.5 5.5 0 1 0 4 4.2M2.5 2.5v2.8h2.8'),
  cmp: svg('M5 3L2 6l3 3M2 6h8M11 13l3-3-3-3M14 10H6'),
};

/** Records shown against the text the row holds now (what a restore would change), instead of against their own past. */
const against = new Set<number>();
let shownRow = '';

const segs = (d: DiffSeg[]): string => d.map(s => (s.t === 'same' ? esc(s.text) : s.t === 'add' ? `<ins>${esc(s.text)}</ins>` : `<del>${esc(s.text)}</del>`)).join('');

/**
 * The activity of the row, in the way of an online editor's feed: the records grouped under the day they were made, newest first, each with a round icon of its kind,
 * who did what, the time on the right and the text under it (what was taken out struck through, what was added underlined). `cardAbove` says the translation
 * the row holds is written out above (the table), so the newest record does not repeat it.
 */
export function renderHistory(ctx: Ctx, row: string, e: Entry | undefined, cardAbove = false): void {
  if (row !== shownRow) { shownRow = row; against.clear(); }
  const current = e?.target ?? '';
  const rows = historyRows(e?.history, current);
  const now = Date.now();
  let day = '';
  $('#hist-list').innerHTML = rows.length ? rows.map(r => {
    const cmp = against.has(r.index);
    const body = r.isCurrent && cardAbove ? '<span class="hint">Це поточний переклад (угорі)</span>'
      : !r.rec.text ? '<span class="hint">текст не змінювався</span>'
      : cmp ? segs(diffWords(current, r.rec.text))
      : r.before ? segs(r.diff) : esc(r.rec.text);
    const label = dayLabel(r.rec.at, now);
    const head = label !== day ? `<div class="ac-d" role="separator"><span>${esc(label)}</span></div>` : '';
    day = label;
    const kind = activityKind(r.rec.what);
    return `${head}<div class="ac-i hv ${r.isCurrent ? 'cur' : ''}" data-hi="${r.index}">
      <span class="ac-ic k-${kind}" aria-hidden="true">${ICON[kind]}</span>
      <div class="ac-m">
        <div class="ac-h"><span class="ac-w"><b>${esc(r.rec.who || 'Хтось')}</b> ${esc(r.rec.what)}${r.isCurrent ? ' <span class="tagi">зараз у полі</span>' : ''}</span>${r.rec.at ? `<time datetime="${new Date(r.rec.at).toISOString()}" title="${when(r.rec.at)}">${clock(r.rec.at)}</time>` : ''}<span class="ac-b">
          ${r.canRestore ? `<button type="button" data-hv="restore" data-i="${r.index}" title="Відновити цю версію: замінити переклад цим текстом (можна скасувати)" aria-label="Відновити цю версію">${TOOL.restore}</button>` : ''}
          ${r.canRestoreBefore ? `<button type="button" data-hv="before" data-i="${r.index}" title="Було до цього: повернути текст, що був перед цією дією" aria-label="Було до цього">${TOOL.before}</button>` : ''}
          ${r.rec.text && !r.isCurrent ? `<button type="button" data-hv="cmp" data-i="${r.index}" aria-pressed="${cmp}" title="${cmp ? 'Показати зміну' : 'Порівняти з поточним'}" aria-label="${cmp ? 'Показати зміну' : 'Порівняти з поточним'}">${TOOL.cmp}</button>` : ''}
        </span></div>
        <div class="t diff ac-t">${body}</div>
        ${cmp ? '<div class="hint">Закреслене зникне, підкреслене повернеться, якщо відновити цю версію.</div>' : ''}
      </div>
    </div>`;
  }).join('') : '<div class="pn-mid">Брак активності</div>';
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
  const was = e?.status;
  apply(u, text, restoreNote(r.rec, b.dataset.hv === 'before' ? 'before' : 'text', r.rec.at ? when(r.rec.at) : 'іншого пристрою'));
  // a restored text is a new text for the row: it goes back to a draft and wants sending (and review) again
  toast(was === 'done' || was === 'appr' ? 'Текст відновлено як чернетку: надішліть його ще раз. Попередній можна повернути тут же, в історії' : 'Текст відновлено. Повернути попередній можна тут же, в історії');
  return true;
}
