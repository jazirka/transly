import { DEFAULT_SETTINGS, emptyProject, parseTerms } from '../core';
import { $, el, plural, toast } from './dom';
import type { Ctx } from './state';

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

export function openSettings(ctx: Ctx, onReset: () => void): void {
  const st = ctx.s.saved.settings;
  const dlg = dialog(`<form method="dialog"><h2 id="st-t">Налаштування</h2>
    <div class="grid"><label for="st-tol">Допуск довжини перекладу відносно оригіналу, %</label><input id="st-tol" type="number" min="5" max="100" step="5" value="${st.tolerancePct}">
      <label for="st-who">Ваше ім’я в коментарях та історії</label><input id="st-who" maxlength="40" value="${st.who}"></div>
    <label class="chk"><input type="checkbox" id="st-block" ${st.blockErrors ? 'checked' : ''}> Не надсилати рядок із помилкою QA</label>
    <p class="hint">Довжина не обмежується: застосунок лише попереджає, коли переклад дуже відрізняється від оригіналу.</p>
    <details><summary>Імпорт глосарію</summary><p class="hint">Рядки «англійською, табуляція, українською».</p><textarea id="st-terms" rows="5" aria-label="Терміни для імпорту"></textarea><button class="btn" type="button" id="st-terms-go">Імпортувати терміни</button></details>
    <details><summary>Імпорт пам’яті перекладів</summary><p class="hint">Рядки «оригінал, табуляція, переклад».</p><textarea id="st-tm" rows="5" aria-label="Пари для імпорту"></textarea><button class="btn" type="button" id="st-tm-go">Імпортувати пари</button></details>
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
  $('#st-reset', dlg).addEventListener('click', () => {
    if (!confirm('Скинути проєкт? Увесь переклад, глосарій і пам’ять буде видалено.')) return;
    const keep = ctx.s.saved.resetEpoch;
    ctx.s.saved = { ...emptyProject(ctx.s.saved.name), resetEpoch: Math.max(keep, Date.now()) };
    ctx.invalidateTm(); onReset(); dlg.close();
    toast('Проєкт скинуто');
  });
}
