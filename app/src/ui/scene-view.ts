import { describePage, displayLength, edit, sceneTitle, sourceTermHits, submit, targetHasTerm, termsIn } from '../core';
import type { Entry, RowChange, SceneInfo, Unit } from '../core';
import { $, esc, plural, toast } from './dom';
import { KIND_LABEL, nameMarks, namesOfRow, qaRows } from './hintcards';
import { markupTerms } from './markup';
import { scenesOf } from './scenecache';
import { openScene } from './scene-dialog';
import { GROUP, STATUS_CAP, shownStatus } from './state';
import type { Ctx } from './state';
import { autoSize } from './text-editor';
import { undoToast } from './undo-toast';

/**
 * The scene as a mode of the centre, next to the table and the editing view: every line of one event page one after
 * another as the game says them, each with its own field, so the whole scene can be translated in place. The cards
 * keep their fields while the view is drawn again (the fields are only touched when the text changed elsewhere), so the
 * caret stays where it is. A file without scenes (the database) has no such mode.
 */

export const SCENE_HTML = `<div class="sv" id="sv"><div class="sv-hd" id="sv-hd"></div><div class="sv-body" id="sv-body"></div></div>`;

/** The scene (and the file) the cards are built for: a redraw of the same one only updates them. */
let built = '';
let scrollKey = '';

const sceneOfCur = (ctx: Ctx): { file: string; sc: SceneInfo; idx: NonNullable<ReturnType<typeof scenesOf>>; i: number } | null => {
  const { s } = ctx;
  const v = s.current ? s.views.find(x => x.name === s.current) : undefined;
  const idx = v ? scenesOf(v.units) : null;
  if (!v || !idx) return null;
  let i = s.scene ? idx.scenes.findIndex(x => x.id === s.scene) : -1;
  if (i < 0 && s.cur) i = idx.byKey.get(s.cur) ?? -1;
  if (i < 0) i = 0;
  const sc = idx.scenes[i];
  return sc ? { file: v.name, sc, idx, i } : null;
};

/** Whether the open file has scenes (the mode is only offered then). */
export const hasScenes = (ctx: Ctx): boolean => {
  const v = ctx.s.current && ctx.s.current !== GROUP ? ctx.s.views.find(x => x.name === ctx.s.current) : undefined;
  return !!v && !!scenesOf(v.units);
};

/** The scene a row is in (its id), for choosing the scene when the mode is entered or a row is picked elsewhere. */
export const sceneIdOf = (ctx: Ctx, key: string | null): string | null => {
  const v = ctx.s.current ? ctx.s.views.find(x => x.name === ctx.s.current) : undefined;
  const idx = v ? scenesOf(v.units) : null;
  if (!idx) return null;
  const i = key ? idx.byKey.get(key) : undefined;
  return idx.scenes[i ?? 0]?.id ?? null;
};

function cardHtml(ctx: Ctx, u: Unit, n: number): string {
  return `<article class="sv-card" data-key="${esc(u.key)}">
    <div class="sv-top"><span class="sd" aria-hidden="true"></span><b class="sv-who"></b><span class="sv-k">${esc(KIND_LABEL[u.kind] ?? u.kind)}</span><span class="sv-n">${n}</span><span class="grow"></span><span class="sv-cnt" aria-hidden="true"></span><button class="sv-ok" type="button" data-sv="send" title="Надіслати й перейти далі (Ctrl+Enter)" aria-label="Надіслати рядок ${n}"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M14 2L7 9M14 2l-4.5 12L7 9 2 6.5z"/></svg></button></div>
    <div class="srcbox sv-src"></div>
    <textarea class="tr-in sv-in" rows="1" data-key="${esc(u.key)}" spellcheck="false" aria-label="Переклад рядка ${n}" placeholder="Переклад"></textarea>
    <div class="qa-under sv-qa"></div>
  </article>`;
}

/** Bring one card in line with the row: the status, the original with its terms, the remarks, the counter, and the field when it is not being typed in. */
function fillCard(ctx: Ctx, card: HTMLElement, u: Unit): void {
  const { s } = ctx;
  const e = ctx.entries(s.current!)[u.key];
  const st = shownStatus(ctx, u, e);
  card.classList.toggle('cur', u.key === s.cur);
  card.classList.toggle('err', st === 'qa');
  const sd = card.querySelector('.sd') as HTMLElement;
  sd.className = `sd ${st}`; sd.title = STATUS_CAP[st];
  (card.querySelector('.sv-who') as HTMLElement).textContent = ctx.speaker(u) || '';
  const have = e?.target ?? '';
  const hits = termsIn(u.source, s.saved.terms);
  const marks = sourceTermHits(u.source, hits).map(h => ({ start: h.start, end: h.end, en: h.term.en, missing: !!have && !targetHasTerm(have, h.term.uk, h.term.alt) }));
  (card.querySelector('.sv-src') as HTMLElement).innerHTML = markupTerms(u.source, [...marks, ...nameMarks(u, namesOfRow(ctx, u), marks)]);
  const ta = card.querySelector('textarea') as HTMLTextAreaElement;
  if (document.activeElement !== ta && ta.value !== have) ta.value = have;
  autoSize(ta);
  meterCard(card, u, ta.value);
  const q = qaRows(ctx, u, e);
  (card.querySelector('.sv-qa') as HTMLElement).innerHTML = have ? q.html : '';
}

function meterCard(card: HTMLElement, u: Unit, text: string): void {
  (card.querySelector('.sv-cnt') as HTMLElement).textContent = text ? `${displayLength(text)} / ${displayLength(u.source)}` : '';
}

/** Draw the header and the cards of the open scene. */
export function renderSceneView(ctx: Ctx): void {
  const { s } = ctx;
  const at = sceneOfCur(ctx);
  const hd = $('#sv-hd'), body = $('#sv-body');
  if (!at) { hd.innerHTML = ''; body.innerHTML = '<div class="empty-state"><b>У цьому файлі немає сцен</b><span>Сцени є лише в картах, спільних подіях і боях: у базі даних рядки не складаються в сцени.</span></div>'; built = ''; return; }
  const { sc, idx, i, file } = at;
  s.scene = sc.id;
  const ents = ctx.entries(file);
  // The open row belongs to the scene shown: when it does not (the mode was just entered, a scene was picked), the first line without a translation is the open one.
  if (!s.cur || !sc.units.some(u => u.key === s.cur)) s.cur = (sc.units.find(u => !ents[u.key]?.target) ?? sc.units[0])?.key ?? null;
  const done = sc.units.filter(u => ents[u.key]?.target).length, appr = sc.units.filter(u => ents[u.key]?.status === 'appr').length;
  const cond = sc.cond ? describePage(sc.cond, s.saved.sysNames).join('; ') : '';
  hd.innerHTML = `<div class="sv-title"><button class="ib sm" type="button" data-sv="prev" ${i > 0 ? '' : 'disabled'} title="Попередня сцена" aria-label="Попередня сцена"><svg viewBox="0 0 16 16"><path d="M10 3.5L5.5 8l4.5 4.5"/></svg></button>
      <div class="sv-t"><b>${esc(sceneTitle(sc))}</b><small>${esc(ctx.fileTitle(file))} · сцена ${i + 1} із ${idx.scenes.length} · перекладено ${done} із ${sc.units.length} · вичитано ${appr}</small></div>
      <button class="ib sm" type="button" data-sv="next" ${i < idx.scenes.length - 1 ? '' : 'disabled'} title="Наступна сцена" aria-label="Наступна сцена"><svg viewBox="0 0 16 16"><path d="M6 3.5L10.5 8 6 12.5"/></svg></button></div>
    ${cond ? `<div class="sv-cond">Показується, коли: ${esc(cond)}</div>` : ''}
    <div class="sv-acts"><button class="btn" type="button" data-sv="all-send" title="Надіслати всі чернетки сцени">Надіслати сцену</button><button class="btn" type="button" data-sv="all-appr" title="Вичитати всі переклади сцени">Вичитати сцену</button><button class="btn" type="button" data-sv="game" title="Подивитися сцену так, як її покаже гра">Як у грі</button></div>`;
  const sig = `${file}\u0001${sc.id}`;
  if (sig !== built || body.children.length !== sc.units.length) {
    built = sig;
    body.innerHTML = sc.units.map((u, n) => cardHtml(ctx, u, n + 1)).join('');
  }
  const cards = [...body.querySelectorAll<HTMLElement>('.sv-card')];
  sc.units.forEach((u, n) => { const c = cards[n]; if (c) fillCard(ctx, c, u); });
  // The row that was chosen elsewhere is brought into view once.
  if (s.cur && s.cur !== scrollKey) { scrollKey = s.cur; bringIntoView(body.querySelector<HTMLElement>(`.sv-card[data-key="${CSS.escape(s.cur)}"]`)); }
}

/** Typing in a card: the row changes at once, like in the editing view. */
export function sceneInput(ctx: Ctx, ta: HTMLTextAreaElement): boolean {
  if (!ta.classList.contains('sv-in')) return false;
  const { s } = ctx;
  const u = ctx.unit(ta.dataset.key ?? '');
  if (!u || !s.current) return true;
  const ents = ctx.entries(s.current);
  ents[u.key] = edit(ents[u.key], u, ta.value, ctx.stage(), Date.now());
  s.sess.n++;
  ctx.persist(); ctx.softTm();
  const card = ta.closest<HTMLElement>('.sv-card');
  if (card) {
    autoSize(ta);
    meterCard(card, u, ta.value);
    const e = ents[u.key], st = shownStatus(ctx, u, e);
    const sd = card.querySelector('.sd') as HTMLElement; sd.className = `sd ${st}`; sd.title = STATUS_CAP[st];
    card.classList.toggle('err', st === 'qa');
    (card.querySelector('.sv-qa') as HTMLElement).innerHTML = ta.value ? qaRows(ctx, u, e).html : '';
  }
  return true;
}

/** A field got the focus: that row becomes the open one (the right panel follows) without redrawing the cards. */
export function sceneFocus(ctx: Ctx, ta: HTMLTextAreaElement, panel: () => void): boolean {
  if (!ta.classList.contains('sv-in')) return false;
  const key = ta.dataset.key ?? '';
  if (ctx.s.cur !== key) {
    ctx.s.cur = key;
    document.querySelectorAll('.sv-card.cur').forEach(c => c.classList.remove('cur'));
    ta.closest('.sv-card')?.classList.add('cur');
    scrollKey = key;
    panel();
  }
  return true;
}

/** Put the focus into the field of a row (after a send, a step or a pick in the list). */
export function focusCard(key: string): void {
  const ta = document.querySelector<HTMLTextAreaElement>(`.sv-in[data-key="${CSS.escape(key)}"]`);
  ta?.focus({ preventScroll: true });
  bringIntoView(ta?.closest<HTMLElement>('.sv-card'));
}

/**
 * Bring a card into view with some of the scene around it. The scroller is the whole view (`#v-scene`), and its top
 * is covered by the sticky header, so the visible part starts below it. A card that is above that part or low in it
 * goes to a third of the height, so the next lines stay in sight; a card that is already high enough does not move.
 */
function bringIntoView(card: HTMLElement | null | undefined): void {
  const sc = document.getElementById('v-scene'), hd = document.getElementById('sv-hd');
  if (!sc || !card) return;
  const b = sc.getBoundingClientRect(), c = card.getBoundingClientRect();
  const top = b.top + (hd?.offsetHeight ?? 0), h = b.bottom - top;
  if (h <= 0 || (c.top >= top + 4 && c.top <= top + h * 0.6)) return;
  sc.scrollTop += c.top - top - h / 3;
}

/**
 * A send was refused because of a remark: the card says so itself (red border, the remark under the field), the view
 * scrolls to it and the focus goes to its first fix (or to the field), so the error is mended there and then. The
 * message is short and goes away by itself, it does not cover the cards.
 */
export function sceneBlocked(ctx: Ctx, key: string, reason: string): void {
  const card = document.querySelector<HTMLElement>(`.sv-card[data-key="${CSS.escape(key)}"]`);
  toast(reason);
  if (!card) return;
  bringIntoView(card);
  (card.querySelector<HTMLElement>('.sv-qa [data-fix]') ?? card.querySelector<HTMLElement>('.sv-in'))?.focus({ preventScroll: true });
  void ctx;
}

/** Send or approve every row of the scene that can be. */
function wholeScene(ctx: Ctx, what: 'send' | 'appr'): void {
  const { s } = ctx;
  const at = sceneOfCur(ctx);
  if (!at) return;
  const ents = ctx.entries(at.file);
  const opts = { blockErrors: s.saved.settings.blockErrors, qa: ctx.qaOpts() };
  const now = Date.now();
  const changes: RowChange[] = [];
  const blocked: string[] = [];
  for (const u of at.sc.units) {
    let next: Entry | undefined = ents[u.key];
    if (!next?.target.trim()) continue;
    if (what === 'send' && next.status !== 'draft') continue;
    if (next.status !== 'done' && next.status !== 'appr') { const r = submit(next, u, 'translate', now, opts); if (!r.ok) { blocked.push(u.key); continue; } next = r.entry; }
    if (what === 'appr') { const r = submit(next, u, 'review', now, opts); if (!r.ok) { blocked.push(u.key); continue; } next = r.entry; }
    changes.push({ file: at.file, key: u.key, next, text: next.target });
  }
  const batch = changes.length ? ctx.commit(changes, what === 'send' ? 'scene' : 'approve', what === 'send' ? undefined : 'вичитано (вся сцена)') : undefined;
  ctx.persist(); ctx.invalidateTm(); ctx.render();
  undoToast(ctx, `${what === 'send' ? 'Надіслано' : 'Вичитано'}: ${plural(changes.length, ['рядок', 'рядки', 'рядків'])}${blocked.length ? `. Пропущено через помилки QA: ${blocked.length}` : ''}`, batch);
  // The cards that were left out show their remarks: go to the first of them.
  const first = blocked[0] ? document.querySelector<HTMLElement>(`.sv-card[data-key="${CSS.escape(blocked[0])}"]`) : null;
  if (first) { bringIntoView(first); (first.querySelector<HTMLElement>('.sv-qa [data-fix]') ?? first.querySelector<HTMLElement>('.sv-in'))?.focus({ preventScroll: true }); }
}

/** Clicks in the scene view. */
export function sceneClick(ctx: Ctx, t: HTMLElement, send: (key: string) => void): boolean {
  const b = t.closest<HTMLElement>('#sv [data-sv]');
  if (!b) return false;
  const { s } = ctx;
  const at = sceneOfCur(ctx);
  if (!at) return true;
  switch (b.dataset.sv) {
    case 'prev': case 'next': {
      const to = at.idx.scenes[at.i + (b.dataset.sv === 'next' ? 1 : -1)];
      if (to) { s.scene = to.id; s.cur = to.units.find(u => !ents0(ctx, at.file)[u.key]?.target)?.key ?? to.units[0]?.key ?? null; ctx.render(); if (s.cur) focusCard(s.cur); }
      return true;
    }
    case 'all-send': wholeScene(ctx, 'send'); return true;
    case 'all-appr': wholeScene(ctx, 'appr'); return true;
    case 'game': { const u = s.cur ? ctx.unit(s.cur) : at.sc.units[0]; if (u) openScene(ctx, u); return true; }
    case 'send': { const key = b.closest<HTMLElement>('.sv-card')?.dataset.key; if (key) send(key); return true; }
    default: return false;
  }
}

const ents0 = (ctx: Ctx, file: string): Record<string, Entry> => ctx.entries(file);
