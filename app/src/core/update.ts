/** Which build of the app this is, and how to tell whether a release is newer. Pure: the network part lives in the UI. */

export type Platform = 'android' | 'windows' | 'mac' | 'linux';

export interface ReleaseAsset { name: string; url: string; size: number; digest?: string }
export interface ReleaseInfo { sha: string; published: string; assets: ReleaseAsset[] }

/** The release tag each platform's installers are published under (see the CI workflows). */
export const RELEASE_TAG: Record<Platform, string> = { android: 'android-latest', windows: 'desktop-latest', mac: 'desktop-latest', linux: 'desktop-latest' };

/** The platform this build runs on: the Android app, or the desktop app on this OS; null in a browser. */
export function platformOf(isAndroidApp: boolean, isDesktopApp: boolean, userAgent: string): Platform | null {
  if (isAndroidApp) return 'android';
  if (!isDesktopApp) return null;
  return /Windows/i.test(userAgent) ? 'windows' : /Mac/i.test(userAgent) ? 'mac' : 'linux';
}

/** GitHub's release JSON → what the update check needs. */
export function parseRelease(json: unknown): ReleaseInfo | null {
  const r = json as { target_commitish?: unknown; published_at?: unknown; assets?: unknown } | null;
  if (!r || typeof r.target_commitish !== 'string') return null;
  const assets = Array.isArray(r.assets) ? (r.assets as Record<string, unknown>[]).filter(a => typeof a.name === 'string' && typeof a.url === 'string').map(a => ({ name: String(a.name), url: String(a.url), size: Number(a.size) || 0, ...(typeof a.digest === 'string' ? { digest: a.digest } : {}) })) : [];
  return { sha: r.target_commitish, published: typeof r.published_at === 'string' ? r.published_at : '', assets };
}

/** The installer to download for this platform. */
export function pickAsset(platform: Platform, assets: ReleaseAsset[]): ReleaseAsset | null {
  const by = (re: RegExp) => assets.find(a => re.test(a.name)) ?? null;
  switch (platform) {
    case 'android': return by(/\.apk$/i);
    case 'windows': return by(/setup.*\.exe$|\.exe$/i) ?? by(/\.msi$/i);
    case 'mac': return by(/\.dmg$/i);
    case 'linux': return by(/\.AppImage$/i) ?? by(/\.deb$/i);
  }
}

/**
 * A release is newer when it was built from another commit AND published after this build was made (a re-run of an older build
 * must not offer a downgrade). A local ("dev") build never asks. Times are optional: without them only the commit is compared.
 */
export function updateAvailable(buildId: string, releaseSha: string, releasePublished = '', builtAt = ''): boolean {
  if (buildId === 'dev' || !releaseSha || releaseSha.startsWith(buildId) || buildId.startsWith(releaseSha)) return false;
  const rel = Date.parse(releasePublished), mine = Date.parse(builtAt);
  return !(Number.isFinite(rel) && Number.isFinite(mine) && rel <= mine);
}
