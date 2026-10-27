import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { build, createZip, crc32, emptyProject, readGame } from '../src/core';
import type { Entry, GameFile } from '../src/core';

const cmd = (code: number, parameters: unknown[]) => ({ code, indent: 0, parameters });
const game: GameFile[] = [{ name: 'Map001.json', json: { events: [null, { id: 1, name: 'A', pages: [{ list: [
  cmd(101, ['', 0, 0, 2, '']), cmd(401, ['Hello \\C[2]you\\C[0]']),
  cmd(101, ['', 0, 0, 2, '']), cmd(401, ['Second']),
  cmd(101, ['', 0, 0, 2, '']), cmd(401, ['Third']),
  cmd(101, ['', 0, 0, 2, '']), cmd(401, ['Fourth']),
] }] }] } }];
const opts = { onlyApproved: false, blockErrors: true, qa: { tolerancePct: 25, terms: [] } };
const e = (target: string, status: Entry['status']): Entry => ({ target, status, mt: 1 });

describe('build', () => {
  const views = readGame(game);
  const [u0, u1, u2, u3] = views[0]!.units;
  const saved = { ...emptyProject('t'), files: { 'Map001.json': {
    [u0!.key]: e('Привіт \\C[2]ти\\C[0]', 'appr'),
    [u1!.key]: e('Другий', 'done'),
    [u2!.key]: e('Третій', 'draft'),
    [u3!.key]: e('Четвертий', 'appr'),
  } } };

  it('includes reviewed and waiting units, skips drafts, leaves input untouched', () => {
    const before = JSON.stringify(game);
    const r = build(game, views, saved, opts);
    expect(r).toMatchObject({ included: 3, skipped: 1, blocked: [] });
    expect(JSON.stringify(game)).toBe(before);
    const list = (r.files[0]!.json as { events: { pages: { list: { parameters: string[] }[] }[] }[] }).events[1]!.pages[0]!.list;
    expect(list.map(c => c.parameters[0]).filter(p => typeof p === 'string' && p.length > 1)).toEqual(['Привіт \\C[2]ти\\C[0]', 'Другий', 'Third', 'Четвертий']);
  });

  it('onlyApproved drops units waiting for review', () => {
    expect(build(game, views, saved, { ...opts, onlyApproved: true }).included).toBe(2);
  });

  it('blocks units with QA errors', () => {
    const broken = { ...saved, files: { 'Map001.json': { ...saved.files['Map001.json'], [u0!.key]: e('Привіт ти', 'appr') } } };
    const r = build(game, views, broken, opts);
    expect(r.blocked).toEqual([`Map001.json::${u0!.key}`]);
    expect(r.included).toBe(2);
    expect(build(game, views, broken, { ...opts, blockErrors: false }).included).toBe(3);
  });
});

describe('zip', () => {
  it('crc32 matches the standard check value', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });
  it('produces an archive that unzip accepts, with UTF-8 content intact', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zip-'));
    const body = new TextEncoder().encode('{"a":"Привіт"}');
    writeFileSync(join(dir, 'x.zip'), createZip([{ name: 'data/Map001.json', data: body }, { name: 'data/Items.json', data: new Uint8Array() }]));
    try {
      const out = execFileSync('unzip', ['-p', join(dir, 'x.zip'), 'data/Map001.json']).toString();
      expect(out).toBe('{"a":"Привіт"}');
      expect(execFileSync('unzip', ['-t', join(dir, 'x.zip')]).toString()).toContain('No errors detected');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return; // unzip not installed here
      throw err;
    }
  });
});
