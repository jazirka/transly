import { build, jumpPlugin, jumpTarget, sceneAddress } from '../core';
import type { Unit } from '../core';
import { applyJump, applyToGame, gameExe, launchGame, restoreJump } from './desktop';
import { toast } from './dom';
import type { Ctx } from './state';

/**
 * Write the translation (drafts included) into the game, add the test plugin and start the game, which then begins
 * inside the scene of `unit`. Desktop only: the caller checks `ctx.gameDir()`.
 */
export async function playInGame(ctx: Ctx, file: string, unit: Unit, from: 'line' | 'event', slot: number): Promise<void> {
  const dir = ctx.gameDir();
  if (!dir) throw new Error('Папку гри не відкрито');
  const target = jumpTarget(file, unit.key, ctx.s.game, from, slot);
  if (!target) { toast(noTargetReason(ctx, file, unit.key)); return; }
  // Ask for the game's program before anything is written: a cancelled dialog leaves the game folder as it was.
  if (!(await gameExe())) { toast('Гру не запущено: не вказано файл гри (.exe). Нічого не записано'); return; }
  const r = build(ctx.s.game, ctx.s.views, ctx.s.saved, { onlyApproved: false, includeDrafts: true, blockErrors: true, qa: ctx.qaOpts() });
  await applyToGame(dir, r.files);
  try { await applyJump(dir, jumpPlugin(target)); }
  catch (e) { throw new Error(`переклад записано в гру, але тестовий плагін не встановлено: ${e instanceof Error ? e.message : String(e)}`); }
  ctx.built(r.included);
  if (!(await launchGame())) { toast('Гру не запущено: не вказано файл гри (.exe). Переклад і тестовий плагін уже в грі; «Збірка → Повернути оригінали» прибере їх'); return; }
  toast('Гру запущено: вона починається з цієї сцени. «Збірка → Повернути оригінали» прибере тестовий плагін');
}

/** Why a row cannot start the game: the three causes read differently to the translator. */
function noTargetReason(ctx: Ctx, file: string, key: string): string {
  if (!sceneAddress(file, key)) return 'Для цього рядка запуск у грі недоступний: він не належить до події на мапі, загальної події чи битви (рядки бази даних, як-от предмети й навички, у грі не відтворюються)';
  if (!ctx.s.game.some(f => f.name === file)) return 'Файли гри не завантажено (показано збережений знімок): відкрийте папку гри, щоб запустити сцену';
  return 'Цієї події вже немає у файлі гри: гра змінилася після останнього відкриття. Відкрийте папку гри знову (Файл → Відкрити папку гри…)';
}

/** Write the translation (drafts included) into the game folder and start the game, to try it as it is. */
export async function buildAndRunGame(ctx: Ctx): Promise<void> {
  const dir = ctx.gameDir();
  if (!dir) { toast('Папку гри не відкрито: відкрийте її в застосунку на ПК'); return; }
  if (!(await gameExe())) { toast('Гру не запущено: не вказано файл гри (.exe). Нічого не записано'); return; }
  const r = build(ctx.s.game, ctx.s.views, ctx.s.saved, { onlyApproved: false, includeDrafts: true, blockErrors: true, qa: ctx.qaOpts() });
  const n = await applyToGame(dir, r.files);
  await restoreJump(dir).catch(() => false); // a normal start, not a scene test
  ctx.built(r.included);
  toast((await launchGame()) ? `Записано файлів у гру: ${n}. Гру запущено` : `Записано файлів у гру: ${n}. Гру не запущено: не вказано файл гри (.exe)`);
}
