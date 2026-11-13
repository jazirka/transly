import { joinAlts, removeTerm, rowsWithTerm, saveTerm, termChange, termRowsNote } from '../core';
import type { GlossaryTerm } from '../core';
import { $, esc, plural, toast } from './dom';
import { offerTermSync } from './termsync-dialog';
import type { Ctx } from './state';

/**
 * The project's glossary as a section of the left panel: search, add, change, delete. It is the same list the checks
 * and the hints read, and a change here is written the same way a change on the phone is (see `core/termedit.ts`).
 */

const SEARCH = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/></svg>';

export const GLOSSARY_HTML = `<div class="slist glpanel" id="lp-gl" hidden>
  <div class="ph card-ph" data-card="glossary"><span class="grow">Глосарій</span><span class="ico" data-hide-left="glossary" role="button" tabindex="0" aria-label="Сховати панель «Глосарій»" title="Сховати">—</span></div>
  <div class="fh">
    <div class="fin">${SEARCH}<input class="qin" id="gl-q" placeholder="Пошук у глосарії" aria-label="Пошук у глосарії" autocomplete="off" spellcheck="false"></div>
    <div class="gl-bar"><span class="hint" id="gl-n"></span><button class="btn p" id="gl-new" type="button">＋ Додати термін</button></div>
  </div>
  <form class="gl-form" id="gl-form" hidden autocomplete="off">
    <div class="lbl" id="gl-form-t">Новий термін</div>
    <label class="gl-f"><span>Оригінал (EN)</span><input id="gl-en" aria-label="Термін англійською"></label>
    <label class="gl-f"><span>Переклад (UK)</span><input id="gl-uk" aria-label="Термін українською"></label>
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

function card(t: GlossaryTerm): string {
  const askDelete = deleting === norm(t.en);
  return `<div class="gt-card" data-term="${esc(t.en)}">
    <div class="gt-h"><b>${esc(t.en)}</b><span class="arr">→</span><span class="uk">${esc(t.uk)}</span></div>
    <div class="gt-m">${t.kind ? `<span class="kchip" title="Категорія терміна">${esc(t.kind)}</span>` : ''}${t.qa === false ? '<span class="tagi">лише підказка, без QA</span>' : '<span class="qatag" title="Перевіряється під час QA">QA</span>'}${t.alt?.length ? `<span class="gt-alt">також: ${esc(t.alt.join(', '))}</span>` : ''}</div>
    ${t.note ? `<div class="gt-note">${esc(t.note)}</div>` : ''}
    <div class="gt-acts"><button class="lnk" type="button" data-gt="edit" data-en="${esc(t.en)}">Змінити</button><button class="lnk ${askDelete ? 'danger on' : ''}" type="button" data-gt="del" data-en="${esc(t.en)}">${askDelete ? 'Справді видалити?' : 'Видалити'}</button></div>
  </div>`;
}

function fillForm(t: GlossaryTerm | undefined): void {
  const set = (id: string, v: string): void => { ($(id) as HTMLInputElement | HTMLTextAreaElement).value = v; };
  set('#gl-en', t?.en ?? ''); set('#gl-uk', t?.uk ?? ''); set('#gl-alt', joinAlts(t?.alt)); set('#gl-kind', t?.kind ?? ''); set('#gl-note', t?.note ?? '');
  ($('#gl-qa') as HTMLInputElement).checked = t?.qa !== false;
  $('#gl-form-t').textContent = t ? `Змінити термін «${t.en}»` : 'Новий термін';
}

/** Draw the list. The form is only filled when it is opened, so what is typed in it survives redraws. */
export function renderGlossaryPanel(ctx: Ctx): void {
  const terms = ctx.s.saved.terms;
  const q = norm(query);
  const found = terms.map(t => [rank(t, q), t] as const).filter(([r]) => r < 4).sort((a, b) => a[0] - b[0] || a[1].en.localeCompare(b[1].en, 'en')).map(([, t]) => t);
  $('#gl-n').textContent = terms.length ? `${plural(terms.length, ['термін', 'терміни', 'термінів'])}${q ? ` · знайдено ${found.length}` : ''}` : 'Термінів ще немає';
  $('#gl-form').hidden = editing === null;
  $('#gl-list').innerHTML = found.length
    ? found.slice(0, SHOWN).map(card).join('') + (found.length > SHOWN ? `<div class="grid-note">Показано ${SHOWN} із ${found.length}. Уточніть пошук.</div>` : '')
    : `<div class="empty-state"><b>${terms.length ? 'Нічого не знайдено' : 'Глосарій порожній'}</b><span>${terms.length ? 'Спробуйте інше слово або частину слова.' : 'Додайте перший термін кнопкою вище або імпортуйте таблицю в налаштуваннях.'}</span></div>`;
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
    const was = editing ? ctx.s.saved.terms.find(x => norm(x.en) === norm(editing!)) : undefined;
    const prev = was ? { en: was.en, uk: was.uk, alt: [...(was.alt ?? [])] } : undefined;
    const r = saveTerm(ctx.s.saved, { en: val('#gl-en'), uk: val('#gl-uk'), alt: val('#gl-alt'), kind: val('#gl-kind'), note: val('#gl-note'), qa: ($('#gl-qa') as HTMLInputElement).checked }, Date.now(), editing || undefined);
    if (r === null) { toast('Заповніть оригінал і переклад'); return; }
    if (r === 'exists') { toast('Такий термін уже є: змініть його у списку'); return; }
    const en = val('#gl-en').trim();
    editing = null;
    ctx.persist(); ctx.invalidateTm(); ctx.render();
    toast(r === 'added' ? `Термін «${en}» додано` : `Термін «${en}» змінено`);
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
  if (t.closest('#gl-new')) { newTerm(ctx); return true; }
  if (t.closest('#gl-cancel')) { editing = null; renderGlossaryPanel(ctx); return true; }
  const b = t.closest<HTMLElement>('[data-gt]');
  if (!b) return false;
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
    if (removeTerm(ctx.s.saved, en, Date.now())) { ctx.persist(); ctx.invalidateTm(); ctx.render(); toast(`Термін «${en}» видалено`); }
    return true;
  }
  return false;
}
