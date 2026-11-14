import { ingestNote } from '../core';
import type { IngestReport, IngestRow } from '../core';
import { $, esc, toast } from './dom';
import { oneLine } from './hintcards';
import { dialog } from './settings';
import { undoBatch } from './undo-toast';
import { undoReport } from '../core';
import type { Ctx } from './state';

const PAGE = 40;

/** What a new version of the game did to the translations: moved, new lines, lines that are gone (their translation is kept). */
export function openIngestReport(ctx: Ctx, r: IngestReport, batch: string | undefined): void {
  const list = (rows: IngestRow[]): string => rows.slice(0, PAGE).map(x => `<div class="sp-row cs-row"><div class="sp-b"><b>${esc(oneLine(x.source, 140))}</b>${x.target ? `<span class="hint">${esc(oneLine(x.target, 140))}</span>` : ''}<span class="hint">${esc(ctx.fileTitle(x.file))}</span></div></div>`).join('') + (rows.length > PAGE ? `<p class="hint">…і ще ${rows.length - PAGE}</p>` : '');
  const dlg = dialog(`<form method="dialog"><h2 id="ig-t">Нова версія гри</h2>
    <p class="hint">Рядки гри зіставлено з попередньою версією за текстом оригіналу, тому вставлене повідомлення не зсуває переклади.</p>
    <p class="sum" role="status">${esc(ingestNote(r)) || 'Нічого не змінилося'}</p>
    ${r.added.length ? `<h3>Нові рядки (${r.added.length})</h3><div class="sp-list">${list(r.added)}</div>` : ''}
    ${r.gone.length ? `<h3>Зникли з гри (${r.gone.length})</h3><p class="hint">Переклад збережено окремо й повернеться, якщо такий оригінал знову з’явиться.</p><div class="sp-list">${list(r.gone)}</div>` : ''}
    ${r.unaligned.length ? `<h3>Не зіставлено</h3><p class="hint">Ці файли змінилися надто сильно: ${esc(r.unaligned.map(f => ctx.fileTitle(f)).join(', '))}. Переклади там лишилися на своїх місцях.</p>` : ''}
    <div class="acts">${batch ? '<button class="btn" type="button" id="ig-undo">Скасувати зіставлення</button>' : ''}<button class="btn p" value="cancel">Закрити</button></div></form>`, 'ig-t');
  dlg.querySelector('#ig-undo')?.addEventListener('click', () => { const res = undoBatch(ctx, batch!); toast(undoReport(res)); dlg.close(); });
}

/** The folder that was picked holds another game than the project (almost none of the translated lines is in it): ask before the rows are mixed. */
export function askAnotherGame(): Promise<boolean> {
  return new Promise(resolve => {
    const dlg = dialog(`<form method="dialog"><h2 id="ag-t">Схоже, це інша гра</h2>
      <p class="hint">У цій папці майже немає рядків, які в проєкті вже перекладено. Якщо відкрити її тут, переклади старої гри стануть чернетками біля чужих рядків. Для іншої гри краще окремий проєкт: у меню проєкту «Налаштування» є «Скинути проєкт» (спершу збережіть копію проєкту у файл).</p>
      <div class="acts"><button class="btn p" value="cancel" id="ag-no">Не відкривати</button><button class="btn" type="button" id="ag-yes">Усе одно відкрити тут</button></div></form>`, 'ag-t');
    let yes = false;
    dlg.querySelector('#ag-yes')?.addEventListener('click', () => { yes = true; dlg.close(); });
    dlg.addEventListener('close', () => resolve(yes));
  });
}
