import { esc } from './dom';
import { saveFile } from './save';
import type { LoadFailure } from './idb';

/**
 * The stored project could not be read. Before, the app silently started an empty project and the next autosave wrote over
 * the unreadable one. Now nothing is written: the translator sees what happened, can save the record to a file, and starts
 * an empty project only on purpose (the old record is kept under another key). Plain inline styles: it is shown before the
 * app's own styles of either front-end are relevant, and both front-ends use it.
 */
export function showRecovery(root: HTMLElement, failure: LoadFailure, keepAndStartEmpty: () => Promise<void>): Promise<void> {
  const btn = 'font:inherit;padding:10px 14px;margin:6px 8px 0 0;border-radius:8px;border:1px solid #5a5d63;background:#2b2d30;color:#dfe1e5;cursor:pointer;min-height:44px';
  root.innerHTML = `<div role="alert" style="max-width:560px;margin:8vh auto;padding:20px;font:16px/1.5 system-ui,sans-serif;color:#dfe1e5;background:#1e1f22;border:1px solid #393b40;border-radius:12px;overflow:auto;max-height:90vh">
    <h1 style="font-size:20px;margin:0 0 10px">Збережений проєкт не вдалося прочитати</h1>
    <p style="margin:0 0 10px">Причина: ${esc(failure.reason)}.</p>
    <p style="margin:0 0 10px">Нічого не видалено й не перезаписано: ${failure.raw ? 'запис лишається в сховищі цього браузера. Збережіть його у файл (його можна відкрити пізніше або передати розробнику), а тоді почніть із порожнього проєкту. Старий запис при цьому зберігається окремо.' : 'новий запис не робитиметься, доки сховище не відповість. Спробуйте ще раз; якщо браузер у приватному режимі, відкрийте застосунок у звичайному вікні.'}</p>
    ${failure.raw ? `<button type="button" id="rc-save" style="${btn}">Зберегти запис у файл</button>` : ''}
    <button type="button" id="rc-retry" style="${btn}">Спробувати ще раз</button>
    <button type="button" id="rc-new" style="${btn}">Почати з порожнього проєкту</button>
    <p id="rc-msg" style="margin:10px 0 0;color:#a2a7ae" aria-live="polite"></p></div>`;
  const msg = root.querySelector<HTMLElement>('#rc-msg')!;
  return new Promise(resolve => {
    root.querySelector('#rc-save')?.addEventListener('click', () => { void saveFile('transly-unreadable-project.json', failure.raw, 'application/json').then(ok => { msg.textContent = ok ? 'Запис збережено у файл.' : 'Файл не збережено.'; }); });
    root.querySelector('#rc-retry')!.addEventListener('click', () => location.reload());
    root.querySelector('#rc-new')!.addEventListener('click', () => { void keepAndStartEmpty().then(() => { root.innerHTML = ''; resolve(); }, e => { msg.textContent = `Не вдалося: ${e instanceof Error ? e.message : String(e)}`; }); });
  });
}
