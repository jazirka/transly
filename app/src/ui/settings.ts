import { touchTerms, stamp, DEFAULT_SETTINGS, emptyProject, linkModeOf, parseDelimited, parseHtmlTable, parseTerms, referenceSets, serialize, termsFromTable, withoutReference } from '../core';
import type { GlossaryTerm, LinkMode } from '../core';
import { $, el, esc, plural, toast } from './dom';
import { isDesktop } from './desktop';
import { showDialog } from './modal';
import { nativeChrome, setNativeChrome } from './winctl';
import type { Ctx } from './state';
import { artifactDb, describeClaude, loadClaudeConfig, runClaudeSync, saveClaudeConfig } from './claude';
import { DEFAULT_API, describeGithub, loadGithubConfig, runGithubSync, saveGithubConfig } from './github';
import { importProjectText } from './import-dialog';
import { importReference } from './reference';
import { saveFile } from './save';
import { loadUpdateConfig, updateSectionHtml, wireUpdateSection } from './updates';
import { openSpeakers } from './speakers-dialog';
import { describe, loadSyncConfig, runSync, saveSyncConfig, syncConfigured } from './sync';

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

let lastSettingsTab = 0;

/** Things the settings dialog starts but the shell owns. */
export interface SettingsActions { reset: () => void; adopt: () => void; plugins: () => void; wrap: () => void; qa: () => void; importFiles: () => void; folder: { text: () => string; change: () => void; forget: () => void } }

/** The tab to open first (by name), or the one that was open last. */
export type SettingsTab = 'Загальні' | 'Глосарій і пам’ять' | 'Гра і мови' | 'Синхронізація' | 'Застосунок';

export function openSettings(ctx: Ctx, { reset: onReset, adopt: onImport, plugins: onPlugins, wrap: onWrap, qa: onQa, importFiles: onFiles, folder: onFolder }: SettingsActions, tab?: SettingsTab): void {
  const st = ctx.s.saved.settings;
  const sync = loadSyncConfig();
  const gh = loadGithubConfig();
  const cl = loadClaudeConfig();
  const dlg = dialog(`<form method="dialog"><h2 id="st-t">Налаштування</h2>
    ${isDesktop() ? `<div class="folder-set"><label for="st-folder">Папка гри цього проєкту</label><div class="folder-row"><span id="st-folder" class="path" tabindex="0"></span><button class="btn" type="button" id="st-folder-change">Змінити…</button><button class="btn" type="button" id="st-folder-forget">Забути</button></div>
      <p class="hint">Папка запам’ятовується для проєкту й відновлюється під час запуску. Якщо її перенесено чи видалено, програма покаже банер із вибором нової, а переклад і оригінали в проєкті збережуться.</p>
      <label class="achk"><input type="checkbox" id="st-sysbar" ${nativeChrome() ? 'checked' : ''}> Системний заголовок вікна</label>
      <p class="hint">Запасний варіант: якщо власного заголовка не видно або його кнопки не працюють. Застосовується одразу.</p></div>` : ''}
    <div class="grid"><label for="st-tol">Радити, коли переклад відрізняється від оригіналу понад, % (від 5 до 100)</label><input id="st-tol" type="number" min="5" max="100" step="5" value="${esc(String(st.tolerancePct))}" aria-describedby="st-tol-err">
      <label for="st-who">Ваше ім’я в коментарях та історії</label><input id="st-who" maxlength="40" value="${esc(String(st.who))}"></div>
    <p class="hint bad st-err" id="st-tol-err" role="alert"></p>
    <label class="achk"><input type="checkbox" id="st-block" ${st.blockErrors ? 'checked' : ''}> Не надсилати рядок із помилкою QA</label>
    <div class="grid"><label for="st-link">Автозаповнення однакових рядків після «Надіслати»</label><select id="st-link"><option value="ask" ${linkModeOf(st) === 'ask' ? 'selected' : ''}>заповнювати порожні чернетками, про різні питати (рекомендовано)</option><option value="auto" ${linkModeOf(st) === 'auto' ? 'selected' : ''}>заповнювати порожні й самому оновлювати різні (вичитані не чіпає)</option><option value="off" ${linkModeOf(st) === 'off' ? 'selected' : ''}>не заповнювати</option></select></div>
    <p class="hint">Порожні зв’язані рядки заповнюються одразу після надсилання чернетками з позначкою «авто» (цю дію можна відмінити в повідомленні). Вичитаний рядок і рядок, який ви змінили пізніше, не перезаписуються без вашого вибору.</p>
    <div class="grid"><label for="st-wrap">Перенесення рядків у повідомленнях гри</label><button class="btn" type="button" id="st-wrap">Налаштувати…</button></div>
    <div class="grid"><label for="st-qa">Правила перевірки тексту (літери, пробіли, апостроф, коди)</label><button class="btn" type="button" id="st-qa">Налаштувати…</button></div>
    <p class="hint">Коли й за якою шириною рядки розбиваються, чи переносяться слова з дефісом, коли попереджати про четвертий рядок. Довжина тексту не обмежується: застосунок лише радить.</p>
    <details><summary>Тексти плагінів</summary><p class="hint">Частина ігор показує текст командами плагінів, а не вікнами повідомлень. ${st.pluginCommands.length ? `Зараз увімкнено: ${esc(st.pluginCommands.join(', '))}.` : 'Поки нічого не увімкнено.'}</p><div class="acts l"><button class="btn" type="button" id="st-plug">Обрати команди з текстом…</button></div></details>
    <details><summary>Імпорт глосарію</summary>
      <p class="hint">З файлу: таблиця Google Sheets, збережена як веб-сторінка (.html), або .csv / .tsv із колонками «Оригінал», «Переклад 1…», «Опис», «Розділ».</p>
      <label class="achk"><input type="checkbox" id="st-terms-qa"> Перевіряти ці терміни в QA (для великого глосарію краще вимкнути: він лише підказує)</label>
      <div class="acts l"><button class="btn" type="button" id="st-terms-file-btn">Імпортувати з файлу…</button></div><input type="file" id="st-terms-file" accept=".html,.htm,.csv,.tsv,.txt,text/html,text/csv,text/plain" hidden>
      <p class="hint">Або вставте рядки «англійською, табуляція, українською»:</p><textarea id="st-terms" rows="4" aria-label="Терміни для імпорту"></textarea><button class="btn" type="button" id="st-terms-go">Імпортувати вставлені терміни</button></details>
    <details><summary>Імпорт пам’яті перекладів</summary><p class="hint">Рядки «оригінал, табуляція, переклад».</p><textarea id="st-tm" rows="5" aria-label="Пари для імпорту"></textarea><button class="btn" type="button" id="st-tm-go">Імпортувати пари</button></details>
    <details><summary>Мовці</summary><p class="hint">Імен мовців у грі на RPG Maker MV немає. Їх можна визначити за обличчям персонажа й подією.</p><div class="acts l"><button class="btn" type="button" id="st-spk">Визначити мовців…</button></div></details>
    <details><summary>Довідкові мови</summary><p class="hint">Додайте ту саму гру іншими мовами (наприклад, російською, польською): кожна з’явиться під оригіналом як підказка. Мов можна додати скільки завгодно. Рядки вирівнюються автоматично, навіть якщо в тій версії є додані чи прибрані репліки.</p>
      <div id="rf-state" class="acts l">${referenceSets(ctx.s.saved.reference).map(r => `<span class="chip on">${esc(r.lang.toUpperCase())} <span class="hint">${plural(Object.keys(r.texts).length, ['файл', 'файли', 'файлів'])}</span></span><button class="btn" type="button" data-rf-del="${esc(r.lang)}" aria-label="Прибрати довідку ${esc(r.lang)}">Прибрати ${esc(r.lang.toUpperCase())}</button>`).join('') || '<span class="hint">Довідок ще немає</span>'}</div>
      <div class="grid"><label for="rf-lang">Код мови</label><input id="rf-lang" maxlength="8" value="${ctx.s.saved.reference ? '' : 'ru'}" placeholder="ru, pl, fr…"></div>
      <div class="acts l"><button class="btn" type="button" id="rf-go">Додати мову: обрати папку довідкової версії…</button></div></details>
    ${updateSectionHtml(loadUpdateConfig())}
    <details id="cl-sec" hidden><summary>Синхронізація через Claude (між вашими пристроями)</summary>
      <p class="hint">Спільна база цього артефакта працює на всіх ваших пристроях, де відкрито цей самий артефакт: ПК, телефон. Не потрібні ні файли, ні свій сервер, ні GitHub. Натисніть «Синхронізувати» тут, потім відкрийте артефакт на іншому пристрої й натисніть там те саме: приїдуть переклад, глосарій, пам’ять та оригінальні рядки гри.</p>
      <div class="grid"><label for="cl-every">Автоматично</label><select id="cl-every">${[[0, 'Лише за кліком'], [30, 'Кожні 30 хвилин'], [180, 'Кожні 3 години'], [360, 'Кожні 6 годин']].map(([v, l]) => `<option value="${v}" ${cl.everyMin === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="acts l"><button class="btn p" type="button" id="cl-go">Синхронізувати через Claude зараз</button></div>
      <p class="hint" id="cl-state" role="status">${cl.last ? 'Остання синхронізація: ' + new Date(cl.last).toLocaleString('uk-UA') : 'Ще не синхронізовано'}</p></details>
    <details><summary>Синхронізація через GitHub</summary>
      <p class="hint">Переклад зберігається у вашому репозиторії GitHub (краще приватному) звичайними файлами, а історія комітів показує, що й коли змінилося. Створіть репозиторій із файлом README, потім токен: GitHub → Settings → Developer settings → Fine-grained tokens, доступ лише до цього репозиторію, право «Contents: Read and write». Токен лишається тільки ${isDesktop() ? 'на цьому пристрої' : 'у цьому браузері'} й не потрапляє у файл проєкту.</p>
      <div class="grid"><label for="gh-repo">Репозиторій (власник/назва)</label><input id="gh-repo" placeholder="ivan/my-translation" autocomplete="off" spellcheck="false" value="${esc(gh.repo)}">
        <label for="gh-token">Токен доступу</label><input id="gh-token" type="password" autocomplete="off" value="${esc(gh.token)}">
        <label for="gh-branch">Гілка (необов’язково)</label><input id="gh-branch" placeholder="основна гілка репозиторію" autocomplete="off" spellcheck="false" value="${esc(gh.branch)}">
        <label for="gh-dir">Папка в репозиторії (необов’язково)</label><input id="gh-dir" placeholder="корінь репозиторію" autocomplete="off" spellcheck="false" value="${esc(gh.dir)}">
        <label for="gh-every">Автоматично</label><select id="gh-every">${[[0, 'Лише за кліком'], [30, 'Кожні 30 хвилин'], [180, 'Кожні 3 години'], [360, 'Кожні 6 годин']].map(([v, l]) => `<option value="${v}" ${gh.everyMin === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <label class="achk"><input type="checkbox" id="gh-orig" ${gh.originals ? 'checked' : ''}> Зберігати в репозиторії оригінальні рядки гри (лише для приватного; без них пристрій без гри, наприклад телефон, не покаже оригінал)</label>
      <details><summary>Додатково</summary><div class="grid"><label for="gh-api">Адреса API (для GitHub Enterprise)</label><input id="gh-api" type="url" autocomplete="off" spellcheck="false" value="${esc(gh.api)}"></div></details>
      <div class="acts l"><button class="btn p" type="button" id="gh-go">Синхронізувати з GitHub зараз</button></div>
      <p class="hint" id="gh-state" role="status">${gh.last ? 'Остання синхронізація: ' + new Date(gh.last).toLocaleString('uk-UA') : 'Ще не синхронізовано'}</p>
      ${isDesktop() ? '' : '<p class="hint">Якщо пише, що немає з’єднання, а інтернет є: сторінка, у якій відкрито застосунок, може забороняти запити до GitHub (так працює вбудований перегляд). Користуйтеся застосунком як сайтом або настільною версією.</p>'}</details>
    <details><summary>Синхронізація через власний сервер</summary><p class="hint">Через ваш власний проміжний сервер (<code>node server/relay.ts</code>): він лише передає зашифровані дані й забуває їх. Без чужих хмар. Дані шифруються паролем на пристроях. Для адреси в інтернеті потрібен https.</p>
      <div class="grid"><label for="sy-url">Адреса сервера</label><input id="sy-url" type="url" placeholder="https://sync.example.com або http://192.168.0.14:7421" value="${esc(sync.url)}">
        <label for="sy-pass">Пароль синхронізації (однаковий на всіх пристроях)</label><input id="sy-pass" type="password" autocomplete="off" minlength="8" value="${esc(sync.passphrase)}">
        <label for="sy-every">Автоматично</label><select id="sy-every">${[[0, 'Лише за кліком'], [30, 'Кожні 30 хвилин'], [180, 'Кожні 3 години'], [360, 'Кожні 6 годин']].map(([v, l]) => `<option value="${v}" ${sync.everyMin === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="acts l"><button class="btn p" type="button" id="sy-go">Синхронізувати зараз</button></div><p class="hint" id="sy-state" role="status">${sync.last ? 'Остання синхронізація: ' + new Date(sync.last).toLocaleString('uk-UA') : 'Ще не синхронізовано'}</p></details>
    <details><summary>Обмін проєктом через файл</summary><p class="hint">Файл містить переклад, глосарій, пам’ять і оригінальні рядки, без файлів гри. Імпорт зливає зміни по рядках: лишається новіша правка.</p>
      <div class="acts l"><button class="btn" type="button" id="st-export">Зберегти проєкт у файл</button><button class="btn" type="button" id="st-import">Імпортувати з файлу…</button><button class="btn" type="button" id="st-files">Відкрити файли або вставити JSON…</button></div><input type="file" id="st-file" accept="application/json,.json" hidden></details>
    <details><summary>Небезпечна зона</summary><p class="hint">Видаляє весь переклад, глосарій та імпортовану пам’ять ${isDesktop() ? 'у цьому застосунку' : 'у цьому браузері'}. Файли гри не змінюються.</p><button class="btn" type="button" id="st-reset">Скинути проєкт…</button></details>
    <div class="acts"><span class="hint st-auto">Зміни застосовуються одразу.</span><button class="btn p" type="button" id="st-close">Закрити</button></div></form>`, 'st-t');
  dlg.classList.add('tall');
  /* Sections live on tabs so nobody scrolls through everything to reach one setting. */
  const TABS: [string, string[]][] = [
    ['Загальні', []],
    ['Глосарій і пам’ять', ['Імпорт глосарію', 'Імпорт пам’яті перекладів']],
    ['Гра і мови', ['Мовці', 'Довідкові мови', 'Тексти плагінів']],
    ['Синхронізація', ['Синхронізація через Claude', 'Синхронізація через GitHub', 'Синхронізація через власний сервер', 'Обмін проєктом через файл']],
    ['Застосунок', ['Оновлення застосунку', 'Небезпечна зона']],
  ];
  const form = dlg.querySelector('form')!;
  const bar = el('div', 'stabbar'); bar.setAttribute('role', 'tablist');
  const items = [...form.children].filter(c => c.tagName !== 'H2' && !c.classList.contains('acts') || c.matches('details'));
  const tabOf = (c: Element): number => {
    const sum = c.matches('details') ? c.querySelector(':scope > summary')?.textContent ?? '' : '';
    const i = TABS.findIndex(([, names]) => names.some(n => sum.startsWith(n)));
    return i < 0 ? 0 : i;
  };
  items.forEach(c => c.setAttribute('data-stab', String(tabOf(c))));
  let shown = tab ? Math.max(0, TABS.findIndex(([n]) => n === tab)) : lastSettingsTab;
  const show = (i: number): void => {
    shown = lastSettingsTab = i;
    items.forEach(c => c.classList.toggle('tab-off', c.getAttribute('data-stab') !== String(i)));
    bar.querySelectorAll('button').forEach((b, k) => { b.setAttribute('aria-selected', String(k === i)); b.tabIndex = k === i ? 0 : -1; });
  };
  TABS.forEach(([name], i) => { const b = el('button'); b.type = 'button'; b.setAttribute('role', 'tab'); b.textContent = name; b.addEventListener('click', () => show(i)); bar.appendChild(b); });
  form.querySelector('h2')!.after(bar);
  show(shown);
  $('#st-wrap', dlg).addEventListener('click', () => { dlg.close(); onWrap(); });
  $('#st-qa', dlg).addEventListener('click', () => { dlg.close(); onQa(); });
  $('#st-plug', dlg).addEventListener('click', () => { dlg.close(); onPlugins(); });
  $('#st-files', dlg).addEventListener('click', () => { dlg.close(); onFiles(); });
  /* The general settings are applied as they change (like the sync ones below), so there is nothing to save and «Закрити» loses nothing. */
  const applyGeneral = (): boolean => {
    const tol = $('#st-tol', dlg) as HTMLInputElement, tolErr = $('#st-tol-err', dlg);
    const v = Number(tol.value);
    // the refusal is written next to the field (and the field is marked and focused), not only in a message that is gone in three seconds
    const ok = tol.value.trim() !== '' && v >= 5 && v <= 100;
    tol.setAttribute('aria-invalid', String(!ok));
    tolErr.textContent = ok ? '' : 'Відсоток має бути від 5 до 100. Поки значення не виправлено, налаштування не застосовуються.';
    if (!ok) { tol.focus(); return false; }
    st.tolerancePct = v;
    st.blockErrors = ($('#st-block', dlg) as HTMLInputElement).checked;
    st.linkMode = ($('#st-link', dlg) as HTMLSelectElement).value as LinkMode;
    st.propagate = st.linkMode !== 'off';
    st.who = ($('#st-who', dlg) as HTMLInputElement).value.trim() || DEFAULT_SETTINGS.who;
    ctx.s.saved.settingsAt = Date.now();
    ctx.s.who = st.who;
    ctx.persist(); ctx.render();
    return true;
  };
  for (const id of ['#st-tol', '#st-who', '#st-block', '#st-link']) $(id, dlg).addEventListener('change', applyGeneral);
  $('#st-close', dlg).addEventListener('click', () => { if (applyGeneral()) dlg.close(); });
  const addTerms = (terms: GlossaryTerm[]): { added: number; merged: number } => {
    let added = 0, merged = 0;
    const have = new Map(ctx.s.saved.terms.map(t => [t.en.toLowerCase(), t]));
    for (const t of terms) {
      const cur = have.get(t.en.toLowerCase());
      if (!cur) { ctx.s.saved.terms.push(t); have.set(t.en.toLowerCase(), t); added++; continue; }
      const known = new Set([cur.uk, ...(cur.alt ?? [])].map(x => x.toLowerCase()));
      const more = [t.uk, ...(t.alt ?? [])].filter(x => !known.has(x.toLowerCase()));
      if (more.length) { cur.alt = [...(cur.alt ?? []), ...more]; cur.mt = Date.now(); merged++; }
    }
    touchTerms(ctx.s.saved.terms);
    ctx.persist(); ctx.render();
    return { added, merged };
  };
  const showFolder = (): void => { const el0 = dlg.querySelector<HTMLElement>('#st-folder'); if (el0) { el0.textContent = onFolder.text(); el0.title = el0.textContent; } };
  showFolder();
  dlg.querySelector('#st-folder-change')?.addEventListener('click', () => { dlg.close(); onFolder.change(); });
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
    let added = 0;
    for (const t of terms) if (!ctx.s.saved.terms.some(x => x.en.toLowerCase() === t.en.toLowerCase())) { ctx.s.saved.terms.push({ ...t, mt: Date.now() }); added++; }
    touchTerms(ctx.s.saved.terms);
    ctx.persist(); ctx.render();
    toast(`Додано термінів: ${added}${rejected ? `, пропущено рядків без пари: ${rejected}` : ''}`);
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
  $('#st-spk', dlg).addEventListener('click', () => { dlg.close(); openSpeakers(ctx); });
  $('#rf-go', dlg).addEventListener('click', async () => {
    const lang = ($('#rf-lang', dlg) as HTMLInputElement).value.trim().toLowerCase();
    if (!lang) { toast('Вкажіть код мови, наприклад ru або pl'); return; }
    try { if (await importReference(ctx, lang)) { ctx.render(); dlg.close(); } } catch (err) { toast(err instanceof Error ? err.message : 'Не вдалося прочитати папку'); }
  });
  dlg.querySelectorAll<HTMLElement>('[data-rf-del]').forEach(b => b.addEventListener('click', () => {
    const next = withoutReference(ctx.s.saved.reference, b.dataset.rfDel!);
    if (next) ctx.s.saved.reference = next; else delete ctx.s.saved.reference;
    ctx.s.saved.assetsRev = Date.now(); ctx.persist(); ctx.render(); toast(`Довідку ${b.dataset.rfDel!.toUpperCase()} прибрано`); dlg.close();
  }));
  // The shared database exists only inside an artifact: show the section once the page knows it is there.
  void artifactDb().then(db => { if (db) $('#cl-sec', dlg).hidden = false; });
  $('#cl-every', dlg).addEventListener('change', e => { cl.everyMin = Number((e.target as HTMLSelectElement).value); saveClaudeConfig(cl); });
  $('#cl-go', dlg).addEventListener('click', async () => {
    const state = $('#cl-state', dlg), btn = $('#cl-go', dlg) as HTMLButtonElement;
    btn.disabled = true; state.textContent = 'Синхронізую…';
    try { const rep = await runClaudeSync(ctx, cl, onImport); state.textContent = describeClaude(rep); toast(describeClaude(rep)); }
    catch (err) { state.textContent = err instanceof Error ? err.message : 'Не вдалося синхронізувати'; }
    btn.disabled = false;
  });
  wireUpdateSection(dlg);
  const readGh = () => ({ ...gh, repo: ($('#gh-repo', dlg) as HTMLInputElement).value.trim(), token: ($('#gh-token', dlg) as HTMLInputElement).value.trim(), branch: ($('#gh-branch', dlg) as HTMLInputElement).value.trim(), dir: ($('#gh-dir', dlg) as HTMLInputElement).value.trim(), everyMin: Number(($('#gh-every', dlg) as HTMLSelectElement).value), originals: ($('#gh-orig', dlg) as HTMLInputElement).checked, api: ($('#gh-api', dlg) as HTMLInputElement).value.trim() || DEFAULT_API });
  // Everything typed here is kept at once, so closing the dialog does not lose a pasted token.
  dlg.querySelector('details:has(#gh-repo)')?.addEventListener('change', () => { const c = readGh(); if (c.repo !== gh.repo || c.branch !== gh.branch || c.dir !== gh.dir || c.api !== gh.api) c.state = { shas: {}, commit: '', assetsRev: 0 }; Object.assign(gh, c); saveGithubConfig(gh); });
  $('#gh-go', dlg).addEventListener('click', async () => {
    Object.assign(gh, readGh()); saveGithubConfig(gh);
    const state = $('#gh-state', dlg), btn = $('#gh-go', dlg) as HTMLButtonElement;
    if (!gh.repo || !gh.token) { state.textContent = 'Вкажіть репозиторій і токен доступу'; return; }
    btn.disabled = true; state.textContent = 'Синхронізую…';
    try { const rep = await runGithubSync(ctx, gh, onImport); state.textContent = describeGithub(rep); toast(describeGithub(rep)); }
    catch (err) { state.textContent = err instanceof Error ? err.message : 'Не вдалося синхронізувати'; }
    btn.disabled = false;
  });
  const readSync = () => ({ ...sync, url: ($('#sy-url', dlg) as HTMLInputElement).value.trim(), passphrase: ($('#sy-pass', dlg) as HTMLInputElement).value, everyMin: Number(($('#sy-every', dlg) as HTMLSelectElement).value) });
  $('#sy-every', dlg).addEventListener('change', () => { saveSyncConfig(readSync()); toast('Налаштування синхронізації збережено'); });
  $('#sy-go', dlg).addEventListener('click', async () => {
    const cfg = readSync();
    saveSyncConfig(cfg);
    const state = $('#sy-state', dlg), btn = $('#sy-go', dlg) as HTMLButtonElement;
    if (!syncConfigured(cfg)) { state.textContent = 'Вкажіть адресу сервера та пароль (щонайменше 8 символів)'; return; }
    btn.disabled = true; state.textContent = 'Синхронізую…';
    try { const rep = await runSync(ctx, cfg, onImport); state.textContent = describe(rep); toast(describe(rep)); }
    catch (err) { state.textContent = err instanceof Error ? err.message : 'Не вдалося синхронізувати'; }
    btn.disabled = false;
  });
  $('#st-export', dlg).addEventListener('click', async () => {
    const name = `${ctx.s.saved.name.replace(/[^\p{L}\p{N}_-]+/gu, '_') || 'transly'}.transly.json`;
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
    const keep = ctx.s.saved.resetEpoch;
    ctx.s.saved = { ...emptyProject(ctx.s.saved.name), resetEpoch: Math.max(keep, Date.now()) };
    ctx.invalidateTm(); onReset(); dlg.close();
    toast('Проєкт скинуто');
  });
}
