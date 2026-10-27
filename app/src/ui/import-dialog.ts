import { deserialize, looksLikeProject, mergeProjects } from '../core';
import { $, toast } from './dom';
import { pickFromFiles } from './folder';
import type { PickedFile } from './folder';
import { dialog } from './settings';
import type { Ctx } from './state';

/** Merge a project file's text into the open project. Returns how many rows disagreed (the newer edit wins). */
export function importProjectText(ctx: Ctx, text: string, adopt: () => void): number {
  const r = mergeProjects(ctx.s.saved, deserialize(text));
  ctx.s.saved = r.project;
  adopt();
  return r.conflicts.length;
}

const done = (conflicts: number) => toast(conflicts ? `Проєкт злито. Конфліктів: ${conflicts}: лишилась новіша правка` : 'Проєкт злито');

/**
 * Bring work over from another device. A phone has no game folder, so it takes the project file saved on the
 * computer (or its text pasted in), and can also open game files directly.
 */
export function openImport(ctx: Ctx, adopt: () => void, openGameFiles: (files: PickedFile[]) => Promise<void>): void {
  const dlg = dialog(`<form method="dialog"><h2 id="im-t">Відкрити файли</h2>
    <p class="hint">Щоб продовжити на цьому пристрої переклад із комп’ютера, на ПК виберіть «Налаштування → Обмін проєктом через файл → Зберегти проєкт у файл». Передайте файл сюди (месенджер, пошта, власний сервер) і оберіть його нижче. Або скопіюйте весь вміст файлу й вставте в поле.</p>
    <div class="acts l"><button class="btn p" type="button" id="im-pick">Обрати файли…</button></div>
    <p class="hint">Можна обрати файл проєкту (<code>.transly.json</code>) і/або файли гри: <code>.json</code>, <code>.po</code>, <code>.csv</code>, <code>.rpy</code>.</p>
    <input type="file" id="im-file" multiple hidden>
    <label class="lbl-b" for="im-paste">Вставити вміст файлу проєкту (JSON)</label><textarea id="im-paste" rows="6" spellcheck="false" autocomplete="off" placeholder='{"version":1,"name":…'></textarea>
    <div class="acts l"><button class="btn" type="button" id="im-go">Імпортувати вставлене</button></div>
    <p class="hint" id="im-state" role="status"></p>
    <div class="acts"><button class="btn" value="cancel">Закрити</button></div></form>`, 'im-t');
  const state = (t: string) => { $('#im-state', dlg).textContent = t; };
  const finish = () => { if (!ctx.s.views.length) toast('У проєкті немає оригінальних рядків: на ПК відкрийте папку гри й збережіть проєкт знову'); dlg.close(); };

  const fileInput = $('#im-file', dlg) as HTMLInputElement;
  // No `accept`: phones grey out files whose type they do not know (.json, .po), and the user could not pick them.
  $('#im-pick', dlg).addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const files = [...(fileInput.files ?? [])];
    fileInput.value = '';
    if (!files.length) return;
    state('Читаю…');
    const game: File[] = [];
    let projects = 0, conflicts = 0;
    for (const f of files) {
      try {
        if (/\.json$/i.test(f.name) && looksLikeProject(await f.slice(0, 4000).text())) { conflicts += importProjectText(ctx, await f.text(), adopt); projects++; }
        else game.push(f);
      } catch (err) { state(`${f.name}: ${err instanceof Error ? err.message : 'не вдалося прочитати'}`); return; }
    }
    if (projects) done(conflicts);
    if (game.length) {
      const picked = pickFromFiles(game);
      if (!picked.length) { state('Серед файлів немає тих, які я вмію перекладати (.json, .po, .csv, .rpy)'); return; }
      dlg.close();
      await openGameFiles(picked);
      return;
    }
    finish();
  });

  $('#im-go', dlg).addEventListener('click', () => {
    const text = ($('#im-paste', dlg) as HTMLTextAreaElement).value.trim();
    if (!text) { state('Вставте вміст файлу проєкту'); return; }
    try { done(importProjectText(ctx, text, adopt)); finish(); }
    catch (err) { state(err instanceof Error ? err.message : 'Не вдалося прочитати текст'); }
  });
}
