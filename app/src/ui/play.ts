import { build, jumpPlugin, jumpTarget } from '../core';
import type { Unit } from '../core';
import { applyJump, applyToGame, launchGame, restoreJump } from './desktop';
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
  if (!target) { toast('Для цього рядка запуск у грі недоступний: він не належить до події на мапі, загальної події чи битви (рядки бази даних, як-от предмети й навички, у грі не відтворюються)'); return; }
  const r = build(ctx.s.game, ctx.s.views, ctx.s.saved, { onlyApproved: false, includeDrafts: true, blockErrors: true, qa: ctx.qaOpts() });
  await applyToGame(dir, r.files);
  await applyJump(dir, jumpPlugin(target));
  ctx.built(r.included);
  await launchGame();
  toast('Гру запущено: вона починається з цієї сцени. «Збірка → Повернути оригінали» прибере тестовий плагін');
}

/** Write the translation (drafts included) into the game folder and start the game, to try it as it is. */
export async function buildAndRunGame(ctx: Ctx): Promise<void> {
  const dir = ctx.gameDir();
  if (!dir) { toast('Папку гри не відкрито: відкрийте її в застосунку на ПК'); return; }
  const r = build(ctx.s.game, ctx.s.views, ctx.s.saved, { onlyApproved: false, includeDrafts: true, blockErrors: true, qa: ctx.qaOpts() });
  const n = await applyToGame(dir, r.files);
  await restoreJump(dir).catch(() => false); // a normal start, not a scene test
  ctx.built(r.included);
  await launchGame();
  toast(`Записано файлів у гру: ${n}. Гру запущено`);
}
