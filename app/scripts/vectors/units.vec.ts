import { test } from 'vitest';
import { cleanUnits } from '../../src/core/ext/units';
import { rng, text, writeVectors } from './util';

test('export units vectors', () => {
  const r = rng(2024);
  const out: Record<string, { input: unknown; output: unknown }[]> = {};
  const add = (name: string, input: unknown, output: unknown) => (out[name] ??= []).push({ input, output });
  const KEYS = ['a', 'b', 'a', 'k/1', 'k\1', 'Ключ', '', 'x'.repeat(400), 'x'.repeat(401), 'constructor', '__proto__', 'a b', '..', 'é', 5, null, ['k']];
  const KINDS = ['dialogue', 'choice', 'scroll', 'name', 'description', 'message', 'term', 'other', '', 5, null];
  const row = (): unknown => r.pick([
    () => ({ key: r.pick(KEYS), source: r.pick(['Hello', '', text(r, 5), 'z'.repeat(100000), 'z'.repeat(100001), 5, null]), ...(r.chance(0.5) ? { speaker: r.pick(['Bob', 's'.repeat(250), 5, '', null]) } : {}), ...(r.chance(0.7) ? { kind: r.pick(KINDS) } : {}), ...(r.chance(0.5) ? { context: r.pick(['c', 'c'.repeat(450), 7, text(r, 4)]) } : {}), ...(r.chance(0.2) ? { extra: 1, face: 'f' } : {}) }),
    () => r.pick([null, 5, 'str', [], {}, true]),
  ])();
  for (let i = 0; i < 300; i++) {
    const raw = Array.from({ length: r.int(10) }, row);
    add('cleanUnits', raw, { units: cleanUnits(raw) });
  }
  for (const bad of [null, 5, 'x', {}, { length: 1 }, true]) {
    let err: string | null = null;
    try { cleanUnits(bad); } catch (e) { err = (e as Error).message; }
    add('cleanUnits', bad, { error: err });
  }
  writeVectors('units', out);
});
