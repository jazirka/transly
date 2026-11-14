import { activeIssues, afterSend, applyPlan, linkModeOf, planOf, sourceTermHits, targetHasTerm, targetTermHits, displayLength, edit as editFn, lengthDeviation, linesShown, openThreads, recordChange, referenceSets, setIgnored, submit, termsIn, tooWide, unitWord, wrapMessage } from '../core';
import type { BatchKind, Entry, Unit } from '../core';
import { $, buzz, esc, plural, toast } from './dom';
import { discussClick, renderDiscuss } from './discuss';
import { chipsHtml, qaRows, namesOfRow, nameMarks, realOf, tmMatch } from './hintcards';
import { ROW_PANEL_HTML, renderRowPanel, rowPanelClick } from './rowpanel';
import { focusCard, sceneBlocked } from './scene-view';
import { historyClick } from './history-panel';
import { CODE_RE, markupTerms } from './markup';
import { autoSize, drawMarks, insertAtCursor } from './text-editor';
import { hideTermCard } from './termcard';
import { drawLinks } from './links';
import { openLinkRows } from './links-dialog';
import { isDesktop, openLink, rememberedGameDir } from './desktop';
import { drawPic, picOfFace, picsOfRow } from './gameimg';
import type { Pic } from './gameimg';
import { STATUS_CAP, noteChange, shownStatus } from './state';
import { undoToast } from './undo-toast';
import type { Ctx } from './state';

const I = {
  copy: '<svg viewBox="0 0 16 16"><rect x="5.5" y="5.5" width="8" height="8" rx="1"/><path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2"/></svg>',
  clear: '<svg viewBox="0 0 16 16"><path d="M3 4.5h10M6.5 4.5v-1.5h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5"/></svg>',
  code: '<svg viewBox="0 0 16 16"><path d="M6 3H3.5v10H6M10 3h2.5v10H10M8 5v6"/></svg>',
  play: '<svg viewBox="0 0 16 16"><path d="M5 3.5l8 4.5-8 4.5z" fill="currentColor" stroke="none"/></svg>',
  send: '<svg viewBox="0 0 16 16"><path d="M14 2L7 9M14 2l-4.5 12L7 9 2 6.5z"/></svg>',
  up: '<svg viewBox="0 0 16 16"><path d="M4 9.5L8 5.5l4 4"/></svg>',
  down: '<svg viewBox="0 0 16 16"><path d="M4 6.5L8 10.5l4-4"/></svg>',
  ok: '<svg viewBox="0 0 16 16"><path d="M3 8.5l3.2 3.2L13 4.8"/></svg>',
  scene: '<svg viewBox="0 0 16 16"><rect x="2.5" y="3" width="11" height="6" rx="1.5"/><rect x="2.5" y="11" width="7" height="2.5" rx="1"/></svg>',
  compact: '<svg viewBox="0 0 16 16"><path d="M3 6V3h3M13 6V3h-3M3 10v3h3M13 10v3h-3"/></svg>',
  wrap: '<svg viewBox="0 0 16 16"><path d="M2.5 4h11M2.5 8h8.5a2.5 2.5 0 0 1 0 5H8M9.5 11l-1.7 2 1.7 2M2.5 12h2"/></svg>',
  hint: '<svg viewBox="0 0 16 16"><path d="M8 2.5a4 4 0 0 0-2.2 7.3c.5.4.7.9.7 1.4v.3h3v-.3c0-.5.2-1 .7-1.4A4 4 0 0 0 8 2.5zM6.5 13.5h3"/></svg>',
  chat: '<svg viewBox="0 0 16 16"><path d="M3 3.5h10v7H8.5L6 13v-2.5H3z"/></svg>',
  clock: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5"/><path d="M8 5v3.2l2 1.3"/></svg>',
  dict: '<svg viewBox="0 0 16 16"><path d="M3.5 2.5h8a1 1 0 0 1 1 1v10H4.5a1 1 0 0 1-1-1z"/><path d="M6 5.5h4M6 8h4"/></svg>',
};

/** Static skeleton of the editing view; renderFocus() fills the pieces so the textarea keeps focus while typing. */
export const FOCUS_HTML = `<div class="fc"><div class="fc-in"><div class="te-links" id="te-links"></div>
  <div class="fhd"><span class="k" id="f-key"></span><span class="fchips" id="f-chips"></span><span class="st-pill" id="f-state"></span></div>
  <div class="offlist" id="f-off" hidden><span>Цей рядок не входить у поточний фільтр або пошук.</span><button data-reset>Показати всі рядки</button></div>
  <div><div class="lbl">Оригінал · EN</div><div class="srcbox" id="f-src" lang="en"></div><div class="pics" id="f-pics" hidden></div></div>
  <div id="f-refbox" hidden></div>
  <div class="trblock">
    <div class="lbl"><span id="f-trlbl">Переклад · UK</span></div>
    <div class="te"><div class="te-layer" id="te-layer" aria-hidden="true"></div><textarea class="tr-in" id="i-tr" spellcheck="false" aria-label="Переклад"></textarea></div>
    <div class="edbar">
      <button class="ib lab" id="b-compact" title="Лише текст: сховати контекст і примітки" aria-label="Режим лише тексту">${I.compact}<span class="tl">Лише текст</span></button>
      <button class="ib" id="b-clear" title="Очистити переклад" aria-label="Очистити переклад">${I.clear}</button>
      <span class="grow"></span>
      <div class="cnt2" id="cnt2" title="Знаків у перекладі / в оригіналі. Рекомендація: якнайближче до оригіналу"><span id="c-ch">0 / 0 зн.</span></div>
      <button class="saveb" id="b-save" aria-label="Надіслати">${I.send}</button>
    </div>
    <div class="wraphint" id="f-wrap" hidden></div>
    <div class="qa-under" id="f-qa"></div>
  </div>
</div></div>`;

export const SIDE_HTML = `<aside class="fs" aria-label="Панель рядка">
  <div class="rz rz-r" id="rz-r" role="separator" aria-orientation="vertical" aria-label="Ширина правої панелі" aria-valuemin="260" aria-valuemax="640" tabindex="0" title="Потягніть, щоб змінити ширину (подвійний клік — стандартна)"></div>
  <div class="itabs" id="stabs" role="toolbar" aria-label="Права панель">
    <button class="on" aria-pressed="true" data-p="panel" title="Переклад, пропозиції, терміни й обговорення рядка">${I.chat}<span class="tl">Рядок</span> <span class="cnt" id="cm-badge" hidden>0</span></button>
  </div>
  <div class="ibody">
    <div class="ph"><span class="grow" id="rp-title">Рядок</span><span class="ico" id="rp-close" title="Сховати панель" role="button" tabindex="0" aria-label="Сховати панель">—</span></div>
    <section class="qa-side" id="qa-side" hidden><div class="lbl">Перевірка рядка</div><div id="i-iss" class="qa-under"></div></section>
    <div class="pane on" id="s-pn" data-title="Рядок">${ROW_PANEL_HTML}</div>
  </div>
</aside>`;

let picToken = 0;
/** Pictures from the game folder for the string (item icons, faces, enemies): desktop only, and only when the project has a game folder. */
function renderPics(ctx: Ctx, u: Unit | undefined): void {
  const host = $('#f-pics'), game = isDesktop() ? rememberedGameDir() : null;
  const token = ++picToken;
  if (!u || !game) { host.hidden = true; host.replaceChildren(); return; }
  const r = realOf(ctx, u);
  const pics: Pic[] = [...picsOfRow(ctx.s.game, r.file, r.key), ...picOfFace(u.face)];
  for (const g of ctx.names().find(u.source).slice(0, 4)) pics.push(...picsOfRow(ctx.s.game, g.file, g.key));
  const seen = new Set<string>();
  const uniq = pics.filter(p => { const k = JSON.stringify(p); if (seen.has(k)) return false; seen.add(k); return true; });
  void Promise.all(uniq.map(async p => ({ p, c: await drawPic(game, p) }))).then(done => {
    if (token !== picToken) return;
    const ok = done.filter(d => d.c);
    host.replaceChildren(...ok.map(({ p, c }) => {
      const fig = document.createElement('figure');
      fig.className = `pic ${p.kind}`;
      c!.setAttribute('role', 'img'); c!.setAttribute('aria-label', p.label || p.kind);
      fig.append(c!);
      if (p.label) { const cap = document.createElement('figcaption'); cap.textContent = p.label; fig.append(cap); }
      return fig;
    }));
    host.hidden = !ok.length;
  });
}
const entryOf = (ctx: Ctx, u: Unit): Entry | undefined => ctx.entries(ctx.s.current!)[u.key];

/** Fill the editing view from state. The textarea is only reset when the unit changed. */
export function renderFocus(ctx: Ctx, desktop: boolean): void {
  const { s } = ctx;
  const u = s.cur ? ctx.unit(s.cur) : undefined;
  const list = ctx.visible();
  const host = $('#v-focus');
  host.classList.toggle('is-empty', !u);
  if (!u) {
    $('#f-key').textContent = '';
    ($('#i-tr') as HTMLTextAreaElement).value = '';
    ($('#i-tr') as HTMLTextAreaElement).disabled = true;
    $('#te-layer').textContent = '';
    $('#f-state').textContent = '';
    $('#f-chips').innerHTML = '';
    renderPics(ctx, undefined);
    $('#f-src').innerHTML = `<span class="hint">${list.length ? 'Оберіть рядок зліва.' : 'За поточним фільтром рядків немає.'}</span>`;
    return;
  }
  ($('#i-tr') as HTMLTextAreaElement).disabled = false;
  const e = entryOf(ctx, u);
  const st = shownStatus(ctx, u, e);
  const pos = list.findIndex(x => x.key === u.key);
  $('#f-key').textContent = `${realOf(ctx, u).file.replace(/\.[^.]+$/, '')} › ${u.context} › ${u.key.replace(/^.*\.list/, 'list')}`;
  $('#f-state').innerHTML = `<span class="sd ${st}"></span>${e?.returned && e.status === 'draft' ? 'повернено на доопрацювання' : STATUS_CAP[st]}`;
  $('#f-off').hidden = pos >= 0;
  const hits = termsIn(u.source, s.saved.terms);
  const have = e?.target ?? '';
  const termMarks = sourceTermHits(u.source, hits).map(h => ({ start: h.start, end: h.end, en: h.term.en, missing: !!have && !targetHasTerm(have, h.term.uk, h.term.alt) }));
  $('#f-src').innerHTML = markupTerms(u.source, [...termMarks, ...nameMarks(u, namesOfRow(ctx, u), termMarks)]);
  $('#f-chips').innerHTML = chipsHtml(ctx, u);
  renderPics(ctx, u);
  const refs = referenceSets(s.saved.reference).map(r => ({ lang: r.lang, text: r.texts[realOf(ctx, u).file]?.[realOf(ctx, u).key] })).filter(r => r.text);
  $('#f-refbox').hidden = !refs.length;
  $('#f-refbox').innerHTML = refs.map(r => `<div class="lbl">Довідка · ${esc(r.lang.toUpperCase())}</div><div class="srcbox ref" lang="${esc(r.lang)}">${esc(r.text!)}</div>`).join('');
  const ta = $('#i-tr') as HTMLTextAreaElement;
  if (document.activeElement !== ta || ta.dataset.key !== u.key) { if (ta.dataset.key !== u.key) hideTermCard(); ta.value = e?.target ?? ''; ta.dataset.key = u.key; }
  refreshTerms(ctx, u);
  meter(ctx, u);
  refreshQa(ctx, u);
  const lab = 'Надіслати';
  $('#b-save').title = lab + ' (Ctrl+Enter)';
  $('#b-save').setAttribute('aria-label', lab);
}

/** Terms of the open row, worked out once per row. */
let rowTerms: { key: string; source: string; terms: ReturnType<typeof termsIn<Ctx['s']['saved']['terms'][number]>> } | null = null;

/**
 * Underlines under the translation field and the state of the terms in the original: every term of the original that
 * the translation renders is underlined where it stands in the translation, and a term the translation lacks is
 * underlined in the original with a wavy line. Called when the row is drawn and as the text changes.
 */
function refreshTerms(ctx: Ctx, u: Unit): void {
  const ta = $('#i-tr') as HTMLTextAreaElement;
  if (!rowTerms || rowTerms.key !== u.key || rowTerms.source !== u.source) rowTerms = { key: u.key, source: u.source, terms: termsIn(u.source, ctx.s.saved.terms) };
  const terms = rowTerms.terms;
  const found = targetTermHits(ta.value, terms).map(h => ({ start: h.start, end: h.end, cls: 'tt', data: { hc: 'term', hk: h.term.en } }));
  for (const m of ta.value.matchAll(CODE_RE)) if (!found.some(x => m.index! < x.end && m.index! + m[0].length > x.start)) found.push({ start: m.index!, end: m.index! + m[0].length, cls: 'tc', data: { hc: 'code', hk: m[0] } });
  found.sort((a, b) => a.start - b.start);
  drawMarks($('#te-layer'), ta.value, found);

  const byEn = new Map(terms.map(t => [t.en, t]));
  document.querySelectorAll<HTMLElement>('#f-src .th').forEach(el => { const t = byEn.get(el.dataset.term ?? ''); if (t) el.classList.toggle('miss', !!ta.value && !targetHasTerm(ta.value, t.uk, t.alt)); });
  autoSize(ta);
  drawLinks(ctx);
}

function meter(ctx: Ctx, u: Unit): void {
  const t = ($('#i-tr') as HTMLTextAreaElement).value;
  const rl = displayLength(u.source), n = displayLength(t);
  const d = Math.abs(lengthDeviation(u.source, t)), tol = ctx.s.saved.settings.tolerancePct;
  $('#c-ch').textContent = `${n} / ${rl} зн.`;
  $('#cnt2').classList.toggle('over', !!t && d > tol);
  $('#cnt2').classList.toggle('mid', !!t && d <= tol && d > tol / 2);
  // A line longer than the game's window is said right under the field, with the way to fix it; so is a message with more lines than the window shows.
  const plan = ctx.wrapPlan(), wide = tooWide(plan, u, t), wh = $('#f-wrap');
  const said: string[] = [];
  if (wide.count) {
    const word = unitWord(plan);
    const auto = plan.settings.mode === 'build' ? `: гра перенесе її сама (≈${plural(linesShown(plan, u, t), ['рядок', 'рядки', 'рядків'])})` : `: ${plural(wide.count, ['рядок', 'рядки', 'рядків'])}`;
    said.push(`<b>Рядок довший за вікно гри</b> (до ${wide.width} ${word})${auto}`);
  }
  const max = plan.settings.maxLines, shown = u.kind === 'dialogue' && max > 0 && t ? linesShown(plan, u, t) : 0;
  if (shown > max) said.push(`<b>${plural(shown, ['рядок', 'рядки', 'рядків'])}</b>, а вікно показує ${max}: гра покаже на кількох сторінках`);
  wh.hidden = !said.length;
  if (said.length) wh.innerHTML = `<span>${said.join(' · ')}</span>${wide.count ? '<button type="button" class="btn" data-wrap>Перенести за шириною</button>' : ''}`;
}

function refreshQa(ctx: Ctx, u: Unit): void {
  const e = entryOf(ctx, u);
  const t = e?.target ?? '';
  const q = qaRows(ctx, u, e);
  $('#f-qa').innerHTML = q.html;
  const st = shownStatus(ctx, u, e);
  const pill = $('#f-state');
  pill.innerHTML = `<span class="sd ${st}"></span>${e?.returned && e.status === 'draft' ? 'повернено на доопрацювання' : STATUS_CAP[st]}`;
}

/** The right zone belongs to the whole editor: it follows the selected row in the table and in the editing view alike. */
export function renderSidePanel(ctx: Ctx): void {
  const { s } = ctx;
  const u = s.cur && s.current ? ctx.unit(s.cur) : undefined;
  renderSide(ctx, u, u ? entryOf(ctx, u) : undefined);
}

function renderSide(ctx: Ctx, u: Unit | undefined, e: Entry | undefined): void {
  const { s } = ctx;
  const open = s.phone || s.sideOn.length > 0;
  document.querySelectorAll<HTMLElement>('#stabs [data-p]').forEach(b => { b.classList.toggle('on', open); b.setAttribute('aria-pressed', String(open)); });
  document.getElementById('v-focus')?.classList.toggle('side-collapsed', !open);
  // In the table there is no editor to carry the remarks of the row: they stand at the top of this zone.
  const q = u && s.mode === 'table' ? qaRows(ctx, u, e) : { html: '', count: 0 };
  $('#qa-side').hidden = !q.count;
  $('#i-iss').innerHTML = q.count ? q.html : '';
  renderRowPanel(ctx, u, e);
  if (!u) { $('#cm-list').innerHTML = ''; $('#cm-badge').hidden = true; $('#pn-cm-n').hidden = true; return; }
  const open0 = openThreads(e);
  for (const id of ['#cm-badge', '#pn-cm-n']) { $(id).textContent = String(open0); $(id).hidden = !open0; }
  renderDiscuss(ctx, `${s.current}|${u.key}`, e);
}

function edit0(ctx: Ctx, u: Unit, text: string): Entry {
  return editFn(entryOf(ctx, u), u, text, ctx.stage(), Date.now());
}

let panelTimer = 0;
/** The panel shows the translation and its versions: after typing it is drawn again (not on every key). */
function refreshPanel(ctx: Ctx, u: Unit): void {
  window.clearTimeout(panelTimer);
  panelTimer = window.setTimeout(() => {
    const cur = ctx.s.cur ? ctx.unit(ctx.s.cur) : undefined;
    if (cur && cur.key === u.key && ctx.s.current && (ctx.s.phone || ctx.s.sideOn.length)) renderRowPanel(ctx, cur, entryOf(ctx, cur));
  }, 250);
}

/** Typing in the editing textarea. */
/** The row being typed into in the editor and what it held before the first keystroke: the whole stay in the field becomes one action of the journal. */
let typing: { file: string; key: string; before: Entry | undefined } | null = null;

/**
 * The typing in the editor is over (the field lost the focus, or a shortcut is about to change the row): what was typed becomes one
 * action of the journal, so Ctrl+Z outside the field takes it back in its place among the other actions, not the one before it.
 */
export function closeTyping(ctx: Ctx): void {
  const t = typing; typing = null;
  if (!t) return;
  const ents = ctx.entries(t.file);
  const now = ents[t.key];
  if (!now || now.target === (t.before?.target ?? '')) return;
  if (t.before) ents[t.key] = t.before; else delete ents[t.key];
  ctx.commit([{ file: t.file, key: t.key, next: now, text: now.target }], 'edit');
  ctx.persist();
}

export function focusInput(ctx: Ctx, ta: HTMLTextAreaElement): void {
  const u = ctx.unit(ta.dataset.key ?? '');
  if (!u || !ctx.s.current) return;
  const ents = ctx.entries(ctx.s.current);
  if (typing && (typing.key !== u.key || typing.file !== ctx.s.current)) closeTyping(ctx);
  if (!typing) typing = { file: ctx.s.current, key: u.key, before: ents[u.key] ? structuredClone(ents[u.key]) : undefined };
  ents[u.key] = edit0(ctx, u, ta.value);
  noteChange(ctx.s, ctx.s.current, u.key);
  ctx.persist();
  refreshTerms(ctx, u);
  meter(ctx, u); refreshQa(ctx, u);
  ctx.softTm(); ctx.refreshTop();
  refreshPanel(ctx, u);
}

/** Change the text of the open row; `kind` makes it an action of the journal that can be taken back from the activity feed. */
function setText(ctx: Ctx, u: Unit, text: string, what: string, kind?: BatchKind): string | undefined {
  closeTyping(ctx);
  const ents = ctx.entries(ctx.s.current!);
  const next = edit0(ctx, u, text);
  let batch: string | undefined;
  if (kind) batch = ctx.commit([{ file: ctx.s.current!, key: u.key, next, text }], kind, what);
  else { ents[u.key] = recordChange(ents[u.key], next, what, text, ctx.s.who, Date.now()); noteChange(ctx.s, ctx.s.current!, u.key); }
  // The field keeps what is typed in it while it has the focus (a shortcut changes the row without leaving it): bring it in line first.
  const card = ctx.s.mode === 'scene' ? document.querySelector<HTMLTextAreaElement>(`.sv-in[data-key="${CSS.escape(u.key)}"]`) : null;
  if (card) card.value = text; else if (ctx.s.mode === 'edit') ($('#i-tr') as HTMLTextAreaElement).value = text;
  ctx.persist(); ctx.invalidateTm(); ctx.render();
  if (card) focusCard(u.key); else if (ctx.s.mode === 'edit') ($('#i-tr') as HTMLTextAreaElement).focus();
  return batch;
}

/** Put a text into the translation: at the caret in the editor, at the end of the translation in the table. */
export function insertText(ctx: Ctx, text: string): void {
  const u = ctx.s.cur ? ctx.unit(ctx.s.cur) : undefined;
  if (!u || !ctx.s.current) { toast('Спершу виберіть рядок'); return; }
  if (ctx.s.mode === 'table') { const have = entryOf(ctx, u)?.target ?? ''; setText(ctx, u, have ? `${have} ${text}` : text, 'вставлено з картки'); }
  else if (ctx.s.mode === 'scene') { const ta = document.querySelector<HTMLTextAreaElement>(`.sv-in[data-key="${CSS.escape(u.key)}"]`); if (ta) insertAtCursor(ta, text); }
  else insertAtCursor($('#i-tr') as HTMLTextAreaElement, text);
}

export function step(ctx: Ctx, dir: 1 | -1): void {
  const list = ctx.visible();
  const i = list.findIndex(x => x.key === ctx.s.cur);
  const next = list[i + dir];
  if (!next) { toast(dir > 0 ? 'Це останній рядок у списку' : 'Це перший рядок у списку'); return; }
  ctx.select(next.key);
}

/**
 * What follows a send of the row `u` (already written as the action `sendBatch`): the rows with the same original are
 * filled in as drafts marked «авто» (see `links.ts` for the project's mode), and the message says what happened, with «Скасувати».
 * Used by the editing view and by Ctrl+Enter in the table.
 */
export function afterSendFollowUp(ctx: Ctx, u: Unit, sendBatch: string, now: number): void {
  const { s } = ctx;
  // What happens to the rows with the same original depends on the project's mode (see `links.ts`): the empty ones are filled
  // at once as one action with its «Скасувати», the ones that differ are offered for a look (or updated, in the automatic mode).
  const real = realOf(ctx, u);
  const sync = afterSend(s.saved, ctx.links(), linkModeOf(s.saved.settings), real.file, real.key, now);
  // The twins are filled in as drafts marked «авто»; a proofread twin is not touched.
  const filled = planOf(ctx.entries, sync.changes, 'link');
  const batch = applyPlan(ctx.commit, filled);
  ctx.persist(); ctx.invalidateTm();
  const look = (): void => openLinkRows(ctx, real.file, real.key);
  const differ = `Зв’язаних рядків відрізняється: ${sync.pending}`;
  const text = 'Надіслано' + (batch ? `. Автозаповнено чернетками: ${plural(filled.changes.length, ['однаковий рядок', 'однакові рядки', 'однакових рядків'])}` : '');
  if (batch) { undoToast(ctx, text, batch); if (sync.pending) toast(differ, { action: { label: 'Переглянути', run: look } }); }
  else if (sync.pending) toast(`${text}. ${differ}`, { action: { label: 'Переглянути', run: look } });
  else undoToast(ctx, text, sendBatch);
}

/** Send the open row and move on to the next one. */
export function send(ctx: Ctx): void {
  const { s } = ctx;
  buzz(12);
  const u = s.cur ? ctx.unit(s.cur) : undefined;
  if (!u || !s.current) return;
  const ents = ctx.entries(s.current);
  const r = submit(ents[u.key], u, 'translate', Date.now(), { blockErrors: s.saved.settings.blockErrors, qa: ctx.qaOpts() });
  if (!r.ok) { if (s.mode === 'scene') sceneBlocked(ctx, u.key, r.reason); else toast(r.reason, { sticky: true }); return; }
  // The row to go on with is chosen BEFORE the send: with the filter «Чернетки» the sent row drops out of the list, and
  // choosing afterwards would jump back to the top of the list instead of the row that follows.
  const before = ctx.visible(), at = before.findIndex(x => x.key === u.key);
  const next = before[at + 1] ?? before[at];
  // A send is an action of the journal like any other: Ctrl+Z and the «Скасувати» of the message take it back.
  const sendBatch = ctx.commit([{ file: s.current, key: u.key, next: r.entry, text: r.entry.target }], 'send');
  afterSendFollowUp(ctx, u, sendBatch, Date.now());
  if (next && next.key !== u.key) ctx.select(next.key); else ctx.render();
}

/** Clicks inside the editing view. Returns true when handled. */
export function focusClick(ctx: Ctx, t: HTMLElement): boolean {
  const { s } = ctx;
  const u = s.cur ? ctx.unit(s.cur) : undefined;
  if (sideClick(ctx, t)) return true;
  if (!u || !s.current) return false;
  const ents = ctx.entries(s.current);
  const ta = $('#i-tr') as HTMLTextAreaElement;
  const tm = t.closest<HTMLElement>('[data-tm]');
  if (tm) { const m = tmMatch(Number(tm.dataset.tm)); if (m) setText(ctx, u, m.t, `підставлено з пам’яті (${m.score}%)`, 'memory'); return true; }
  const go = t.closest<HTMLElement>('[data-goto]');
  if (go) { ctx.select(go.dataset.goto!); return true; }
  if (t.closest('#b-clear')) {
    if (!ta.value && !ents[u.key]?.target) { toast('Переклад уже порожній'); return true; }
    undoToast(ctx, 'Переклад очищено', setText(ctx, u, '', 'очищено', 'clear')); return true;
  }
  if (t.closest('[data-wrap]')) {
    const plan = ctx.wrapPlan();
    if (plan.disabled) { toast('Ширину рядка вимкнено в «Перенесення рядків»'); return true; }
    const r = wrapMessage(plan, u, ta.value);
    if (!r.changed) toast('Рядки вже вміщаються'); else setText(ctx, u, r.text, 'перенесено рядки', 'wrap');
    return true;
  }
  if (t.closest('#b-save')) { send(ctx); return true; }
  const ins = t.closest<HTMLElement>('[data-ins]');
  if (ins) { setText(ctx, u, ta.value + (ins.dataset.ins ?? ''), 'додано керівні коди', 'fix'); return true; }
  return false;
}

/** The buttons of a remark (fix, ignore, bring back): they sit under the editor and in the panel, so they work in the table too. */
export function qaClick(ctx: Ctx, t: HTMLElement): boolean {
  const { s } = ctx;
  const ign = t.closest<HTMLElement>('[data-ign]'), un = t.closest<HTMLElement>('[data-unign]'), fix = t.closest<HTMLElement>('[data-fix]'), tool = t.closest<HTMLElement>('[data-tool]');
  if (tool) { ctx.tool('wrap'); return true; }
  if (!ign && !un && !fix) return false;
  // In the scene the remark belongs to the card it stands in, not to the row that happened to be open.
  const own = t.closest<HTMLElement>('.sv-card')?.dataset.key;
  if (own) s.cur = own;
  const u = s.cur ? ctx.unit(s.cur) : undefined;
  if (!u || !s.current) return true;
  const ents = ctx.entries(s.current);
  const e = ents[u.key];
  if (ign || un) {
    if (e) { ents[u.key] = setIgnored(e, (ign ?? un)!.dataset[ign ? 'ign' : 'unign']!, !!ign, Date.now()); ctx.persist(); ctx.render(); }
    return true;
  }
  const issue = activeIssues(u, { ...(e ?? { mt: 0, status: 'new' as const }), target: e?.target ?? '' }, ctx.qaOpts()).find(i => i.key === fix!.dataset.fix);
  if (issue?.fix) setText(ctx, u, issue.fix.text, `виправлено: ${issue.fix.label}`, 'fix');
  return true;
}

/** Clicks in the right-hand zone. It works with the selected row in the table and in the editing view alike. */
export function sideClick(ctx: Ctx, t: HTMLElement): boolean {
  const { s } = ctx;
  const tab = t.closest<HTMLElement>('#stabs [data-p]');
  if (tab) {
    // The rail button shows the panel or folds the zone to its rail.
    if (s.phone) { s.sideOn = ['panel']; } else { s.sideOn = s.sideOn.length ? [] : ['panel']; s.sideTouched = true; }
    ctx.render(); return true;
  }
  if (t.closest('#rp-close')) { s.sideOn = []; s.sideTouched = true; ctx.render(); return true; }
  if (qaClick(ctx, t)) return true;
  if (!t.closest('.fs')) return false;
  const u = s.cur ? ctx.unit(s.cur) : undefined;
  const ext = t.closest<HTMLElement>('[data-ext]');
  if (ext) { void openLink(ext.dataset.ext!); return true; }
  if (!u || !s.current) return false;
  if (rowPanelClick(ctx, t, (unit, text, what, kind) => setText(ctx, unit, text, what, kind))) return true;
  if (historyClick(ctx, t, (unit, text, what) => setText(ctx, unit, text, what))) return true;
  if (discussClick(ctx, t)) return true;
  return false;
}
