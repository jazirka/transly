import { i18n, touchTerms, stamp, DEFAULT_SETTINGS, emptyProject, linkModeOf, parseDelimited, parseHtmlTable, parseTerms, referenceSets, serialize, termsFromTable, withoutReference, uiLocale } from '../core';
import type { GlossaryTerm, LinkMode } from '../core';
import { $, CRUMB, el, esc, plural, toast } from './dom';
import { isDesktop } from './desktop';
import { setInterfaceLanguage } from './ext';
import { showDialog } from './modal';
import { nativeChrome, setNativeChrome } from './winctl';
import { forgetPlaces, pagesPrefs, setPagesPrefs } from './pages';
import { PAGE_SIZES } from '../core';
import type { Ctx } from './state';
import { artifactDb, describeClaude, loadClaudeConfig, runClaudeSync, saveClaudeConfig } from './claude';
import { DEFAULT_API, describeGithub, loadGithubConfig, runGithubSync, saveGithubConfig } from './github';
import { importProjectText } from './import-dialog';
import { importReference } from './reference';
import { saveFile } from './save';
import { loadUpdateConfig, updatePlatform, updateSectionHtml, wireUpdateSection } from './updates';
import { openSpeakers } from './speakers-dialog';
import { describe, loadSyncConfig, runSync, saveSyncConfig, syncConfigured, syncUrlProblem } from './sync';

/** Open a <dialog> above the app (see `modal.ts`); it closes on Esc and restores focus to the opener. */
export function dialog(html: string, labelId: string): HTMLDialogElement {
  const opener = document.activeElement as HTMLElement | null;
  const dlg = el('dialog', 'adlg');
  dlg.setAttribute('aria-labelledby', labelId);
  dlg.innerHTML = html;
  document.body.appendChild(dlg);
  dlg.addEventListener('close', () => { dlg.remove(); opener?.focus?.(); });
  showDialog(dlg);
  return dlg;
}


/** What stays of the settings when the project is reset: how it is named and coloured is not translation. */
const KEEP_ON_RESET = ['nameFrom', 'title', 'folderName', 'iconText', 'hue'] as const;

/** Empty the project (the translation, the glossary, the memory); its name, colour and the folder of the game stay. */
export function resetProject(ctx: Ctx, onReset: () => void): void {
  const old = ctx.s.saved;
  const fresh = { ...emptyProject(old.name), resetEpoch: Math.max(old.resetEpoch, Date.now()) };
  for (const k of KEEP_ON_RESET) if (old.settings[k] !== undefined) (fresh.settings as unknown as Record<string, unknown>)[k] = old.settings[k];
  ctx.s.saved = fresh;
  ctx.invalidateTm(); onReset();
  toast('Проєкт скинуто');
}

/** Things the settings dialog starts but the shell owns. */
export interface SettingsActions { extensions: () => void; project: () => void; reset: () => void; adopt: () => void; plugins: () => void; wrap: () => void; qa: () => void; importFiles: () => void; folder: { text: () => string; change: () => void; forget: () => void } }

/** The pages of the settings, as the tree on the left lists them. */
export type SettingsTab = 'general' | 'look' | 'folder' | 'lang' | 'terms' | 'tm' | 'qa' | 'wrap' | 'claude' | 'github' | 'server' | 'file' | 'update' | 'danger';

const TITLES: Record<SettingsTab, string> = {
  general: 'Загальні', look: 'Вигляд', folder: 'Папка гри', lang: 'Гра і мови', terms: 'Імпорт глосарію', tm: 'Імпорт пам’яті перекладів',
  qa: 'Правила QA', wrap: 'Перенесення рядків', claude: 'Claude', github: 'GitHub', server: 'Власний сервер', file: 'Файл', update: 'Оновлення застосунку', danger: 'Небезпечна зона',
};
const GROUPS: [string, SettingsTab[]][] = [
  ['Проєкт', ['general', 'look', 'folder', 'lang']],
  ['Пов’язане й пам’ять', ['terms', 'tm']],
  ['Перевірка', ['qa', 'wrap']],
  ['Синхронізація', ['claude', 'github', 'server', 'file']],
  ['Застосунок', ['update', 'danger']],
];
const EVERY = [[0, 'Лише за кліком'], [30, 'Кожні 30 хвилин'], [180, 'Кожні 3 години'], [360, 'Кожні 6 годин']] as const;
const CHEV = '<svg class="chev" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 3.5l3 3 3-3"/></svg>';

let lastPage: SettingsTab = 'general';
/** Groups the translator has folded, kept for the next time the dialog is opened. */
const folded = new Set<string>();

/** A warning that cannot be missed: a coloured banner with its icon and a bold first line. */
const warn = (title: string, text: string, bad = false): string => `<div class="st-warn${bad ? ' bad' : ''}" role="note"><span class="wi" aria-hidden="true">!</span><div><b>${title}</b><span>${text}</span></div></div>`;

/** The text of `t` with the part that matches the search `s` (lower case) marked. */
const mark = (t: string, s: string): string => {
  const i = s ? t.toLowerCase().indexOf(s) : -1;
  return i < 0 ? esc(t) : `${esc(t.slice(0, i))}<mark>${esc(t.slice(i, i + s.length))}</mark>${esc(t.slice(i + s.length))}`;
};

/**
 * The settings: a tree of pages on the left (with a search and groups that fold), the page on the right, and «Зберегти / Застосувати / Скасувати»
 * below. What is typed waits until it is applied (the accent colour is tried on the whole app at once and goes back if it is cancelled); the buttons
 * that do something (imports, saving to a file, reset, checking for an update) act at once.
 */
export function openSettings(ctx: Ctx, { extensions: onExtensions, project: onProject, reset: onReset, adopt: onImport, plugins: onPlugins, wrap: onWrap, qa: onQa, importFiles: onFiles, folder: onFolder }: SettingsActions, tab?: SettingsTab): void {
  const st = ctx.s.saved.settings;
  const gh = loadGithubConfig();
  const sync = loadSyncConfig();
  const cl = loadClaudeConfig();
  const where = isDesktop() ? 'на цьому пристрої' : 'у цьому браузері';
  const page = (id: SettingsTab, attrs: string, html: string): string => `<section class="st-page" id="stp-${id}" data-page="${id}" ${attrs} hidden>${html}</section>`;
  const every = (cur: number): string => EVERY.map(([v, l]) => `<option value="${v}" ${cur === v ? 'selected' : ''}>${l}</option>`).join('');
  const dlg = dialog(`<form method="dialog" class="st">
    <nav class="st-nav" id="st-nav" aria-label="Розділи налаштувань">
      <label class="st-srch"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/></svg><input id="st-q" type="search" autocomplete="off" placeholder="Пошук налаштувань" aria-label="Пошук налаштувань"></label>
      <div class="st-tree" id="st-tree"></div>
    </nav>
    <div class="st-main" id="st-main">
      <h2 id="st-t" class="st-crumb"></h2>
      <div class="st-content">
    ${page('general', 'data-sec="gen"', `<div class="grid"><label for="st-tol">Радити, коли переклад відрізняється від оригіналу понад, % (від 5 до 100)</label><input id="st-tol" type="number" min="5" max="100" step="5" value="${esc(String(st.tolerancePct))}" aria-describedby="st-tol-err">
      <label for="st-who">Ваше ім’я в коментарях та історії</label><input id="st-who" maxlength="40" value="${esc(String(st.who))}"></div>
    <div class="grid" data-now><label for="st-lang">Мова інтерфейсу</label><select id="st-lang">${i18n.languages().map(l => `<option value="${esc(l.code)}" ${l.code === i18n.language ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select></div>
    <p class="hint" data-now>Інші мови додаються як розширення (мовні пакети). <button class="btn s" type="button" id="st-ext">Розширення…</button></p>
    <p class="hint bad st-err" id="st-tol-err" role="alert"></p>
    <label class="achk"><input type="checkbox" id="st-block" ${st.blockErrors ? 'checked' : ''}> Не надсилати рядок із помилкою QA</label>
    <div class="grid"><label for="st-link">Автозаповнення однакових рядків після «Надіслати»</label><select id="st-link"><option value="ask" ${linkModeOf(st) === 'ask' ? 'selected' : ''}>заповнювати порожні чернетками, про різні питати (рекомендовано)</option><option value="auto" ${linkModeOf(st) === 'auto' ? 'selected' : ''}>заповнювати порожні й самому оновлювати різні (вичитані не чіпає)</option><option value="off" ${linkModeOf(st) === 'off' ? 'selected' : ''}>не заповнювати</option></select></div>
    <p class="hint">Порожні зв’язані рядки заповнюються одразу після надсилання чернетками з позначкою «авто» (цю дію можна відмінити в повідомленні). Вичитаний рядок і рядок, який ви змінили пізніше, не перезаписуються без вашого вибору.</p>`)}
    ${page('look', '', `<div class="st-sub" data-now><h3>Назва, значок і колір проєкту</h3><p class="hint">Тепер вони в окремому вікні налаштувань проєкту: колір береться з назви проєкту (назви папки гри), якщо його не вибрано вручну.</p>
      <div class="acts l"><button class="btn" type="button" id="st-proj">Налаштування проєкту…</button></div></div>
    <div class="st-sub" data-now><h3>Список рядків</h3>
      <div class="grid"><label for="st-pgm">Як показувати довгий список</label><select id="st-pgm"><option value="pages" ${pagesPrefs().mode === 'pages' ? 'selected' : ''}>сторінками: одна сторінка, кнопки ‹ ›</option><option value="flow" ${pagesPrefs().mode === 'flow' ? 'selected' : ''}>безперервно, зі знаками сторінок</option><option value="off" ${pagesPrefs().mode === 'off' ? 'selected' : ''}>безперервно, без сторінок</option></select>
        <label for="st-pgs">Рядків на сторінці</label><select id="st-pgs">${PAGE_SIZES.map(n => `<option value="${n}" ${pagesPrefs().size === n ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
      <label class="achk"><input type="checkbox" id="st-pgr" ${pagesPrefs().remember ? 'checked' : ''}> Пам’ятати місце (сторінку, рядок і прокрутку) для кожного файлу й набору фільтрів</label>
      <p class="hint">Малюється лише одна сторінка, тож великі файли відкриваються швидше, а в кожного рядка є місце, до якого легко повернутися. Застосовується одразу.</p></div>
    ${isDesktop() ? `<div data-now><label class="achk"><input type="checkbox" id="st-sysbar" ${nativeChrome() ? 'checked' : ''}> Системний заголовок вікна</label>
      <p class="hint">Запасний варіант: якщо власного заголовка не видно або його кнопки не працюють. Застосовується одразу.</p></div>` : ''}`)}
    ${isDesktop() ? page('folder', '', `<div class="folder-set"><label for="st-folder">Папка гри цього проєкту</label><div class="folder-row"><span id="st-folder" class="path" tabindex="0"></span><button class="btn" type="button" id="st-folder-change">Змінити…</button><button class="btn" type="button" id="st-folder-forget">Забути</button></div>
      <p class="hint">Папка запам’ятовується для проєкту й відновлюється під час запуску. Якщо її перенесено чи видалено, програма покаже банер із вибором нової, а переклад і оригінали в проєкті збережуться.</p></div>`) : ''}
    ${page('lang', '', `<div class="st-sub"><h3>Тексти плагінів</h3><p class="hint">Частина ігор показує текст командами плагінів, а не вікнами повідомлень. ${st.pluginCommands.length ? `Зараз увімкнено: ${esc(st.pluginCommands.join(', '))}.` : 'Поки нічого не увімкнено.'}</p><div class="acts l"><button class="btn" type="button" id="st-plug">Обрати команди з текстом…</button></div></div>
    <div class="st-sub"><h3>Мовці</h3><p class="hint">Імен мовців у грі на RPG Maker MV немає. Їх можна визначити за обличчям персонажа й подією.</p><div class="acts l"><button class="btn" type="button" id="st-spk">Визначити мовців…</button></div></div>
    <div class="st-sub"><h3>Довідкові мови</h3><p class="hint">Додайте ту саму гру іншими мовами (наприклад, російською, польською): кожна з’явиться під оригіналом як підказка. Мов можна додати скільки завгодно. Рядки вирівнюються автоматично, навіть якщо в тій версії є додані чи прибрані репліки.</p>
      <div id="rf-state" class="acts l">${referenceSets(ctx.s.saved.reference).map(r => `<span class="chip on">${esc(r.lang.toUpperCase())} <span class="hint">${plural(Object.keys(r.texts).length, ['файл', 'файли', 'файлів'])}</span></span><button class="btn" type="button" data-rf-del="${esc(r.lang)}" aria-label="Прибрати довідку ${esc(r.lang)}">Прибрати ${esc(r.lang.toUpperCase())}</button>`).join('') || '<span class="hint">Довідок ще немає</span>'}</div>
      <div class="grid"><label for="rf-lang">Код мови</label><input id="rf-lang" maxlength="8" value="${ctx.s.saved.reference ? '' : 'ru'}" placeholder="ru, pl, fr…"></div>
      <div class="acts l"><button class="btn" type="button" id="rf-go">Додати мову: обрати папку довідкової версії…</button></div></div>`)}
    ${page('terms', '', `<p class="hint">З файлу: таблиця Google Sheets, збережена як веб-сторінка (.html), або .csv / .tsv із колонками «Оригінал», «Переклад 1…», «Опис», «Розділ».</p>
      <label class="achk"><input type="checkbox" id="st-terms-qa"> Перевіряти ці терміни в QA (для великого глосарію краще вимкнути: він лише підказує)</label>
      <div class="acts l"><button class="btn" type="button" id="st-terms-file-btn">Імпортувати з файлу…</button></div><input type="file" id="st-terms-file" accept=".html,.htm,.csv,.tsv,.txt,text/html,text/csv,text/plain" hidden>
      <p class="hint">Або вставте рядки «англійською, табуляція, українською»:</p><textarea id="st-terms" rows="4" aria-label="Терміни для імпорту"></textarea><div class="acts l"><button class="btn" type="button" id="st-terms-go">Імпортувати вставлені терміни</button></div>`)}
    ${page('tm', '', `<p class="hint">Рядки «оригінал, табуляція, переклад».</p><textarea id="st-tm" rows="7" aria-label="Пари для імпорту"></textarea><div class="acts l"><button class="btn" type="button" id="st-tm-go">Імпортувати пари</button></div>`)}
    ${page('qa', '', `<div class="grid"><label for="st-qa">Правила перевірки тексту (літери, пробіли, апостроф, коди)</label><button class="btn" type="button" id="st-qa">Налаштувати…</button></div>
    <p class="hint">Які перевірки ввімкнено й що вони вважають помилкою чи порадою. Довжина тексту не обмежується: застосунок лише радить.</p>`)}
    ${page('wrap', '', `<div class="grid"><label for="st-wrap">Перенесення рядків у повідомленнях гри</label><button class="btn" type="button" id="st-wrap">Налаштувати…</button></div>
    <p class="hint">Коли й за якою шириною рядки розбиваються, чи переносяться слова з дефісом, коли попереджати про четвертий рядок.</p>`)}
    ${page('claude', 'data-sec="cl"', `<p class="hint">Спільна база цього артефакта працює на всіх ваших пристроях, де відкрито цей самий артефакт: ПК, телефон. Не потрібні ні файли, ні свій сервер, ні GitHub. Натисніть «Синхронізувати» тут, потім відкрийте артефакт на іншому пристрої й натисніть там те саме: приїдуть переклад, глосарій, пам’ять та оригінальні рядки гри.</p>
      <div class="grid"><label for="cl-every">Автоматично</label><select id="cl-every">${every(cl.everyMin)}</select></div>
      <div class="acts l"><button class="btn p" type="button" id="cl-go">Синхронізувати через Claude зараз</button></div>
      <p class="hint" id="cl-state" role="status">${cl.last ? 'Остання синхронізація: ' + new Date(cl.last).toLocaleString(uiLocale()) : 'Ще не синхронізовано'}</p>`)}
    ${page('github', 'data-sec="gh"', `${warn(`Токен лишається тільки ${where}`, 'Дайте йому доступ лише до репозиторію з перекладом (право «Contents: Read and write»). Він не потрапляє у файл проєкту.')}
      <p class="hint">Переклад зберігається у вашому репозиторії GitHub (краще приватному) звичайними файлами, а історія комітів показує, що й коли змінилося. Створіть репозиторій із файлом README, потім токен: GitHub → Settings → Developer settings → Fine-grained tokens.</p>
      <div class="grid"><label for="gh-repo">Репозиторій (власник/назва)</label><input id="gh-repo" placeholder="ivan/my-translation" autocomplete="off" spellcheck="false" value="${esc(gh.repo)}">
        <label for="gh-token">Токен доступу</label><input id="gh-token" type="password" autocomplete="off" value="${esc(gh.token)}">
        <label for="gh-branch">Гілка (необов’язково)</label><input id="gh-branch" placeholder="основна гілка репозиторію" autocomplete="off" spellcheck="false" value="${esc(gh.branch)}">
        <label for="gh-dir">Папка в репозиторії (необов’язково)</label><input id="gh-dir" placeholder="корінь репозиторію" autocomplete="off" spellcheck="false" value="${esc(gh.dir)}">
        <label for="gh-every">Автоматично</label><select id="gh-every">${every(gh.everyMin)}</select></div>
      <label class="achk"><input type="checkbox" id="gh-orig" ${gh.originals ? 'checked' : ''}> Зберігати в репозиторії оригінальні рядки гри (лише для приватного; без них пристрій без гри, наприклад телефон, не покаже оригінал)</label>
      <details><summary>Додатково</summary><div class="grid"><label for="gh-api">Адреса API (для GitHub Enterprise)</label><input id="gh-api" type="url" autocomplete="off" spellcheck="false" value="${esc(gh.api)}"></div></details>
      <div class="acts l"><button class="btn p" type="button" id="gh-go">Синхронізувати з GitHub зараз</button></div>
      <p class="hint" id="gh-state" role="status">${gh.last ? 'Остання синхронізація: ' + new Date(gh.last).toLocaleString(uiLocale()) : 'Ще не синхронізовано'}</p>
      ${isDesktop() ? '' : '<p class="hint">Якщо пише, що немає з’єднання, а інтернет є: сторінка, у якій відкрито застосунок, може забороняти запити до GitHub (так працює вбудований перегляд). Користуйтеся застосунком як сайтом або настільною версією.</p>'}`)}
    ${page('server', 'data-sec="sy"', `${warn('Для адреси в інтернеті потрібен https', 'Дані шифруються паролем на пристроях: сервер лише передає їх і забуває. Адреса в домашній мережі може бути й http.')}
      <p class="hint">Через ваш власний проміжний сервер (<code>node server/relay.ts</code>). Без чужих хмар.</p>
      <div class="grid"><label for="sy-url">Адреса сервера</label><input id="sy-url" type="url" placeholder="https://sync.example.com або http://192.168.0.14:7421" value="${esc(sync.url)}">
        <label for="sy-pass">Пароль синхронізації (однаковий на всіх пристроях)</label><input id="sy-pass" type="password" autocomplete="off" minlength="8" value="${esc(sync.passphrase)}">
        <label for="sy-every">Автоматично</label><select id="sy-every">${every(sync.everyMin)}</select></div>
      <div class="acts l"><button class="btn p" type="button" id="sy-go">Синхронізувати зараз</button></div><p class="hint" id="sy-state" role="status">${sync.last ? 'Остання синхронізація: ' + new Date(sync.last).toLocaleString(uiLocale()) : 'Ще не синхронізовано'}</p>`)}
    ${page('file', '', `<p class="hint">Файл містить переклад, глосарій, пам’ять і оригінальні рядки, без файлів гри. Імпорт зливає зміни по рядках: лишається новіша правка.</p>
      <div class="acts l"><button class="btn" type="button" id="st-export">Зберегти проєкт у файл</button><button class="btn" type="button" id="st-import">Імпортувати з файлу…</button><button class="btn" type="button" id="st-files">Відкрити файли або вставити JSON…</button></div><input type="file" id="st-file" accept="application/json,.json" hidden>`)}
    ${page('update', 'data-sec="up"', updateSectionHtml(loadUpdateConfig()))}
    ${page('danger', '', `${warn('Скинути проєкт', `Видаляє весь переклад, глосарій та імпортовану пам’ять ${isDesktop() ? 'у цьому застосунку' : 'у цьому браузері'}. Файли гри не змінюються.`, true)}
      <div class="acts l"><button class="btn bad" type="button" id="st-reset">Скинути проєкт…</button></div>`)}
      </div>
    </div>
    <div class="st-bar"><span class="st-dirty" id="st-dirty" role="status" hidden>Є незастосовані зміни</span>
      <button class="btn p" type="button" id="st-save">Зберегти</button><button class="btn" type="button" id="st-apply" disabled>Застосувати</button><button class="btn" type="button" id="st-cancel">Скасувати</button></div></form>`, 'st-t');
  dlg.classList.add('st-dlg');
  const nav = $('#st-nav', dlg), tree = $('#st-tree', dlg), crumb = $('#st-t', dlg), q = $('#st-q', dlg) as HTMLInputElement;
  const saveBtn = $('#st-save', dlg) as HTMLButtonElement, applyBtn = $('#st-apply', dlg) as HTMLButtonElement, dirtyEl = $('#st-dirty', dlg);

  /* ---- the tree of pages ---- */
  const groupOf = (id: SettingsTab): string => GROUPS.find(([, ids]) => ids.includes(id))![0];
  const off = new Set<SettingsTab>();
  if (!isDesktop()) off.add('folder');
  if (!updatePlatform()) off.add('update');
  off.add('claude');   // shown once the page knows it is inside an artifact (below)
  const pages = new Map<SettingsTab, HTMLElement>();
  dlg.querySelectorAll<HTMLElement>('.st-page').forEach(p => pages.set(p.dataset.page as SettingsTab, p));
  const hay = new Map<SettingsTab, string>();
  for (const [id, p] of pages) hay.set(id, `${TITLES[id]} ${groupOf(id)} ${p.textContent ?? ''}`.toLowerCase());
  const has = (id: SettingsTab): boolean => pages.has(id) && !off.has(id);
  const hits = (id: SettingsTab, s: string): boolean => !s || hay.get(id)!.includes(s);
  let cur: SettingsTab = 'general';
  const drawTree = (): void => {
    const s = q.value.trim().toLowerCase();
    const html = GROUPS.map(([g, ids]) => {
      const its = ids.filter(id => has(id) && hits(id, s));
      if (!its.length) return '';
      const shut = !s && folded.has(g) && !its.includes(cur);
      return `<button type="button" class="st-grp${shut ? ' closed' : ''}" data-g="${esc(g)}" aria-expanded="${!shut}">${CHEV}${esc(g)}</button>`
        + (shut ? '' : its.map(id => `<button type="button" class="st-ti" data-p="${id}"${id === cur ? ' aria-current="page"' : ''}>${mark(TITLES[id], s)}</button>`).join(''));
    }).join('');
    tree.innerHTML = html || '<p class="hint st-none">Нічого не знайдено</p>';
  };
  const show = (id: SettingsTab, focus = false): void => {
    if (!has(id)) id = 'general';
    cur = lastPage = id;
    for (const [pid, p] of pages) p.hidden = pid !== id;
    crumb.innerHTML = `<span class="vh">Налаштування: </span><span>${esc(groupOf(id))}</span>${CRUMB}<span>${esc(TITLES[id])}</span>`;
    drawTree();
    if (focus) tree.querySelector<HTMLElement>('.st-ti[aria-current=page]')?.focus();
  };
  tree.addEventListener('click', e => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!t) return;
    if (t.classList.contains('st-grp')) { const g = t.dataset.g!; if (folded.has(g)) folded.delete(g); else folded.add(g); drawTree(); [...tree.querySelectorAll<HTMLElement>('.st-grp')].find(b => b.dataset.g === g)?.focus(); return; }
    show(t.dataset.p as SettingsTab, true);
  });
  tree.addEventListener('keydown', e => {
    const rows = [...tree.querySelectorAll<HTMLElement>('.st-grp,.st-ti')];
    const i = rows.indexOf(document.activeElement as HTMLElement), row = rows[i];
    if (!row) return;
    if (e.key === 'ArrowDown') { rows[i + 1]?.focus(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { if (i > 0) rows[i - 1]!.focus(); else q.focus(); e.preventDefault(); }
    else if (row.classList.contains('st-grp') && ((e.key === 'ArrowLeft' && row.getAttribute('aria-expanded') === 'true') || (e.key === 'ArrowRight' && row.getAttribute('aria-expanded') === 'false'))) { e.preventDefault(); row.click(); }
  });
  q.addEventListener('input', () => {
    const s = q.value.trim().toLowerCase();
    // the page on the right follows the search: the first page that has the words, unless the one open has them too
    if (s && !hits(cur, s)) { const first = GROUPS.flatMap(([, ids]) => ids).find(id => has(id) && hits(id, s)); if (first) { show(first); return; } }
    drawTree();
  });
  q.addEventListener('keydown', e => { if (e.key === 'ArrowDown') { tree.querySelector<HTMLElement>('.st-ti,.st-grp')?.focus(); e.preventDefault(); } });
  /* The part you work in wears the colour of the project; the other one is grey (the same logic as the tool windows of the app). */
  const useNav = (on: boolean): void => { nav.classList.toggle('use', on); };
  nav.addEventListener('pointerdown', () => useNav(true)); nav.addEventListener('focusin', () => useNav(true));
  $('#st-main', dlg).addEventListener('pointerdown', () => useNav(false)); $('#st-main', dlg).addEventListener('focusin', () => useNav(false));
  useNav(true);
  void artifactDb().then(db => { if (db) { off.delete('claude'); drawTree(); } });

  /* ---- what waits to be applied ---- */
  const touched = new Set<string>();
  let dirty = false, escAt = 0;
  const setDirty = (d: boolean): void => { dirty = d; applyBtn.disabled = !d; dirtyEl.hidden = !d; dirtyEl.textContent = 'Є незастосовані зміни'; if (!d) touched.clear(); };
  dlg.querySelector('.st-content')!.addEventListener('input', onEdit);
  dlg.querySelector('.st-content')!.addEventListener('change', onEdit);
  function onEdit(e: Event): void {
    const t = e.target as HTMLElement;
    if (t.closest('[data-now]')) return;
    const sec = t.closest<HTMLElement>('[data-sec]')?.dataset.sec;
    if (!sec) return;
    touched.add(sec); setDirty(true);
  }
  const readGeneral = (): boolean => {
    const tol = $('#st-tol', dlg) as HTMLInputElement, tolErr = $('#st-tol-err', dlg);
    const v = Number(tol.value);
    // the refusal is written next to the field (and the field is marked and focused), not only in a message that is gone in three seconds
    const ok = tol.value.trim() !== '' && v >= 5 && v <= 100;
    tol.setAttribute('aria-invalid', String(!ok));
    tolErr.textContent = ok ? '' : 'Відсоток має бути від 5 до 100. Поки значення не виправлено, налаштування не застосовуються.';
    if (!ok) { show('general'); tol.focus(); return false; }
    st.tolerancePct = v;
    st.blockErrors = ($('#st-block', dlg) as HTMLInputElement).checked;
    st.linkMode = ($('#st-link', dlg) as HTMLSelectElement).value as LinkMode;
    st.propagate = st.linkMode !== 'off';
    st.who = ($('#st-who', dlg) as HTMLInputElement).value.trim() || DEFAULT_SETTINGS.who;
    ctx.s.who = st.who;
    return true;
  };
  /* Sync settings are read from the form when they are applied, over what is stored (the last-sync marks of a run that went on meanwhile stay). */
  const saveGh = () => {
    const base = loadGithubConfig();
    const c = { ...base, repo: ($('#gh-repo', dlg) as HTMLInputElement).value.trim(), token: ($('#gh-token', dlg) as HTMLInputElement).value.trim(), branch: ($('#gh-branch', dlg) as HTMLInputElement).value.trim(), dir: ($('#gh-dir', dlg) as HTMLInputElement).value.trim(), everyMin: Number(($('#gh-every', dlg) as HTMLSelectElement).value), originals: ($('#gh-orig', dlg) as HTMLInputElement).checked, api: ($('#gh-api', dlg) as HTMLInputElement).value.trim() || DEFAULT_API };
    if (c.repo !== base.repo || c.branch !== base.branch || c.dir !== base.dir || c.api !== base.api) c.state = { shas: {}, commit: '', assetsRev: 0 };
    saveGithubConfig(c);
    return c;
  };
  const saveSy = () => { const c = { ...loadSyncConfig(), url: ($('#sy-url', dlg) as HTMLInputElement).value.trim(), passphrase: ($('#sy-pass', dlg) as HTMLInputElement).value, everyMin: Number(($('#sy-every', dlg) as HTMLSelectElement).value) }; saveSyncConfig(c); return c; };
  const saveCl = () => { const c = { ...loadClaudeConfig(), everyMin: Number(($('#cl-every', dlg) as HTMLSelectElement).value) }; saveClaudeConfig(c); return c; };
  const updates = wireUpdateSection(dlg);
  /** Applies what waits. False (and the page with the mistake in front) when something is wrong. */
  const commit = (): boolean => {
    if (touched.has('gen') && !readGeneral()) return false;
    if (touched.has('gen')) { ctx.s.saved.settingsAt = Date.now(); ctx.persist(); ctx.render(); }
    if (touched.has('gh')) saveGh();
    if (touched.has('sy')) saveSy();
    if (touched.has('cl')) saveCl();
    if (touched.has('up')) updates.save();
    setDirty(false);
    return true;
  };
  const flush = (): boolean => !dirty || commit();
  /** Leave the dialog for another window: what is typed is applied first, so nothing is lost on the way. */
  const away = (fn: () => void): void => { if (!flush()) return; dlg.close(); fn(); };
  saveBtn.addEventListener('click', () => { if (commit()) dlg.close(); });
  applyBtn.addEventListener('click', () => { if (commit()) toast('Налаштування застосовано'); });
  $('#st-cancel', dlg).addEventListener('click', () => { setDirty(false); dlg.close(); });
  // Esc: clears the search first; with changes waiting the first Esc only says so, the second one throws them away
  dlg.addEventListener('cancel', e => {
    if (q.value && document.activeElement === q) { e.preventDefault(); q.value = ''; drawTree(); return; }
    if (!dirty) return;
    if (Date.now() - escAt < 4000) return;
    e.preventDefault(); escAt = Date.now();
    dirtyEl.textContent = 'Є незастосовані зміни: Esc ще раз скасує їх'; dirtyEl.classList.remove('flash'); void dirtyEl.offsetWidth; dirtyEl.classList.add('flash');
  });

  $('#st-proj', dlg).addEventListener('click', () => away(onProject));
  $('#st-ext', dlg).addEventListener('click', () => away(onExtensions));
  $('#st-lang', dlg).addEventListener('change', e => { setInterfaceLanguage((e.target as HTMLSelectElement).value); });
  $('#st-wrap', dlg).addEventListener('click', () => away(onWrap));
  $('#st-qa', dlg).addEventListener('click', () => away(onQa));
  $('#st-plug', dlg).addEventListener('click', () => away(onPlugins));
  $('#st-files', dlg).addEventListener('click', () => away(onFiles));
  $('#st-spk', dlg).addEventListener('click', () => away(() => openSpeakers(ctx)));

  const addTerms = (terms: GlossaryTerm[]): { added: number; merged: number } => {
    let added = 0, merged = 0;
    const have = new Map(ctx.s.saved.terms.map(t => [t.en.toLowerCase(), t]));
    for (const t of terms) {
      const cur0 = have.get(t.en.toLowerCase());
      if (!cur0) { ctx.s.saved.terms.push(t); have.set(t.en.toLowerCase(), t); added++; continue; }
      const known = new Set([cur0.uk, ...(cur0.alt ?? [])].map(x => x.toLowerCase()));
      const more = [t.uk, ...(t.alt ?? [])].filter(x => !known.has(x.toLowerCase()));
      if (more.length) { cur0.alt = [...(cur0.alt ?? []), ...more]; cur0.mt = Date.now(); merged++; }
    }
    touchTerms(ctx.s.saved.terms);
    ctx.persist(); ctx.render();
    return { added, merged };
  };
  const showFolder = (): void => { const el0 = dlg.querySelector<HTMLElement>('#st-folder'); if (el0) { el0.textContent = onFolder.text(); el0.title = el0.textContent; } };
  showFolder();
  dlg.querySelector('#st-folder-change')?.addEventListener('click', () => away(onFolder.change));
  dlg.querySelector('#st-pgm')?.addEventListener('change', e => { setPagesPrefs({ mode: (e.target as HTMLSelectElement).value as 'pages' | 'flow' | 'off' }); ctx.render(); });
  dlg.querySelector('#st-pgs')?.addEventListener('change', e => { setPagesPrefs({ size: Number((e.target as HTMLSelectElement).value) }); ctx.render(); });
  dlg.querySelector('#st-pgr')?.addEventListener('change', e => { const on = (e.target as HTMLInputElement).checked; setPagesPrefs({ remember: on }); if (!on) forgetPlaces(); });
  dlg.querySelector('#st-sysbar')?.addEventListener('change', e => { setNativeChrome((e.target as HTMLInputElement).checked); });
  dlg.querySelector('#st-folder-forget')?.addEventListener('click', () => { onFolder.forget(); showFolder(); toast('Папку гри забуто. Переклад лишився; збірка й запуск гри недоступні, поки папку не вказано'); });
  const termsFile = $('#st-terms-file', dlg) as HTMLInputElement;
  $('#st-terms-file-btn', dlg).addEventListener('click', () => termsFile.click());
  termsFile.addEventListener('change', async () => {
    const f = termsFile.files?.[0];
    if (!f) return;
    try {
      const text = await f.text();
      const rows = /\.html?$/i.test(f.name) || /<table/i.test(text.slice(0, 5000)) ? parseHtmlTable(text) : parseDelimited(text);
      const { terms, skipped } = termsFromTable(rows, Date.now(), ($('#st-terms-qa', dlg) as HTMLInputElement).checked);
      if (!terms.length) { toast('У файлі не знайдено термінів: потрібна колонка «Оригінал» і хоча б одна «Переклад»'); return; }
      const r = addTerms(terms);
      toast(`Додано термінів: ${r.added}${r.merged ? `, доповнено варіантами: ${r.merged}` : ''}${skipped ? `, пропущено рядків: ${skipped}` : ''}`);
    } catch { toast('Не вдалося прочитати файл'); }
    termsFile.value = '';
  });
  $('#st-terms-go', dlg).addEventListener('click', () => {
    const { terms, rejected } = parseTerms(($('#st-terms', dlg) as HTMLTextAreaElement).value);
    let added = 0, same = 0;
    const clash: string[] = [];
    for (const t of terms) {
      const have = ctx.s.saved.terms.find(x => x.en.toLowerCase() === t.en.toLowerCase());
      if (!have) { ctx.s.saved.terms.push({ ...t, mt: Date.now() }); added++; }
      else if (have.uk.trim() === t.uk.trim()) same++;
      else clash.push(`${t.en} → ${t.uk} (у глосарії: ${have.uk})`);
    }
    touchTerms(ctx.s.saved.terms);
    ctx.persist(); ctx.render();
    // a term that is there already with another translation is not overwritten, and it is not passed over in silence either
    const notes = [rejected ? `пропущено рядків без пари: ${rejected}` : '', same ? `уже є: ${same}` : '', clash.length ? `не змінено, бо вже є з іншим перекладом: ${clash.slice(0, 5).join('; ')}${clash.length > 5 ? ` і ще ${clash.length - 5}` : ''}` : ''].filter(Boolean);
    toast(`Додано термінів: ${added}${notes.length ? '. ' + notes.join('. ') : ''}`, clash.length ? { sticky: true } : {});
  });
  $('#st-tm-go', dlg).addEventListener('click', () => {
    let added = 0, rejected = 0;
    for (const line of ($('#st-tm', dlg) as HTMLTextAreaElement).value.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const [s, t] = line.split('\t');
      if (!s?.trim() || !t?.trim()) { rejected++; continue; }
      if (!ctx.s.saved.memory.some(m => m.s === s.trim() && m.t === t.trim())) { ctx.s.saved.memory.push({ s: s.trim(), t: t.trim(), mt: Date.now() }); added++; }
    }
    ctx.invalidateTm(); ctx.persist(); ctx.render();
    toast(`Імпортовано ${plural(added, ['пару', 'пари', 'пар'])}${rejected ? `, пропущено рядків без табуляції: ${rejected}` : ''}`);
  });
  $('#rf-go', dlg).addEventListener('click', async () => {
    const lang = ($('#rf-lang', dlg) as HTMLInputElement).value.trim().toLowerCase();
    if (!lang) { toast('Вкажіть код мови, наприклад ru або pl'); return; }
    if (!flush()) return;
    try { if (await importReference(ctx, lang)) { ctx.render(); dlg.close(); } } catch (err) { toast(err instanceof Error ? err.message : 'Не вдалося прочитати папку'); }
  });
  dlg.querySelectorAll<HTMLElement>('[data-rf-del]').forEach(b => b.addEventListener('click', () => {
    if (!flush()) return;
    const next = withoutReference(ctx.s.saved.reference, b.dataset.rfDel!);
    if (next) ctx.s.saved.reference = next; else delete ctx.s.saved.reference;
    ctx.s.saved.assetsRev = Date.now(); ctx.persist(); ctx.render(); toast(`Довідку ${b.dataset.rfDel!.toUpperCase()} прибрано`); dlg.close();
  }));
  $('#cl-go', dlg).addEventListener('click', async () => {
    const state = $('#cl-state', dlg), btn = $('#cl-go', dlg) as HTMLButtonElement;
    const c = saveCl();
    btn.disabled = true; state.textContent = 'Синхронізую…';
    try { const rep = await runClaudeSync(ctx, c, onImport); state.textContent = describeClaude(rep); toast(describeClaude(rep)); }
    catch (err) { state.textContent = err instanceof Error ? err.message : 'Не вдалося синхронізувати'; }
    btn.disabled = false;
  });
  $('#gh-go', dlg).addEventListener('click', async () => {
    const c = saveGh();
    const state = $('#gh-state', dlg), btn = $('#gh-go', dlg) as HTMLButtonElement;
    if (!c.repo || !c.token) { state.textContent = 'Вкажіть репозиторій і токен доступу'; return; }
    btn.disabled = true; state.textContent = 'Синхронізую…';
    try { const rep = await runGithubSync(ctx, c, onImport); state.textContent = describeGithub(rep); toast(describeGithub(rep)); }
    catch (err) { state.textContent = err instanceof Error ? err.message : 'Не вдалося синхронізувати'; }
    btn.disabled = false;
  });
  $('#sy-go', dlg).addEventListener('click', async () => {
    const cfg = saveSy();
    const state = $('#sy-state', dlg), btn = $('#sy-go', dlg) as HTMLButtonElement;
    const bad = syncUrlProblem(cfg.url);
    if (bad) { state.textContent = bad; $('#sy-url', dlg).focus(); return; }
    if (!syncConfigured(cfg)) { state.textContent = 'Вкажіть пароль синхронізації (щонайменше 8 символів)'; return; }
    btn.disabled = true; state.textContent = 'Синхронізую…';
    try { const rep = await runSync(ctx, cfg, onImport); state.textContent = describe(rep); toast(describe(rep)); }
    catch (err) {
      // a request that never reached a server (the address is wrong, the server is off, no network) is not a wrong password
      const m = err instanceof Error ? err.message : '';
      state.textContent = err instanceof TypeError || /failed to fetch|networkerror|load failed/i.test(m) ? 'Сервер не відповів: перевірте адресу, чи запущено сервер і чи є мережа' : m || 'Не вдалося синхронізувати';
    }
    btn.disabled = false;
  });
  $('#st-export', dlg).addEventListener('click', async () => {
    const name = `${ctx.s.saved.name.replace(/\.(json|po|csv|rpy)$/i, '').replace(/[^\p{L}\p{N}_-]+/gu, '_') || 'transly'}-${new Date().toISOString().slice(0, 10)}.transly.json`;
    // The file carries the mark of its own making; when the save is cancelled the mark is taken back.
    const was = ctx.s.saved.stamps?.copy;
    stamp(ctx.s.saved, 'copy', 'файл', Date.now());
    if (await saveFile(name, serialize(ctx.s.saved), 'application/json')) { toast('Проєкт збережено у файл'); ctx.persist(); ctx.render(); }
    else if (was) ctx.s.saved.stamps!.copy = was; else delete ctx.s.saved.stamps?.copy;
  });
  const file = $('#st-file', dlg) as HTMLInputElement;
  $('#st-import', dlg).addEventListener('click', () => file.click());
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    if (!f) return;
    if (!flush()) return;
    try {
      const conflicts = importProjectText(ctx, await f.text(), onImport);
      toast(conflicts ? `Проєкт злито. Конфліктів: ${conflicts}: лишилась новіша правка` : 'Проєкт злито');
      dlg.close();
    } catch (err) { toast(err instanceof Error ? err.message : 'Не вдалося прочитати файл'); }
  });
  let armed = false, armedAt = 0;
  const resetBtn = $('#st-reset', dlg), resetIdle = resetBtn.textContent ?? '';
  let armTimer: ReturnType<typeof setTimeout> | null = null;
  const disarm = (): void => { armed = false; resetBtn.textContent = resetIdle; if (armTimer) { clearTimeout(armTimer); armTimer = null; } };
  resetBtn.addEventListener('click', () => {
    // Two clicks instead of confirm(): embedded frames suppress browser dialogs. The confirmation appears on the very same
    // spot, so the second click of a double-click must not confirm it, and it lapses if the translator does not follow it up.
    if (!armed) { armed = true; armedAt = Date.now(); resetBtn.textContent = 'Так, видалити весь переклад'; armTimer = setTimeout(disarm, 6000); return; }
    if (Date.now() - armedAt < 1200) return;
    resetProject(ctx, onReset); setDirty(false); dlg.close();
  });

  show(tab ?? lastPage);
  q.focus();
}
