import { DEFAULT_SETTINGS, emptyProject, parseDelimited, parseHtmlTable, parseTerms, serialize, termsFromTable } from '../core';
import type { GlossaryTerm } from '../core';
import { $, el, esc, plural, toast } from './dom';
import type { Ctx } from './state';
import { artifactDb, describeClaude, loadClaudeConfig, runClaudeSync, saveClaudeConfig } from './claude';
import { DEFAULT_API, describeGithub, loadGithubConfig, runGithubSync, saveGithubConfig } from './github';
import { importProjectText } from './import-dialog';
import { importReference } from './reference';
import { saveFile } from './save';
import { loadUpdateConfig, updateSectionHtml, wireUpdateSection } from './updates';
import { openSpeakers } from './speakers-dialog';
import { describe, loadSyncConfig, runSync, saveSyncConfig, syncConfigured } from './sync';

/** Open a native <dialog>; it traps focus, closes on Esc and restores focus to the opener. */
export function dialog(html: string, labelId: string): HTMLDialogElement {
  const opener = document.activeElement as HTMLElement | null;
  const dlg = el('dialog', 'adlg');
  dlg.setAttribute('aria-labelledby', labelId);
  dlg.innerHTML = html;
  document.body.appendChild(dlg);
  dlg.addEventListener('close', () => { dlg.remove(); opener?.focus?.(); });
  dlg.showModal();
  return dlg;
}

let lastSettingsTab = 0;

/** Things the settings dialog starts but the shell owns. */
export interface SettingsActions { reset: () => void; adopt: () => void; plugins: () => void; importFiles: () => void }

export function openSettings(ctx: Ctx, { reset: onReset, adopt: onImport, plugins: onPlugins, importFiles: onFiles }: SettingsActions): void {
  const st = ctx.s.saved.settings;
  const sync = loadSyncConfig();
  const gh = loadGithubConfig();
  const cl = loadClaudeConfig();
  const autoNow = st.lineLimit === 0 ? ctx.lineLimit() : 0;
  const dlg = dialog(`<form method="dialog"><h2 id="st-t">Налаштування</h2>
    <div class="grid"><label for="st-tol">Допуск довжини перекладу відносно оригіналу, %</label><input id="st-tol" type="number" min="5" max="100" step="5" value="${st.tolerancePct}">
      <label for="st-who">Ваше ім’я в коментарях та історії</label><input id="st-who" maxlength="40" value="${st.who}"></div>
    <label class="achk"><input type="checkbox" id="st-block" ${st.blockErrors ? 'checked' : ''}> Не надсилати рядок із помилкою QA</label>
    <label class="achk"><input type="checkbox" id="st-prop" ${st.propagate ? 'checked' : ''}> Переносити переклад в однакові рядки (інші файли теж)</label>
    <div class="grid"><label for="st-lim-mode">Ширина рядка в повідомленні (вікно гри)</label><select id="st-lim-mode"><option value="auto" ${st.lineLimit === 0 ? 'selected' : ''}>За оригіналом гри${autoNow ? ` (зараз ${autoNow})` : ''}</option><option value="custom" ${st.lineLimit > 0 ? 'selected' : ''}>Своє число</option><option value="off" ${st.lineLimit < 0 ? 'selected' : ''}>Не перевіряти</option></select>
      <label for="st-lim">Символів у рядку</label><input id="st-lim" type="number" min="10" max="200" value="${st.lineLimit > 0 ? st.lineLimit : autoNow || 50}" ${st.lineLimit > 0 ? '' : 'disabled'}></div>
    <p class="hint">Довжина тексту не обмежується: застосунок лише попереджає, коли переклад дуже відрізняється від оригіналу або рядок ширший за вікно гри (з обличчям поруч вікно вужче). Кнопка «Перенести рядки» розбиває текст сама.</p>
    <details><summary>Тексти плагінів</summary><p class="hint">Частина ігор показує текст командами плагінів, а не вікнами повідомлень. ${st.pluginCommands.length ? `Зараз увімкнено: ${esc(st.pluginCommands.join(', '))}.` : 'Поки нічого не увімкнено.'}</p><div class="acts l"><button class="btn" type="button" id="st-plug">Обрати команди з текстом…</button></div></details>
    <details><summary>Імпорт глосарію</summary>
      <p class="hint">З файлу: таблиця Google Sheets, збережена як веб-сторінка (.html), або .csv / .tsv із колонками «Оригінал», «Переклад 1…», «Опис», «Розділ».</p>
      <label class="achk"><input type="checkbox" id="st-terms-qa"> Перевіряти ці терміни в QA (для великого загального словника краще вимкнути: він лише підказує)</label>
      <div class="acts l"><button class="btn" type="button" id="st-terms-file-btn">Імпортувати з файлу…</button></div><input type="file" id="st-terms-file" accept=".html,.htm,.csv,.tsv,.txt,text/html,text/csv,text/plain" hidden>
      <p class="hint">Або вставте рядки «англійською, табуляція, українською»:</p><textarea id="st-terms" rows="4" aria-label="Терміни для імпорту"></textarea><button class="btn" type="button" id="st-terms-go">Імпортувати вставлені терміни</button></details>
    <details><summary>Імпорт пам’яті перекладів</summary><p class="hint">Рядки «оригінал, табуляція, переклад».</p><textarea id="st-tm" rows="5" aria-label="Пари для імпорту"></textarea><button class="btn" type="button" id="st-tm-go">Імпортувати пари</button></details>
    <details><summary>Мовці</summary><p class="hint">Імен мовців у грі на RPG Maker MV немає. Їх можна визначити за обличчям персонажа й подією.</p><div class="acts l"><button class="btn" type="button" id="st-spk">Визначити мовців…</button></div></details>
    <details><summary>Довідкова мова</summary><p class="hint">Додайте ту саму гру іншою мовою (наприклад, російською): її переклад з’явиться під оригіналом як підказка. Рядки вирівнюються автоматично, навіть якщо в тій версії є додані чи прибрані репліки.</p>
      <p class="hint" id="rf-state">${ctx.s.saved.reference ? `Додано: ${esc(ctx.s.saved.reference.lang)}` : 'Довідки ще немає'}</p>
      <div class="grid"><label for="rf-lang">Код мови</label><input id="rf-lang" maxlength="8" value="${esc(ctx.s.saved.reference?.lang ?? 'ru')}"></div>
      <div class="acts l"><button class="btn" type="button" id="rf-go">Обрати папку довідкової версії…</button>${ctx.s.saved.reference ? '<button class="btn" type="button" id="rf-del">Прибрати довідку</button>' : ''}</div></details>
    ${updateSectionHtml(loadUpdateConfig())}
    <details id="cl-sec" hidden><summary>Синхронізація через Claude (між вашими пристроями)</summary>
      <p class="hint">Спільна база цього артефакта працює на всіх ваших пристроях, де відкрито цей самий артефакт: ПК, телефон. Не потрібні ні файли, ні свій сервер, ні GitHub. Натисніть «Синхронізувати» тут, потім відкрийте артефакт на іншому пристрої й натисніть там те саме: приїдуть переклад, глосарій, пам’ять та оригінальні рядки гри.</p>
      <div class="grid"><label for="cl-every">Автоматично</label><select id="cl-every">${[[0, 'Лише за кліком'], [30, 'Кожні 30 хвилин'], [180, 'Кожні 3 години'], [360, 'Кожні 6 годин']].map(([v, l]) => `<option value="${v}" ${cl.everyMin === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="acts l"><button class="btn p" type="button" id="cl-go">Синхронізувати через Claude зараз</button></div>
      <p class="hint" id="cl-state" role="status">${cl.last ? 'Остання синхронізація: ' + new Date(cl.last).toLocaleString('uk-UA') : 'Ще не синхронізовано'}</p></details>
    <details><summary>Синхронізація через GitHub</summary>
      <p class="hint">Переклад зберігається у вашому репозиторії GitHub (краще приватному) звичайними файлами, а історія комітів показує, що й коли змінилося. Створіть репозиторій із файлом README, потім токен: GitHub → Settings → Developer settings → Fine-grained tokens, доступ лише до цього репозиторію, право «Contents: Read and write». Токен лишається тільки в цьому браузері й не потрапляє у файл проєкту.</p>
      <div class="grid"><label for="gh-repo">Репозиторій (власник/назва)</label><input id="gh-repo" placeholder="ivan/my-translation" autocomplete="off" spellcheck="false" value="${esc(gh.repo)}">
        <label for="gh-token">Токен доступу</label><input id="gh-token" type="password" autocomplete="off" value="${esc(gh.token)}">
        <label for="gh-branch">Гілка (необов’язково)</label><input id="gh-branch" placeholder="основна гілка репозиторію" autocomplete="off" spellcheck="false" value="${esc(gh.branch)}">
        <label for="gh-dir">Папка в репозиторії (необов’язково)</label><input id="gh-dir" placeholder="корінь репозиторію" autocomplete="off" spellcheck="false" value="${esc(gh.dir)}">
        <label for="gh-every">Автоматично</label><select id="gh-every">${[[0, 'Лише за кліком'], [30, 'Кожні 30 хвилин'], [180, 'Кожні 3 години'], [360, 'Кожні 6 годин']].map(([v, l]) => `<option value="${v}" ${gh.everyMin === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <label class="achk"><input type="checkbox" id="gh-orig" ${gh.originals ? 'checked' : ''}> Зберігати в репозиторії оригінальні рядки гри (лише для приватного; без них пристрій без гри, наприклад телефон, не покаже оригінал)</label>
      <details><summary>Додатково</summary><div class="grid"><label for="gh-api">Адреса API (для GitHub Enterprise)</label><input id="gh-api" type="url" autocomplete="off" spellcheck="false" value="${esc(gh.api)}"></div></details>
      <div class="acts l"><button class="btn p" type="button" id="gh-go">Синхронізувати з GitHub зараз</button></div>
      <p class="hint" id="gh-state" role="status">${gh.last ? 'Остання синхронізація: ' + new Date(gh.last).toLocaleString('uk-UA') : 'Ще не синхронізовано'}</p>
      <p class="hint">Якщо пише, що немає з’єднання, а інтернет є: сторінка, у якій відкрито застосунок, може забороняти запити до GitHub (так працює вбудований перегляд). Користуйтеся застосунком як сайтом або настільною версією.</p></details>
    <details><summary>Синхронізація через власний сервер</summary><p class="hint">Через ваш власний проміжний сервер (<code>node server/relay.ts</code>): він лише передає зашифровані дані й забуває їх. Без чужих хмар. Дані шифруються паролем на пристроях. Для адреси в інтернеті потрібен https.</p>
      <div class="grid"><label for="sy-url">Адреса сервера</label><input id="sy-url" type="url" placeholder="https://sync.example.com або http://192.168.0.14:7421" value="${esc(sync.url)}">
        <label for="sy-pass">Пароль синхронізації (однаковий на всіх пристроях)</label><input id="sy-pass" type="password" autocomplete="off" minlength="8" value="${esc(sync.passphrase)}">
        <label for="sy-every">Автоматично</label><select id="sy-every">${[[0, 'Лише за кліком'], [30, 'Кожні 30 хвилин'], [180, 'Кожні 3 години'], [360, 'Кожні 6 годин']].map(([v, l]) => `<option value="${v}" ${sync.everyMin === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="acts l"><button class="btn p" type="button" id="sy-go">Синхронізувати зараз</button></div><p class="hint" id="sy-state" role="status">${sync.last ? 'Остання синхронізація: ' + new Date(sync.last).toLocaleString('uk-UA') : 'Ще не синхронізовано'}</p></details>
    <details><summary>Обмін проєктом через файл</summary><p class="hint">Файл містить переклад, глосарій, пам’ять і оригінальні рядки, без файлів гри. Імпорт зливає зміни по рядках: лишається новіша правка.</p>
      <div class="acts l"><button class="btn" type="button" id="st-export">Зберегти проєкт у файл</button><button class="btn" type="button" id="st-import">Імпортувати з файлу…</button><button class="btn" type="button" id="st-files">Відкрити файли або вставити JSON…</button></div><input type="file" id="st-file" accept="application/json,.json" hidden></details>
    <details><summary>Небезпечна зона</summary><p class="hint">Видаляє весь переклад, глосарій та імпортовану пам’ять у цьому браузері. Файли гри не змінюються.</p><button class="btn" type="button" id="st-reset">Скинути проєкт…</button></details>
    <div class="acts"><button class="btn" value="cancel">Скасувати</button><button class="btn p" id="st-save" value="save">Зберегти</button></div></form>`, 'st-t');
  /* Sections live on tabs so nobody scrolls through everything to reach one setting. */
  const TABS: [string, string[]][] = [
    ['Загальні', []],
    ['Словники й мовці', ['Імпорт глосарію', 'Імпорт пам’яті перекладів', 'Мовці', 'Довідкова мова', 'Тексти плагінів']],
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
  let shown = lastSettingsTab;
  const show = (i: number): void => {
    shown = lastSettingsTab = i;
    items.forEach(c => c.classList.toggle('tab-off', c.getAttribute('data-stab') !== String(i)));
    bar.querySelectorAll('button').forEach((b, k) => { b.setAttribute('aria-selected', String(k === i)); b.tabIndex = k === i ? 0 : -1; });
  };
  TABS.forEach(([name], i) => { const b = el('button'); b.type = 'button'; b.setAttribute('role', 'tab'); b.textContent = name; b.addEventListener('click', () => show(i)); bar.appendChild(b); });
  form.querySelector('h2')!.after(bar);
  show(shown);
  $('#st-lim-mode', dlg).addEventListener('change', e => { ($('#st-lim', dlg) as HTMLInputElement).disabled = (e.target as HTMLSelectElement).value !== 'custom'; });
  $('#st-plug', dlg).addEventListener('click', () => { dlg.close(); onPlugins(); });
  $('#st-files', dlg).addEventListener('click', () => { dlg.close(); onFiles(); });
  const num = () => Number(($('#st-tol', dlg) as HTMLInputElement).value);
  $('#st-save', dlg).addEventListener('click', e => {
    const v = num();
    if (!(v >= 5 && v <= 100)) { e.preventDefault(); toast('Допуск має бути від 5 до 100'); return; }
    st.tolerancePct = v;
    st.blockErrors = ($('#st-block', dlg) as HTMLInputElement).checked;
    st.propagate = ($('#st-prop', dlg) as HTMLInputElement).checked;
    const mode = ($('#st-lim-mode', dlg) as HTMLSelectElement).value, lim = Number(($('#st-lim', dlg) as HTMLInputElement).value);
    if (mode === 'custom' && !(lim >= 10 && lim <= 200)) { e.preventDefault(); toast('Ширина рядка має бути від 10 до 200 символів'); return; }
    st.lineLimit = mode === 'off' ? -1 : mode === 'custom' ? Math.round(lim) : 0;
    st.who = ($('#st-who', dlg) as HTMLInputElement).value.trim() || DEFAULT_SETTINGS.who;
    ctx.s.saved.settingsAt = Date.now();
    ctx.s.who = st.who;
    ctx.persist(); ctx.render(); toast('Налаштування збережено');
  });
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
    ctx.persist(); ctx.render();
    return { added, merged };
  };
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
    const lang = ($('#rf-lang', dlg) as HTMLInputElement).value.trim().toLowerCase() || 'ru';
    try { if (await importReference(ctx, lang)) { ctx.render(); dlg.close(); } } catch (err) { toast(err instanceof Error ? err.message : 'Не вдалося прочитати папку'); }
  });
  dlg.querySelector('#rf-del')?.addEventListener('click', () => { delete ctx.s.saved.reference; ctx.s.saved.assetsRev = Date.now(); ctx.persist(); ctx.render(); toast('Довідку прибрано'); dlg.close(); });
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
    if (await saveFile(name, serialize(ctx.s.saved), 'application/json')) toast('Проєкт збережено у файл');
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
  let armed = false;
  $('#st-reset', dlg).addEventListener('click', ev => {
    // Two clicks instead of confirm(): embedded frames suppress browser dialogs.
    if (!armed) { armed = true; (ev.currentTarget as HTMLElement).textContent = 'Так, видалити весь переклад'; return; }
    const keep = ctx.s.saved.resetEpoch;
    ctx.s.saved = { ...emptyProject(ctx.s.saved.name), resetEpoch: Math.max(keep, Date.now()) };
    ctx.invalidateTm(); onReset(); dlg.close();
    toast('Проєкт скинуто');
  });
}
