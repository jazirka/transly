import { describe, expect, it } from 'vitest';
import { RELEASE_TAG, parseRelease, pickAsset, platformOf, updateAvailable } from '../src/core';

const release = { target_commitish: 'abc123', published_at: '2026-10-28T01:48:30Z', assets: [
  { name: 'Transly_0.1.0_x64-setup.exe', url: 'https://api.github.com/repos/o/r/releases/assets/1', size: 5, digest: 'sha256:aa' },
  { name: 'Transly_0.1.0_x64_en-US.msi', url: 'https://api.github.com/repos/o/r/releases/assets/2', size: 6 },
  { name: 'Transly_0.1.0_aarch64.dmg', url: 'https://api.github.com/repos/o/r/releases/assets/3', size: 7 },
  { name: 'transly.apk', url: 'https://api.github.com/repos/o/r/releases/assets/4', size: 8 },
  { name: 'broken', size: 1 },
] };

describe('updates', () => {
  it('reads GitHub release JSON and ignores malformed assets', () => {
    const r = parseRelease(release)!;
    expect([r.sha, r.published, r.assets.length]).toEqual(['abc123', '2026-10-28T01:48:30Z', 4]);
    expect(r.assets[0]!.digest).toBe('sha256:aa');
    expect(parseRelease({})).toBeNull();
    expect(parseRelease(null)).toBeNull();
  });
  it('picks the installer for the platform, preferring the setup exe on Windows', () => {
    const a = parseRelease(release)!.assets;
    expect(pickAsset('android', a)?.name).toBe('transly.apk');
    expect(pickAsset('windows', a)?.name).toBe('Transly_0.1.0_x64-setup.exe');
    expect(pickAsset('mac', a)?.name).toContain('.dmg');
    expect(pickAsset('linux', a)).toBeNull();
    expect(pickAsset('windows', a.filter(x => !x.name.endsWith('.exe')))?.name).toContain('.msi');
  });
  it('is newer only when built from another commit, and never for a local build', () => {
    expect(updateAvailable('abc123', 'abc123')).toBe(false);
    expect(updateAvailable('abc123def', 'abc123')).toBe(false);
    expect(updateAvailable('abc123', 'def456')).toBe(true);
    expect(updateAvailable('dev', 'def456')).toBe(false);
    expect(updateAvailable('abc123', '')).toBe(false);
  });
  it('knows the platform and the tag its installers live under', () => {
    expect(platformOf(true, false, 'Android')).toBe('android');
    expect(platformOf(false, true, 'Mozilla/5.0 (Windows NT 10.0)')).toBe('windows');
    expect(platformOf(false, true, 'Mozilla/5.0 (Macintosh)')).toBe('mac');
    expect(platformOf(false, true, 'Mozilla/5.0 (X11; Linux)')).toBe('linux');
    expect(platformOf(false, false, 'Chrome')).toBeNull();
    expect([RELEASE_TAG.android, RELEASE_TAG.windows]).toEqual(['android-latest', 'desktop-latest']);
  });
});
