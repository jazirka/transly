import { RELEASE_TAG, parseRelease, pickAsset, updateAvailable } from '../core';
import type { ReleaseAsset, ReleaseInfo } from '../core';
import { androidBridge } from '../ui/android';

/** In-app updates of the Android app: the latest release of the private repository, read with a read-only token. */
export interface UpdateCfg { token: string; repo: string; auto: boolean; skipped: string }
export interface UpdateCheck { release: ReleaseInfo; asset: ReleaseAsset | null; newer: boolean; page: string }

// The same key as the desktop app uses, so a token entered once is not asked for again.
const KEY = 'transly-update';
export const canUpdate = (): boolean => !!androidBridge()?.installUpdate;
export function loadUpdateCfg(): UpdateCfg {
  const blank: UpdateCfg = { token: '', repo: 'jazirka/transly', auto: true, skipped: '' };
  try { return { ...blank, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<UpdateCfg>) }; } catch { return blank; }
}
export function saveUpdateCfg(c: UpdateCfg): void { try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* private mode */ } }

export async function checkUpdate(cfg: UpdateCfg): Promise<UpdateCheck> {
  if (!cfg.token.trim()) throw new Error('Вставте токен GitHub з правом читання репозиторію');
  if (!/^[\w.-]+\/[\w.-]+$/.test(cfg.repo.trim())) throw new Error('Репозиторій вкажіть як «власник/назва»');
  const tag = RELEASE_TAG.android;
  let r: Response;
  try { r = await fetch(`https://api.github.com/repos/${cfg.repo.trim()}/releases/tags/${tag}`, { cache: 'no-store', headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', Authorization: `Bearer ${cfg.token.trim()}` } }); }
  catch { throw new Error('Немає з’єднання з GitHub'); }
  if (r.status === 401) throw new Error('Токен недійсний або прострочений');
  if (r.status === 404) throw new Error('Релізу ще немає, або токен не має доступу до репозиторію');
  if (!r.ok) throw new Error(`GitHub: помилка ${r.status}`);
  const release = parseRelease(await r.json());
  if (!release) throw new Error('GitHub надіслав незрозумілу відповідь');
  return { release, asset: pickAsset('android', release.assets), newer: updateAvailable(__BUILD_ID__, release.sha), page: `https://github.com/${cfg.repo.trim()}/releases/tag/${tag}` };
}

/** Android downloads the file itself (with the token, without leaking it to the redirect target) and opens the installer. */
export function installUpdate(cfg: UpdateCfg, c: UpdateCheck, onState: (stage: string, text: string) => void): void {
  if (!c.asset) throw new Error('У релізі немає файлу для цієї системи');
  (window as unknown as { __updateState?: typeof onState }).__updateState = onState;
  androidBridge()!.installUpdate!(c.asset.url, cfg.token.trim());
}
