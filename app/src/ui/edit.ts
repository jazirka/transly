import { addComment, check, displayLength, edit as editFn, lengthDeviation, missingCodes, note, sendBack, sourceChanged, submit, termsIn } from '../core';
import type { Entry, Unit } from '../core';
import { $, esc, plural, toast } from './dom';
import type { Ctx, SideTab } from './state';

export const STATUS_LABEL = { new: 'Без перекладу', draft: 'Чернетка', done: 'Очікує вичитування', appr: 'Вичитано' } as const;
const SIDE_TABS: [SideTab, string][] = [['hints', 'Вказівки'], ['glossary', 'Глосарій'], ['comments', 'Коментарі'], ['history', 'Історія']];

const when = (t: number) => new Date(t).toLocaleString('uk-UA', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/** Highlight glossary terms inside the (escaped) source. */
function sourceHtml(u: Unit, terms: { en: string }[]): string {
  let h = esc(u.source);
  for (const t of terms.sort((a, b) => b.en.length - a.en.length)) {
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])(${esc(t.en).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?![\\p{L}\\p{N}])`, 'giu');
    h = h.replace(re, '$1<mark class="term" title="Термін глосарію">$2</mark>');
  }
  return h;
}

export function renderEditor(ctx: Ctx, box: HTMLElement): void {
  const { s } = ctx;
  const list = ctx.visible();
  const u = s.cur ? ctx.unit(s.cur) : undefined;
  if (!u || !list.some(x => x.key === u.key)) {
    box.innerHTML = `<div class="empty"><h2>${list.length ? 'Оберіть рядок' : 'Рядків немає'}</h2>${list.length ? 'Скористайтеся стрілками або таблицею.' : s.mode === 'review' ? 'Немає рядків, які очікують вичитування. Надішліть переклад на вичитування в режимі «Редагування».' : 'За поточним фільтром рядків немає. Змініть фільтр.'}</div>`;
    return;
  }
  const review = s.mode === 'review';
  const e = ctx.entries(s.current!)[u.key];
  const pos = list.findIndex(x => x.key === u.key);
  const n = (ctx.view()?.units.findIndex(x => x.key === u.key) ?? 0) + 1;
  const st = e?.status ?? 'new';
  const glossary = termsIn(u.source, s.saved.terms);
  box.innerHTML = `<div class="edit"><section class="edmain" aria-label="Редагування рядка">
    <div class="crumb"><span class="mono">${esc(s.current!)}</span> › <span>${esc(u.context)}</span> › <b class="mono">${esc(u.key.replace(/^.*\.list/, 'list'))}</b><span class="grow"></span><span class="stpill ${st}">${STATUS_LABEL[st]}${e?.returned ? ' · повернуто' : ''}</span></div>
    ${u.speaker ? `<div class="who">${esc(u.speaker)}</div>` : ''}
    <div class="lbl">Оригінал · EN</div>
    <div class="source" id="ed-src">${sourceHtml(u, [...glossary])}</div>
    ${review ? `<div class="lbl">Версія перекладача</div><div class="source orig">${esc(e?.orig ?? '—')}${e && e.orig !== undefined && e.orig !== e.target ? '<span class="chg">змінено вичитуванням</span>' : ''}</div>` : ''}
    <div class="lbl">${review ? 'Після вичитування' : 'Переклад'} · UK</div>
    <textarea id="ed-tr" class="big" rows="${Math.max(4, u.source.split('\n').length + 1)}" aria-label="Переклад" data-key="${esc(u.key)}">${esc(e?.target ?? '')}</textarea>
    <div class="edbar">
      <button class="ib" id="ed-copy" title="Скопіювати оригінал у переклад" aria-label="Скопіювати оригінал у переклад">⧉</button>
      <button class="ib" id="ed-clear" title="Очистити переклад" aria-label="Очистити переклад">⌫</button>
      <button class="ib" id="ed-code" title="Вставити відсутні керівні коди з оригіналу" aria-label="Вставити відсутні коди">[ ]</button>
      <span class="stepper" role="group" aria-label="Перехід між рядками"><button class="ib" id="ed-prev" aria-label="Попередній рядок" title="Попередній рядок (Alt+↑)">∧</button><span class="queue" title="Рядок ${pos + 1} із ${list.length} у поточному списку">${pos >= 0 ? `${pos + 1}/${list.length}` : '—'}</span><button class="ib" id="ed-next" aria-label="Наступний рядок" title="Наступний рядок (Alt+↓)">∨</button></span>
      <span class="grow"></span>
      <span class="cnt ${lenClass(u, e)}" id="ed-cnt" title="Символів у перекладі / в оригіналі. Рекомендація: якнайближче до оригіналу"></span>
      ${review ? '<button class="btn" id="ed-back">Повернути перекладачу</button>' : ''}
      <button class="btn p" id="ed-send" title="Ctrl+Enter">${review ? 'Затвердити' : 'Надіслати на вичитування'}</button>
    </div>
    <div id="ed-qa"></div>
    <div class="meta">Рядок ${n} · ${esc(u.kind)}</div></section>
    <aside class="side" aria-label="Вказівки до рядка"><div class="stabs" role="tablist">${SIDE_TABS.map(([t, l]) => `<button role="tab" data-side="${t}" aria-selected="${s.sideTab === t}">${l}${t === 'comments' && e?.comments?.length ? ` <span class="badge">${e.comments.length}</span>` : ''}</button>`).join('')}</div>
      <div class="sbody" id="ed-side"></div></aside></div>`;
  refreshStatus(ctx, box, u);
  renderSide(ctx, $('#ed-side', box), u);
}

function lenClass(u: Unit, e: Entry | undefined): string {
  if (!e?.target) return '';
  const d = Math.abs(lengthDeviation(u.source, e.target));
  return d > 25 ? 'over' : d > 12 ? 'mid' : '';
}

/** Re-render the parts that change while typing (counter, QA) without touching the textarea. */
export function refreshStatus(ctx: Ctx, box: HTMLElement, u: Unit): void {
  const e = ctx.entries(ctx.s.current!)[u.key];
  const t = e?.target ?? '';
  const cnt = $('#ed-cnt', box);
  cnt.textContent = `${displayLength(t)}/${displayLength(u.source)}`;
  cnt.className = `cnt ${lenClass(u, e)}`;
  const changed = sourceChanged(e, u) ? `<div class="qa warn" role="note">Оригінал змінено в грі після перекладу. Було: «${esc(e?.src ?? '')}». Перевірте переклад</div>` : '';
  $('#ed-qa', box).innerHTML = changed + (t ? check(u, t, ctx.qaOpts()).map(i => `<div class="qa ${i.severity}" role="note">${esc(i.message)}</div>`).join('') : '');
  const pill = box.querySelector('.stpill');
  if (pill) { const st = e?.status ?? 'new'; pill.className = `stpill ${st}`; pill.textContent = STATUS_LABEL[st] + (e?.returned ? ' · повернуто' : ''); }
}

export function renderSide(ctx: Ctx, pane: HTMLElement, u: Unit): void {
  const { s } = ctx;
  const e = ctx.entries(s.current!)[u.key];
  if (s.sideTab === 'hints') {
    const m = ctx.tm().find(u.source, { min: 50, limit: 5, exclude: x => x.s === u.source && x.t === (e?.target ?? '') });
    pane.innerHTML = m.length
      ? `<div class="sh">Пам’ять перекладів · ${plural(m.length, ['збіг', 'збіги', 'збігів'])}</div>` + m.map((x, i) =>
        `<button class="tm" data-tm="${i}"><span class="pc ${x.score >= 90 ? 'hi' : ''}">${x.score}%</span><span class="tmt">${esc(x.t)}</span><span class="tms">${esc(x.src)} · «${esc(x.s.slice(0, 60))}»</span></button>`).join('')
      : '<div class="hint">Схожих перекладів поки немає. Вони з’являться, коли ви перекладете схожі рядки.</div>';
    (pane as HTMLElement & { _m?: typeof m })._m = m;
  } else if (s.sideTab === 'glossary') {
    const hit = termsIn(u.source, s.saved.terms);
    pane.innerHTML = `<div class="sh">Глосарій у рядку</div>${hit.length ? hit.map(t => `<div class="gl"><b>${esc(t.en)}</b> → ${esc(t.uk)}</div>`).join('') : '<div class="hint">У цьому рядку термінів немає.</div>'}
      <form class="form" id="gl-form"><div class="sh">Додати термін</div><input name="en" placeholder="Англійською" aria-label="Термін англійською" required><input name="uk" placeholder="Українською" aria-label="Термін українською" required><button class="btn">Додати</button></form>`;
  } else if (s.sideTab === 'comments') {
    const c = e?.comments ?? [];
    pane.innerHTML = `${c.length ? c.map(x => `<div class="cm"><b>${esc(x.who)}</b> <span class="hint">${when(x.at)}</span><div>${esc(x.text)}</div></div>`).join('') : '<div class="hint">Коментарів немає.</div>'}
      <form class="form" id="cm-form"><textarea name="text" rows="3" placeholder="Коментар або питання до цього рядка" aria-label="Коментар" required></textarea><button class="btn">Додати коментар</button></form>`;
  } else {
    const h = [...(e?.history ?? [])].reverse();
    pane.innerHTML = h.length ? h.map(x => `<div class="cm"><b>${esc(x.who)}</b> · ${esc(x.what)} <span class="hint">${when(x.at)}</span>${x.text ? `<div class="hint">${esc(x.text.slice(0, 160))}</div>` : ''}</div>`).join('') : '<div class="hint">Змін ще не було.</div>';
  }
}

/** Handle editor-specific clicks. Returns true when the event was consumed. */
export function onEditorClick(ctx: Ctx, t: HTMLElement): boolean {
  const { s } = ctx;
  const u = s.cur ? ctx.unit(s.cur) : undefined;
  if (!u || !s.current) return false;
  const ents = ctx.entries(s.current);
  const ta = document.getElementById('ed-tr') as HTMLTextAreaElement | null;
  const setText = (text: string, what: string) => {
    ents[u.key] = note(edit0(ctx, u, text), what, text, s.who, Date.now());
    ctx.persist(); ctx.invalidateTm(); ctx.render();
  };
  const tab = t.closest<HTMLElement>('[data-side]');
  if (tab) { s.sideTab = tab.dataset.side as SideTab; ctx.render(); return true; }
  if (t.closest('#ed-copy')) { setText(u.source, 'скопійовано оригінал'); return true; }
  if (t.closest('#ed-clear')) { setText('', 'очищено'); return true; }
  if (t.closest('#ed-code')) {
    const cur = ta?.value ?? '';
    const miss = missingCodes(u.source, cur);
    if (!miss.length) { toast('Усі керівні коди вже є'); return true; }
    setText(cur + miss.join(''), 'додано керівні коди');
    return true;
  }
  if (t.closest('#ed-prev')) { step(ctx, -1); return true; }
  if (t.closest('#ed-next')) { step(ctx, 1); return true; }
  if (t.closest('#ed-send')) { send(ctx); return true; }
  if (t.closest('#ed-back')) {
    const cur = ents[u.key];
    if (!cur) return true;
    ents[u.key] = note(sendBack(cur, Date.now()), 'повернуто перекладачу', '', s.who, Date.now());
    ctx.persist(); toast('Повернуто перекладачу'); step(ctx, 1); return true;
  }
  const tm = t.closest<HTMLElement>('[data-tm]');
  if (tm) {
    const pane = document.getElementById('ed-side') as (HTMLElement & { _m?: { t: string; score: number }[] }) | null;
    const m = pane?._m?.[Number(tm.dataset.tm)];
    if (m) setText(m.t, `підставлено з пам’яті (${m.score}%)`);
    return true;
  }
  return false;
}

export function onEditorSubmit(ctx: Ctx, form: HTMLFormElement): boolean {
  const { s } = ctx;
  const u = s.cur ? ctx.unit(s.cur) : undefined;
  if (!u || !s.current) return false;
  const data = new FormData(form);
  if (form.id === 'gl-form') {
    const en = String(data.get('en') ?? '').trim(), uk = String(data.get('uk') ?? '').trim();
    if (!en || !uk) return true;
    if (s.saved.terms.some(t => t.en.toLowerCase() === en.toLowerCase())) { toast('Такий термін уже є'); return true; }
    s.saved.terms.push({ en, uk, mt: Date.now() });
    ctx.persist(); ctx.render(); toast('Термін додано');
    return true;
  }
  if (form.id === 'cm-form') {
    const text = String(data.get('text') ?? '').trim();
    if (!text) return true;
    const ents = ctx.entries(s.current);
    ents[u.key] = addComment(ents[u.key], s.who, text, Date.now());
    ctx.persist(); ctx.render();
    return true;
  }
  return false;
}

export function onEditorInput(ctx: Ctx, ta: HTMLTextAreaElement): void {
  const { s } = ctx;
  const u = ctx.unit(ta.dataset.key ?? '');
  if (!u || !s.current) return;
  const ents = ctx.entries(s.current);
  ents[u.key] = edit0(ctx, u, ta.value);
  ctx.persist();
  const box = ta.closest('.edit')?.parentElement;
  if (box) refreshStatus(ctx, box, u);
}

function edit0(ctx: Ctx, u: Unit, text: string): Entry {
  const prev = ctx.entries(ctx.s.current!)[u.key];
  const stage = ctx.s.mode === 'review' ? 'review' : 'translate';
  return editFn(prev, u, text, stage, Date.now());
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
  const stage = s.mode === 'review' ? 'review' : 'translate';
  const r = submit(ents[u.key], u, stage, Date.now(), { blockErrors: s.saved.settings.blockErrors, qa: ctx.qaOpts() });
  if (!r.ok) { toast(r.reason); return; }
  ents[u.key] = note(r.entry, stage === 'translate' ? 'надіслано на вичитування' : 'вичитано', r.entry.target, s.who, Date.now());
  ctx.persist(); ctx.invalidateTm();
  toast(stage === 'translate' ? 'Надіслано на вичитування' : 'Вичитано');
  const list = ctx.visible();
  const i = list.findIndex(x => x.key === u.key);
  const next = list[i + 1] ?? list[i];
  if (next && next.key !== u.key) ctx.select(next.key); else ctx.render();
}

