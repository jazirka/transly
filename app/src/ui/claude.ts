import { EMPTY_CLAUDE_STATE, adoptSynced, claudeSync, stamp } from '../core';
import type { ClaudeReport, ClaudeState, DbLike } from '../core';
import type { Ctx } from './state';

type ClaudeHost = { claude?: { use?: (name: string) => Promise<unknown> } };

let dbPromise: Promise<DbLike | null> | null = null;

/** The artifact's shared database, or null when this page is not running inside an artifact that has it. */
export function artifactDb(): Promise<DbLike | null> {
  dbPromise ??= (async () => {
    try { return ((await (window as unknown as ClaudeHost).claude?.use?.('db')) as DbLike | null | undefined) ?? null; }
    catch { return null; }
  })();
  return dbPromise;
}

export interface ClaudeConfig {
  everyMin: number;
  last: number;
  /** What this device saw in the shared database last time. */
  state: ClaudeState;
  /** Names this device when two devices compete for the write lease. */
  holder: string;
}

const KEY = 'transly-claude';

export function loadClaudeConfig(): ClaudeConfig {
  const fresh = { everyMin: 0, last: 0, state: EMPTY_CLAUDE_STATE, holder: '' };
  let c: ClaudeConfig;
  try { c = { ...fresh, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<ClaudeConfig>) }; } catch { c = fresh; }
  if (!c.holder) c.holder = (crypto.randomUUID?.() ?? String(Math.random())).slice(0, 18);
  return c;
}

export function saveClaudeConfig(c: ClaudeConfig): void {
  try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* private mode: it just starts over */ }
}

/** Sync now and put the merged project into the app. Throws readable errors. */
export async function runClaudeSync(ctx: Ctx, cfg: ClaudeConfig, adopt: () => void): Promise<ClaudeReport> {
  const db = await artifactDb();
  if (!db) throw new Error('Спільна база доступна лише у вбудованому артефакті Claude');
  await ctx.autosave.flush();
  const report = await claudeSync(db, cfg.holder, cfg.state, ctx.s.saved, { since: cfg.last });
  // edits typed while the request was running must survive: merge the result into what is in memory now
  ctx.s.saved = adoptSynced(ctx.s.saved, report.project);
  stamp(ctx.s.saved, 'copy', 'синхронізація', Date.now());
  cfg.last = Date.now();
  cfg.state = report.state;
  saveClaudeConfig(cfg);
  adopt();
  return report;
}

export function describeClaude(r: ClaudeReport): string {
  const parts = [
    r.pulled ? `отримано файлів: ${r.pulled}` : '',
    r.pushed ? `надіслано файлів: ${r.pushed}` : '',
    r.gotSnapshot ? 'отримано оригінальні рядки' : '',
    r.conflicts ? `конфліктів: ${r.conflicts} (лишилась новіша правка)` : '',
  ].filter(Boolean);
  return 'Через Claude: ' + (parts.length ? parts.join(', ') : 'усе вже синхронізовано');
}
