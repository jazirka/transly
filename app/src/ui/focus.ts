import { gorohUrl, multitranUrl, wordsOf, activeIssues, byHintOrder, buildSceneIndex, check, describePage, explainCodes, usageKey, displayLength, edit as editFn, lengthDeviation, limitFor, newBatch, openThreads, propagate, recordChange, referenceSets, sceneAt, sendBack, setIgnored, sourceChanged, submit, termsIn, wrapLines, HINT_GLYPH, HINT_GROUP, HINT_LABEL } from '../core';
import type { BatchKind, Entry, SceneIndex, Unit } from '../core';
import { $, buzz, esc, plural, toast } from './dom';
import { discussClick, renderDiscuss } from './discuss';
import { historyClick, renderHistory } from './history-panel';
import { markup } from './markup';
import { isDesktop, openLink, rememberedGameDir } from './desktop';
import { drawPic, picOfFace, picsOfRow } from './gameimg';
import type { Pic } from './gameimg';
import { openScene } from './scene-dialog';
import { GROUP, SEP, STATUS_CAP, shownStatus, splitKey } from './state';
import type { Ctx, SideTab } from './state';

const I = {
  copy: '<svg viewBox="0 0 16 16"><rect x="5.5" y="5.5" width="8" height="8" rx="1"/><path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2"/></svg>',
  clear: '<svg viewBox="0 0 16 16"><path d="M3 4.5h10M6.5 4.5v-1.5h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5"/></svg>',
  code: '<svg viewBox="0 0 16 16"><path d="M6 3H3.5v10H6M10 3h2.5v10H10M8 5v6"/></svg>',
  play: '<svg viewBox="0 0 16 16"><path d="M5 3.5l8 4.5-8 4.5z" fill="currentColor" stroke="none"/></svg>',
  back: '<svg viewBox="0 0 16 16"><path d="M14 2L7 9M14 2l-4.5 12L7 9 2 6.5z"/></svg>',
  up: '<svg viewBox="0 0 16 16"><path d="M4 9.5L8 5.5l4 4"/></svg>',
  down: '<svg viewBox="0 0 16 16"><path d="M4 6.5L8 10.5l4-4"/></svg>',
  ok: '<svg viewBox="0 0 16 16"><path d="M3 8.5l3.2 3.2L13 4.8"/></svg>',
  scene: '<svg viewBox="0 0 16 16"><rect x="2.5" y="3" width="11" height="6" rx="1.5"/><rect x="2.5" y="11" width="7" height="2.5" rx="1"/></svg>',
  compact: '<svg viewBox="0 0 16 16"><path d="M3 6V3h3M13 6V3h-3M3 10v3h3M13 10v3h-3"/></svg>',
  wrap: '<svg viewBox="0 0 16 16"><path d="M2.5 4h11M2.5 8h8.5a2.5 2.5 0 0 1 0 5H8M9.5 11l-1.7 2 1.7 2M2.5 12h2"/></svg>',
  hint: '<svg viewBox="0 0 16 16"><path d="M8 2.5a4 4 0 0 0-2.2 7.3c.5.4.7.9.7 1.4v.3h3v-.3c0-.5.2-1 .7-1.4A4 4 0 0 0 8 2.5zM6.5 13.5h3"/></svg>',
  chat: '<svg viewBox="0 0 16 16"><path d="M3 3.5h10v7H8.5L6 13v-2.5H3z"/></svg>',
  clock: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5"/><path d="M8 5v3.2l2 1.3"/></svg>',
};

/** Static skeleton of the editing view; renderFocus() fills the pieces so the textarea keeps focus while typing. */
export const FOCUS_HTML = `<div class="fc"><div class="fc-in">
  <div class="fhd"><span class="k" id="f-key"></span><span class="st-pill" id="f-state"></span></div>
  <div class="fnav">
    <span class="stepper" role="group" aria-label="Перехід між рядками списку"><button class="ib sm" id="f-prev" title="Попередній рядок у списку (Alt+↑)" aria-label="Попередній рядок">${I.up}</button><span class="queue" id="f-queue"></span><button class="ib sm" id="f-next" title="Наступний рядок у списку (Alt+↓)" aria-label="Наступний рядок">${I.down}</button></span>
    <button class="ib lab" id="b-scene" title="Переглянути сцену: усі рядки події поспіль, як у грі" aria-label="Переглянути сцену">${I.scene}<span class="tl">Сцена</span></button>
  </div>
  <div class="offlist" id="f-off" hidden><span>Цей рядок не входить у поточний фільтр або пошук.</span><button data-reset>Показати всі рядки</button></div>
  <div class="ctxstrip" id="c-before" aria-label="Що було перед цим рядком у сцені" hidden></div>
  <div><div class="lbl">Оригінал · EN</div><div class="srcbox" id="f-src"></div><div class="pics" id="f-pics" hidden></div></div>
  <div id="f-refbox" hidden></div>
  <div class="trblock">
    <div class="lbl"><span id="f-trlbl">Переклад · UK</span><button class="lbl-btn" id="b-copy" title="Вставити оригінал у переклад (Alt+O)" aria-label="Вставити оригінал у переклад">${I.copy}<span>Вставити оригінал</span></button></div>
    <textarea class="tr-in" id="i-tr" spellcheck="false" aria-label="Переклад"></textarea>
    <div class="edbar">
      <button class="ib lab" id="b-compact" title="Лише текст: сховати контекст і примітки" aria-label="Режим лише тексту">${I.compact}<span class="tl">Лише текст</span></button>
      <details class="more"><summary class="ib" title="Ще дії" aria-label="Ще дії">⋯</summary><div class="morep">
        <button id="b-code" title="Вставити відсутні керівні коди з оригіналу">${I.code}<span>Вставити керівні коди</span></button>
        <button id="b-wrap" title="Перенести рядки за шириною вікна гри">${I.wrap}<span>Перенести рядки за шириною</span></button>
        <hr><button class="danger" id="b-clear" title="Очистити переклад (можна скасувати)">${I.clear}<span>Очистити переклад</span></button>
      </div></details>
      <span class="vsep" aria-hidden="true"></span><button class="ib" id="b-play" title="Зібрати й перевірити в грі (F5)" aria-label="Перевірити в грі" hidden>${I.play}</button>
      <button class="ib" id="b-return" title="Повернути перекладачу" aria-label="Повернути перекладачу" hidden>${I.back}</button>
      <span class="grow"></span>
      <span class="qab" id="qa-badge" title="Активні проблеми QA в рядку" hidden></span>
      <div class="cnt2" id="cnt2" title="Знаків у перекладі / в оригіналі. Рекомендація: якнайближче до оригіналу"><span id="c-ch">0 / 0 зн.</span></div>
      <button class="saveb" id="b-save" aria-label="Надіслати на вичитування">${I.ok}</button>
    </div>
    <div class="qa-under" id="f-qa"></div>
    <div class="proof" id="f-proof" hidden style="margin-top:10px"></div>
  </div>
  <div class="ctxstrip" id="c-after" aria-label="Що буде після цього рядка в сцені" hidden></div>
</div></div>`;

const hg = (cat: keyof typeof HINT_GLYPH): string => `<span class="hg" aria-hidden="true">${HINT_GLYPH[cat]}</span>`;

export const SIDE_HTML = `<aside class="fs" aria-label="Підказки та обговорення рядка">
  <div class="rz rz-r" id="rz-r" role="separator" aria-orientation="vertical" aria-label="Ширина правої панелі" aria-valuemin="260" aria-valuemax="640" tabindex="0" title="Потягніть, щоб змінити ширину (подвійний клік — стандартна)"></div>
  <div class="itabs" id="stabs" role="toolbar" aria-label="Панелі правої зони">
    <button class="on" aria-pressed="true" data-p="s-tm" title="Підказки: терміни, контекст, довідка">${I.hint}<span class="tl">Підказки</span></button><hr class="ssep">
    <button aria-pressed="false" data-p="s-sim" title="Схожі переклади з пам’яті й однакові рядки">${I.copy}<span class="tl">Схожі</span></button><hr class="ssep">
    <button aria-pressed="false" data-p="s-cm" title="Обговорення рядка">${I.chat}<span class="tl">Обговорення</span> <span class="cnt" id="cm-badge" hidden>0</span></button><hr class="ssep">
    <button aria-pressed="false" data-p="s-hi" title="Історія змін рядка: порівняння й відновлення">${I.clock}<span class="tl">Історія</span></button>
  </div>
  <div class="ibody">
    <div class="ph"><span class="grow" id="rp-title">Підказки</span><span class="ico" id="rp-close" title="Сховати панель" role="button" tabindex="0" aria-label="Сховати панель">—</span></div>
    <div class="pane on" id="s-tm" data-title="Підказки"><div class="ph card-ph"><span class="grow">Підказки</span><span class="ico" data-hide-pane="s-tm" role="button" tabindex="0" aria-label="Сховати панель «Підказки»" title="Сховати">—</span></div>
      <div class="hint" id="h-none">Оберіть рядок.</div>
      <section class="hsec" id="hs-err" hidden><h4 class="hh error">${hg('error')}${HINT_GROUP.error} і ${HINT_GROUP.style.toLowerCase()}<span class="n" id="hn-err"></span></h4><div id="i-iss" class="qa-under"></div></section>
      <section class="hsec" id="hs-term" hidden><h4 class="hh term">${hg('term')}${HINT_GROUP.term}<span class="n" id="hn-term"></span></h4><div id="i-gl"></div><div id="i-gn"></div></section>
      <section class="hsec" id="hs-ctx" hidden><h4 class="hh context">${hg('context')}${HINT_GROUP.context}</h4><div id="i-ctx"></div></section>
      <section class="hsec" id="hs-ref" hidden><h4 class="hh info">${hg('info')}${HINT_GROUP.info}<span class="r" id="dc-kind"></span></h4><div id="i-dc"></div></section>
    </div>
    <div class="rz rz-p" data-rzp="0" role="separator" aria-orientation="horizontal" aria-label="Розділ між панелями" aria-valuenow="50" aria-valuemin="10" aria-valuemax="90" tabindex="0" hidden></div>
    <div class="pane" id="s-sim" data-title="Схожі"><div class="ph card-ph"><span class="grow">Схожі</span><span class="ico" data-hide-pane="s-sim" role="button" tabindex="0" aria-label="Сховати панель «Схожі»" title="Сховати">—</span></div>
      <div><div class="lbl">Пам’ять перекладів <span class="r" id="tm-n"></span></div><div id="i-tm"></div></div>
      <div id="same-box" hidden><div class="lbl">Однакові рядки в грі <span class="r" id="same-n"></span></div><div id="i-same"></div></div>
    </div>
    <div class="rz rz-p" data-rzp="1" role="separator" aria-orientation="horizontal" aria-label="Розділ між панелями" aria-valuenow="50" aria-valuemin="10" aria-valuemax="90" tabindex="0" hidden></div>
    <div class="pane" id="s-cm" data-title="Обговорення"><div class="ph card-ph"><span class="grow">Обговорення</span><span class="ico" data-hide-pane="s-cm" role="button" tabindex="0" aria-label="Сховати панель «Обговорення»" title="Сховати">—</span></div>
      <div id="cm-list" class="cm-list"></div>
      <div class="cm-new"><textarea class="cmin" id="cm-in" placeholder="Нове обговорення цього рядка…" aria-label="Новий коментар"></textarea>
      <div class="actions" style="margin-top:0"><button class="btn" id="cm-add">Коментувати</button><span class="hint">Ctrl+Enter</span></div></div>
    </div>
    <div class="rz rz-p" data-rzp="2" role="separator" aria-orientation="horizontal" aria-label="Розділ між панелями" aria-valuenow="50" aria-valuemin="10" aria-valuemax="90" tabindex="0" hidden></div>
    <div class="pane" id="s-hi" data-title="Історія"><div class="ph card-ph"><span class="grow">Історія</span><span class="ico" data-hide-pane="s-hi" role="button" tabindex="0" aria-label="Сховати панель «Історія»" title="Сховати">—</span></div><div class="hist" id="hist-list"></div></div>
  </div>
</aside>`;

const when = (t: number) => new Date(t).toLocaleString('uk-UA', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const stageOf = (ctx: Ctx): 'review' | 'translate' => ctx.stage();
/** The file and key a row really belongs to: in a group of files the row's key carries its file. */
const realOf = (ctx: Ctx, u: Unit): { file: string; key: string } => splitKey(u.key) ?? { file: ctx.s.current!, key: u.key };
let gorohKind: 'Тлумачення' | 'Синоніми' = 'Тлумачення';
const KIND_LABEL: Record<Unit['kind'], string> = { dialogue: 'діалог', choice: 'варіант вибору', scroll: 'прокрутний текст', name: 'назва', description: 'опис', message: 'повідомлення', term: 'термін гри' };
const oneLine = (t: string, n = 90): string => { const f = t.replace(/\s+/g, ' ').trim(); return f.length > n ? f.slice(0, n) + '…' : f; };

/** Words of the original (Multitran) and of the translation (Goroh) as links: they open in the browser. */
function renderDict(u: Unit, target: string): void {
  const en = wordsOf(u.source), uk = wordsOf(target);
  $('#hs-ref').hidden = !en.length && !uk.length;
  $('#dc-kind').innerHTML = `<button class="lnk" data-gk="${gorohKind === 'Тлумачення' ? 'Синоніми' : 'Тлумачення'}" title="Що відкривати для слів перекладу на Гороху">Горох: ${gorohKind.toLowerCase()}</button>`;
  const chip = (w: string, url: string): string => `<button class="wchip" data-ext="${esc(url)}" title="Відкрити в браузері">${esc(w)}</button>`;
  $('#i-dc').innerHTML = `<div class="wrow"><small class="hint">Multitran</small>${en.map(w => chip(w, multitranUrl(w))).join('')}</div>${uk.length ? `<div class="wrow"><small class="hint">Горох</small>${uk.map(w => chip(w, gorohUrl(w, gorohKind))).join('')}</div>` : ''}`;
}

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

export const SIDE_ORDER: SideTab[] = ['hints', 'similar', 'comments', 'history'];
const PANE: Record<SideTab, string> = { hints: 's-tm', similar: 's-sim', comments: 's-cm', history: 's-hi' };
const TAB_OF: Record<string, SideTab> = { 's-tm': 'hints', 's-sim': 'similar', 's-cm': 'comments', 's-hi': 'history' };
const PANE_TITLE: Record<SideTab, string> = { hints: 'Підказки', similar: 'Схожі', comments: 'Обговорення', history: 'Історія' };
/** Switch a panel on (keeping the fixed order) / off. */
export const showSide = (on: SideTab[], t: SideTab): SideTab[] => (on.includes(t) ? on : SIDE_ORDER.filter(x => x === t || on.includes(x)));
export const hideSide = (on: SideTab[], t: SideTab): SideTab[] => on.filter(x => x !== t);

let tmCur: { t: string; score: number }[] = [];
let gameNames: { file: string; key: string; name: string }[] = [];
let sameRows: { file: string; key: string }[] = [];

const sceneCache = new WeakMap<object, SceneIndex | null>();
/** The scenes of a file, worked out once for as long as the file's rows are the same. */
export function scenesOf(units: Unit[]): SceneIndex | null {
  let s = sceneCache.get(units);
  if (s === undefined) { s = buildSceneIndex(units); sceneCache.set(units, s); }
  return s;
}

/**
 * Two lines before and after the open row, from the same scene: what was just said and what comes next. Files without
 * scenes (database, text formats) have no such strip: their neighbouring rows have nothing to do with each other.
 */
function renderContext(ctx: Ctx, u: Unit): void {
  const r = realOf(ctx, u);
  const before = $('#c-before'), after = $('#c-after');
  const v = ctx.s.views.find(x => x.name === r.file);
  const sc = v ? sceneAt(scenesOf(v.units), r.key) : null;
  const i = sc ? sc.units.findIndex(x => x.key === r.key) : -1;
  if (!sc || i < 0) { before.hidden = after.hidden = true; return; }
  const ents = ctx.entries(r.file);
  const line = (x: Unit): string => {
    const e = ents[x.key];
    const st = shownStatus(ctx, x, e);
    const key = ctx.s.current === GROUP ? r.file + SEP + x.key : x.key;
    return `<button class="cl" data-goto="${esc(key)}" title="${esc(e?.target ? `Переклад: ${e.target}` : 'Ще не перекладено')}"><span class="sd ${st}" aria-hidden="true"></span>${ctx.speaker(x) ? `<span class="cl-w">${esc(ctx.speaker(x))}</span>` : ''}<span class="cl-t">${esc(oneLine(x.source))}</span></button>`;
  };
  const b = sc.units.slice(Math.max(0, i - 2), i), a = sc.units.slice(i + 1, i + 3);
  before.hidden = !b.length; after.hidden = !a.length;
  before.innerHTML = `<div class="cl-h">Перед цим рядком · ${i + 1} із ${sc.units.length} у сцені</div>${b.map(line).join('')}`;
  after.innerHTML = `<div class="cl-h">Далі в сцені</div>${a.map(line).join('')}`;
}

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
    $('#f-state').textContent = '';
    $('#f-queue').textContent = '';
    $('#c-before').hidden = true; $('#c-after').hidden = true;
    renderPics(ctx, undefined);
    $('#f-src').innerHTML = `<span class="hint">${list.length ? 'Оберіть рядок зліва.' : s.mode === 'review' ? 'Немає рядків, які очікують вичитування.' : 'За поточним фільтром рядків немає.'}</span>`;
    return;
  }
  ($('#i-tr') as HTMLTextAreaElement).disabled = false;
  const e = entryOf(ctx, u);
  const st = shownStatus(ctx, u, e);
  const review = ctx.stage() === 'review';
  const pos = list.findIndex(x => x.key === u.key);
  $('#f-key').textContent = `${realOf(ctx, u).file.replace(/\.[^.]+$/, '')} › ${u.context}${ctx.speaker(u) ? ' › ' + ctx.speaker(u) : ''} › ${u.key.replace(/^.*\.list/, 'list')}`;
  $('#f-state').innerHTML = `<span class="sd ${st}"></span>${e?.returned && e.status === 'draft' ? 'повернено на доопрацювання' : STATUS_CAP[st]}`;
  $('#f-queue').textContent = pos >= 0 ? `Рядок ${pos + 1} з ${list.length}` : '';
  $('#f-queue').title = pos >= 0 ? `Рядок ${pos + 1} із ${list.length} у поточному списку (з урахуванням фільтрів)` : '';
  $('#f-off').hidden = pos >= 0;
  const hits = termsIn(u.source, s.saved.terms);
  $('#f-src').innerHTML = markup(u.source, hits.map(t => t.en));
  renderPics(ctx, u);
  renderContext(ctx, u);
  const refs = referenceSets(s.saved.reference).map(r => ({ lang: r.lang, text: r.texts[realOf(ctx, u).file]?.[realOf(ctx, u).key] })).filter(r => r.text);
  $('#f-refbox').hidden = !refs.length;
  $('#f-refbox').innerHTML = refs.map(r => `<div class="lbl">Довідка · ${esc(r.lang.toUpperCase())}</div><div class="srcbox ref" lang="${esc(r.lang)}">${esc(r.text!)}</div>`).join('');
  $('#f-trlbl').textContent = review ? 'Після вичитування · UK' : 'Переклад · UK';
  const ta = $('#i-tr') as HTMLTextAreaElement;
  if (document.activeElement !== ta || ta.dataset.key !== u.key) { ta.value = e?.target ?? ''; ta.dataset.key = u.key; }
  meter(ctx, u);
  refreshQa(ctx, u);
  const pf = $('#f-proof');
  pf.hidden = !review;
  if (review) pf.innerHTML = `<div class="lbl">Версія перекладача</div><div class="t">${esc(e?.orig ?? '—')}${e && e.orig !== undefined && e.orig !== e.target ? '<span class="chg">змінено вичитуванням</span>' : ''}</div>`;
  const lab = review ? 'Затвердити' : 'Надіслати на вичитування';
  $('#b-save').title = lab + ' (Ctrl+Enter)';
  $('#b-save').setAttribute('aria-label', lab);
  $('#b-return').hidden = !review;
  $('#b-play').hidden = !desktop;
  const limit = u.kind === 'dialogue' || u.kind === 'scroll' ? limitFor(ctx.lineLimit(), u.face) : 0;
  $('#b-wrap').hidden = !limit;
}

function meter(ctx: Ctx, u: Unit): void {
  const t = ($('#i-tr') as HTMLTextAreaElement).value;
  const rl = displayLength(u.source), n = displayLength(t);
  const d = Math.abs(lengthDeviation(u.source, t)), tol = ctx.s.saved.settings.tolerancePct;
  $('#c-ch').textContent = `${n} / ${rl} зн.`;
  $('#cnt2').classList.toggle('over', !!t && d > tol);
  $('#cnt2').classList.toggle('mid', !!t && d <= tol && d > tol / 2);
}

/** The remarks of a row, most important first, each with its kind named and drawn (not only coloured). Shared by the editor and the panel. */
function qaRows(ctx: Ctx, u: Unit, e: Entry | undefined): { html: string; count: number } {
  const t = e?.target ?? '';
  const opts = ctx.qaOpts();
  const iss = byHintOrder(activeIssues(u, e, opts));
  const ignored = e?.ign?.length ? check(u, e.target, opts).filter(i => e.ign?.includes(i.key)) : [];
  const kind = (c: keyof typeof HINT_GLYPH): string => `<span class="kind k-${c}" title="${HINT_LABEL[c]}"><span aria-hidden="true">${HINT_GLYPH[c]}</span> ${HINT_LABEL[c]}</span>`;
  let h = '';
  if (sourceChanged(e, u)) h += `<div class="qa-row warn cat-context">${kind('context')}<span class="qa-msg">Оригінал змінено в грі після перекладу. Було: «${esc(e?.src ?? '')}». Перевірте переклад</span></div>`;
  if (t) {
    if (!iss.length) h += `<div class="qa-row good"><span class="dot"></span>${ignored.length ? 'QA: активних проблем немає' : 'QA: проблем не знайдено'}</div>`;
    h += iss.map(x => `<div class="qa-row ${x.severity} cat-${x.cat}">${kind(x.cat)}<span class="qa-msg">${esc(x.message)}</span><span class="qa-act">${x.fix ? `<button class="fix" data-fix="${esc(x.key)}" title="Застосувати виправлення (можна скасувати в історії рядка)">${esc(x.fix.label)}</button>` : ''}<button class="ign" data-ign="${x.key}" title="Не вважати проблемою для цього рядка">Ігнорувати</button></span></div>`).join('');
    h += ignored.map(x => `<div class="qa-row muted"><span class="dot"></span><span class="qa-msg">${esc(x.message)}</span><span class="qa-act"><span class="tagi">ігноровано</span><button class="ign" data-unign="${x.key}">Повернути</button></span></div>`).join('');
  }
  return { html: h, count: t ? iss.length : 0 };
}

function refreshQa(ctx: Ctx, u: Unit): void {
  const e = entryOf(ctx, u);
  const t = e?.target ?? '';
  const q = qaRows(ctx, u, e);
  $('#f-qa').innerHTML = q.html;
  $('#qa-badge').hidden = !t || !q.count;
  $('#qa-badge').textContent = String(q.count);
  const st = shownStatus(ctx, u, e);
  const pill = $('#f-state');
  pill.innerHTML = `<span class="sd ${st}"></span>${e?.returned && e.status === 'draft' ? 'повернено на доопрацювання' : STATUS_CAP[st]}`;
}

/** The right zone belongs to the whole editor: it follows the selected row in the table and in the editing view alike. */
export function renderSidePanel(ctx: Ctx): void {
  const { s } = ctx;
  const u = s.cur && s.current ? ctx.unit(s.cur) : undefined;
  renderSide(ctx, u, u ? entryOf(ctx, u) : undefined, u ? termsIn(u.source, s.saved.terms) : []);
}

/** Terms of the row, names the game itself defines, and the facts about the line, in the order of their importance. */
function renderHints(ctx: Ctx, u: Unit, e: Entry | undefined, hits: ReturnType<typeof termsIn<Ctx['s']['saved']['terms'][number]>>): void {
  const { s } = ctx;
  const r = realOf(ctx, u);
  $('#h-none').hidden = true;
  // Mistakes and recommendations sit under the editor while it is open; in the table the panel is the only place for them.
  const q = s.mode === 'table' ? qaRows(ctx, u, e) : { html: '', count: 0 };
  $('#hs-err').hidden = !q.count;
  $('#hn-err').textContent = q.count ? String(q.count) : '';
  $('#i-iss').innerHTML = q.count ? q.html : '';
  const term = (g: (typeof hits)[number]): string => `<div class="hc term"><div class="hc-h">${`<span class="hg" aria-hidden="true">${HINT_GLYPH.term}</span>`}<b>${esc(g.en)}</b><span class="arr">→</span><span class="uk">${esc(g.uk)}</span>${g.kind ? `<span class="kchip" title="Категорія терміна">${esc(g.kind)}</span>` : ''}</div>${g.alt?.length ? `<div class="hc-b">також: ${esc(g.alt.join(', '))}</div>` : ''}${g.note ? `<div class="hc-b">${esc(g.note)}</div>` : ''}</div>`;
  $('#i-gl').innerHTML = hits.map(term).join('');
  const gn = ctx.names().find(u.source).filter(g => !(g.file === r.file && g.key === r.key));
  gameNames = gn;
  $('#i-gn').innerHTML = gn.map((g, n) => {
    const t = ctx.entries(g.file)[g.key]?.target;
    const file = `<span class="kchip" title="Назва з бази гри: файл ${esc(g.file)}">${esc(g.file.replace(/\.json$/, ''))}</span>`;
    const g0 = `<span class="hg" aria-hidden="true">${HINT_GLYPH.term}</span>`;
    return t
      ? `<div class="hc term gn" data-gn="${n}" role="button" tabindex="0" title="Вставити в переклад"><div class="hc-h">${g0}<b>${esc(g.name)}</b><span class="arr">→</span><span class="uk">${esc(t)}</span>${file}</div></div>`
      : `<div class="hc term gn pending"><div class="hc-h">${g0}<b>${esc(g.name)}</b>${file}</div><div class="hc-b">Назва з гри ще не перекладена. <button class="lnk" data-gogn="${n}">Перейти до неї</button></div></div>`;
  }).join('');
  const nTerms = hits.length + gn.length;
  $('#hs-term').hidden = !nTerms;
  $('#hn-term').textContent = nTerms ? String(nTerms) : '';

  const actor = (n: number) => { const a = s.views.find(v => v.name === 'Actors.json')?.units.find(x => x.key === `[${n}].name`); return a ? s.saved.files['Actors.json']?.[a.key]?.target || a.source : undefined; };
  const codes = explainCodes(u.source, actor, s.saved.sysNames);
  const uk = usageKey(r.file, r.key);
  const used = uk ? ctx.usage().get(uk) ?? [] : [];
  const sc = scenesOf(s.views.find(v => v.name === r.file)?.units ?? []);
  const first = sc ? sceneAt(sc, r.key)?.units[0] : undefined;
  const cond = first?.page ? describePage(first.page, s.saved.sysNames).slice(0, 4).join('; ') : '';
  const label = ctx.view()?.label ?? s.views.find(v => v.name === r.file)?.label;
  const limit = u.kind === 'dialogue' || u.kind === 'scroll' ? limitFor(ctx.lineLimit(), u.face) : 0;
  const same = ctx.dups().others(r.file, r.key).length;
  const fact = (k: string, v: string): string => `<div class="fact"><dt>${k}</dt><dd>${v}</dd></div>`;
  const facts = [
    fact('Тип', esc(KIND_LABEL[u.kind] ?? u.kind)),
    ctx.speaker(u) ? fact('Мовець', esc(ctx.speaker(u))) : '',
    cond ? fact('Умови сторінки', esc(cond)) : '',
    label ? fact('Місцевість', esc(label)) : '',
    u.note ? fact('Позначка розробників', esc(u.note)) : '',
    limit ? fact('Ширина рядка', `до ${limit} символів${u.face ? ' (поруч обличчя)' : ''}`) : '',
    u.dbNote ? fact('Примітка в базі', `<code>${esc(u.dbNote)}</code>`) : '',
    used.length ? fact('Гравець отримує в', used.map(esc).join('; ')) : '',
    same ? fact('Однакових рядків у грі', `${same} · <button class="lnk" data-side="similar">показати</button>`) : '',
  ].filter(Boolean).join('');
  const codeRows = codes.length ? `<div class="lbl">Коди в рядку</div>${codes.map(c => `<div class="gloss-row"><b>${esc(c.code)}</b><span class="arr">→</span><span>${esc(c.meaning)}</span></div>`).join('')}` : '';
  $('#i-ctx').innerHTML = `<dl class="facts">${facts}</dl>${codeRows}`;
  $('#hs-ctx').hidden = !facts && !codeRows;
  renderDict(u, e?.target ?? '');
}

/** Memory matches and the rows of the game that have exactly the same original. */
function renderSimilar(ctx: Ctx, u: Unit, e: Entry | undefined): void {
  const r = realOf(ctx, u);
  const m = ctx.tm().find(u.source, { min: 50, limit: 6, exclude: x => x.s === u.source && x.t === (e?.target ?? '') });
  tmCur = m;
  $('#tm-n').textContent = m.length ? plural(m.length, ['збіг', 'збіги', 'збігів']) : '';
  $('#i-tm').innerHTML = m.length ? m.map((x, n) => `<div class="sg" data-tm="${n}" role="button" tabindex="0" title="Підставити в переклад"><span class="pc ${x.score >= 90 ? '' : 'mid'}">${x.score}%</span><div>${esc(x.t)}<small>${esc(x.src)} · «${esc(x.s.length > 38 ? x.s.slice(0, 38) + '…' : x.s)}»</small></div></div>`).join('') : '<div class="hint">Збігів у пам’яті перекладів немає</div>';
  sameRows = ctx.dups().others(r.file, r.key);
  $('#same-box').hidden = !sameRows.length;
  $('#same-n').textContent = sameRows.length ? String(sameRows.length) : '';
  $('#i-same').innerHTML = sameRows.slice(0, 12).map((x, n) => {
    const t = ctx.entries(x.file)[x.key]?.target;
    return `<div class="sg same" data-same="${n}" role="button" tabindex="0" title="Перейти до цього рядка"><span class="pc eq" aria-hidden="true">=</span><div>${t ? esc(oneLine(t)) : '<span class="hint">ще не перекладено</span>'}<small>${esc(x.file.replace(/\.json$/, ''))} · ${esc(x.key.replace(/^.*\.list/, 'list'))}</small></div></div>`;
  }).join('') + (sameRows.length > 12 ? `<div class="hint">Показано 12 із ${sameRows.length}.</div>` : '');
}

function renderSide(ctx: Ctx, u: Unit | undefined, e: Entry | undefined, hits: ReturnType<typeof termsIn<Ctx['s']['saved']['terms'][number]>>): void {
  const { s } = ctx;
  const on = s.phone ? [s.sideTab] : s.sideOn;
  const tab = on[0] ?? s.sideTab;
  const all = on.length > 1;
  const open = s.phone || on.length > 0;
  const idOf = (t: SideTab): string => PANE[t];
  document.querySelectorAll<HTMLElement>('#stabs [data-p]').forEach(b => { const isOn = on.some(t => idOf(t) === b.dataset.p); b.classList.toggle('on', isOn); b.setAttribute('aria-pressed', String(isOn)); });
  document.querySelectorAll<HTMLElement>('.ibody .pane').forEach(p => p.classList.toggle('on', on.some(t => idOf(t) === p.id)));
  // A splitter sits before every shown panel that has another shown panel above it.
  document.querySelectorAll<HTMLElement>('.ibody .rz-p').forEach(d => { const pane = d.nextElementSibling as HTMLElement | null; const k = pane ? SIDE_ORDER.findIndex(t => idOf(t) === pane.id) : -1; d.hidden = !(k > 0 && on.some(t => idOf(t) === pane?.id) && on.some(t => SIDE_ORDER.indexOf(t) < k)); });
  const fsEl = document.querySelector<HTMLElement>('.fs');
  fsEl?.classList.toggle('stack', all);
  document.getElementById('v-focus')?.classList.toggle('side-collapsed', !open);
  $('#rp-title').textContent = all ? 'Панелі' : PANE_TITLE[tab];
  const show = (t: SideTab): boolean => on.includes(t);
  const hintEmpty = '<div class="hint">Оберіть рядок.</div>';
  if (!u) {
    $('#h-none').hidden = false;
    for (const id of ['#hs-err', '#hs-term', '#hs-ctx', '#hs-ref', '#same-box']) $(id).hidden = true;
    $('#i-tm').innerHTML = ''; $('#tm-n').textContent = '';
    $('#cm-list').innerHTML = hintEmpty; $('#hist-list').innerHTML = hintEmpty;
    $('#cm-badge').hidden = true;
    return;
  }
  const row = `${s.current}|${u.key}`;
  const open0 = openThreads(e);
  $('#cm-badge').textContent = String(open0); $('#cm-badge').hidden = !open0;
  if (show('hints')) renderHints(ctx, u, e, hits);
  if (show('similar')) renderSimilar(ctx, u, e);
  if (show('comments')) renderDiscuss(ctx, row, e);
  if (show('history')) renderHistory(ctx, row, e);
}

function edit0(ctx: Ctx, u: Unit, text: string): Entry {
  return editFn(entryOf(ctx, u), u, text, stageOf(ctx), Date.now());
}

let historyTimer = 0;
/** The history marks which version the field holds and offers the others: after typing it is drawn again (not on every key). */
function refreshHistory(ctx: Ctx, u: Unit): void {
  if (!(ctx.s.phone ? ctx.s.sideTab === 'history' : ctx.s.sideOn.includes('history'))) return;
  window.clearTimeout(historyTimer);
  historyTimer = window.setTimeout(() => {
    const cur = ctx.s.cur ? ctx.unit(ctx.s.cur) : undefined;
    if (cur && cur.key === u.key && ctx.s.current) renderHistory(ctx, `${ctx.s.current}|${u.key}`, entryOf(ctx, u));
  }, 200);
}

/** Typing in the editing textarea. */
export function focusInput(ctx: Ctx, ta: HTMLTextAreaElement): void {
  const u = ctx.unit(ta.dataset.key ?? '');
  if (!u || !ctx.s.current) return;
  const ents = ctx.entries(ctx.s.current);
  ents[u.key] = edit0(ctx, u, ta.value);
  ctx.s.sess.n++;
  ctx.persist();
  meter(ctx, u); refreshQa(ctx, u);
  ctx.softTm();
  refreshHistory(ctx, u);
}

/** Change the text of the open row; `kind` makes it an action of the journal that can be taken back from the activity feed. */
function setText(ctx: Ctx, u: Unit, text: string, what: string, kind?: BatchKind): void {
  const ents = ctx.entries(ctx.s.current!);
  const next = edit0(ctx, u, text);
  if (kind) ctx.commit([{ file: ctx.s.current!, key: u.key, next, text }], kind, what);
  else { ents[u.key] = recordChange(ents[u.key], next, what, text, ctx.s.who, Date.now()); ctx.s.sess.n++; }
  // The field keeps what is typed in it while it has the focus (a shortcut changes the row without leaving it): bring it in line first.
  if (ctx.s.mode !== 'table') ($('#i-tr') as HTMLTextAreaElement).value = text;
  ctx.persist(); ctx.invalidateTm(); ctx.render();
  if (ctx.s.mode !== 'table') ($('#i-tr') as HTMLTextAreaElement).focus();
}

/** Put the original into the translation (the button in the corner of the field, Alt+O). */
export function insertOriginal(ctx: Ctx): void {
  const u = ctx.s.cur ? ctx.unit(ctx.s.cur) : undefined;
  if (!u || !ctx.s.current) { toast('Спершу виберіть рядок'); return; }
  setText(ctx, u, u.source, 'скопійовано оригінал');
}

export function step(ctx: Ctx, dir: 1 | -1): void {
  const list = ctx.visible();
  const i = list.findIndex(x => x.key === ctx.s.cur);
  const next = list[i + dir];
  if (!next) { toast(dir > 0 ? 'Це останній рядок у списку' : 'Це перший рядок у списку'); return; }
  ctx.select(next.key);
}

/** Send to review / approve the current unit and move on. */
export function send(ctx: Ctx): void {
  const { s } = ctx;
  buzz(12);
  const u = s.cur ? ctx.unit(s.cur) : undefined;
  if (!u || !s.current) return;
  const ents = ctx.entries(s.current);
  const stage = stageOf(ctx);
  const r = submit(ents[u.key], u, stage, Date.now(), { blockErrors: s.saved.settings.blockErrors, qa: ctx.qaOpts() });
  if (!r.ok) { toast(r.reason, { sticky: true }); return; }
  const now = Date.now();
  ents[u.key] = recordChange(ents[u.key], r.entry, stage === 'translate' ? 'надіслано на вичитування' : 'вичитано', r.entry.target, s.who, now);
  const same = s.saved.settings.propagate ? propagate(s.saved, ctx.dups(), realOf(ctx, u).file, { ...u, key: realOf(ctx, u).key }, ents[u.key]!, stage, now, s.who, newBatch(stage === 'translate' ? 'twin' : 'approve', now)) : 0;
  s.sess.n++;
  ctx.persist(); ctx.invalidateTm();
  toast((stage === 'translate' ? 'Надіслано на вичитування' : 'Вичитано') + (same ? `. Також у ${plural(same, ['однаковому рядку', 'однакових рядках', 'однакових рядках'])}` : ''));
  const list = ctx.visible();
  const i = list.findIndex(x => x.key === u.key);
  const next = list[i + 1] ?? list[i];
  if (next && next.key !== u.key) ctx.select(next.key); else ctx.render();
}

/** Clicks inside the editing view. Returns true when handled. */
export function focusClick(ctx: Ctx, t: HTMLElement): boolean {
  const { s } = ctx;
  const u = s.cur ? ctx.unit(s.cur) : undefined;
  if (!t.closest('details.more > summary')) document.querySelectorAll<HTMLDetailsElement>('details.more').forEach(d => { d.open = false; });
  if (sideClick(ctx, t)) return true;
  if (!u || !s.current) return false;
  const ents = ctx.entries(s.current);
  const ta = $('#i-tr') as HTMLTextAreaElement;
  if (t.closest('#b-copy')) { insertOriginal(ctx); return true; }
  const go = t.closest<HTMLElement>('[data-goto]');
  if (go) { ctx.select(go.dataset.goto!); return true; }
  if (t.closest('#b-clear')) {
    if (!ta.value && !ents[u.key]?.target) { toast('Переклад уже порожній'); return true; }
    setText(ctx, u, '', 'очищено', 'clear'); toast('Переклад очищено. Скасувати можна в «Активності»'); return true;
  }
  if (t.closest('#b-scene')) { openScene(ctx, u); return true; }
  if (t.closest('#b-wrap,[data-wrap]')) {
    const limit = limitFor(ctx.lineLimit(), u.face);
    if (!limit) { toast('Ширину рядка вимкнено в налаштуваннях'); return true; }
    const text = wrapLines(ta.value, limit);
    if (text === ta.value) toast('Рядки вже вміщаються'); else setText(ctx, u, text, 'перенесено рядки');
    return true;
  }
  if (t.closest('#b-code')) {
    const miss = activeIssues(u, { target: ta.value }, ctx.qaOpts()).find(i => i.key === 'codes')?.codes ?? [];
    if (!miss.length) { toast('Усі керівні коди вже є'); return true; }
    setText(ctx, u, ta.value + miss.join(''), 'додано керівні коди');
    return true;
  }
  if (t.closest('#f-prev')) { step(ctx, -1); return true; }
  if (t.closest('#f-next')) { step(ctx, 1); return true; }
  if (t.closest('#b-save')) { send(ctx); return true; }
  if (t.closest('#b-return')) {
    const cur = ents[u.key];
    if (!cur) return true;
    ents[u.key] = recordChange(cur, sendBack(cur, Date.now()), 'повернуто перекладачу', '', s.who, Date.now());
    ctx.persist(); toast('Повернуто перекладачу'); step(ctx, 1); return true;
  }
  const ins = t.closest<HTMLElement>('[data-ins]');
  if (ins) { setText(ctx, u, ta.value + (ins.dataset.ins ?? ''), 'додано керівні коди'); return true; }
  return false;
}

/** The buttons of a remark (fix, ignore, bring back): they sit under the editor and in the panel, so they work in the table too. */
function qaClick(ctx: Ctx, t: HTMLElement): boolean {
  const { s } = ctx;
  const u = s.cur ? ctx.unit(s.cur) : undefined;
  const ign = t.closest<HTMLElement>('[data-ign]'), un = t.closest<HTMLElement>('[data-unign]'), fix = t.closest<HTMLElement>('[data-fix]');
  if (!ign && !un && !fix) return false;
  if (!u || !s.current) return true;
  const ents = ctx.entries(s.current);
  const e = ents[u.key];
  if (ign || un) {
    if (e) { ents[u.key] = setIgnored(e, (ign ?? un)!.dataset[ign ? 'ign' : 'unign']!, !!ign, Date.now()); ctx.persist(); ctx.render(); }
    return true;
  }
  const issue = activeIssues(u, { ...(e ?? { mt: 0, status: 'new' as const }), target: e?.target ?? '' }, ctx.qaOpts()).find(i => i.key === fix!.dataset.fix);
  if (issue?.fix) setText(ctx, u, issue.fix.text, `виправлено: ${issue.fix.label}`);
  return true;
}

/** Clicks in the right-hand zone. It works with the selected row in the table and in the editing view alike. */
export function sideClick(ctx: Ctx, t: HTMLElement): boolean {
  const { s } = ctx;
  const tab = t.closest<HTMLElement>('#stabs [data-p]');
  if (tab) {
    const next = TAB_OF[tab.dataset.p ?? ''] ?? 'hints';
    // Every rail button switches its own panel on or off; several on = they share the zone.
    if (s.phone) { s.sideTab = next; s.sideOn = [next]; }
    else { s.sideOn = s.sideOn.includes(next) ? hideSide(s.sideOn, next) : showSide(s.sideOn, next); if (s.sideOn.length) s.sideTab = s.sideOn[0]!; }
    ctx.render(); return true;
  }
  const hp = t.closest<HTMLElement>('[data-hide-pane]');
  if (hp) { const tb = TAB_OF[hp.dataset.hidePane ?? '']; if (tb) { s.sideOn = hideSide(s.sideOn, tb); ctx.render(); } return true; }
  if (t.closest('#rp-close')) { s.sideOn = []; ctx.render(); return true; }
  if (qaClick(ctx, t)) return true;
  if (!t.closest('.fs')) return false;
  const u = s.cur ? ctx.unit(s.cur) : undefined;
  const sw = t.closest<HTMLElement>('[data-side]');
  if (sw) { const to = sw.dataset.side as SideTab; if (s.phone) { s.sideTab = to; s.sideOn = [to]; } else s.sideOn = showSide(s.sideOn, to); s.sideTab = to; ctx.render(); return true; }
  const ext = t.closest<HTMLElement>('[data-ext]');
  if (ext) { void openLink(ext.dataset.ext!); return true; }
  const gk = t.closest<HTMLElement>('[data-gk]');
  if (gk) { gorohKind = gk.dataset.gk as typeof gorohKind; if (u) renderDict(u, entryOf(ctx, u)?.target ?? ''); return true; }
  if (!u || !s.current) return false;
  const gogn = t.closest<HTMLElement>('[data-gogn]');
  if (gogn) { const g = gameNames[Number(gogn.dataset.gogn)]; if (g) ctx.open(g.file, g.key); return true; }
  const same = t.closest<HTMLElement>('[data-same]');
  if (same) { const g = sameRows[Number(same.dataset.same)]; if (g) ctx.open(g.file, g.key); return true; }
  const gn = t.closest<HTMLElement>('[data-gn]');
  if (gn) {
    const g = gameNames[Number(gn.dataset.gn)];
    const tr = g ? ctx.entries(g.file)[g.key]?.target : '';
    if (!tr) return true;
    if (s.mode === 'table') { setText(ctx, u, tr, 'підставлено назву з гри'); return true; }
    const ta = $('#i-tr') as HTMLTextAreaElement;
    ta.focus(); ta.setRangeText(tr, ta.selectionStart, ta.selectionEnd, 'end'); ta.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }
  const tm = t.closest<HTMLElement>('[data-tm]');
  if (tm) { const m = tmCur[Number(tm.dataset.tm)]; if (m) setText(ctx, u, m.t, `підставлено з пам’яті (${m.score}%)`); return true; }
  if (historyClick(ctx, t, (unit, text, what) => setText(ctx, unit, text, what))) return true;
  if (discussClick(ctx, t)) return true;
  return false;
}
