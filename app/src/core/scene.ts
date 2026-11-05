import type { Unit } from './model';

/**
 * A scene is one event page: the commands of a map event, a common event or a battle page. Its rows share the key up
 * to `.list`, e.g. `events[3].pages[0].list[12]` and `events[3].pages[0].list[14].choice[1]`.
 */
const LIST_KEY = /^(.*\.list)\[(\d+)\](?:\.(choice\[(\d+)\]|cmd))?$/;

/** The scene a row key belongs to (the key up to `.list`), or null for rows that are not part of an event page. */
export const sceneKey = (key: string): string | null => LIST_KEY.exec(key)?.[1] ?? null;

/** The rows of the scene `key` belongs to, in game order. Formats without scenes get the rows around it. */
export function sceneUnits(units: Unit[], key: string, around = 12): Unit[] {
  const m = LIST_KEY.exec(key);
  if (m) {
    const prefix = m[1] + '[';
    return units.filter(u => u.key.startsWith(prefix));
  }
  const i = units.findIndex(u => u.key === key);
  return i < 0 ? [] : units.slice(Math.max(0, i - around), i + around + 1);
}

/** One step of a scene as the player sees it. */
export type SceneLine =
  | { kind: 'say' | 'scroll' | 'plugin'; unit: Unit }
  /** A choice: its options, one row each. */
  | { kind: 'choice'; units: Unit[] };

/** Group a scene's rows into what happens on screen: choice options sit together under their question. */
export function sceneLines(units: Unit[]): SceneLine[] {
  const out: SceneLine[] = [];
  let at = '';
  for (const u of units) {
    const m = LIST_KEY.exec(u.key);
    if (u.kind === 'choice' && m && m[3]?.startsWith('choice')) {
      const last = out[out.length - 1];
      if (last?.kind === 'choice' && at === m[1] + '[' + m[2] + ']') last.units.push(u);
      else { out.push({ kind: 'choice', units: [u] }); at = m[1] + '[' + m[2] + ']'; }
    } else out.push({ kind: u.kind === 'scroll' ? 'scroll' : m?.[3] === 'cmd' ? 'plugin' : 'say', unit: u });
  }
  return out;
}

/** Where a row sits in the game's data: enough to start the game at it. */
export type SceneAddress =
  | { kind: 'map'; mapId: number; eventIndex: number; page: number; index: number }
  | { kind: 'common'; common: number; index: number }
  | { kind: 'troop'; troop: number; page: number; index: number };

export function sceneAddress(file: string, key: string): SceneAddress | null {
  const map = /^Map(\d+)\.json$/.exec(file);
  if (map) {
    const m = /^events\[(\d+)\]\.pages\[(\d+)\]\.list\[(\d+)\]/.exec(key);
    return m ? { kind: 'map', mapId: Number(map[1]), eventIndex: Number(m[1]), page: Number(m[2]), index: Number(m[3]) } : null;
  }
  if (file === 'CommonEvents.json') {
    const m = /^\[(\d+)\]\.list\[(\d+)\]/.exec(key);
    return m ? { kind: 'common', common: Number(m[1]), index: Number(m[2]) } : null;
  }
  if (file === 'Troops.json') {
    const m = /^\[(\d+)\]\.pages\[(\d+)\]\.list\[(\d+)\]/.exec(key);
    return m ? { kind: 'troop', troop: Number(m[1]), page: Number(m[2]), index: Number(m[3]) } : null;
  }
  return null;
}
