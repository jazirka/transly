import { hasGap, joinAlts, patternParts, removeTerm, rowsWithTerm, saveTerm, strandKind, termChange, termRowsNote, termsStamp } from '../core';
import type { GlossaryTerm } from '../core';
import { $, esc, plural, toast } from './dom';
import { oneLine } from './hintcards';
import { openLinkRows } from './links-dialog';
import { mineClick, suggestionsList } from './mine-panel';
import { entriesWithDifferences, usageAll, usageLine, usageRev } from './strands-panel';
import { offerTermSync } from './termsync-dialog';
import type { Ctx } from './state';

/**
 * The project's glossary as a section of the left panel: search, add, change, delete. It is the same list the checks
 * and the hints read, and a change here is written the same way a change on the phone is (see `core/termedit.ts`).
 */

const SEARCH = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/></svg>';

export const GLOSSARY_HTML = `<div class="slist glpanel" id="lp-gl" hidden>
  <div class="ph card-ph" data-card="glossary"><span class="grow">Пов’язане</span><span class="ico" data-hide-left="glossary" role="button" tabindex="0" aria-label="Сховати панель «Глосарій»" title="Сховати">—</span></div>
  <div class="fh">
    <div class="fin">${SEARCH}<input class="qin" id="gl-q" placeholder="Пошук серед записів" aria-label="Пошук серед записів" autocomplete="off" spellcheck="false"></div>
    <div class="gl-chips chips2" id="gl-chips" role="group" aria-label="Вид записів"></div>
    <div class="gl-bar"><span class="hint" id="gl-n"></span><button class="btn p" id="gl-new" type="button">＋ Додати</button></div>
  </div>
  <form class="gl-form" id="gl-form" hidden autocomplete="off">
    <div class="lbl" id="gl-form-t">Новий термін</div>
    <label class="gl-f"><span>Оригінал (EN)</span><input id="gl-en" aria-label="Слово або конструкція англійською" placeholder="слово або конструкція: take … off"></label>
    <label class="gl-f"><span>Переклад (UK)</span><input id="gl-uk" aria-label="Переклад українською" placeholder="як перекладати"></label>
    <label class="gl-f"><span>Інші прийнятні переклади</span><input id="gl-alt" placeholder="через «;»" aria-label="Інші прийнятні переклади"></label>
    <label class="gl-f"><span>Категорія</span><input id="gl-kind" placeholder="наприклад, Weapons" aria-label="Категорія"></label>
    <label class="gl-f"><span>Примітка</span><textarea id="gl-note" rows="2" aria-label="Примітка"></textarea></label>
    <label class="achk"><input type="checkbox" id="gl-qa" checked> Перевіряти термін під час QA</label>
    <div class="gl-acts"><button class="btn p" id="gl-save" type="submit">Зберегти</button><button class="btn" id="gl-cancel" type="button">Скасувати</button></div>
  </form>
  <div class="sl-body" id="gl-list"></div>
</div>`;

/** What is typed in the search box. */
let query = '';
/** The original word of the term being changed ('' for a new term); null while the form is closed. */
let editing: string | null = null;
/** Term waiting for the second click of a deletion. */
let deleting: string | null = null;
let deleteTimer = 0;

const SHOWN = 200;
const norm = (s: string): string => s.trim().toLowerCase();

/** How well a term fits the search: 0 exact … 3 contains, 4 does not fit. */
function rank(t: GlossaryTerm, q: string): number {
  if (!q) return 3;
  const names = [t.en, t.uk, ...(t.alt ?? [])].map(norm);
  if (names.some(n => n === q)) return 0;
  if (names.some(n => n.startsWith(q))) return 1;
  if (names.some(n => n.split(/[^\p{L}\p{N}]+/u).some(w => w.startsWith(q)))) return 2;
  return names.some(n => n.includes(q)) || norm(t.kind ?? '').includes(q) || norm(t.note ?? '').includes(q) ? 3 : 4;
}

const KIND_WORD = { word: 'слово', phrase: 'фраза', construction: 'конструкція' } as const;

function card(ctx: Ctx, t: GlossaryTerm, withUse: boolean): string {
  const askDelete = deleting === norm(t.en);
  const use = withUse ? usageLine(usageAll(ctx, t)) : '';
  return `<div class="gt-card" data-term="${esc(t.en)}">
    <div class="gt-h"><b>${esc(t.en)}</b><span class="arr">→</span><span class="uk">${esc(t.uk)}</span></div>
    <div class="gt-m"><span class="tg k">${KIND_WORD[strandKind(t.en)]}</span>${use ? `<span class="hint">${esc(use)}</span>` : ''}${t.kind ? `<span class="kchip" title="Категорія терміна">${esc(t.kind)}</span>` : ''}${t.qa === false ? '<span class="tagi">лише підказка, без QA</span>' : '<span class="qatag" title="Перевіряється під час QA">QA</span>'}${t.alt?.length ? `<span class="gt-alt">також: ${esc(t.alt.join(', '))}</span>` : ''}</div>
    ${t.note ? `<div class="gt-note">${esc(t.note)}</div>` : ''}
    <div class="gt-acts"><button class="lnk" type="button" data-gt="edit" data-en="${esc(t.en)}">Змінити</button><button class="lnk ${askDelete ? 'danger on' : ''}" type="button" data-gt="del" data-en="${esc(t.en)}">${askDelete ? 'Справді видалити?' : 'Видалити'}</button></div>
  </div>`;
}

function fillForm(t: GlossaryTerm | undefined): void {
  const set = (id: string, v: string): void => { ($(id) as HTMLInputElement | HTMLTextAreaElement).value = v; };
  set('#gl-en', t?.en ?? ''); set('#gl-uk', t?.uk ?? ''); set('#gl-alt', joinAlts(t?.alt)); set('#gl-kind', t?.kind ?? ''); set('#gl-note', t?.note ?? '');
  ($('#gl-qa') as HTMLInputElement).checked = t?.qa !== false;
  $('#gl-form-t').textContent = t ? `Змінити запис «${t.en}»` : 'Новий запис';
}

/** Which entries the list shows: all, words and phrases, constructions (with a gap), the groups of identical rows, or the entries rendered differently somewhere. */
type Show = 'all' | 'word' | 'construction' | 'rows' | 'memory' | 'diff';
/** The memory is counted (which builds its index) only after it was asked for once. */
let memoryAsked = false;
let show: Show = 'all';
/** The entries with differences, worked out in slices; null while it is being worked out. */
let diffs: { stamp: string; set: Set<string> } | null = null;
let diffsFor = '';

const stampOf = (ctx: Ctx): string => `${termsStamp(ctx.s.saved.terms)}|${usageRev()}|${ctx.s.views.length}`;

function chipsHtml(ctx: Ctx, counts: Record<Show, number | null>): string {
  const labels: [Show, string][] = [['all', 'Усе'], ['word', 'Слова'], ['construction', 'Конструкції'], ['rows', 'Рядки'], ['memory', 'Пам’ять'], ['diff', 'Розбіжності']];
  return labels.map(([k, l]) => `<button type="button" class="chip${show === k ? ' on' : ''}${counts[k] === 0 && show !== k ? ' idle' : ''}" data-glk="${k}" aria-pressed="${show === k}">${l}${counts[k] === null ? '' : ` <span class="n">${counts[k]}</span>`}</button>`).join('');
}

/** The groups of rows with the same original, the biggest first (the old «Зв’язані рядки»). */
function clusterCards(ctx: Ctx, q: string): { html: string; total: number } {
  const all = [...ctx.links().clusters()].filter(([text]) => !q || norm(text).includes(q)).sort((a, b) => b[1].length - a[1].length);
  const html = all.slice(0, SHOWN).map(([text, rows]) => {
    const first = rows[0]!;
    return `<div class="gt-card" data-cluster="${esc(text)}">
      <div class="gt-h"><b>${esc(oneLine(text, 80))}</b></div>
      <div class="gt-m"><span class="tg k">однаковий рядок</span><span class="hint">× ${rows.length}</span></div>
      <div class="gt-acts"><button class="lnk" type="button" data-gt="open-row" data-file="${esc(first.file)}" data-key="${esc(first.key)}">Відкрити</button><button class="lnk" type="button" data-gt="sync-rows" data-file="${esc(first.file)}" data-key="${esc(first.key)}">Поширити переклад…</button></div>
    </div>`;
  }).join('');
  return { html, total: all.length };
}

/** Draw the list. The form is only filled when it is opened, so what is typed in it survives redraws. */
export function renderGlossaryPanel(ctx: Ctx): void {
  const terms = ctx.s.saved.terms;
  const q = norm(query);
  const stamp = stampOf(ctx);
  // the entries rendered differently somewhere are worked out when that filter is chosen, and again when the translations changed
  if (show === 'diff' && (!diffs || diffs.stamp !== stamp) && diffsFor !== stamp) {
    diffsFor = stamp;
    void entriesWithDifferences(ctx, terms).then(set => { diffs = { stamp, set }; if (document.getElementById('gl-list') && show === 'diff') renderGlossaryPanel(ctx); }).catch(() => { diffsFor = ''; });
  }
  const isConstruction = (t: GlossaryTerm): boolean => hasGap(t.en) && patternParts(t.en).length > 1;
  const counts: Record<Show, number | null> = {
    all: terms.length, word: terms.filter(t => !isConstruction(t)).length, construction: terms.filter(isConstruction).length,
    rows: ctx.links().size, memory: memoryAsked ? ctx.tm().size : null, diff: diffs && diffs.stamp === stamp ? diffs.set.size : null,
  };
  $('#gl-chips').innerHTML = chipsHtml(ctx, counts);
  $('#gl-form').hidden = editing === null;
  const list = $('#gl-list');
  if (show === 'rows') {
    const c = clusterCards(ctx, q);
    $('#gl-n').textContent = c.total ? `${plural(c.total, ['група однакових рядків', 'групи однакових рядків', 'груп однакових рядків'])}` : 'Однакових рядків немає';
    list.innerHTML = c.total ? c.html + (c.total > SHOWN ? `<div class="grid-note">Показано ${SHOWN} із ${c.total}. Уточніть пошук.</div>` : '') : '<div class="empty-state"><b>Однакових рядків немає</b><span>Тут з’являються рядки, чий оригінал повторюється в грі.</span></div>';
    return;
  }
  if (show === 'memory') {
    memoryAsked = true;
    const tm = ctx.tm();
    const hits = q ? tm.search(query, SHOWN) : [];
    const label = (x: string): string => (x === 'Імпорт' ? 'імпорт' : x.replace(/\.json$/, ''));
    $('#gl-n').textContent = `${plural(tm.size, ['пара', 'пари', 'пар'])} у пам’яті${q ? ` · знайдено ${hits.length}` : ''}`;
    list.innerHTML = !q ? '<div class="empty-state"><b>Пам’ять перекладів</b><span>Введіть слово в пошуку: покажу, як воно вже перекладалося.</span></div>'
      : hits.length ? hits.map(x => `<div class="gt-card mem"><div class="gt-h"><span>${esc(oneLine(x.s, 120))}</span></div><div class="gt-note">${esc(oneLine(x.t, 160))}</div><div class="gt-m"><span class="tg k">пам’ять</span><span class="hint">${esc(label(x.src))}</span></div></div>`).join('')
        : '<div class="empty-state"><b>У пам’яті цього немає</b><span>Спробуйте інше слово.</span></div>';
    return;
  }
  const pool = show === 'word' ? terms.filter(t => !isConstruction(t)) : show === 'construction' ? terms.filter(isConstruction) : show === 'diff' ? terms.filter(t => diffs?.stamp === stamp && diffs.set.has(t.en)) : terms;
  const found = pool.map(t => [rank(t, q), t] as const).filter(([r]) => r < 4).sort((a, b) => a[0] - b[0] || a[1].en.localeCompare(b[1].en, 'en')).map(([, t]) => t);
  $('#gl-n').textContent = terms.length ? `${plural(pool.length, ['запис', 'записи', 'записів'])}${q ? ` · знайдено ${found.length}` : ''}` : 'Записів ще немає';
  if (show === 'diff' && (!diffs || diffs.stamp !== stamp)) { list.innerHTML = '<div class="empty-state"><b>Рахую розбіжності…</b><span>Дивлюсь, де запис перекладено не так, як у ньому сказано.</span></div>'; return; }
  const prop = show === 'construction' && !q ? suggestionsList(ctx).html : '';
  list.innerHTML = prop + (found.length
    ? found.slice(0, SHOWN).map((t, i) => card(ctx, t, i < 30)).join('') + (found.length > SHOWN ? `<div class="grid-note">Показано ${SHOWN} із ${found.length}. Уточніть пошук.</div>` : '')
    : (prop ? '' : `<div class="empty-state"><b>${terms.length ? 'Нічого не знайдено' : 'Записів ще немає'}</b><span>${terms.length ? (show === 'diff' ? 'Усі записи перекладено так, як у них сказано.' : 'Спробуйте інше слово або частину слова.') : 'Додайте перший запис кнопкою вище або імпортуйте таблицю в налаштуваннях.'}</span></div>`));
}

/** Show the glossary filtered to one word (a result of the global search, or the term in a hint). */
export function showTerm(ctx: Ctx, en: string): void {
  query = en; editing = null; deleting = null;
  const box = document.getElementById('gl-q') as HTMLInputElement | null;
  if (box) box.value = en;
  renderGlossaryPanel(ctx);
}

/** Open the form to change an existing term (from the card of the term). */
export function editTerm(ctx: Ctx, en: string): void {
  const term = ctx.s.saved.terms.find(x => norm(x.en) === norm(en));
  if (!term) return;
  query = term.en; editing = term.en; deleting = null;
  const box = document.getElementById('gl-q') as HTMLInputElement | null;
  if (box) box.value = term.en;
  fillForm(term);
  renderGlossaryPanel(ctx);
  ($('#gl-uk') as HTMLInputElement).focus();
}

/** Open the form for a new term (`en` and `uk` may be filled in already). */
export function newTerm(ctx: Ctx, en = '', uk = ''): void {
  editing = '';
  fillForm(undefined);
  ($('#gl-en') as HTMLInputElement).value = en; ($('#gl-uk') as HTMLInputElement).value = uk;
  renderGlossaryPanel(ctx);
  ($(en ? '#gl-uk' : '#gl-en') as HTMLInputElement).focus();
}

export function wireGlossary(ctx: Ctx): void {
  const root = $('#lp-gl');
  root.addEventListener('input', e => {
    if ((e.target as HTMLElement).id === 'gl-q') { query = ($('#gl-q') as HTMLInputElement).value; renderGlossaryPanel(ctx); }
  });
  root.addEventListener('keydown', e => {
    if (e.key === 'Escape' && editing !== null) { e.preventDefault(); e.stopPropagation(); editing = null; renderGlossaryPanel(ctx); }
  });
  $('#gl-form').addEventListener('submit', e => {
    e.preventDefault();
    const val = (id: string): string => ($(id) as HTMLInputElement | HTMLTextAreaElement).value;
    // a copy of the term as it was: after the change its old rendering is looked for in the translations
    const typed = val('#gl-en');
    if (hasGap(typed) && patternParts(typed).length < 2) { toast('Конструкції потрібні принаймні два слова з пропуском між ними: «take … off». Для одного слова пропуск не потрібен'); return; }
    const was = editing ? ctx.s.saved.terms.find(x => norm(x.en) === norm(editing!)) : undefined;
    const prev = was ? { en: was.en, uk: was.uk, alt: [...(was.alt ?? [])] } : undefined;
    const r = saveTerm(ctx.s.saved, { en: val('#gl-en'), uk: val('#gl-uk'), alt: val('#gl-alt'), kind: val('#gl-kind'), note: val('#gl-note'), qa: ($('#gl-qa') as HTMLInputElement).checked }, Date.now(), editing || undefined);
    if (r === null) { toast('Заповніть оригінал і переклад'); return; }
    if (r === 'exists') { toast('Такий термін уже є: змініть його у списку'); return; }
    const en = val('#gl-en').trim();
    editing = null;
    ctx.persist(); ctx.invalidateTm(); ctx.render();
    toast(r === 'added' ? `Запис «${en}» додано` : `Запис «${en}» змінено`);
    if (r === 'added') {
      // Where the new word already stands in the originals: what was translated without it, and what is still to be translated.
      const term = ctx.s.saved.terms.find(x => norm(x.en) === norm(en));
      const rows = term ? rowsWithTerm(ctx.s.views, ctx.s.saved, term) : null;
      const note = rows ? termRowsNote(en, rows) : '';
      if (rows && note) toast(note, rows.lacking.length ? { action: { label: 'Показати', run: () => ctx.openRows(`Рядки з «${en}»`, [...rows.lacking, ...rows.waiting]) } } : {});
    }
    if (r === 'changed') {
      const now = ctx.s.saved.terms.find(x => norm(x.en) === norm(en));
      const change = now ? termChange(prev, { en: now.en, uk: now.uk, alt: now.alt }) : null;
      if (change) offerTermSync(ctx, change);
    }
  });
}

/** Clicks in the glossary section. Returns true when handled. */
export function glossaryClick(ctx: Ctx, t: HTMLElement): boolean {
  if (!t.closest('#lp-gl')) return false;
  if (mineClick(ctx, t)) return true;
  const chip = t.closest<HTMLElement>('[data-glk]');
  if (chip) { show = (chip.dataset.glk as Show) ?? 'all'; renderGlossaryPanel(ctx); return true; }
  if (t.closest('#gl-new')) { newTerm(ctx); return true; }
  if (t.closest('#gl-cancel')) { editing = null; renderGlossaryPanel(ctx); return true; }
  const b = t.closest<HTMLElement>('[data-gt]');
  if (!b) return false;
  if (b.dataset.gt === 'open-row') { ctx.open(b.dataset.file ?? '', b.dataset.key ?? ''); return true; }
  if (b.dataset.gt === 'sync-rows') { openLinkRows(ctx, b.dataset.file ?? '', b.dataset.key ?? ''); return true; }
  const en = b.dataset.en ?? '';
  if (b.dataset.gt === 'edit') {
    editing = en;
    const term = ctx.s.saved.terms.find(x => norm(x.en) === norm(en));
    fillForm(term);
    renderGlossaryPanel(ctx);
    ($('#gl-uk') as HTMLInputElement).focus();
    return true;
  }
  if (b.dataset.gt === 'del') {
    // Two clicks: the first only asks, the second deletes.
    if (deleting !== norm(en)) {
      deleting = norm(en); window.clearTimeout(deleteTimer);
      deleteTimer = window.setTimeout(() => { deleting = null; if (document.getElementById('gl-list')) renderGlossaryPanel(ctx); }, 4000);
      renderGlossaryPanel(ctx);
      return true;
    }
    window.clearTimeout(deleteTimer); deleting = null;
    if (removeTerm(ctx.s.saved, en, Date.now())) { ctx.persist(); ctx.invalidateTm(); ctx.render(); toast(`Запис «${en}» видалено`); }
    return true;
  }
  return false;
}
