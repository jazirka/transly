import { applyTheme, branchNames, branchOf, createBranch, deleteBranch, gameTitleOf, iconLetters, MAIN, nameSourceOf, projectTitle, renameBranch, rowsIn, switchBranch, themeHue, themeTokens } from '../core';
import type { NameSource, SavedProject } from '../core';
import { $, CRUMB, esc, plural, toast } from './dom';
import { BRANCH_ICON, askName } from './branches';
import type { BranchActions } from './branches';
import { isDesktop } from './desktop';
import { loadGithubConfig } from './github';
import { dialog, resetProject } from './settings';
import type { SettingsTab } from './settings';
import type { Ctx } from './state';

/** What the dialog of the project asks the shell for. */
export interface ProjectActions {
  branches: BranchActions;
  folder: { text: () => string; change: () => void; forget: () => void };
  /** The project was emptied: read the game's strings into it again. */
  reset: () => void;
  /** The settings of the whole app, on a page (GitHub, languages). */
  app: (tab: SettingsTab) => void;
}

export type ProjectTab = 'look' | 'branches' | 'folder' | 'github' | 'lang' | 'danger';

const TITLES: Record<ProjectTab, string> = { look: 'Назва й вигляд', branches: 'Гілки', folder: 'Папка гри', github: 'GitHub', lang: 'Мови', danger: 'Небезпечна зона' };
const GROUPS: [string, ProjectTab[]][] = [['Проєкт', ['look', 'branches', 'folder']], ['Підключення', ['github', 'lang']], ['Обережно', ['danger']]];

let lastPage: ProjectTab = 'look';

/** The project's own settings, apart from the settings of the app: how it is named and coloured, its branches, its game folder, the way out. */
export function openProjectSettings(ctx: Ctx, acts: ProjectActions, tab?: ProjectTab): void {
  const saved = (): SavedProject => ctx.s.saved;
  const st = saved().settings;
  const desk = isDesktop();
  const off = new Set<ProjectTab>(desk ? [] : ['folder']);

  /* ---- what is on the page «Назва й вигляд» (kept apart until it is applied) ---- */
  let from: NameSource = nameSourceOf(saved());
  let custom = st.title ?? '', letters = st.iconText ?? '', hue: number | undefined = st.hue;
  const draft = (): Pick<SavedProject, 'name' | 'settings' | 'snapshot'> => ({ name: saved().name, snapshot: saved().snapshot, settings: { ...st, nameFrom: from, title: custom, iconText: letters } });
  const folderName = (st.folderName ?? '').trim(), gameTitle = gameTitleOf(saved().snapshot);
  // the name of the repository the translation is kept in, when GitHub is connected: offered as a name (it never changes the name by itself)
  const ghRepo = (loadGithubConfig().repo.split('/').pop() ?? '').trim();
  const sample = (v: string, none: string): string => v ? `<b>${esc(v)}</b>` : `<span class="mute">${esc(none)}</span>`;

  const lookPage = `
    <div class="pjs-prev" id="pjs-prev" role="status" aria-live="polite"><span class="pj lg" id="pjs-av" aria-hidden="true"></span><div><b id="pjs-title"></b><small>Так проєкт виглядає в шапці й у меню</small></div></div>
    <div class="st-sub"><h3>Назва проєкту</h3>
      <div class="pjs-from" role="radiogroup" aria-label="Звідки береться назва">
        <label class="pjs-r"><input type="radio" name="pjs-from" value="folder" ${folderName ? '' : 'disabled'}> <span>З папки гри <small>${sample(folderName, 'папку ще не обрано')}</small></span></label>
        <label class="pjs-r"><input type="radio" name="pjs-from" value="game" ${gameTitle ? '' : 'disabled'}> <span>З назви в грі <small>${sample(gameTitle, 'гра не називає себе')}</small></span></label>
        <div class="pjs-r pjs-own"><label><input type="radio" name="pjs-from" value="custom"> <span>Своя назва</span></label><input id="pjs-name" aria-label="Своя назва" maxlength="80" autocomplete="off" spellcheck="false" value="${esc(custom)}" placeholder="наприклад, Покинута хатина"></div>
      </div>
      ${ghRepo ? `<p class="hint">Репозиторій GitHub цього проєкту називається «${esc(ghRepo)}». <button class="btn s" type="button" id="pjs-ghname">Взяти цю назву</button></p>` : ''}
      <p class="hint">Назва лише підпис: переклад, злиття й синхронізація від неї не залежать, тож її можна міняти будь-коли.</p></div>
    <div class="st-sub theme-set"><h3>Значок і колір</h3>
      <div class="grid"><label for="pjs-ico">Літери значка (1–2)</label><input id="pjs-ico" maxlength="2" autocomplete="off" spellcheck="false" value="${esc(letters)}" aria-describedby="pjs-ico-hint"></div>
      <p class="hint" id="pjs-ico-hint">Порожньо: перші літери назви (дві, якщо в назві два слова).</p>
      <div class="grid"><label for="th-hue">Колір акценту</label><input id="th-hue" type="range" min="0" max="359" step="1" aria-describedby="th-hint"></div>
      <div class="th-row"><span class="th-sw" id="th-sw" aria-hidden="true"></span><span class="hint" id="th-hint" role="status"></span><button class="btn" type="button" id="th-reset">Як за назвою</button></div>
      <div class="th-pre" id="th-pre" role="group" aria-label="Готові кольори">${[185, 215, 245, 275, 305, 335].map(h => `<button type="button" data-h="${h}" aria-label="Відтінок ${h}°" style="background:${themeTokens(h)['--accent']}"></button>`).join('')}</div>
      <p class="hint">Колір береться з холодної частини кола, щоб його не сплутати зі статусами. Він міняється в усьому застосунку одразу і лишається, коли ви збережете.</p></div>`;

  const dlg = dialog(`<form method="dialog" class="st pjs">
    <nav class="st-nav" id="st-nav" aria-label="Розділи налаштувань проєкту"><div class="st-tree" id="st-tree"></div></nav>
    <div class="st-main" id="st-main">
      <h2 id="st-t" class="st-crumb"></h2>
      <div class="st-content">
        <section class="st-page" data-page="look" data-sec="look" hidden>${lookPage}</section>
        <section class="st-page" data-page="branches" hidden><div id="pjs-br"></div><div class="acts l"><button class="btn" type="button" id="pjs-newbr">＋ Нова гілка…</button><button class="btn" type="button" id="pjs-merge">⇄ Злити гілку…</button></div></section>
        <section class="st-page" data-page="folder" hidden><div class="folder-set"><label for="st-folder">Папка гри цього проєкту</label><div class="folder-row"><span id="st-folder" class="path" tabindex="0"></span><button class="btn" type="button" id="pjs-fch">Змінити…</button><button class="btn" type="button" id="pjs-ffg">Забути</button></div></div>
          <p class="hint">Папка запам’ятовується для проєкту й відновлюється під час запуску. Її назва стає назвою проєкту, поки ви не оберете іншу.</p></section>
        <section class="st-page" data-page="github" hidden><p class="hint">Репозиторій, токен, гілка й папка в репозиторії, і синхронізація. Вони не залежать від самого проєкту: той самий токен годиться для кількох проєктів.</p><div class="acts l"><button class="btn" type="button" id="pjs-gh">Налаштування GitHub…</button></div></section>
        <section class="st-page" data-page="lang" hidden><p class="hint">Тексти плагінів, мовці та довідкові мови (та сама гра іншими мовами).</p><div class="acts l"><button class="btn" type="button" id="pjs-lang">Гра і мови…</button></div></section>
        <section class="st-page" data-page="danger" hidden><div class="st-warn bad" role="note"><span class="wi" aria-hidden="true">!</span><div><b>Скинути проєкт</b><span>Видаляє весь переклад, глосарій та імпортовану пам’ять ${desk ? 'у цьому застосунку' : 'у цьому браузері'}. Назва, колір і папка гри лишаються. Відновити неможливо: спершу збережіть проєкт у файл.</span></div></div>
          <div class="acts l"><button class="btn bad" type="button" id="pjs-reset">Скинути проєкт…</button></div></section>
      </div>
    </div>
    <div class="st-bar"><span class="st-dirty" id="st-dirty" role="status" hidden>Є незастосовані зміни</span>
      <button class="btn p" type="button" id="st-save">Зберегти</button><button class="btn" type="button" id="st-apply" disabled>Застосувати</button><button class="btn" type="button" id="st-cancel">Скасувати</button></div>
  </form>`, 'st-t');
  dlg.classList.add('st-dlg', 'pjs-dlg');
  const tree = $('#st-tree', dlg), crumb = $('#st-t', dlg), nav = $('#st-nav', dlg);
  const saveBtn = $('#st-save', dlg) as HTMLButtonElement, applyBtn = $('#st-apply', dlg) as HTMLButtonElement, dirtyEl = $('#st-dirty', dlg);
  const pages = new Map<ProjectTab, HTMLElement>();
  dlg.querySelectorAll<HTMLElement>('.st-page').forEach(p => pages.set(p.dataset.page as ProjectTab, p));
  const has = (id: ProjectTab): boolean => pages.has(id) && !off.has(id);
  let cur: ProjectTab = 'look';

  const drawTree = (): void => {
    tree.innerHTML = GROUPS.map(([g, ids]) => {
      const its = ids.filter(has);
      return its.length ? `<p class="st-gl">${esc(g)}</p>` + its.map(id => `<button type="button" class="st-ti flat" data-p="${id}"${id === cur ? ' aria-current="page"' : ''}>${esc(TITLES[id])}</button>`).join('') : '';
    }).join('');
  };
  const show = (id: ProjectTab, focus = false): void => {
    if (!has(id)) id = 'look';
    cur = lastPage = id;
    for (const [pid, p] of pages) p.hidden = pid !== id;
    crumb.innerHTML = `<span class="vh">Налаштування проєкту: </span><span>${esc(projectTitle(saved()))}</span>${CRUMB}<span>${esc(TITLES[id])}</span>`;
    drawTree();
    if (id === 'branches') drawBranches();
    if (focus) tree.querySelector<HTMLElement>('.st-ti[aria-current=page]')?.focus();
  };
  tree.addEventListener('click', e => { const t = (e.target as HTMLElement).closest<HTMLElement>('[data-p]'); if (t) show(t.dataset.p as ProjectTab, true); });
  tree.addEventListener('keydown', e => {
    const rows = [...tree.querySelectorAll<HTMLElement>('.st-ti')], i = rows.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    if (e.key === 'ArrowDown') { rows[i + 1]?.focus(); e.preventDefault(); } else if (e.key === 'ArrowUp') { rows[i - 1]?.focus(); e.preventDefault(); }
  });
  /* The part you work in wears the colour of the project; the other one is grey (as in the app's own windows). */
  const useNav = (on: boolean): void => { nav.classList.toggle('use', on); };
  nav.addEventListener('pointerdown', () => useNav(true)); nav.addEventListener('focusin', () => useNav(true));
  $('#st-main', dlg).addEventListener('pointerdown', () => useNav(false)); $('#st-main', dlg).addEventListener('focusin', () => useNav(false));
  useNav(true);

  /* ---- «Назва й вигляд» ---- */
  const radios = [...dlg.querySelectorAll<HTMLInputElement>('input[name=pjs-from]')];
  const nameIn = $('#pjs-name', dlg) as HTMLInputElement, icoIn = $('#pjs-ico', dlg) as HTMLInputElement;
  const hueSlider = $('#th-hue', dlg) as HTMLInputElement, hueReset = $('#th-reset', dlg) as HTMLButtonElement, swatches = $('#th-pre', dlg);
  let dirty = false, escAt = 0;
  const setDirty = (d: boolean): void => { dirty = d; applyBtn.disabled = !d; dirtyEl.hidden = !d; dirtyEl.textContent = 'Є незастосовані зміни'; };
  const paint = (): void => {
    const d = draft(), title = projectTitle(d), h = themeHue(title, hue);
    const lt = iconLetters(d);
    $('#pjs-av', dlg).textContent = lt; $('#pjs-av', dlg).classList.toggle('two', Array.from(lt).length > 1);
    $('#pjs-title', dlg).textContent = title;
    for (const r of radios) r.checked = r.value === from;
    ($('#pjs-ico-hint', dlg)).textContent = letters.trim() ? 'Свої літери: вони не залежать від назви.' : `Порожньо: перші літери назви (${iconLetters({ ...d, settings: { ...d.settings, iconText: '' } })}).`;
    hueSlider.value = String(h);
    $('#th-sw', dlg).style.background = themeTokens(h)['--accent']!;
    $('#th-hint', dlg).textContent = hue === undefined ? `Колір береться з назви проєкту: ${h}°` : `Обрано вручну: ${h}°`;
    hueReset.disabled = hue === undefined;
    swatches.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.h) === h)));
    // tried on the whole app at once; put back when the dialog closes without saving
    applyTheme(document.documentElement, h);
    const bc = $('#st-t', dlg).lastElementChild; if (bc && cur === 'look') bc.textContent = TITLES.look;
  };
  const edit = (fn: () => void): void => { fn(); setDirty(true); paint(); };
  radios.forEach(r => r.addEventListener('change', () => edit(() => { from = r.value as NameSource; })));
  nameIn.addEventListener('input', () => edit(() => { custom = nameIn.value; if (custom.trim()) from = 'custom'; }));
  dlg.querySelector('#pjs-ghname')?.addEventListener('click', () => edit(() => { custom = ghRepo; nameIn.value = ghRepo; from = 'custom'; }));
  icoIn.addEventListener('input', () => edit(() => { letters = icoIn.value; }));
  swatches.querySelectorAll('button').forEach(b => b.addEventListener('click', () => edit(() => { hue = Number((b as HTMLElement).dataset.h); })));
  hueSlider.addEventListener('input', () => edit(() => { hue = Number(hueSlider.value); }));
  hueReset.addEventListener('click', () => edit(() => { hue = undefined; }));

  const commit = (): boolean => {
    if (from === 'custom' && !custom.trim()) { show('look'); nameIn.setAttribute('aria-invalid', 'true'); nameIn.focus(); toast('Напишіть свою назву або виберіть іншу'); return false; }
    if (from === 'folder') delete st.nameFrom; else st.nameFrom = from;
    if (custom.trim()) st.title = custom.trim(); else delete st.title;
    if (letters.trim()) st.iconText = letters.trim(); else delete st.iconText;
    if (hue === undefined) delete st.hue; else st.hue = hue;
    saved().settingsAt = Date.now(); ctx.persist(); ctx.render();
    setDirty(false);
    return true;
  };
  saveBtn.addEventListener('click', () => { if (!dirty || commit()) dlg.close(); });
  applyBtn.addEventListener('click', () => { if (commit()) toast('Збережено'); });
  $('#st-cancel', dlg).addEventListener('click', () => { setDirty(false); dlg.close(); });
  dlg.addEventListener('cancel', e => {
    if (!dirty) return;
    if (Date.now() - escAt < 4000) return;
    e.preventDefault(); escAt = Date.now();
    dirtyEl.textContent = 'Є незастосовані зміни: Esc ще раз скасує їх'; dirtyEl.classList.remove('flash'); void dirtyEl.offsetWidth; dirtyEl.classList.add('flash');
  });
  // however the dialog is closed, the app shows the saved colour (the one tried on it is gone)
  dlg.addEventListener('close', () => { applyTheme(document.documentElement, themeHue(projectTitle(saved()), saved().settings.hue)); });

  /* ---- «Гілки» ---- */
  const wrapped: BranchActions = { saved, merge: acts.branches.merge, apply: (next, note) => { acts.branches.apply(next, note); if (dlg.open) drawBranches(); } };
  const drawBranches = (): void => {
    const p = saved(), now = branchOf(p), names = branchNames(p);
    $('#pjs-br', dlg).innerHTML = `<table class="pjs-brt"><thead><tr><th scope="col">Гілка</th><th scope="col">Від</th><th scope="col">Рядків</th><th scope="col"><span class="vh">Дії</span></th></tr></thead><tbody>${names.map(n => {
      const b = p.branches?.[n];
      const acts_ = `${n === now ? '<span class="ok">поточна ✓</span>' : `<button class="btn s" type="button" data-bs="${esc(n)}">Перемкнути</button>`}${n === MAIN ? '' : `<button class="btn s" type="button" data-br="${esc(n)}">Перейменувати…</button>`}${n === MAIN || n === now ? '' : `<button class="btn s" type="button" data-bd="${esc(n)}">Видалити</button>`}`;
      return `<tr${n === now ? ' class="cur"' : ''}><th scope="row"><span class="cfg-t">${BRANCH_ICON}${esc(n)}</span></th><td>${n === MAIN ? 'основна' : b?.from ? esc(b.from) : '—'}</td><td>${plural(rowsIn(p, n), ['рядок', 'рядки', 'рядків'])}</td><td class="pjs-act">${acts_}</td></tr>`;
    }).join('')}</tbody></table>`;
    ($('#pjs-merge', dlg) as HTMLButtonElement).disabled = names.length < 2;
  };
  $('#pjs-br', dlg).addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!b) return;
    const p = saved();
    if (b.dataset.bs !== undefined) { wrapped.apply(switchBranch(p, b.dataset.bs), `Гілка «${b.dataset.bs}»`); return; }
    if (b.dataset.br !== undefined) { const from_ = b.dataset.br; askName(wrapped, `Перейменувати «${from_}»`, 'Перейменувати', from_, name => renameBranch(wrapped.saved(), from_, name), name => `Гілку названо «${name}»`); return; }
    if (b.dataset.bd !== undefined) {
      // asks once more, on the very same spot
      if (!b.dataset.sure) { b.dataset.sure = '1'; b.textContent = 'Так, видалити'; b.classList.add('p'); return; }
      const name = b.dataset.bd;
      wrapped.apply(deleteBranch(wrapped.saved(), name, Date.now()), `Гілку «${name}» видалено`);
    }
  });
  $('#pjs-newbr', dlg).addEventListener('click', () => askName(wrapped, 'Нова гілка', 'Створити', '', name => createBranch(wrapped.saved(), name, Date.now()), name => `Створено гілку «${name}» і перемкнуто на неї`));
  $('#pjs-merge', dlg).addEventListener('click', () => { if (dirty && !commit()) return; dlg.close(); void import('./branches').then(m => m.chooseMerge(acts.branches)); });

  /* ---- «Папка гри», «GitHub», «Мови» ---- */
  const showFolder = (): void => { const f = dlg.querySelector<HTMLElement>('#st-folder'); if (f) { f.textContent = acts.folder.text(); f.title = f.textContent; } };
  showFolder();
  const away = (fn: () => void): void => { if (dirty && !commit()) return; dlg.close(); fn(); };
  $('#pjs-fch', dlg).addEventListener('click', () => away(acts.folder.change));
  $('#pjs-ffg', dlg).addEventListener('click', () => { acts.folder.forget(); showFolder(); toast('Папку гри забуто'); });
  $('#pjs-gh', dlg).addEventListener('click', () => away(() => acts.app('github')));
  $('#pjs-lang', dlg).addEventListener('click', () => away(() => acts.app('lang')));

  /* ---- «Небезпечна зона» ---- */
  const resetBtn = $('#pjs-reset', dlg), idle = resetBtn.textContent ?? '';
  let armed = false, armedAt = 0, armTimer: ReturnType<typeof setTimeout> | null = null;
  const disarm = (): void => { armed = false; resetBtn.textContent = idle; if (armTimer) { clearTimeout(armTimer); armTimer = null; } };
  resetBtn.addEventListener('click', () => {
    // two clicks instead of confirm(): embedded frames suppress browser dialogs; the second one waits a moment so a double-click cannot confirm
    if (!armed) { armed = true; armedAt = Date.now(); resetBtn.textContent = 'Так, видалити весь переклад'; armTimer = setTimeout(disarm, 6000); return; }
    if (Date.now() - armedAt < 1200) return;
    resetProject(ctx, acts.reset); setDirty(false); dlg.close();
  });

  show(tab ?? lastPage);
  paint();
  if (!has(cur)) show('look');
}
