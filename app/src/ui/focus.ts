import { activeIssues, addComment, describePage, explainCodes, sceneUnits, usageKey, displayLength, edit as editFn, lengthDeviation, limitFor, note, propagate, referenceSets, sendBack, sourceChanged, submit, termsIn, wrapLines } from '../core';
import type { Entry, Unit } from '../core';
import { $, esc, plural, toast } from './dom';
import { markup } from './markup';
import { openScene } from './scene-dialog';
import { STATUS_CAP, shownStatus, splitKey } from './state';
import type { Ctx, SideTab } from './state';

const I = {
  copy: '<svg viewBox="0 0 16 16"><rect x="5.5" y="5.5" width="8" height="8" rx="1"/><path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2"/></svg>',
  clear: '<svg viewBox="0 0 16 16"><path d="M3 4.5h10M6.5 4.5v-1.5h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5"/></svg>',
  code: '<svg viewBox="0 0 16 16"><path d="M6 3H3.5v10H6M10 3h2.5v10H10M8 5v6"/></svg>',
  play: '<svg viewBox="0 0 16 16"><path d="M5 3.5l8 4.5-8 4.5z" fill="currentColor" stroke="none"/></svg>',
  back: '<svg viewBox="0 0 16 16"><path d="M6 3.5L2.5 7 6 10.5M2.5 7h7a4 4 0 0 1 0 8H8"/></svg>',
  up: '<svg viewBox="0 0 16 16"><path d="M4 9.5L8 5.5l4 4"/></svg>',
  down: '<svg viewBox="0 0 16 16"><path d="M4 6.5L8 10.5l4-4"/></svg>',
  ok: '<svg viewBox="0 0 16 16"><path d="M3 8.5l3.2 3.2L13 4.8"/></svg>',
  scene: '<svg viewBox="0 0 16 16"><rect x="2.5" y="3" width="11" height="6" rx="1.5"/><rect x="2.5" y="11" width="7" height="2.5" rx="1"/></svg>',
  wrap: '<svg viewBox="0 0 16 16"><path d="M2.5 4h11M2.5 8h8.5a2.5 2.5 0 0 1 0 5H8M9.5 11l-1.7 2 1.7 2M2.5 12h2"/></svg>',
};

/** Static skeleton of the editing view; renderFocus() fills the pieces so the textarea keeps focus while typing. */
export const FOCUS_HTML = `<div class="fc"><div class="fc-in">
  <div class="fhd"><span class="k" id="f-key"></span><span class="st-pill" id="f-state"></span></div>
  <div class="offlist" id="f-off" hidden><span>Цей рядок не входить у поточний фільтр або пошук.</span><button data-reset>Показати всі рядки</button></div>
  <div><div class="lbl">Оригінал · EN</div><div class="srcbox" id="f-src"></div></div>
  <div id="f-refbox" hidden></div>
  <div class="trblock">
    <div class="lbl" id="f-trlbl">Переклад · UK</div>
    <textarea class="tr-in" id="i-tr" spellcheck="false" aria-label="Переклад"></textarea>
    <div class="edbar">
      <button class="ib lab" id="b-copy" title="Копіювати оригінал у переклад" aria-label="Копіювати оригінал у переклад">${I.copy}<span class="tl">Оригінал</span></button>
      <button class="ib lab" id="b-scene" title="Переглянути сцену: усі рядки події поспіль, як у грі" aria-label="Переглянути сцену">${I.scene}<span class="tl">Сцена</span></button>
      <details class="more"><summary class="ib" title="Ще дії" aria-label="Ще дії">⋯</summary><div class="morep">
        <button id="b-code" title="Вставити відсутні керівні коди з оригіналу">${I.code}<span>Вставити керівні коди</span></button>
        <button id="b-wrap" title="Перенести рядки за шириною вікна гри">${I.wrap}<span>Перенести рядки за шириною</span></button>
        <hr><button class="danger" id="b-clear" title="Очистити переклад (можна скасувати)">${I.clear}<span>Очистити переклад</span></button>
      </div></details>
      <span class="vsep" aria-hidden="true"></span><button class="ib" id="b-play" title="Зібрати й перевірити в грі (F5)" aria-label="Перевірити в грі" hidden>${I.play}</button>
      <button class="ib" id="b-return" title="Повернути перекладачу" aria-label="Повернути перекладачу" hidden>${I.back}</button>
      <span class="vsep" aria-hidden="true"></span><span class="stepper" role="group" aria-label="Перехід між рядками списку"><button class="ib sm" id="f-prev" title="Попередній рядок у списку (Alt+↑)" aria-label="Попередній рядок">${I.up}</button><span class="queue" id="f-queue"></span><button class="ib sm" id="f-next" title="Наступний рядок у списку (Alt+↓)" aria-label="Наступний рядок">${I.down}</button></span>
      <span class="qab" id="qa-badge" title="Активні проблеми QA в рядку" hidden></span>
      <span class="grow"></span>
      <div class="cnt2" id="cnt2" title="Символів у перекладі / в оригіналі. Рекомендація: якнайближче до оригіналу"><span id="c-ch">0/0</span></div>
      <button class="saveb" id="b-save" aria-label="Надіслати на вичитування">${I.ok}</button>
    </div>
    <div class="qa-under" id="f-qa"></div>
    <div class="proof" id="f-proof" hidden style="margin-top:10px"></div>
  </div>
  <div class="ctxrow"><div style="grid-column:1/-1"><div class="lbl">Сусідні рядки</div><div class="ctx" id="c-near"></div></div></div>
  <div class="hint" id="f-meta"></div>
</div></div>`;

export const SIDE_HTML = `<aside class="fs" aria-label="Вказівки до рядка">
  <div class="rz rz-r" id="rz-r" role="separator" aria-orientation="vertical" aria-label="Ширина правої панелі" aria-valuemin="260" aria-valuemax="640" tabindex="0" title="Потягніть, щоб змінити ширину (подвійний клік — стандартна)"></div>
  <div class="itabs" id="stabs" role="tablist">
    <button class="on" role="tab" data-p="s-tm"><svg viewBox="0 0 16 16"><path d="M3 4h10M3 8h10M3 12h6"/></svg><span class="tl">Вказівки</span></button><hr class="ssep">
    <button role="tab" data-p="s-gl"><svg viewBox="0 0 16 16"><path d="M3.5 2.5h8a1 1 0 0 1 1 1v10H4.5a1 1 0 0 1-1-1z"/><path d="M6 5.5h4"/></svg><span class="tl">Глосарій</span></button><hr class="ssep">
    <button role="tab" data-p="s-cm"><svg viewBox="0 0 16 16"><path d="M3 3.5h10v7H8.5L6 13v-2.5H3z"/></svg><span class="tl">Коментарі</span> <span class="cnt" id="cm-badge">0</span></button><hr class="ssep">
    <button role="tab" data-p="s-hi"><svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5"/><path d="M8 5v3.2l2 1.3"/></svg><span class="tl">Історія</span></button>
  </div>
  <div class="ibody">
    <div class="ph"><span class="grow" id="rp-title">Вказівки</span><span class="ico" id="rp-close" title="Сховати панель" role="button" tabindex="0" aria-label="Сховати панель">—</span></div>
    <div class="pane on" id="s-tm" data-title="Вказівки"><div class="ph card-ph"><span class="grow">Вказівки</span><span class="ico" data-hide-pane="s-tm" role="button" tabindex="0" aria-label="Сховати панель «Вказівки»" title="Сховати">—</span></div><div><div class="lbl">Глосарій у рядку</div><div id="i-gl"></div></div><div id="cd-box" hidden><div class="lbl">Коди в рядку</div><div id="i-cd"></div></div><div id="db-box" hidden><div class="lbl">Про цей запис гри</div><div id="i-db"></div></div><div id="gn-box" hidden><div class="lbl">Назви з гри</div><div id="i-gn"></div></div><div><div class="lbl">Пам’ять перекладів <span class="r" id="tm-n"></span></div><div id="i-tm"></div></div></div>
    <div class="rz rz-p" data-rzp="0" role="separator" aria-orientation="horizontal" tabindex="0" hidden></div>
    <div class="pane" id="s-gl" data-title="Глосарій"><div class="ph card-ph"><span class="grow">Глосарій</span><span class="ico" data-hide-pane="s-gl" role="button" tabindex="0" aria-label="Сховати панель «Глосарій»" title="Сховати">—</span></div>
      <div class="fin" style="width:auto"><input id="gl-q" placeholder="Пошук у глосарії" aria-label="Пошук у глосарії"></div>
      <table class="gt"><thead><tr><th>EN</th><th>UK</th><th>Тип</th></tr></thead><tbody id="gtb"></tbody></table>
      <div class="gl-form"><div class="lbl">Додати термін</div><input id="gl-en" placeholder="Англійською" aria-label="Термін англійською"><input id="gl-uk" placeholder="Українською" aria-label="Термін українською"><button class="btn" id="gl-add">＋ Додати термін</button></div>
    </div>
    <div class="rz rz-p" data-rzp="1" role="separator" aria-orientation="horizontal" tabindex="0" hidden></div>
    <div class="pane" id="s-cm" data-title="Коментарі"><div class="ph card-ph"><span class="grow">Коментарі</span><span class="ico" data-hide-pane="s-cm" role="button" tabindex="0" aria-label="Сховати панель «Коментарі»" title="Сховати">—</span></div>
      <div id="cm-list" style="display:flex;flex-direction:column;gap:12px"></div>
      <textarea class="cmin" id="cm-in" placeholder="Написати коментар до цього рядка…" aria-label="Коментар"></textarea>
      <div class="actions" style="margin-top:0"><button class="btn" id="cm-add">Коментувати</button></div>
    </div>
    <div class="rz rz-p" data-rzp="2" role="separator" aria-orientation="horizontal" tabindex="0" hidden></div>
    <div class="pane" id="s-hi" data-title="Історія"><div class="ph card-ph"><span class="grow">Історія</span><span class="ico" data-hide-pane="s-hi" role="button" tabindex="0" aria-label="Сховати панель «Історія»" title="Сховати">—</span></div><div class="hist" id="hist-list"></div></div>
  </div>
</aside>`;

const when = (t: number) => new Date(t).toLocaleString('uk-UA', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const stageOf = (ctx: Ctx) => (ctx.s.mode === 'review' ? 'review' : 'translate') as 'review' | 'translate';
/** The file and key a row really belongs to: in a group of files the row's key carries its file. */
const realOf = (ctx: Ctx, u: Unit): { file: string; key: string } => splitKey(u.key) ?? { file: ctx.s.current!, key: u.key };
const entryOf = (ctx: Ctx, u: Unit): Entry | undefined => ctx.entries(ctx.s.current!)[u.key];

export const SIDE_ORDER: SideTab[] = ['hints', 'glossary', 'comments', 'history'];
/** Switch a panel on (keeping the fixed order) / off. */
export const showSide = (on: SideTab[], t: SideTab): SideTab[] => (on.includes(t) ? on : SIDE_ORDER.filter(x => x === t || on.includes(x)));
export const hideSide = (on: SideTab[], t: SideTab): SideTab[] => on.filter(x => x !== t);

let tmCur: { t: string; score: number }[] = [];
let gameNames: { file: string; key: string; name: string }[] = [];

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
    $('#f-src').innerHTML = `<span class="hint">${list.length ? 'Оберіть рядок зліва.' : s.mode === 'review' ? 'Немає рядків, які очікують вичитування.' : 'За поточним фільтром рядків немає.'}</span>`;
    return;
  }
  ($('#i-tr') as HTMLTextAreaElement).disabled = false;
  const e = entryOf(ctx, u);
  const st = shownStatus(ctx, u, e);
  const review = s.mode === 'review';
  const pos = list.findIndex(x => x.key === u.key);
  $('#f-key').textContent = `${realOf(ctx, u).file.replace(/\.[^.]+$/, '')} › ${u.context}${ctx.speaker(u) ? ' › ' + ctx.speaker(u) : ''} › ${u.key.replace(/^.*\.list/, 'list')}`;
  $('#f-state').innerHTML = `<span class="sd ${st}"></span>${e?.returned && e.status === 'draft' ? 'повернено на доопрацювання' : STATUS_CAP[st]}`;
  $('#f-queue').textContent = pos >= 0 ? `${pos + 1}/${list.length}` : '';
  $('#f-queue').title = pos >= 0 ? `Рядок ${pos + 1} із ${list.length} у поточному списку (з урахуванням фільтрів)` : '';
  $('#f-off').hidden = pos >= 0;
  const hits = termsIn(u.source, s.saved.terms);
  $('#f-src').innerHTML = markup(u.source, hits.map(t => t.en));
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
  const all = ctx.view()?.units ?? [];
  const idx = all.findIndex(x => x.key === u.key);
  $('#c-near').innerHTML = [-2, -1, 0, 1, 2].map(d => all[idx + d]).map((x, j) => x ? `<div class="${j === 2 ? 'me' : ''}"><span>${idx + j - 1}</span><span>${esc(ctx.speaker(x))}</span><span>${esc(x.source.length > 34 ? x.source.slice(0, 34) + '…' : x.source)}</span></div>` : '').join('');
  const same = ctx.dups().others(realOf(ctx, u).file, realOf(ctx, u).key).length;
  const label = ctx.view()?.label ?? s.views.find(v => v.name === realOf(ctx, u).file)?.label;
  const limit = u.kind === 'dialogue' || u.kind === 'scroll' ? limitFor(ctx.lineLimit(), u.face) : 0;
  $('#b-wrap').hidden = !limit;
  const first = sceneUnits(s.views.find(v => v.name === realOf(ctx, u).file)?.units ?? [], realOf(ctx, u).key)[0];
  const cond = first?.page ? describePage(first.page, s.saved.sysNames).slice(0, 4).join('; ') : '';
  $('#f-meta').textContent = [`Тип: ${u.kind}`, cond ? `Умови: ${cond}` : '', label ? `Місцевість: ${label}` : '', u.note ? `Позначка розробників: ${u.note}` : '', limit ? `Ширина рядка: до ${limit} символів${u.face ? ' (поруч обличчя)' : ''}` : '', same ? `однакових рядків у грі: ${same}` : ''].filter(Boolean).join(' · ');
  $('#cm-badge').textContent = String(e?.comments?.length ?? 0);
}

function meter(ctx: Ctx, u: Unit): void {
  const t = ($('#i-tr') as HTMLTextAreaElement).value;
  const rl = displayLength(u.source), n = displayLength(t);
  const d = Math.abs(lengthDeviation(u.source, t)), tol = ctx.s.saved.settings.tolerancePct;
  $('#c-ch').textContent = `${n}/${rl}`;
  $('#cnt2').classList.toggle('over', !!t && d > tol);
  $('#cnt2').classList.toggle('mid', !!t && d <= tol && d > tol / 2);
}

function refreshQa(ctx: Ctx, u: Unit): void {
  const e = entryOf(ctx, u);
  const t = e?.target ?? '';
  const opts = ctx.qaOpts();
  const iss = activeIssues(u, e, opts);
  const ignored = e?.ign?.length ? checkAllIgnored(u, e, opts) : [];
  let h = '';
  if (sourceChanged(e, u)) h += `<div class="qa-row warn"><span class="dot"></span><span class="qa-msg">Оригінал змінено в грі після перекладу. Було: «${esc(e?.src ?? '')}». Перевірте переклад</span></div>`;
  if (t) {
    if (!iss.length) h += `<div class="qa-row good"><span class="dot"></span>${ignored.length ? 'QA: активних проблем немає' : 'QA: проблем не знайдено'}</div>`;
    h += iss.map(x => `<div class="qa-row ${x.severity}"><span class="dot"></span><span class="qa-msg">${esc(x.message)}</span><span class="qa-act">${x.codes?.length ? `<button class="fix" data-ins="${esc(x.codes.join(''))}">Вставити ${esc(x.codes.join(' '))}</button>` : ''}${x.key === 'wrap' ? '<button class="fix" data-wrap>Перенести рядки</button>' : ''}<button class="ign" data-ign="${x.key}" title="Не вважати проблемою для цього рядка">Ігнорувати</button></span></div>`).join('');
    h += ignored.map(x => `<div class="qa-row muted"><span class="dot"></span><span class="qa-msg">${esc(x.message)}</span><span class="qa-act"><span class="tagi">ігноровано</span><button class="ign" data-unign="${x.key}">Повернути</button></span></div>`).join('');
  }
  $('#f-qa').innerHTML = h;
  $('#qa-badge').hidden = !t || !iss.length;
  $('#qa-badge').textContent = String(iss.length);
  const st = shownStatus(ctx, u, e);
  const pill = $('#f-state');
  pill.innerHTML = `<span class="sd ${st}"></span>${e?.returned && e.status === 'draft' ? 'повернено на доопрацювання' : STATUS_CAP[st]}`;
}

import { check } from '../core';
function checkAllIgnored(u: Unit, e: Entry, opts: ReturnType<Ctx['qaOpts']>) {
  return check(u, e.target, opts).filter(i => e.ign?.includes(i.key));
}

/** The right zone belongs to the whole editor: it follows the selected row in the table and in the editing view alike. */
export function renderSidePanel(ctx: Ctx): void {
  const { s } = ctx;
  const u = s.cur && s.current ? ctx.unit(s.cur) : undefined;
  renderSide(ctx, u, u ? entryOf(ctx, u) : undefined, u ? termsIn(u.source, s.saved.terms) : []);
}

function renderSide(ctx: Ctx, u: Unit | undefined, e: Entry | undefined, hits: ReturnType<typeof termsIn<Ctx['s']['saved']['terms'][number]>>): void {
  const { s } = ctx;
  const on = s.phone ? [s.sideTab] : s.sideOn;
  const tab = on[0] ?? s.sideTab;
  const map: Record<SideTab, string> = { hints: 's-tm', glossary: 's-gl', comments: 's-cm', history: 's-hi' };
  const all = on.length > 1;
  const open = s.phone || on.length > 0;
  const idOf = (t: SideTab): string => map[t];
  document.querySelectorAll<HTMLElement>('#stabs [data-p]').forEach(b => { const isOn = on.some(t => idOf(t) === b.dataset.p); b.classList.toggle('on', isOn); b.setAttribute('aria-selected', String(isOn)); b.setAttribute('aria-pressed', String(isOn)); });
  document.querySelectorAll<HTMLElement>('.ibody .pane').forEach(p => p.classList.toggle('on', on.some(t => idOf(t) === p.id)));
  // A splitter sits before every shown panel that has another shown panel above it.
  document.querySelectorAll<HTMLElement>('.ibody .rz-p').forEach(d => { const pane = d.nextElementSibling as HTMLElement | null; const k = pane ? SIDE_ORDER.findIndex(t => idOf(t) === pane.id) : -1; d.hidden = !(k > 0 && on.some(t => idOf(t) === pane?.id) && on.some(t => SIDE_ORDER.indexOf(t) < k)); });
  const fsEl = document.querySelector<HTMLElement>('.fs');
  fsEl?.classList.toggle('stack', all);
  document.getElementById('v-focus')?.classList.toggle('side-collapsed', !open);
  $('#rp-title').textContent = all ? 'Панелі' : ({ hints: 'Вказівки', glossary: 'Глосарій', comments: 'Коментарі', history: 'Історія' } as const)[tab];
  const show = (t: SideTab): boolean => on.includes(t);
  if (!u) {
    const hintEmpty = '<div class="hint">Оберіть рядок.</div>';
    $('#i-gl').innerHTML = hintEmpty; $('#i-tm').innerHTML = ''; $('#tm-n').textContent = '';
    for (const id of ['#cd-box', '#db-box', '#gn-box']) $(id).hidden = true;
    $('#cm-list').innerHTML = hintEmpty; $('#hist-list').innerHTML = hintEmpty;
    if (show('glossary')) renderGlossary(ctx);
    return;
  }
  if (show('hints')) {
    $('#i-gl').innerHTML = hits.length ? hits.map(g => `<div class="gloss-row"><b>${esc(g.en)}</b><span class="arr">→</span><span>${esc(g.uk)}${g.alt?.length ? `<small class="hint"> · ${esc(g.alt.join(', '))}</small>` : ''}</span>${g.kind ? `<span class="t">${esc(g.kind.slice(0, 18))}</span>` : ''}</div>`).join('') : '<div class="hint">Термінів немає</div>';
    const actor = (n: number) => { const a = s.views.find(v => v.name === 'Actors.json')?.units.find(x => x.key === `[${n}].name`); return a ? s.saved.files['Actors.json']?.[a.key]?.target || a.source : undefined; };
    const codes = explainCodes(u.source, actor, s.saved.sysNames);
    $('#cd-box').hidden = !codes.length;
    $('#i-cd').innerHTML = codes.map(c => `<div class="gloss-row"><b>${esc(c.code)}</b><span class="arr">→</span><span>${esc(c.meaning)}</span></div>`).join('');
    const uk = usageKey(realOf(ctx, u).file, realOf(ctx, u).key);
    const used = uk ? ctx.usage().get(uk) ?? [] : [];
    $('#db-box').hidden = !u.dbNote && !used.length;
    $('#i-db').innerHTML = (u.dbNote ? `<div class="hint">Примітка в базі: <code>${esc(u.dbNote)}</code></div>` : '') + (used.length ? `<div class="hint">Гравець отримує в: ${used.map(esc).join('; ')}</div>` : '');
    const gn = ctx.names().find(u.source).filter(g => !(g.file === realOf(ctx, u).file && g.key === realOf(ctx, u).key));
    gameNames = gn;
    $('#gn-box').hidden = !gn.length;
    $('#i-gn').innerHTML = gn.map((g, n) => {
      const t = ctx.entries(g.file)[g.key]?.target;
      return t ? `<div class="gloss-row gn" data-gn="${n}" role="button" tabindex="0" title="Вставити в переклад"><b>${esc(g.name)}</b><span class="arr">→</span><span>${esc(t)}</span><span class="t">${esc(g.file.replace(/\.json$/, ''))}</span></div>` : `<div class="gloss-row gn"><b>${esc(g.name)}</b><span class="arr">→</span><span class="hint">ще не перекладено</span><span class="t">${esc(g.file.replace(/\.json$/, ''))}</span></div>`;
    }).join('');
    const m = ctx.tm().find(u.source, { min: 50, limit: 4, exclude: x => x.s === u.source && x.t === (e?.target ?? '') });
    tmCur = m;
    $('#tm-n').textContent = m.length ? plural(m.length, ['збіг', 'збіги', 'збігів']) : '';
    $('#i-tm').innerHTML = m.length ? m.map((x, n) => `<div class="sg" data-tm="${n}" role="button" tabindex="0" title="Підставити в переклад"><span class="pc ${x.score >= 90 ? '' : 'mid'}">${x.score}%</span><div>${esc(x.t)}<small>${esc(x.src)} · «${esc(x.s.length > 38 ? x.s.slice(0, 38) + '…' : x.s)}»</small></div></div>`).join('') : '<div class="hint">Збігів у пам’яті перекладів немає</div>';
  }
  if (show('glossary')) renderGlossary(ctx);
  if (show('comments')) {
    const c = e?.comments ?? [];
    $('#cm-list').innerHTML = c.length ? c.map(x => `<div class="cm"><div class="av" style="background:#7a62d8">${esc(x.who[0] ?? '?')}</div><div><div class="h"><b>${esc(x.who)}</b>${when(x.at)}</div><p>${esc(x.text)}</p></div></div>`).join('') : '<div class="hint">До цього рядка коментарів немає.</div>';
  }
  if (show('history')) {
    const h = [...(e?.history ?? [])].reverse();
    $('#hist-list').innerHTML = h.length ? h.map(x => `<div><div class="h"><b>${esc(x.who)}</b> · ${esc(x.what)} · ${when(x.at)}</div>${x.text ? `<div class="t">${esc(x.text.slice(0, 160))}</div>` : ''}</div>`).join('') : '<div class="hint">Змін поки немає.</div>';
  }
}

export function renderGlossary(ctx: Ctx): void {
  const q = ($('#gl-q') as HTMLInputElement).value.trim().toLowerCase();
  const terms = ctx.s.saved.terms;
  const rank = (t: { en: string; uk: string; alt?: string[] }): number => {
    if (!q) return 3;
    const names = [t.en, t.uk, ...(t.alt ?? [])].map(x => x.toLowerCase());
    if (names.some(n => n === q)) return 0;
    if (names.some(n => n.startsWith(q))) return 1;
    if (names.some(n => n.split(/[^\p{L}\p{N}]+/u).some(w => w.startsWith(q)))) return 2;
    return names.some(n => n.includes(q)) ? 3 : 4;
  };
  const a = terms.map(t => [rank(t), t] as const).filter(([r]) => r < 4).sort((x, y) => x[0] - y[0]).slice(0, 40).map(([, t]) => t);
  $('#gtb').innerHTML = a.length ? a.map(g => `<tr><td>${esc(g.en)}</td><td>${esc(g.uk)}${g.alt?.length ? `<div class="hint">${esc(g.alt.join(', '))}</div>` : ''}</td><td class="hint">${esc(g.kind ?? '')}${g.note ? ' · ' + esc(g.note.slice(0, 80)) : ''}${g.qa === false ? '' : ' <span class="qatag">QA</span>'}</td></tr>`).join('') : '<tr><td colspan="3" class="hint">Нічого не знайдено</td></tr>';
}

function edit0(ctx: Ctx, u: Unit, text: string): Entry {
  return editFn(entryOf(ctx, u), u, text, stageOf(ctx), Date.now());
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
  ctx.invalidateTm();
}

function setText(ctx: Ctx, u: Unit, text: string, what: string): void {
  const ents = ctx.entries(ctx.s.current!);
  ents[u.key] = note(edit0(ctx, u, text), what, text, ctx.s.who, Date.now());
  ctx.s.sess.n++;
  ctx.persist(); ctx.invalidateTm(); ctx.render();
  if (ctx.s.mode !== 'table') ($('#i-tr') as HTMLTextAreaElement).focus();
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
  const u = s.cur ? ctx.unit(s.cur) : undefined;
  if (!u || !s.current) return;
  const ents = ctx.entries(s.current);
  const stage = stageOf(ctx);
  const r = submit(ents[u.key], u, stage, Date.now(), { blockErrors: s.saved.settings.blockErrors, qa: ctx.qaOpts() });
  if (!r.ok) { toast(r.reason, { sticky: true }); return; }
  ents[u.key] = note(r.entry, stage === 'translate' ? 'надіслано на вичитування' : 'вичитано', r.entry.target, s.who, Date.now());
  const same = s.saved.settings.propagate ? propagate(s.saved, ctx.dups(), realOf(ctx, u).file, { ...u, key: realOf(ctx, u).key }, ents[u.key]!, stage, Date.now(), s.who) : 0;
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
  if (t.closest('#b-copy')) { setText(ctx, u, u.source, 'скопійовано оригінал'); return true; }
  if (t.closest('#b-clear')) { setText(ctx, u, '', 'очищено'); return true; }
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
    ents[u.key] = note(sendBack(cur, Date.now()), 'повернуто перекладачу', '', s.who, Date.now());
    ctx.persist(); toast('Повернуто перекладачу'); step(ctx, 1); return true;
  }
  const ign = t.closest<HTMLElement>('[data-ign]');
  if (ign) { const e = ents[u.key]; if (e) { ents[u.key] = { ...e, ign: [...new Set([...(e.ign ?? []), ign.dataset.ign!])], mt: Date.now() }; ctx.persist(); ctx.render(); } return true; }
  const un = t.closest<HTMLElement>('[data-unign]');
  if (un) { const e = ents[u.key]; if (e) { ents[u.key] = { ...e, ign: (e.ign ?? []).filter(k => k !== un.dataset.unign), mt: Date.now() }; ctx.persist(); ctx.render(); } return true; }
  const ins = t.closest<HTMLElement>('[data-ins]');
  if (ins) { setText(ctx, u, ta.value + (ins.dataset.ins ?? ''), 'додано керівні коди'); return true; }
  return false;
}

/** Clicks in the right-hand zone. It works with the selected row in the table and in the editing view alike. */
export function sideClick(ctx: Ctx, t: HTMLElement): boolean {
  const { s } = ctx;
  const tab = t.closest<HTMLElement>('#stabs [data-p]');
  if (tab) {
    const next = ({ 's-tm': 'hints', 's-gl': 'glossary', 's-cm': 'comments', 's-hi': 'history' } as const)[tab.dataset.p as 's-tm'] ?? 'hints';
    // Every rail button switches its own panel on or off; several on = they share the zone.
    if (s.phone) { s.sideTab = next; s.sideOn = [next]; }
    else { s.sideOn = s.sideOn.includes(next) ? hideSide(s.sideOn, next) : showSide(s.sideOn, next); if (s.sideOn.length) s.sideTab = s.sideOn[0]!; }
    ctx.render(); return true;
  }
  const hp = t.closest<HTMLElement>('[data-hide-pane]');
  if (hp) { const tab = ({ 's-tm': 'hints', 's-gl': 'glossary', 's-cm': 'comments', 's-hi': 'history' } as const)[hp.dataset.hidePane as 's-tm']; if (tab) { s.sideOn = hideSide(s.sideOn, tab); ctx.render(); } return true; }
  if (t.closest('#rp-close')) { s.sideOn = []; ctx.render(); return true; }
  if (!t.closest('.fs')) return false;
  const u = s.cur ? ctx.unit(s.cur) : undefined;
  if (t.closest('#gl-add')) {
    const en = ($('#gl-en') as HTMLInputElement).value.trim(), uk = ($('#gl-uk') as HTMLInputElement).value.trim();
    if (!en || !uk) { toast('Заповніть обидва поля'); return true; }
    if (s.saved.terms.some(x => x.en.toLowerCase() === en.toLowerCase())) { toast('Такий термін уже є'); return true; }
    s.saved.terms.push({ en, uk, mt: Date.now() });
    ($('#gl-en') as HTMLInputElement).value = ''; ($('#gl-uk') as HTMLInputElement).value = '';
    ctx.persist(); ctx.render(); toast('Термін додано');
    return true;
  }
  if (!u || !s.current) return false;
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
  if (t.closest('#cm-add')) {
    const box = $('#cm-in') as HTMLTextAreaElement;
    const text = box.value.trim();
    if (!text) { toast('Напишіть коментар'); return true; }
    const ents = ctx.entries(s.current);
    ents[u.key] = addComment(ents[u.key], s.who, text, Date.now());
    box.value = '';
    ctx.persist(); ctx.render();
    return true;
  }
  return false;
}
