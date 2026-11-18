import { describe, expect, it } from 'vitest';
import { sameBuild } from '../src/core';
import { backgroundRound } from '../src/ui/bgupdate';
import type { BackgroundDeps } from '../src/ui/bgupdate';
import type { UpdateCheck } from '../src/ui/updates';

const release = (sha: string, asset: string | null = 'Transly_0.1.0_x64-setup.exe'): UpdateCheck => ({
  platform: 'windows', newer: true, page: '', release: { sha, published: '', assets: [] },
  asset: asset ? { name: asset, url: 'https://api.github.com/repos/o/r/releases/assets/9', size: 10, digest: 'sha256:00' } : null,
});
function world(over: Partial<{ pending: string | null; check: () => Promise<UpdateCheck>; build: string }> = {}) {
  const calls: { cmd: string; args?: Record<string, unknown> }[] = [], chip: [string | null, boolean][] = [];
  let pending = over.pending ?? null;
  const d: BackgroundDeps = {
    invoke: (async (cmd: string, args?: Record<string, unknown>) => { calls.push({ cmd, args }); if (cmd === 'pending_update') return pending; if (cmd === 'clear_pending_update') pending = null; return null; }) as BackgroundDeps['invoke'],
    check: over.check ?? (async () => release('bbbb2222')),
    thisBuild: id => sameBuild(over.build ?? 'aaaa1111', id),
    waiting: (b, fresh) => { chip.push([b, fresh]); },
  };
  return { d, calls, chip };
}
const cfg = { auto: true, token: ' tok ' };

describe('sameBuild', () => {
  it('a full commit and its short form are one build; a local build is nobody\'s', () => {
    expect(sameBuild('4ef952886764e809', '4ef9528')).toBe(true);
    expect(sameBuild('4ef9528', '92f8af6')).toBe(false);
    expect(sameBuild('dev', 'dev')).toBe(false);
    expect(sameBuild('', 'abc')).toBe(false);
  });
});

describe('the update in the background', () => {
  it('fetches a newer installer quietly: no dialog, only the chip of the status bar says it is waiting', async () => {
    const w = world();
    expect(await backgroundRound(cfg, w.d)).toBe('fetched');
    const fetched = w.calls.find(c => c.cmd === 'prefetch_update')!;
    expect(fetched.args).toEqual({ url: 'https://api.github.com/repos/o/r/releases/assets/9', token: 'tok', name: 'Transly_0.1.0_x64-setup.exe', build: 'bbbb2222' });
    expect(w.chip.at(-1)).toEqual(['bbbb2222', true]);
    expect(w.calls[0]).toEqual({ cmd: 'set_update_mode', args: { auto: true } });
  });
  it('does not fetch the same version twice', async () => {
    const w = world({ pending: 'bbbb2222' });
    expect(await backgroundRound(cfg, w.d)).toBe('waiting');
    expect(w.calls.some(c => c.cmd === 'prefetch_update')).toBe(false);
    expect(w.chip[0]).toEqual(['bbbb2222', false]);
  });
  it('an installer that waits from before but is the build that runs now is thrown away', async () => {
    const w = world({ pending: 'aaaa1111', check: async () => ({ ...release('aaaa1111'), newer: false }) });
    expect(await backgroundRound(cfg, w.d)).toBe('current');
    expect(w.calls.some(c => c.cmd === 'clear_pending_update')).toBe(true);
    expect(w.chip[0]).toEqual([null, false]);
  });
  it('with the setting off nothing is fetched, but a waiting installer is still shown and the shell is told', async () => {
    const w = world({ pending: 'bbbb2222' });
    expect(await backgroundRound({ auto: false, token: 'tok' }, w.d)).toBe('off');
    expect(w.calls[0]).toEqual({ cmd: 'set_update_mode', args: { auto: false } });
    expect(w.chip[0]).toEqual(['bbbb2222', false]);
    expect(w.calls.some(c => c.cmd === 'prefetch_update')).toBe(false);
  });
  it('without a token there is nothing to look with', async () => {
    const w = world();
    expect(await backgroundRound({ auto: true, token: '  ' }, w.d)).toBe('off');
  });
  it('only a Windows installer (.exe) is fetched in the background', async () => {
    const w = world({ check: async () => release('bbbb2222', 'Transly_0.1.0_x64_en-US.msi') });
    expect(await backgroundRound(cfg, w.d)).toBe('failed');
    expect(w.calls.some(c => c.cmd === 'prefetch_update')).toBe(false);
  });
  it('an error (offline, a bad token, no checksum) is swallowed: the round says «failed» and the next one tries again', async () => {
    const offline = world({ check: async () => { throw new Error('Немає з’єднання з GitHub'); } });
    expect(await backgroundRound(cfg, offline.d)).toBe('failed');
    const bad = world();
    bad.d.invoke = (async (cmd: string) => { if (cmd === 'prefetch_update') throw 'контрольна сума не збігається'; return null; }) as BackgroundDeps['invoke'];
    expect(await backgroundRound(cfg, bad.d)).toBe('failed');
    expect(bad.chip.every(([b]) => b === null)).toBe(true);
  });
  it('no newer version: nothing happens', async () => {
    const w = world({ check: async () => ({ ...release('aaaa1111'), newer: false }) });
    expect(await backgroundRound(cfg, w.d)).toBe('current');
    expect(w.calls.some(c => c.cmd === 'prefetch_update')).toBe(false);
  });
});
