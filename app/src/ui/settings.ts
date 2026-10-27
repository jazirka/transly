import { DEFAULT_SETTINGS, deserialize, emptyProject, mergeProjects, parseDelimited, parseHtmlTable, parseTerms, serialize, termsFromTable } from '../core';
import type { GlossaryTerm } from '../core';
import { $, el, esc, plural, toast } from './dom';
import type { Ctx } from './state';
import { importReference } from './reference';
import { saveFile } from './save';
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

export function openSettings(ctx: Ctx, onReset: () => void, onImport: () => void): void {
  const st = ctx.s.saved.settings;
  const sync = loadSyncConfig();
  const dlg = dialog(`<form method="dialog"><h2 id="st-t">Налаштування</h2>
    <div class="grid"><label for="st-tol">Допуск довжини перекладу відносно оригіналу, %</label><input id="st-tol" type="number" min="5" max="100" step="5" value="${st.tolerancePct}">
      <label for="st-who">Ваше ім’я в коментарях та історії</label><input id="st-who" maxlength="40" value="${st.who}"></div>
    <label class="achk"><input type="checkbox" id="st-block" ${st.blockErrors ? 'checked' : ''}> Не надсилати рядок із помилкою QA</label>
    <label class="achk"><input type="checkbox" id="st-prop" ${st.propagate ? 'checked' : ''}> Переносити переклад в однакові рядки (інші файли теж)</label>
    <p class="hint">Довжина не обмежується: застосунок лише попереджає, коли переклад дуже відрізняється від оригіналу.</p>
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
    <details><summary>Синхронізація пристроїв</summary><p class="hint">Через ваш власний проміжний сервер (<code>node server/relay.ts</code>): він лише передає зашифровані дані й забуває їх. Без чужих хмар. Дані шифруються паролем на пристроях. Для адреси в інтернеті потрібен https.</p>
      <div class="grid"><label for="sy-url">Адреса сервера</label><input id="sy-url" type="url" placeholder="https://sync.example.com або http://192.168.0.14:7421" value="${esc(sync.url)}">
        <label for="sy-pass">Пароль синхронізації (однаковий на всіх пристроях)</label><input id="sy-pass" type="password" autocomplete="off" minlength="8" value="${esc(sync.passphrase)}">
        <label for="sy-every">Автоматично</label><select id="sy-every">${[[0, 'Лише за кліком'], [30, 'Кожні 30 хвилин'], [180, 'Кожні 3 години'], [360, 'Кожні 6 годин']].map(([v, l]) => `<option value="${v}" ${sync.everyMin === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="acts l"><button class="btn p" type="button" id="sy-go">Синхронізувати зараз</button></div><p class="hint" id="sy-state" role="status">${sync.last ? 'Остання синхронізація: ' + new Date(sync.last).toLocaleString('uk-UA') : 'Ще не синхронізовано'}</p></details>
    <details><summary>Обмін проєктом через файл</summary><p class="hint">Файл містить переклад, глосарій, пам’ять і оригінальні рядки, без файлів гри. Імпорт зливає зміни по рядках: лишається новіша правка.</p>
      <div class="acts l"><button class="btn" type="button" id="st-export">Зберегти проєкт у файл</button><button class="btn" type="button" id="st-import">Імпортувати з файлу…</button></div><input type="file" id="st-file" accept="application/json,.json" hidden></details>
    <details><summary>Небезпечна зона</summary><p class="hint">Видаляє весь переклад, глосарій та імпортовану пам’ять у цьому браузері. Файли гри не змінюються.</p><button class="btn" type="button" id="st-reset">Скинути проєкт…</button></details>
    <div class="acts"><button class="btn" value="cancel">Скасувати</button><button class="btn p" id="st-save" value="save">Зберегти</button></div></form>`, 'st-t');
  const num = () => Number(($('#st-tol', dlg) as HTMLInputElement).value);
  $('#st-save', dlg).addEventListener('click', e => {
    const v = num();
    if (!(v >= 5 && v <= 100)) { e.preventDefault(); toast('Допуск має бути від 5 до 100'); return; }
    st.tolerancePct = v;
    st.blockErrors = ($('#st-block', dlg) as HTMLInputElement).checked;
    st.propagate = ($('#st-prop', dlg) as HTMLInputElement).checked;
    st.who = ($('#st-who', dlg) as HTMLInputElement).value.trim() || DEFAULT_SETTINGS.who;
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
      const other = deserialize(await f.text());
      const r = mergeProjects(ctx.s.saved, other);
      ctx.s.saved = r.project;
      onImport();
      toast(r.conflicts.length ? `Проєкт злито. Конфліктів: ${r.conflicts.length}: лишилась новіша правка` : 'Проєкт злито');
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
