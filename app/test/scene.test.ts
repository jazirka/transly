import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { extract, jumpPlugin, jumpTarget, sceneAddress, sceneLines, sceneUnits } from '../src/core';
import type { GameFile, JumpTarget, Unit } from '../src/core';

const cmd = (code: number, parameters: unknown[], indent = 0) => ({ code, indent, parameters });
const mapJson = {
  displayName: '', events: [null,
    { id: 1, name: 'door', x: 4, y: 7, pages: [{ list: [cmd(101, ['', 0, 0, 2, '']), cmd(401, ['It is locked.']), cmd(0, [])] }] },
    { id: 2, name: 'cook', x: 9, y: 3, pages: [
      { list: [cmd(101, ['Cook', 0, 0, 2, '']), cmd(401, ['Hungry?']), cmd(102, [['Yes', 'No'], 1]), cmd(402, [0, 'Yes']), cmd(101, ['Cook', 0, 0, 2, '']), cmd(401, ['Here you go.']), cmd(0, [], 1), cmd(402, [1, 'No']), cmd(0, [], 1), cmd(404, []), cmd(0, [])] },
      { list: [cmd(101, ['Cook', 0, 0, 2, '']), cmd(401, ['Come back soon.']), cmd(0, [])] }] },
  ],
};
const game: GameFile[] = [{ name: 'Map007.json', json: mapJson }, { name: 'CommonEvents.json', json: [null, { name: 'x', list: [cmd(101, ['', 0, 0, 2, '']), cmd(401, ['A common line.']), cmd(0, [])] }] }];
const units: Unit[] = extract(game[0]!);

describe('scenes', () => {
  it('a scene is one event page, in game order', () => {
    const cook = units.find(u => u.source === 'Hungry?')!;
    expect(sceneUnits(units, cook.key).map(u => u.source)).toEqual(['Hungry?', 'Yes', 'No', 'Here you go.']);
    expect(sceneUnits(units, units.find(u => u.source === 'Come back soon.')!.key).map(u => u.source)).toEqual(['Come back soon.']);
    expect(sceneUnits(units, units.find(u => u.source === 'It is locked.')!.key)).toHaveLength(1);
  });

  it('groups the options of a choice under it', () => {
    const lines = sceneLines(sceneUnits(units, units.find(u => u.source === 'Hungry?')!.key));
    expect(lines.map(l => l.kind)).toEqual(['say', 'choice', 'say']);
    const choice = lines[1]!;
    expect(choice.kind === 'choice' && choice.units.map(u => u.source)).toEqual(['Yes', 'No']);
  });

  it('formats without scenes get the rows around the one asked for', () => {
    const rows: Unit[] = Array.from({ length: 40 }, (_, i) => ({ key: `k${i}`, source: `line ${i}`, speaker: '', kind: 'dialogue', context: 'c' }));
    expect(sceneUnits(rows, 'k20', 3).map(u => u.key)).toEqual(['k17', 'k18', 'k19', 'k20', 'k21', 'k22', 'k23']);
    expect(sceneUnits(rows, 'missing')).toEqual([]);
  });

  it('reads the address of a row from its file and key', () => {
    expect(sceneAddress('Map007.json', 'events[2].pages[1].list[5]')).toEqual({ kind: 'map', mapId: 7, eventIndex: 2, page: 1, index: 5 });
    expect(sceneAddress('Map007.json', 'events[2].pages[0].list[3].choice[1]')).toEqual({ kind: 'map', mapId: 7, eventIndex: 2, page: 0, index: 3 });
    expect(sceneAddress('CommonEvents.json', '[12].list[4]')).toEqual({ kind: 'common', common: 12, index: 4 });
    expect(sceneAddress('Troops.json', '[3].pages[0].list[2]')).toMatchObject({ kind: 'troop', troop: 3 });
    expect(sceneAddress('Items.json', '[1].name')).toBeNull();
    expect(sceneAddress('Map007.json', 'displayName')).toBeNull();
  });
});

describe('jump target', () => {
  it('finds the event, its tile and where to start', () => {
    const key = units.find(u => u.source === 'Here you go.')!.key;
    expect(jumpTarget('Map007.json', key, game, 'line')).toEqual({ kind: 'map', mapId: 7, x: 9, y: 3, eventIndex: 2, eventId: 2, page: 0, common: 0, troop: 0, index: 4, slot: 0, setup: { switches: [] } });
    expect(jumpTarget('Map007.json', key, game, 'event', 2)).toMatchObject({ index: 0, slot: 2 });
    expect(jumpTarget('CommonEvents.json', '[1].list[1]', game, 'line')).toMatchObject({ kind: 'common', common: 1, index: 1 });
  });
  it('starts a battle for troop rows and has nothing for database rows and unknown events', () => {
    expect(jumpTarget('Troops.json', '[1].pages[0].list[1]', game, 'line')).toMatchObject({ kind: 'troop', troop: 1, page: 0, index: 1 });
    expect(jumpTarget('Items.json', '[1].name', game, 'line')).toBeNull();
    expect(jumpTarget('Map007.json', 'events[9].pages[0].list[1]', game, 'line')).toBeNull();
  });
});

/** The plugin runs against stand-ins for the engine's objects: what it calls, in what order, with which numbers. */
function runPlugin(target: JumpTarget, opts: { loadGame?: (slot: number) => unknown; mapId?: number; emptyParty?: boolean } = {}) {
  const calls: unknown[][] = [];
  const interpreter = { _index: -1, setup: (list: unknown, id: number) => calls.push(['setup', (list as unknown[]).length, id]) };
  const sandbox: Record<string, unknown> = {
    console: { error: (m: string) => calls.push(['error', m]) },
    DataManager: { setupNewGame: () => calls.push(['newGame']), loadGame: (s: number) => { calls.push(['load', s]); return opts.loadGame ? opts.loadGame(s) : true; } },
    SceneManager: { goto: (c: { name: string }) => calls.push(['goto', c.name]), push: (c: { name: string }) => calls.push(['push', c.name]) },
    BattleManager: { setup: (...a: unknown[]) => calls.push(['battle', ...a]), onEncounter: () => calls.push(['encounter']) },
    Scene_Battle: class { start() { calls.push(['battleStart']); } },
    $gameTroop: { _interpreter: interpreter },
    $dataTroops: [null, { pages: [{ list: [1, 2, 3, 4] }] }],
    $dataSystem: { startMapId: 1, startX: 5, startY: 6 },
    Scene_Boot: class { start() { calls.push(['boot']); } },
    Scene_Map: class { start() { calls.push(['mapStart']); } },
    $gamePlayer: { reserveTransfer: (...a: unknown[]) => calls.push(['transfer', ...a]) },
    $gameMap: { mapId: () => opts.mapId ?? target.mapId, _interpreter: interpreter },
    $dataMap: mapJson,
    $dataCommonEvents: [null, { list: [1, 2, 3] }],
    $gameSwitches: { setValue: (id: number, v: boolean) => calls.push(['switch', id, v]) },
    $gameVariables: { value: () => 0, setValue: (id: number, v: number) => calls.push(['variable', id, v]) },
    $gameSelfSwitches: { setValue: (k: unknown[], v: boolean) => calls.push(['self', ...k, v]) },
    $gameParty: { members: () => (opts.emptyParty ? [] : [1]), hasItem: () => false, gainItem: (i: { id: number }, n: number) => calls.push(['item', i.id, n]), addActor: (id: number) => calls.push(['actor', id]) },
    $dataItems: [null, { id: 1 }],
    $dataActors: [null, { id: 1 }],
  };
  vm.runInNewContext(jumpPlugin(target), sandbox);
  const boot = new (sandbox.Scene_Boot as new () => { start(): void })();
  boot.start();
  const map = new (sandbox.Scene_Map as new () => { start(): void })();
  const fight = new (sandbox.Scene_Battle as new () => { start(): void })();
  return { calls, interpreter, startMap: () => map.start(), startBattle: () => fight.start() };
}

describe('the test plugin', () => {
  const key = units.find(u => u.source === 'Here you go.')!.key;
  const target = jumpTarget('Map007.json', key, game, 'line')!;

  it('skips the title, moves the player to the event and runs the page from the chosen command', () => {
    const r = runPlugin(target);
    expect(r.calls.slice(0, 4)).toEqual([['boot'], ['newGame'], ['transfer', 7, 9, 3, 2, 2], ['goto', 'Scene_Map']]);
    r.startMap();
    expect(r.calls).toContainEqual(['setup', 11, 2]);
    expect(r.interpreter._index).toBe(4);
  });

  it('switches on what the event page needs and makes sure the party is not empty', () => {
    const need = { ...target, setup: { switches: [1, 4], variable: { id: 3, min: 10 }, selfSwitch: 'B', item: 1, actor: 1 } };
    const r = runPlugin(need, { emptyParty: true });
    expect(r.calls.filter(c => c[0] !== 'boot' && c[0] !== 'newGame' && c[0] !== 'goto' && c[0] !== 'transfer')).toEqual([['switch', 1, true], ['switch', 4, true], ['variable', 3, 10], ['self', 7, 2, 'B', true], ['item', 1, 1], ['actor', 1], ['actor', 1]]);
    const idx = (n: string) => r.calls.findIndex(c => c[0] === n);
    expect(idx('switch')).toBeLessThan(idx('transfer'));
    expect(runPlugin(target).calls.some(c => c[0] === 'actor')).toBe(false);
  });

  it('runs only once, and only on the right map', () => {
    const wrong = runPlugin(target, { mapId: 3 });
    wrong.startMap();
    expect(wrong.calls.some(c => c[0] === 'setup')).toBe(false);
    const r = runPlugin(target);
    r.startMap(); r.startMap();
    expect(r.calls.filter(c => c[0] === 'setup')).toHaveLength(1);
  });

  it('starts a common event on whatever map the game starts on', () => {
    const r = runPlugin(jumpTarget('CommonEvents.json', '[1].list[1]', game, 'line')!, { mapId: 1 });
    expect(r.calls.some(c => c[0] === 'transfer')).toBe(false);
    r.startMap();
    expect(r.calls).toContainEqual(['setup', 3, 0]);
    expect(r.interpreter._index).toBe(1);
  });

  it('starts a battle and runs the chosen page of its troop once the fight opens', () => {
    const r = runPlugin(jumpTarget('Troops.json', '[1].pages[0].list[2]', game, 'line')!);
    expect(r.calls.slice(0, 4)).toEqual([['boot'], ['newGame'], ['transfer', 1, 5, 6, 2, 2], ['goto', 'Scene_Map']]);
    r.startMap();
    expect(r.calls).toContainEqual(['battle', 1, false, true]);
    expect(r.calls).toContainEqual(['push', 'Scene_Battle']);
    r.startBattle(); r.startBattle();
    expect(r.calls.filter(c => c[0] === 'setup')).toEqual([['setup', 4, 0]]);
    expect(r.interpreter._index).toBe(2);
  });

  it('loads a save (MV answers at once, MZ with a promise) and falls back to a new game when that fails', async () => {
    const t = { ...target, slot: 2 };
    expect(runPlugin(t).calls.slice(0, 3)).toEqual([['boot'], ['load', 2], ['transfer', 7, 9, 3, 2, 2]]);
    const mz = runPlugin(t, { loadGame: () => Promise.resolve(0) });
    await Promise.resolve();
    expect(mz.calls.map(c => c[0])).toContain('transfer');
    const failed = runPlugin(t, { loadGame: () => false });
    expect(failed.calls.map(c => c[0])).toEqual(['boot', 'load', 'error', 'newGame', 'transfer', 'goto']);
    const rejected = runPlugin(t, { loadGame: () => Promise.reject(new Error('no file')) });
    await new Promise(r => setTimeout(r, 0));
    expect(rejected.calls.map(c => c[0])).toContain('newGame');
  });

  it('says so instead of crashing when the scene is gone', () => {
    const r = runPlugin({ ...target, eventIndex: 9 });
    r.startMap();
    expect(r.calls.some(c => c[0] === 'error' && String(c[1]).includes('сцену не знайдено'))).toBe(true);
  });

  it('uses only syntax old NW.js understands', () => {
    const src = jumpPlugin(target);
    expect(src).not.toMatch(/\?\.|\?\?|=>|\blet\b|\bconst\b/);
  });
});
