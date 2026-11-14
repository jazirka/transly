import { describe, expect, it } from 'vitest';
import { apply, extract } from '../src/core';
import type { GameFile, Translations } from '../src/core';

const cmd = (code: number, parameters: unknown[], indent = 0) => ({ code, indent, parameters });
const tr = (entries: Record<string, string>): Translations =>
  Object.fromEntries(Object.entries(entries).map(([k, target]) => [k, { target, status: 'done' as const, mt: 1 }]));

const files: GameFile[] = [
  { name: 'CommonEvents.json', json: [null, { id: 1, name: 'Intro', list: [cmd(101, ['', 0, 0, 2, '']), cmd(401, ['Hello, hero.']), cmd(102, [['Yes', 'No'], 1]), cmd(0, [])] }] },
  { name: 'Troops.json', json: [null, { id: 1, name: 'Slimes', pages: [{ list: [cmd(101, ['', 0, 0, 2, '']), cmd(401, ['Gloop!']), cmd(0, [])] }] }] },
  { name: 'System.json', json: { gameTitle: 'Quest', currencyUnit: 'G', elements: ['', 'Fire'], terms: { basic: ['Level'], commands: ['Fight'], params: [], messages: { actionFailure: 'No effect!' } } } },
  { name: 'Items.json', json: [null, { id: 1, name: 'Potion', description: 'Heals.', price: 50, note: '<tag>' }] },
];

describe('apply: every RPG Maker file kind writes translations back and changes nothing else', () => {
  for (const f of files) {
    it(`${f.name}: identity translation reproduces the original structure`, () => {
      const units = extract(f);
      expect(units.length).toBeGreaterThan(0);
      const all = tr(Object.fromEntries(units.map(u => [u.key, u.source])));
      expect(apply(f, all)).toEqual(f.json);
    });
    it(`${f.name}: every translated row is written to the right place`, () => {
      const units = extract(f);
      const all = tr(Object.fromEntries(units.map(u => [u.key, 'UK:' + u.source])));
      const out = JSON.stringify(apply(f, all));
      for (const u of units) expect(out, u.key).toContain(JSON.stringify('UK:' + u.source).slice(1, -1));
      for (const u of units) expect(out, 'original left: ' + u.key).not.toContain(JSON.stringify(u.source).slice(1, -1).replace(/^/, '"'));
    });
  }
});
