import type { UpdateCheck } from './updates';

/**
 * The update in the background (the Windows app): a new version is looked for while the app works, its installer is fetched and checked in
 * the app's data folder without a word, and it is installed without a window when the app is closed (or at once, when the user says so).
 * No dialog, no installer on the screen. What the app needs from outside is passed in, so that the rounds can be tried without a shell.
 */
export interface BackgroundDeps {
  invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
  /** Asks GitHub for the newest release (throws when there is no way to know). */
  check: () => Promise<UpdateCheck>;
  /** True when the id is the build that runs now. */
  thisBuild: (id: string) => boolean;
  /** The state of the chip in the status bar: a build is waiting (fresh: it has just been fetched), or nothing is. */
  waiting: (build: string | null, fresh: boolean) => void;
}

export type RoundResult = 'off' | 'current' | 'waiting' | 'fetched' | 'failed';

export async function backgroundRound(cfg: { auto: boolean; token: string }, d: BackgroundDeps): Promise<RoundResult> {
  // the way the installer is started when the app closes follows the setting
  try { await d.invoke('set_update_mode', { auto: cfg.auto }); } catch { /* not in the shell */ }
  // an installer that waits from before: the version it holds may be the one that runs now (it was installed), then it is only rubbish
  let waiting: string | null = null;
  try { waiting = await d.invoke<string | null>('pending_update'); } catch { /* none */ }
  if (waiting && d.thisBuild(waiting)) { try { await d.invoke('clear_pending_update'); } catch { /* ignore */ } waiting = null; }
  d.waiting(waiting, false);
  if (!cfg.auto || !cfg.token.trim()) return 'off';
  try {
    const c = await d.check();
    if (!c.newer) return waiting ? 'waiting' : 'current';
    if (waiting === c.release.sha) return 'waiting';
    if (!c.asset || !/\.exe$/i.test(c.asset.name)) return 'failed';
    await d.invoke('prefetch_update', { url: c.asset.url, token: cfg.token.trim(), name: c.asset.name, build: c.release.sha });
    d.waiting(c.release.sha, true);
    return 'fetched';
  } catch {
    // offline, a bad token, no checksum from GitHub: the next round tries again; the check made by hand in Settings says why
    return 'failed';
  }
}
