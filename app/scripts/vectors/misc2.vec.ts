import { test } from 'vitest';
import type { GameFile, Unit } from '../../src/core/model';
import type { SavedProject } from '../../src/core/project';
import { DEFAULT_NAME, gameTitleOf, iconLetters, nameFromFolder, nameSourceOf, projectTitle } from '../../src/core/projname';
import { alignReference, referenceSets, withoutReference, withReference } from '../../src/core/reference';
import type { ReferenceBundle, ReferenceSet } from '../../src/core/reference';
import { buildUsage, usageKey } from '../../src/core/usage';
import { rng, writeVectors } from './util';
import type { Rng } from './util';

function genList(r: Rng): unknown[] {
  return Array.from({ length: r.int(6) }, () => r.pick([
    () => ({ code: r.pick([126, 127, 128, 318, 101, 126.5, undefined]), parameters: [r.pick([1, 2, 3, 5, 1.5, 'x', null]), r.pick([0, 1, 0, 0.0]), r.pick([4, 7, 'y'])] }),
    () => ({ code: 126, parameters: [1, 0] }),
    () => ({ code: 318, parameters: [0, 0, r.pick([2, 3])] }),
    () => null, () => ({}), () => ({ code: 126 }), () => 5,
  ])());
}

test('export misc2 vectors', () => {
  const r = rng(8642);
  const out: Record<string, { input: unknown; output: unknown }[]> = {};
  const add = (name: string, input: unknown, output: unknown) => (out[name] ??= []).push({ input, output });

  // usage
  for (let i = 0; i < 200; i++) {
    const game: GameFile[] = [];
    for (const name of r.chance(0.8) ? ['Map001.json', 'Map002.json', 'Map1x.json'] : []) {
      if (r.chance(0.2)) continue;
      const events = r.chance(0.9) ? [null, ...Array.from({ length: r.int(4) }, (_, k) => r.pick([
        () => ({ id: k + 1, name: r.pick(['Chest', '', 'NPC']), pages: Array.from({ length: r.int(3) }, () => ({ list: r.chance(0.9) ? genList(r) : 'bad' })) }),
        () => ({ id: k + 1, pages: [{ list: genList(r) }] }),
        () => ({ id: k + 1, name: 'NoPages' }), () => null, () => ({ name: 'NoId', pages: [{ list: genList(r) }] }),
      ])())] : 'notarray';
      game.push({ name, json: (r.chance(0.9) ? { events } : events) as never });
    }
    if (r.chance(0.6)) game.push({ name: 'CommonEvents.json', json: [null, ...Array.from({ length: r.int(3) }, () => r.pick([() => ({ name: 'Ev', list: genList(r) }), () => ({ list: genList(r) }), () => ({ name: 5, list: genList(r) }), () => ({ name: null, list: genList(r) })])())] as never });
    game.push({ name: r.pick(['Items.json', 'Map001.json.bak', 'map001.json']), json: [] });
    const labels: Record<string, string> = { 'Map001.json': r.pick(['Town', '', 'Ліс']) };
    const u = buildUsage(game, f => labels[f]);
    add('usage', { game, labels }, [...u.entries()]);
  }
  for (const [f, k] of [['Items.json', '[5].name'], ['Items.json', '[12].description'], ['Items.json', 'events[1]'], ['A', '[x].name'], ['A', '[5]name'], ['A', '[007].name']]) add('usageKey', [f, k], usageKey(f!, k!));

  // projname
  const PATHS = ['C:\\Games\\My_Game\\www\\data', '/home/u/Cool_Game/data', 'C:\\', 'C:', 'D:\\www', '', '   ', 'Game', 'x/game/GAME', 'a\\\\b//c', '  spaced  /data', 'My__Game', '/', 'Ґанок/js', 'game/data/www', 'Locales'];
  for (const p of PATHS) add('nameFromFolder', p, nameFromFolder(p));
  const snaps = (): Record<string, Unit[]> | undefined => r.pick([
    () => undefined, () => ({}), () => ({ 'System.json': [{ key: 'gameTitle', source: ' My Game ', speaker: '', kind: 'name', context: '' }] as Unit[] }),
    () => ({ 'data/System.json': [{ key: 'gameTitle', source: 'Deep', speaker: '', kind: 'name', context: '' }] as Unit[] }),
    () => ({ 'System.json': [{ key: 'other', source: 'x', speaker: '', kind: 'name', context: '' }] as Unit[] }),
    () => ({ 'a/System.json': [] as Unit[], 'b/System.json': [{ key: 'gameTitle', source: 'B', speaker: '', kind: 'name', context: '' }] as Unit[] }),
  ])();
  const TITLES = [undefined, '', '  ', 'Моя гра', ' Custom ', 'the Lord of the Rings', 'Гра на два', 'a b', '😀 Smile', 'ß test', '12 34', '---'];
  for (let i = 0; i < 300; i++) {
    const settings: Record<string, unknown> = {
      ...(r.chance(0.7) ? { nameFrom: r.pick(['custom', 'game', 'folder', 'weird', 5]) } : {}), ...(r.chance(0.6) ? { title: r.pick(TITLES) } : {}), ...(r.chance(0.6) ? { folderName: r.pick(TITLES) } : {}), ...(r.chance(0.4) ? { iconText: r.pick([undefined, '', ' ab ', 'xyz', '😀😀😀', 'ß']) } : {}),
    };
    const p = { name: r.pick([DEFAULT_NAME, 'Named', '']), settings, snapshot: snaps() } as unknown as Pick<SavedProject, 'name' | 'settings' | 'snapshot'>;
    add('title', { name: p.name, settings, snapshot: p.snapshot ?? null }, { game: gameTitleOf(p.snapshot as never), source: nameSourceOf(p), title: projectTitle(p), icon: iconLetters(p) });
  }

  // reference
  const set = (lang: string): ReferenceSet => ({ lang, texts: { 'a.json': { k1: lang + '1', k2: 'x' } } });
  for (let i = 0; i < 80; i++) {
    let b: ReferenceBundle | undefined = r.chance(0.2) ? undefined : (r.chance(0.5) ? withReference(undefined, set('en')) : { lang: 'en', texts: {}, extra: [set('pl')] });
    const ops = Array.from({ length: 1 + r.int(4) }, () => ({ op: r.pick(['add', 'remove']), lang: r.pick(['en', 'pl', 'de']) }));
    const states: unknown[] = [];
    const start = b ? JSON.parse(JSON.stringify(b)) : null;
    for (const o of ops) { b = o.op === 'add' ? withReference(b, set(o.lang)) : withoutReference(b, o.lang); states.push({ b: b ?? null, sets: referenceSets(b) }); }
    add('bundle', { start, ops }, states);
  }
  const KINDS = ['dialogue', 'choice', 'name'] as const;
  const SRC = ['Hello', 'Hello world', '\\C[2]Hello', '\\C[2]Hello\\C[0]', 'A much longer sentence that should score lower with short ones', 'Yes', 'No', '\\N[1]: hi', 'x'];
  const unitsOf = (r2: Rng, n: number, shift: number): Unit[] => {
    const out: Unit[] = [];
    for (let k = 0; k < n; k++) {
      const roll = r2.next();
      const kind = r2.pick(KINDS);
      const key = roll < 0.2 ? `[${k + shift}].name` : roll < 0.8 ? `events[${r2.int(2)}].pages[0].list[${(k + shift) * 2}]` + (kind === 'choice' ? `.choice[${r2.int(3)}]` : '') : `Other.json:${r2.int(5)}.list[${k}]`;
      out.push({ key, source: r2.pick(SRC), speaker: '', kind, context: '' });
    }
    return out;
  };
  for (let i = 0; i < 250; i++) {
    const a = unitsOf(r, r.int(10), 0);
    const b = r.chance(0.3) ? JSON.parse(JSON.stringify(a)) as Unit[] : unitsOf(r, r.int(10), r.int(3));
    // make keys unique per side as the real extractor does
    const uniq = (l: Unit[]): Unit[] => { const seen = new Set<string>(); return l.filter(u => !seen.has(u.key) && seen.add(u.key)); };
    const ua = uniq(a), ub = uniq(b);
    add('align', { units: ua, ref: ub }, alignReference(ua, ub));
  }
  writeVectors('misc2', out);
});
