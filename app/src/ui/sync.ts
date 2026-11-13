import { adoptSynced, stamp, deriveKeys, httpTransport, syncOnce } from '../core';
import type { SyncReport } from '../core';
import type { Ctx } from './state';

export interface SyncConfig { url: string; passphrase: string; everyMin: number; last: number }
const KEY = 'transly-sync';

/** Server address and passphrase stay on this device only (they are never part of the project file). */
export function loadSyncConfig(): SyncConfig {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<SyncConfig>;
    return { url: raw.url ?? '', passphrase: raw.passphrase ?? '', everyMin: raw.everyMin ?? 0, last: raw.last ?? 0 };
  } catch { return { url: '', passphrase: '', everyMin: 0, last: 0 }; }
}

export function saveSyncConfig(c: SyncConfig): void {
  try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* private mode: the user just re-enters it */ }
}

export const syncConfigured = (c: SyncConfig): boolean => !!c.url.trim() && c.passphrase.length >= 8;

/** Sync now and put the merged project into the app. Throws readable errors. */
export async function runSync(ctx: Ctx, cfg: SyncConfig, adopt: () => void): Promise<SyncReport> {
  const keys = await deriveKeys(cfg.passphrase);
  await ctx.autosave.flush();
  const report = await syncOnce(httpTransport(cfg.url), keys, ctx.s.saved, { since: cfg.last });
  // edits typed while the request was running must survive: merge the result into what is in memory now
  ctx.s.saved = adoptSynced(ctx.s.saved, report.project);
  stamp(ctx.s.saved, 'copy', 'синхронізація', Date.now());
  cfg.last = Date.now();
  saveSyncConfig(cfg);
  adopt();
  return report;
}

export function describe(r: SyncReport): string {
  const parts = [r.gotSnapshot ? 'отримано оригінальні рядки' : '', r.conflicts ? `конфліктів: ${r.conflicts} (лишилась новіша правка)` : ''].filter(Boolean);
  return 'Синхронізовано' + (parts.length ? ': ' + parts.join(', ') : '');
}
