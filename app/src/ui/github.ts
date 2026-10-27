import { EMPTY_GITHUB_STATE, githubSync } from '../core';
import type { GithubApi, GithubReport, GithubSettings, GithubState } from '../core';
import type { Ctx } from './state';

export interface GithubConfig extends GithubSettings {
  token: string;
  /** API address; changes only for GitHub Enterprise (and tests). */
  api: string;
  everyMin: number;
  last: number;
  /** What this device saw in the repository last time. */
  state: GithubState;
}

const KEY = 'transly-github';
export const DEFAULT_API = 'https://api.github.com';

/** The token and repository stay on this device only: they are never part of the project file. */
export function loadGithubConfig(): GithubConfig {
  const blank: GithubConfig = { repo: '', branch: '', dir: '', originals: true, token: '', api: DEFAULT_API, everyMin: 0, last: 0, state: EMPTY_GITHUB_STATE };
  try { return { ...blank, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<GithubConfig>) }; } catch { return blank; }
}

export function saveGithubConfig(c: GithubConfig): void {
  try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* private mode: the user just re-enters it */ }
}

export const githubConfigured = (c: GithubConfig): boolean => !!c.repo.trim() && !!c.token.trim();

export function githubApi(cfg: GithubConfig, fetchFn: typeof fetch = fetch): GithubApi {
  const base = (cfg.api.trim() || DEFAULT_API).replace(/\/+$/, '');
  return {
    async request(method, path, body) {
      const r = await fetchFn(base + path, {
        method,
        headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', Authorization: `Bearer ${cfg.token.trim()}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      const text = await r.text();
      let json: unknown = {};
      try { json = text ? JSON.parse(text) : {}; } catch { /* an error page: only the status matters */ }
      return { status: r.status, json };
    },
  };
}

/** Sync now and put the merged project into the app. Throws readable errors. */
export async function runGithubSync(ctx: Ctx, cfg: GithubConfig, adopt: () => void): Promise<GithubReport> {
  await ctx.autosave.flush();
  const report = await githubSync(githubApi(cfg), cfg, cfg.state, ctx.s.saved, { since: cfg.last });
  ctx.s.saved = report.project;
  cfg.last = Date.now();
  cfg.state = report.state;
  saveGithubConfig(cfg);
  adopt();
  return report;
}

export function describeGithub(r: GithubReport): string {
  const parts = [
    r.pulled ? `отримано файлів: ${r.pulled}` : '',
    r.pushed ? `надіслано файлів: ${r.pushed}` : '',
    r.gotSnapshot ? 'отримано оригінальні рядки' : '',
    r.conflicts ? `конфліктів: ${r.conflicts} (лишилась новіша правка)` : '',
    r.skippedOriginals ? 'оригінальні рядки не збережено: репозиторій публічний' : '',
  ].filter(Boolean);
  return 'GitHub: ' + (parts.length ? parts.join(', ') : 'усе вже синхронізовано');
}
