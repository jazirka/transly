import { build, isRpgMakerFile } from '../core';
import { $, el, esc, plural, toast } from './dom';
import { applyToGame, isDesktop, launchGame, pickExe, rememberedExe, restoreGame, restoreJump } from './desktop';
import { canWriteFolder, downloadZip, writeToFolder } from './export';
import type { Ctx } from './state';

/** Build dialog: zip / folder everywhere, plus "apply and launch" inside the desktop app. */
export function openBuild(ctx: Ctx, dataDir: string | null, onBuilt: (n: number) => void): void {
  const { s } = ctx;
  if (!s.game.length) { toast('Для збірки відкрийте папку гри: вона потрібна лише тут'); return; }
  const desk = isDesktop() && !!dataDir && s.game.every(f => isRpgMakerFile(f.name));
  const opener = document.activeElement as HTMLElement | null;
  const dlg = el('dialog', 'adlg');
  dlg.setAttribute('aria-labelledby', 'bd-t');
  dlg.innerHTML = `<form method="dialog"><h2 id="bd-t">Збірка</h2>
    <p class="hint">Записує перекладені рядки в копії файлів гри. Оригінальні файли не змінюються: оберіть окрему папку або завантажте ZIP.</p>
    <label class="achk"><input type="checkbox" id="bd-appr"> Лише вичитані рядки</label>
    <label class="achk"><input type="checkbox" id="bd-block" checked> Не брати рядки з помилкою QA</label>
    ${desk ? '<label class="achk"><input type="checkbox" id="bd-draft"> Додати чернетки (щоб побачити в грі те, що ще пишете)</label>' : ''}
    <p id="bd-sum" class="sum" role="status"></p>
    ${desk ? `<div class="gamebox"><div class="sh">Перевірка в грі</div><p class="hint">Переклад записується прямо в папку даних гри (${esc(dataDir ?? '')}). Оригінали зберігаються поруч, у папці з суфіксом «.transly-orig», і повертаються кнопкою нижче.</p>
      <p class="hint" id="bd-exe">${rememberedExe() ? 'Файл гри: ' + esc(rememberedExe() ?? '') : 'Файл гри ще не вибрано'}</p>
      <div class="acts l"><button class="btn p" id="bd-play" type="button">Застосувати й запустити гру</button><button class="btn" id="bd-apply" type="button">Лише застосувати</button><button class="btn" id="bd-restore" type="button">Повернути оригінали</button><button class="btn" id="bd-pickexe" type="button">Обрати файл гри…</button></div></div>` : ''}
    <div class="acts"><button class="btn" value="cancel">Закрити</button>
      ${canWriteFolder() && !desk ? '<button class="btn p" id="bd-dir" type="button">Зібрати в папку…</button>' : ''}
      <button class="btn ${canWriteFolder() && !desk ? '' : desk ? '' : 'p'}" id="bd-zip" type="button">Завантажити ZIP</button></div></form>`;
  document.body.appendChild(dlg);
  const run = () => build(s.game, s.views, s.saved, { onlyApproved: ($('#bd-appr', dlg) as HTMLInputElement).checked, includeDrafts: !!(dlg.querySelector('#bd-draft') as HTMLInputElement | null)?.checked, blockErrors: ($('#bd-block', dlg) as HTMLInputElement).checked, qa: ctx.qaOpts() });
  const sum = () => {
    const r = run();
    $('#bd-sum', dlg).textContent = r.included
      ? `У збірку потрапить ${plural(r.included, ['рядок', 'рядки', 'рядків'])} у ${plural(r.files.length, ['файлі', 'файлах', 'файлах'])}. Пропущено: ${r.skipped}${r.blocked.length ? ` (з них через помилки QA: ${r.blocked.length})` : ''}.`
      : 'У збірку поки нічого не потрапить: немає надісланих на вичитування чи вичитаних рядків.';
    dlg.querySelectorAll<HTMLButtonElement>('#bd-dir,#bd-zip,#bd-play,#bd-apply').forEach(b => { b.disabled = !r.included; });
  };
  dlg.addEventListener('change', sum);
  dlg.addEventListener('close', () => { dlg.remove(); opener?.focus?.(); });
  dlg.addEventListener('click', async e => {
    const t = e.target as HTMLElement;
    try {
      if (t.id === 'bd-zip') { const r = run(); if (await downloadZip(r)) { toast('ZIP збережено'); onBuilt(r.included); dlg.close(); } }
      else if (t.id === 'bd-dir') { const r = run(); if (await writeToFolder(r)) { toast('Збірку записано в папку'); onBuilt(r.included); dlg.close(); } }
      else if (t.id === 'bd-apply' || t.id === 'bd-play') {
        const r = run();
        const n = await applyToGame(dataDir!, r.files);
        await restoreJump(dataDir!).catch(() => false); // a normal start, not the scene test
        toast(`Записано файлів у гру: ${n}`);
        onBuilt(r.included);
        if (t.id === 'bd-play') { await launchGame(); toast('Гру запущено'); }
        dlg.close();
      } else if (t.id === 'bd-restore') { const n = await restoreGame(dataDir!); const plugin = await restoreJump(dataDir!).catch(() => false); toast(`Повернуто оригінальних файлів: ${n}${plugin ? '. Тестовий плагін прибрано' : ''}`); }
      else if (t.id === 'bd-pickexe') { const x = await pickExe(); if (x) $('#bd-exe', dlg).textContent = 'Файл гри: ' + x; }
    } catch (err) { toast('Не вдалося записати: ' + (err instanceof Error ? err.message : String(err))); }
  });
  sum();
  dlg.showModal();
}
