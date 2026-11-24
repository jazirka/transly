import { test } from 'vitest';
import type { GameFile } from '../../src/core/model';
import { jumpPlugin, jumpTarget } from '../../src/core/jump';
import { rng, writeVectors } from './util';
import type { Rng } from './util';

function genEvent(r: Rng, id: number): unknown {
  const cond = (): Record<string, unknown> => ({
    switch1Valid: r.chance(0.5), switch1Id: r.pick([1, 2, 7]), switch2Valid: r.chance(0.3), switch2Id: r.pick([3, 4]),
    variableValid: r.chance(0.4), variableId: r.pick([0, 1, 5]), variableValue: r.pick([0, 1, 5, 2.5]),
    selfSwitchValid: r.chance(0.3), selfSwitchCh: r.pick(['A', 'B', '']), itemValid: r.chance(0.3), itemId: r.pick([0, 1, 4]), actorValid: r.chance(0.3), actorId: r.pick([0, 2]),
  });
  return r.pick([
    () => ({ id, name: 'EV', x: r.pick([0, 3, 12, 4.5, 'x', undefined]), y: r.pick([0, 5, 7]), pages: Array.from({ length: r.int(3) }, () => ({ conditions: cond(), trigger: r.int(5), list: [] })) }),
    () => ({ id: r.pick([id, 'bad', undefined]), x: 1, y: 2, pages: [{ conditions: cond(), trigger: 0 }, null, 5] }),
    () => ({ id, x: 1, y: 2, pages: 'none' }),
    () => null, () => 5, () => [],
  ])();
}

test('export jump vectors', () => {
  const r = rng(2468);
  const out: Record<string, { input: unknown; output: unknown }[]> = {};
  const add = (name: string, input: unknown, output: unknown) => (out[name] ??= []).push({ input, output });
  const game: GameFile[] = [
    { name: 'Map001.json', json: { events: [null, genEvent(r, 1), genEvent(r, 2), genEvent(r, 3), genEvent(r, 4)] } },
    { name: 'Map002.json', json: { events: 'x' } },
    { name: 'Map003.json', json: null },
    { name: 'CommonEvents.json', json: [] },
  ];
  for (let g = 0; g < 40; g++) {
    const gm: GameFile[] = [{ name: 'Map001.json', json: { events: [null, ...Array.from({ length: 5 }, (_, i) => genEvent(r, i + 1))] } }, ...game.slice(1)];
    const files = ['Map001.json', 'Map002.json', 'Map003.json', 'Map009.json', 'CommonEvents.json', 'Troops.json', 'Items.json', 'MapInfos.json'];
    const keys = ['events[1].pages[0].list[3]', 'events[2].pages[1].list[0]', 'events[9].pages[0].list[1]', 'events[1].pages[7].list[1]', '[3].list[5]', '[2].pages[1].list[4]', '[5].name', 'events[0].pages[0].list[0]', 'junk'];
    const from = r.pick(['line', 'event'] as const), slot = r.pick([0, 0, 2]);
    const rows = files.flatMap(f => keys.map(k => ({ f, k, t: jumpTarget(f, k, gm, from, slot) })));
    add('targets', { game: gm, from, slot, rows: rows.map(x => [x.f, x.k]) }, rows.map(x => x.t));
    for (const x of rows) if (x.t && r.chance(0.08)) add('plugin', x.t, jumpPlugin(x.t));
  }
  writeVectors('jump', out);
});
