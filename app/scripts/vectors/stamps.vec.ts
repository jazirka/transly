import { test } from 'vitest';
import type { SavedProject } from '../../src/core/project';
import { ago, builtDrift, copyLine, stamp, stampOf } from '../../src/core/stamps';
import { rng, writeVectors } from './util';

test('export stamps vectors', () => {
  const r = rng(1212);
  const out: Record<string, { input: unknown; output: unknown }[]> = {};
  const add = (name: string, input: unknown, output: unknown) => (out[name] ??= []).push({ input, output });
  const NOW = 1_700_000_000_000;
  for (const d of [0, 1, 59_999, 60_000, 3_599_999, 3_600_000, 47 * 3_600_000, 48 * 3_600_000, 49 * 3_600_000, 100 * 86_400_000, -5000, 123_456_789]) add('ago', { mt: NOW - d, now: NOW }, ago(NOW - d, NOW));
  for (let i = 0; i < 300; i++) {
    const stamps: Record<string, unknown> | undefined = r.chance(0.8) ? {
      ...(r.chance(0.7) ? { copy: r.pick([{ mt: NOW - r.int(200_000_000), how: 'файл' }, { mt: NOW - 1000, how: 'sync', n: 3 }, { mt: null, how: 'x' }, { how: 'nomt' }, null, { mt: 'str', how: 'x' }]) } : {}),
      ...(r.chance(0.7) ? { build: r.pick([{ mt: NOW - r.int(100_000), how: 'збірка', n: 5 }, { mt: NOW - 2, how: 'b' }]) } : {}),
    } : undefined;
    const files: SavedProject['files'] = {};
    for (const f of ['a.json', 'b.json']) if (r.chance(0.8)) files[f] = Object.fromEntries(['k1', 'k2', 'k3', 'k4'].filter(() => r.chance(0.8)).map(k => [k, { target: r.pick(['', ' ', 'text', 'x']), status: r.pick(['draft', 'done', 'appr', 'new'] as never[]), mt: NOW - r.int(1000) }]));
    const saved = { files, ...(stamps ? { stamps } : {}) } as unknown as SavedProject;
    const translated = r.int(5), now = NOW + r.int(200_000_000), since = NOW - r.int(1500);
    add('read', { files, stamps: stamps ?? null, translated, now, since }, { copy: stampOf(saved, 'copy'), build: stampOf(saved, 'build'), line: copyLine(saved, now, translated), drift: builtDrift(saved, since) });
    const ops = Array.from({ length: 1 + r.int(3) }, () => ({ kind: r.pick(['copy', 'build'] as const), how: r.pick(['a', 'ф']), now: NOW + r.int(1000), n: r.chance(0.5) ? r.int(10) : undefined }));
    const s2 = { files: {}, ...(stamps ? { stamps: JSON.parse(JSON.stringify(stamps)) } : {}) } as unknown as SavedProject;
    for (const o of ops) stamp(s2, o.kind, o.how, o.now, o.n);
    add('stamp', { stamps: stamps ?? null, ops }, { stamps: (s2 as { stamps?: unknown }).stamps });
  }
  writeVectors('stamps', out);
});
