import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { apply, extract } from '../src/core';
import type { Translations } from '../src/core';

/** Set GAME_DATA_DIR to a game's data folder to run these against real files (not shipped with the repo). */
const dir = process.env.GAME_DATA_DIR;
describe.skipIf(!dir || !existsSync(dir))('real game data', () => {
  const files = dir ? readdirSync(dir).filter(f => f.endsWith('.json')) : [];
  it('extracts units and round-trips every file unchanged with identity translations', () => {
    let total = 0;
    for (const name of files) {
      const json = JSON.parse(readFileSync(`${dir}/${name}`, 'utf8'));
      const units = extract({ name, json });
      total += units.length;
      const keys = new Set(units.map(u => u.key));
      expect(keys.size, `${name}: duplicate keys`).toBe(units.length);
      const identity: Translations = Object.fromEntries(units.map(u => [u.key, { target: u.source, status: 'done' as const, mt: 1 }]));
      expect(apply({ name, json }, identity), `${name}: round trip`).toEqual(json);
    }
    expect(total).toBeGreaterThan(0);
  }, 120_000);
});
