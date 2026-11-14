import { canonicalRpgMakerName, deserialize, formatOf, looksLikeProject, mergeProjects, resetNote } from '../core';
import { artifactDb, describeClaude, loadClaudeConfig, runClaudeSync } from './claude';
import { $, toast } from './dom';
import { isDesktop } from './desktop';
import { pickFromFiles } from './folder';
import type { Chosen, PickedFile } from './folder';
import { dialog } from './settings';
import type { Ctx } from './state';

/** Merge a project file's text into the open project. Returns how many rows disagreed (the newer edit wins). */
export function importProjectText(ctx: Ctx, text: string, adopt: () => void): number {
  // marks from the future (a clock that runs far ahead) are brought back to now, as on every other way in
  const r = mergeProjects(ctx.s.saved, deserialize(text, Date.now()));
  ctx.s.saved = r.project;
  adopt();
  if (r.droppedByReset) toast(`Проєкт злито: ${resetNote(r.droppedByReset)}`);
  return r.conflicts.length;
}

const done = (conflicts: number) => toast(conflicts ? `Проєкт злито. Конфліктів: ${conflicts}: лишилась новіша правка` : 'Проєкт злито');

const TEXT_FILE = /\.(json|txt|bak)$/i;
const GAME_NAMES = 'Map001.json, CommonEvents.json, Items.json…';

/**
 * The name the game uses for a picked file, or null when it is not something Transly can translate. Files that
 * came through a messenger or a download folder are often renamed ("Map001 (1).json"); those are recognised too.
 */
function gameName(name: string): string | null {
  const canon = canonicalRpgMakerName(name);
  if (canon) return canon;
  return formatOf({ name }) ? name : null;
}

/**
 * Bring work over from another device. A phone has no game folder, so it takes the project file saved on the
 * computer (or its text pasted in), and can also open game files directly.
 */
export function openImport(ctx: Ctx, adopt: () => void, openGameFiles: (files: PickedFile[]) => Promise<void>): void {
  const dlg = dialog(`<form method="dialog"><h2 id="im-t">Відкрити файли</h2>
    <p class="hint">${isDesktop()
      ? 'Оберіть файл проєкту (<code>.transly.json</code>), який збережено в іншому місці: «Налаштування → Синхронізація → Обмін проєктом через файл». Або скопіюйте весь вміст файлу й вставте в поле нижче.'
      : 'Щоб продовжити на цьому пристрої переклад із комп’ютера, на ПК виберіть «Налаштування → Синхронізація → Обмін проєктом через файл → Зберегти проєкт у файл». Передайте файл сюди (месенджер, пошта, власний сервер) і оберіть його нижче. Або скопіюйте весь вміст файлу й вставте в поле.'}</p>
    <div id="im-claude" hidden><p class="hint">У застосунку Claude вікно вибору файлів може не відкриватися. Тоді найпростіше взяти проєкт, який ви вже синхронізували з комп’ютера (там: Налаштування → Синхронізація через Claude).</p>
      <div class="acts l"><button class="btn p" type="button" id="im-cl">Отримати з іншого пристрою (через Claude)</button></div></div>
    <div class="acts l"><button class="btn p" type="button" id="im-pick">Обрати файли…</button></div>
    <p class="hint">Можна обрати файл проєкту (<code>.transly.json</code>) і/або файли гри: <code>.json</code>, <code>.po</code>, <code>.csv</code>, <code>.rpy</code>. Файли гри додаються до відкритого проєкту.</p>
    <p class="sum" id="im-state" role="status" hidden></p>
    <input type="file" id="im-file" multiple hidden>
    <label class="lbl-b" for="im-paste">Вставити вміст файлу (JSON)</label><textarea id="im-paste" rows="6" spellcheck="false" autocomplete="off" placeholder='{"version":1,"name":…'></textarea>
    <div id="im-namebox" hidden><label class="lbl-b" for="im-name">Назва файлу гри (як у папці data)</label><input id="im-name" placeholder="Map001.json" autocomplete="off" spellcheck="false"></div>
    <div class="acts l"><button class="btn" type="button" id="im-go">Імпортувати вставлене</button></div>
    <div class="acts"><button class="btn" value="close">Закрити</button></div></form>`, 'im-t');
  const box = $('#im-state', dlg);
  const say = (text: string, bad = false) => { box.hidden = !text; box.textContent = text; box.classList.toggle('bad', bad); if (bad && text) toast(text); };
  const busy = (on: boolean) => dlg.querySelectorAll<HTMLButtonElement>('#im-pick,#im-go,#im-cl').forEach(b => { b.disabled = on; });
  const finish = () => { if (!ctx.s.views.length) toast(isDesktop() ? 'У проєкті немає оригінальних рядків: відкрийте папку гри' : 'У проєкті немає оригінальних рядків: на ПК відкрийте папку гри й збережіть проєкт знову'); dlg.close(); };
  const openGame = async (picked: PickedFile[]) => {
    if (!picked.length) { say(`Не знайшов файлів, які можна перекладати. Файли гри мають називатися як у папці data (${GAME_NAMES}) або бути .po, .csv, .rpy.`, true); return; }
    dlg.close();
    await openGameFiles(picked);
  };

  void artifactDb().then(db => { if (db) $('#im-claude', dlg).hidden = false; });
  $('#im-cl', dlg).addEventListener('click', async () => {
    busy(true); say('Отримую…');
    try {
      const rep = await runClaudeSync(ctx, loadClaudeConfig(), adopt);
      toast(describeClaude(rep));
      if (!ctx.s.views.length) { say('У спільній базі ще немає проєкту. Спершу на комп’ютері: Налаштування → Синхронізація через Claude → Синхронізувати.', true); busy(false); return; }
      dlg.close();
    } catch (err) { say(err instanceof Error ? err.message : 'Не вдалося синхронізувати', true); busy(false); }
  });
  const fileInput = $('#im-file', dlg) as HTMLInputElement;
  // No `accept`: phones grey out files whose type they do not know (.json, .po), and the user could not pick them.
  $('#im-pick', dlg).addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const files = [...(fileInput.files ?? [])];
    if (!files.length) return;
    busy(true); say(`Читаю файлів: ${files.length}…`);
    const game: Chosen[] = [], unknown: string[] = [];
    let projects = 0, conflicts = 0;
    try {
      for (const f of files) {
        const text = TEXT_FILE.test(f.name) || f.type === 'application/json' ? await f.text() : undefined;
        if (text !== undefined && looksLikeProject(text)) { conflicts += importProjectText(ctx, text, adopt); projects++; continue; }
        const name = gameName(f.name);
        if (name) game.push({ file: f, name, ...(text !== undefined ? { text } : {}) }); else unknown.push(f.name);
      }
    } catch (err) { say(`Не вдалося прочитати файл: ${err instanceof Error ? err.message : 'помилка'}`, true); busy(false); fileInput.value = ''; return; }
    fileInput.value = '';
    busy(false);
    if (projects) done(conflicts);
    if (game.length) { await openGame(pickFromFiles(game)); return; }
    if (projects) { finish(); return; }
    say(`Файл «${unknown[0] ?? ''}» не схожий ні на проєкт Transly, ні на файл гри. Файли гри мають називатися як у папці data (${GAME_NAMES}).`, true);
  });

  $('#im-go', dlg).addEventListener('click', async () => {
    const text = ($('#im-paste', dlg) as HTMLTextAreaElement).value.trim();
    if (!text) { say('Вставте вміст файлу', true); return; }
    try {
      if (looksLikeProject(text)) { done(importProjectText(ctx, text, adopt)); finish(); return; }
      try { JSON.parse(text); } catch { say('Це не JSON: схоже, текст скопійовано не повністю', true); return; }
    } catch (err) { say(err instanceof Error ? err.message : 'Не вдалося прочитати текст', true); return; }
    // Valid JSON but not a project: it is a game file, which needs the name the game uses for it.
    const nameBox = $('#im-namebox', dlg), nameIn = $('#im-name', dlg) as HTMLInputElement;
    const name = nameIn.value.trim() ? canonicalRpgMakerName(nameIn.value.trim()) : null;
    if (!name) {
      nameBox.hidden = false; nameIn.focus();
      say(nameIn.value.trim() ? `«${nameIn.value.trim()}» — не назва файлу гри. Приклади: ${GAME_NAMES}` : 'Це не файл проєкту, а, схоже, файл гри. Вкажіть, як він називається в папці data, і натисніть ще раз.', true);
      return;
    }
    await openGame(pickFromFiles([{ file: new File([text], name), name, text }]));
  });
}
