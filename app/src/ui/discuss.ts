import { addComment, commentId, deleteComment, editComment, replyTo, resolveThread, threadsOf } from '../core';
import type { Comment, Entry } from '../core';
import { $, esc, toast } from './dom';
import type { Ctx } from './state';

/**
 * The discussion of the open row, as threads: a comment, the answers to it, and one button that closes the thread when
 * it is settled (closed threads fold away). Authors can edit and delete their own comments. Everything here is written
 * through the row's `comments`; none of it touches the translation.
 */

const when = (t: number): string => new Date(t).toLocaleString('uk-UA', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const COLORS = ['#7a62d8', '#3d8bd9', '#2f9e7f', '#c0803a', '#c25b8a', '#6f7f8c'];
const colorOf = (name: string): string => { let h = 0; for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return COLORS[h % COLORS.length]!; };

/** Thread with an open answer form; comment being edited; comment waiting for the second click of a deletion. */
let replying: string | null = null;
let editing: string | null = null;
let deleting: string | null = null;
let deleteTimer = 0;
let focusNext = false;
/** Unsent text, kept while the row is open so that a redraw does not take it away. */
const drafts = new Map<string, string>();
const draftKey = (row: string, what: string): string => `${row}\u0001${what}`;
let shownRow = '';

function commentHtml(c: Comment, me: string, row: string): string {
  const id = commentId(c);
  const mine = c.who === me;
  const edited = c.ed && c.ed > c.at ? ` · змінено ${when(c.ed)}` : '';
  const body = editing === id
    ? `<div class="cm-edit"><textarea class="cmin" data-edit="${esc(id)}" rows="3" aria-label="Редагувати коментар">${esc(drafts.get(draftKey(row, id)) ?? c.text)}</textarea><div class="cm-acts"><button class="btn p" data-cm="save-edit" data-cid="${esc(id)}">Зберегти</button><button class="btn" data-cm="cancel">Скасувати</button></div></div>`
    : `<p>${esc(c.text)}</p>`;
  const acts = editing === id ? '' : `<div class="cm-acts">${mine ? `<button class="lnk" data-cm="edit" data-cid="${esc(id)}">Редагувати</button><button class="lnk ${deleting === id ? 'danger on' : ''}" data-cm="delete" data-cid="${esc(id)}">${deleting === id ? 'Справді видалити?' : 'Видалити'}</button>` : ''}</div>`;
  return `<div class="cm" data-cid="${esc(id)}"><div class="av" style="background:${colorOf(c.who)}" aria-hidden="true">${esc(Array.from(c.who)[0] ?? '?')}</div><div><div class="h"><b>${esc(c.who)}</b>${when(c.at)}${edited}</div>${body}${acts}</div></div>`;
}

/** The discussion of a row. `row` tells which row is open, so unsent text is kept for it and dropped for others. */
export function renderDiscuss(ctx: Ctx, row: string, e: Entry | undefined): void {
  const me = ctx.s.who;
  if (row !== shownRow) { shownRow = row; replying = editing = deleting = null; drafts.clear(); }
  const threads = threadsOf(e?.comments);
  const open = threads.filter(t => !t.resolved), closed = threads.filter(t => t.resolved);
  const threadHtml = (t: (typeof threads)[number]): string => {
    const answering = replying === t.id;
    const rd = drafts.get(draftKey(row, 'reply:' + t.id)) ?? '';
    return `<div class="thr ${t.resolved ? 'closed' : ''}" data-thread="${esc(t.id)}">
      ${commentHtml(t.root, me, row)}
      ${t.replies.map(r => commentHtml(r, me, row)).join('')}
      <div class="thr-foot">
        ${t.resolved ? `<span class="tagi ok">розв’язано · ${esc(t.by?.who ?? '')} · ${t.by ? when(t.by.at) : ''}</span><button class="lnk" data-cm="reopen" data-cid="${esc(t.id)}">Відкрити знову</button>`
          : `<button class="lnk" data-cm="reply" data-cid="${esc(t.id)}" ${answering ? 'hidden' : ''}>Відповісти</button><button class="lnk ok" data-cm="resolve" data-cid="${esc(t.id)}" title="Закрити обговорення: воно сховається в «Розв’язані»">✓ Розв’язати</button>`}
      </div>
      ${answering ? `<div class="cm-reply"><textarea class="cmin" data-reply="${esc(t.id)}" rows="2" placeholder="Відповісти…" aria-label="Відповідь">${esc(rd)}</textarea><div class="cm-acts"><button class="btn p" data-cm="send-reply" data-cid="${esc(t.id)}">Надіслати</button><button class="btn" data-cm="cancel">Скасувати</button><span class="hint">Ctrl+Enter</span></div></div>` : ''}
    </div>`;
  };
  // the section of resolved threads stays as the reader left it (a click inside it redraws the list: it must not fold up under the pointer)
  const closedWasOpen = !!document.querySelector('#cm-list details.thr-closed[open]');
  $('#cm-list').innerHTML = threads.length
    ? open.map(threadHtml).join('') + (closed.length ? `<details class="thr-closed"${closedWasOpen ? ' open' : ''}><summary>Розв’язані · ${closed.length}</summary>${closed.map(threadHtml).join('')}</details>` : '')
    : '<div class="hint">Коментарів немає</div>';
  $('#cm-badge').textContent = String(open.length);
  $('#cm-badge').hidden = !open.length;
  $('#cm-badge').title = open.length ? `Відкритих обговорень: ${open.length}` : '';
  const box = $('#cm-in') as HTMLTextAreaElement;
  if (document.activeElement !== box) box.value = drafts.get(draftKey(row, 'new')) ?? '';
  if (focusNext) {
    focusNext = false;
    document.querySelector<HTMLTextAreaElement>('#cm-list [data-edit], #cm-list [data-reply]')?.focus();
  }
}

/** Remember what is typed in any of the fields of the discussion. */
export function wireDiscuss(ctx: Ctx): void {
  const side = $('.fs');
  side.addEventListener('input', e => {
    const t = e.target as HTMLTextAreaElement;
    if (!(t instanceof HTMLTextAreaElement) || !t.closest('#s-pn')) return;
    const row = shownRow;
    if (t.id === 'cm-in') drafts.set(draftKey(row, 'new'), t.value);
    else if (t.dataset.reply) drafts.set(draftKey(row, 'reply:' + t.dataset.reply), t.value);
    else if (t.dataset.edit) drafts.set(draftKey(row, t.dataset.edit), t.value);
  });
  side.addEventListener('keydown', e => {
    const t = e.target as HTMLTextAreaElement;
    if (!(t instanceof HTMLTextAreaElement) || !t.closest('#s-pn')) return;
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (t.id === 'cm-in') discussClick(ctx, $('#cm-add'));
      else if (t.dataset.reply) discussClick(ctx, t.closest('.thr')!.querySelector<HTMLElement>('[data-cm="send-reply"]')!);
      else if (t.dataset.edit) discussClick(ctx, t.closest('.cm')!.querySelector<HTMLElement>('[data-cm="save-edit"]')!);
    } else if (e.key === 'Escape' && t.id !== 'cm-in') {
      e.preventDefault(); e.stopPropagation();
      replying = editing = null; ctx.render();
    }
  });
}

/** Clicks in the discussion. Returns true when handled. */
export function discussClick(ctx: Ctx, t: HTMLElement): boolean {
  const { s } = ctx;
  const u = s.cur ? ctx.unit(s.cur) : undefined;
  const b = t.closest<HTMLElement>('#cm-add, [data-cm]');
  if (!b || !u || !s.current) return false;
  const row = `${s.current}|${u.key}`;
  const ents = ctx.entries(s.current);
  const now = Date.now();
  const id = b.dataset.cid ?? '';
  const done = (e: Entry): void => { ents[u.key] = e; ctx.persist(); ctx.render(); };
  const read = (sel: string): string => (document.querySelector<HTMLTextAreaElement>(sel)?.value ?? '').trim();
  if (b.id === 'cm-add') {
    const text = read('#cm-in');
    if (!text) { toast('Напишіть коментар'); return true; }
    drafts.delete(draftKey(row, 'new'));
    ($('#cm-in') as HTMLTextAreaElement).value = '';
    done(addComment(ents[u.key], s.who, text, now));
    return true;
  }
  switch (b.dataset.cm) {
    case 'reply': replying = id; editing = null; focusNext = true; ctx.render(); return true;
    case 'cancel': replying = editing = null; ctx.render(); return true;
    case 'send-reply': {
      const text = read(`#cm-list [data-reply="${CSS.escape(id)}"]`);
      if (!text) { toast('Напишіть відповідь'); return true; }
      drafts.delete(draftKey(row, 'reply:' + id)); replying = null;
      done(replyTo(ents[u.key], id, s.who, text, now));
      return true;
    }
    case 'edit': editing = id; replying = null; focusNext = true; ctx.render(); return true;
    case 'save-edit': {
      const text = read(`#cm-list [data-edit="${CSS.escape(id)}"]`);
      if (!text) { toast('Коментар не може бути порожнім. Щоб прибрати його, натисніть «Видалити»'); return true; }
      drafts.delete(draftKey(row, id)); editing = null;
      const e = ents[u.key];
      if (e) done(editComment(e, id, text, now));
      return true;
    }
    case 'delete': {
      // Two clicks: the first only asks, the second deletes (a deletion cannot be taken back).
      if (deleting !== id) {
        deleting = id; window.clearTimeout(deleteTimer);
        deleteTimer = window.setTimeout(() => { deleting = null; if (document.getElementById('cm-list')) ctx.render(); }, 4000);
        ctx.render(); return true;
      }
      window.clearTimeout(deleteTimer); deleting = null;
      const e = ents[u.key];
      if (e) done(deleteComment(e, id, now));
      return true;
    }
    case 'resolve': case 'reopen': {
      const e = ents[u.key];
      if (e) done(resolveThread(e, id, b.dataset.cm === 'resolve', s.who, now));
      return true;
    }
    default: return false;
  }
}
