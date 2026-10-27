import { DEFAULT_SETTINGS, deserialize, emptyProject, mergeProjects, parseTerms, serialize } from '../core';
import { $, el, esc, plural, toast } from './dom';
import type { Ctx } from './state';
import { describe, loadSyncConfig, runSync, saveSyncConfig, syncConfigured } from './sync';

/** Open a native <dialog>; it traps focus, closes on Esc and restores focus to the opener. */
export function dialog(html: string, labelId: string): HTMLDialogElement {
  const opener = document.activeElement as HTMLElement | null;
  const dlg = el('dialog', 'dlg');
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
    <label class="chk"><input type="checkbox" id="st-block" ${st.blockErrors ? 'checked' : ''}> Не надсилати рядок із помилкою QA</label>
    <p class="hint">Довжина не обмежується: застосунок лише попереджає, коли переклад дуже відрізняється від оригіналу.</p>
    <details><summary>Імпорт глосарію</summary><p class="hint">Рядки «англійською, табуляція, українською».</p><textarea id="st-terms" rows="5" aria-label="Терміни для імпорту"></textarea><button class="btn" type="button" id="st-terms-go">Імпортувати терміни</button></details>
    <details><summary>Імпорт пам’яті перекладів</summary><p class="hint">Рядки «оригінал, табуляція, переклад».</p><textarea id="st-tm" rows="5" aria-label="Пари для імпорту"></textarea><button class="btn" type="button" id="st-tm-go">Імпортувати пари</button></details>
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
    st.who = ($('#st-who', dlg) as HTMLInputElement).value.trim() || DEFAULT_SETTINGS.who;
    ctx.s.who = st.who;
    ctx.persist(); ctx.render(); toast('Налаштування збережено');
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
  $('#st-export', dlg).addEventListener('click', () => {
    const blob = new Blob([serialize(ctx.s.saved)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = el('a');
    a.href = url; a.download = `${ctx.s.saved.name.replace(/[^\p{L}\p{N}_-]+/gu, '_') || 'transly'}.transly.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    toast('Проєкт збережено у файл');
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
  $('#st-reset', dlg).addEventListener('click', () => {
    if (!confirm('Скинути проєкт? Увесь переклад, глосарій і пам’ять буде видалено.')) return;
    const keep = ctx.s.saved.resetEpoch;
    ctx.s.saved = { ...emptyProject(ctx.s.saved.name), resetEpoch: Math.max(keep, Date.now()) };
    ctx.invalidateTm(); onReset(); dlg.close();
    toast('Проєкт скинуто');
  });
}
