import { test } from 'vitest';
import type { GameFile } from '../../src/core/model';
import type { SavedProject } from '../../src/core/project';
import { looksLikeProse, pluginCandidates } from '../../src/core/plugins';
import { adoptSynced } from '../../src/core/session';
import { pickAsset, parseRelease, platformOf, RELEASE_TAG, sameBuild, updateAvailable } from '../../src/core/update';
import type { Platform } from '../../src/core/update';
import { rng, writeVectors } from './util';
import type { Rng } from './util';

const NAMES = ['ShowText', 'GabText', 'choice_text', 'SetColor', 'Fade', 'Msg', 'Weird-Name', ''];
const ARGS = ['Hello there, brave hero of the realm', 'The door is locked.', '2 Hello world', '0.05', 'SATURATION adjustment 0', '3 4 5', 'Привіт, друже мій', 'x', '', 'Wait for me!', '  spaced   text here  ', 'A very long text '.repeat(8), '#ff00aa 12'];

function genGame(r: Rng): GameFile[] {
  const cmd = (): unknown => r.pick([
    () => ({ code: 356, parameters: [`${r.pick(NAMES)}${r.chance(0.8) ? ' ' : ''}${r.pick(ARGS)}`] }),
    () => ({ code: 356, parameters: [r.pick([5, null, undefined])] }),
    () => ({ code: 401, parameters: ['text'] }),
    () => ({ code: 356, parameters: [] }),
  ])();
  const list = (): unknown[] => Array.from({ length: r.int(8) }, cmd);
  const files: GameFile[] = [];
  if (r.chance(0.8)) files.push({ name: 'Map001.json', json: { events: [null, { pages: [{ list: list() }, { list: list() }] }, 5, { pages: 'x' }] } as never });
  if (r.chance(0.6)) files.push({ name: 'CommonEvents.json', json: [null, { list: list() }, { list: list() }, 'x'] as never });
  if (r.chance(0.5)) files.push({ name: 'Troops.json', json: [null, { pages: [{ list: list() }] }] as never });
  if (r.chance(0.3)) files.push({ name: 'Items.json', json: [null, { list: list() }] as never });
  if (r.chance(0.2)) files.push({ name: 'Map002.json', json: null });
  return files;
}

test('export misc4 vectors', () => {
  const r = rng(13579);
  const out: Record<string, { input: unknown; output: unknown }[]> = {};
  const add = (name: string, input: unknown, output: unknown) => (out[name] ??= []).push({ input, output });

  for (let i = 0; i < 200; i++) { const game = genGame(r); add('candidates', game, pluginCandidates(game)); }
  const PROSE = ['Hello there, brave hero', 'ok', 'Done!', 'yes sir', '0.05', 'SATURATION adjustment 0', '3 4 5 6', 'two words', 'a b c', '', '  ', 'the end.', 'Привіт, друже мій', 'ПРИВІТ ДРУЖЕ МІЙ', 'run 12 3', 'x y z w', 'one two 3 four five', '#aa 1 2 go now please'];
  for (const t of PROSE) add('prose', t, looksLikeProse(t));

  // update
  const SHAS = ['', 'abc1234', 'abc1234def5678', 'dev', 'fff', 'abc', 'zzz999'];
  const TIMES = ['', '2026-11-24T10:00:00Z', '2026-11-24T09:00:00Z', '2026-11-24T10:00:00.5Z', '2026-11-24T12:00:00+02:00', '2026-11-24T08:00:00+00:00', '2026-11-25', 'garbage', '2026-11-24T10:00:00-0300', '2025-02-30T00:00:00Z'];
  for (let i = 0; i < 300; i++) { const a = r.pick(SHAS), b = r.pick(SHAS), p = r.pick(TIMES), t = r.pick(TIMES); add('update', { a, b, p, t }, { avail: updateAvailable(a, b, p, t), same: sameBuild(a, b) }); }
  for (const [and, desk, ua] of [[true, false, ''], [false, false, 'x'], [false, true, 'Mozilla Windows NT 10'], [false, true, 'Macintosh'], [false, true, 'X11 Linux'], [false, true, 'WINDOWS']] as const) add('platform', { and, desk, ua }, platformOf(and, desk, ua));
  for (const p of ['android', 'windows', 'mac', 'linux'] as Platform[]) add('tag', p, RELEASE_TAG[p]);
  const ASSETS = [['App.apk'], ['setup.exe', 'x.msi'], ['x.msi'], ['a.dmg', 'b.exe'], ['a.deb', 'b.AppImage'], ['b.deb'], ['readme.txt'], [], ['Installer-Setup.EXE']];
  for (const names of ASSETS) for (const p of ['android', 'windows', 'mac', 'linux'] as Platform[]) { const assets = names.map(n => ({ name: n, url: 'u/' + n, size: 1 })); add('asset', { p, names }, pickAsset(p, assets)?.name ?? null); }
  const REL = [null, 5, {}, { target_commitish: 5 }, { target_commitish: 'abc' }, { target_commitish: 'abc', published_at: '2026-01-01T00:00:00Z', assets: [{ name: 'a.exe', url: 'u', size: '12', digest: 'sha256:1' }, { name: 5, url: 'u' }, { name: 'b', url: 'u', size: 'x' }, { name: 'c', url: 'u', size: -4 }, { name: 'd', url: 'u', size: true }] }, { target_commitish: 'x', assets: 'no' }];
  for (const j of REL) add('release', j, parseRelease(j));

  // session
  for (let i = 0; i < 40; i++) {
    const mk = (mt: number, target: string): SavedProject => ({ version: 1, name: 'p', sourceLang: 'en', targetLang: 'uk', resetEpoch: 0, files: { 'a.json': { k: { target, status: 'draft', mt } } }, memory: [], terms: [], settings: { tolerancePct: 25, blockErrors: true, who: 'Ви', propagate: true, pluginCommands: [], pluginsAsked: false, lineLimit: 0 } } as unknown as SavedProject);
    const live = mk(r.pick([10, 30]), 'live'), synced = mk(r.pick([20, 20]), 'synced');
    add('adopt', { live, synced }, { merged: adoptSynced(live, synced), same: adoptSynced(live, live) });
  }
  writeVectors('misc4', out);
});
