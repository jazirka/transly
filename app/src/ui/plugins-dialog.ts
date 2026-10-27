import { pluginCandidates } from '../core';
import { esc, plural } from './dom';
import { dialog } from './settings';
import type { Ctx } from './state';

/**
 * Some games show text through plugin commands (a pop-up line, a menu option) instead of message boxes. Which
 * commands hold text depends on the plugin, so the translator picks them from what the game actually uses.
 */
export function openPluginTexts(ctx: Ctx, apply: (names: string[]) => void): void {
  const st = ctx.s.saved.settings;
  const cands = pluginCandidates(ctx.s.game);
  const chosen = new Set(st.pluginCommands);
  if (!st.pluginsAsked) for (const c of cands) if (c.likely) chosen.add(c.name);
  const known = new Set(cands.map(c => c.name));
  const keep = st.pluginCommands.filter(n => !known.has(n));
  const rows = cands.map((c, i) => `<label class="pl-row"><input type="checkbox" data-pl="${esc(c.name)}" ${chosen.has(c.name) ? 'checked' : ''}>
      <span class="pl-b"><b>${esc(c.name)}</b> <span class="hint">· ${plural(c.withText, ['команда з текстом', 'команди з текстом', 'команд з текстом'])}${c.withText < c.count ? ` із ${c.count}` : ''}</span>${c.likely ? ' <span class="tagi">схоже на текст для гравця</span>' : ''}
      ${c.samples.map(x => `<span class="hint pl-s">«${esc(x)}»</span>`).join('')}</span></label>`).join('');
  const dlg = dialog(`<form method="dialog"><h2 id="pl-t">Тексти плагінів</h2>
    <p class="hint">Деякі ігри показують текст не у вікнах повідомлень, а командами плагінів (спливаючі репліки, пункти меню). Позначте команди, чий текст бачить гравець: вони з’являться в перекладі як окремі рядки. Назва команди та числа в ній лишаються як були.</p>
    ${cands.length ? `<div class="pl-list">${rows}</div>` : `<p class="hint">${ctx.s.game.length ? 'У цій грі не знайдено команд плагінів із текстом.' : 'Файлів гри зараз немає (проєкт відкрито зі збереженого файлу). Команди можна вибрати на комп’ютері, коли відкрито папку гри.'}</p>`}
    ${keep.length ? `<p class="hint">Також увімкнено раніше: ${keep.map(esc).join(', ')}.</p>` : ''}
    <div class="acts"><button class="btn" value="cancel" id="pl-no">${st.pluginsAsked ? 'Скасувати' : 'Не зараз'}</button>${cands.length ? '<button class="btn p" id="pl-ok" value="save">Застосувати</button>' : ''}</div></form>`, 'pl-t');
  dlg.addEventListener('close', () => { if (!st.pluginsAsked) { st.pluginsAsked = true; ctx.persist(); } });
  dlg.querySelector('#pl-ok')?.addEventListener('click', () => {
    const names = [...dlg.querySelectorAll<HTMLInputElement>('[data-pl]')].filter(b => b.checked).map(b => b.dataset.pl!);
    apply([...keep, ...names]);
  });
}
