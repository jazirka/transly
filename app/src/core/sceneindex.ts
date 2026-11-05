import type { PageInfo, Unit } from './model';
import { sceneKey } from './scene';

/** One scene of a file: the rows of one event page (a map event page, a common event, a battle page), in game order. */
export interface SceneInfo {
  /** The key of the page's command list, e.g. `events[3].pages[0].list`. */
  id: string;
  /** Where it happens: the event's name as the rows give it, e.g. `EV003 · Старий солдат`. */
  title: string;
  /** Which page of the event this is (from 1), when the event has several pages with text. */
  page: number | null;
  /** How many pages of the event have text. */
  pages: number;
  /** Conditions of the page, from its first row. */
  cond?: PageInfo;
  /** Index in the file's rows of the first row. */
  from: number;
  units: Unit[];
}

export interface SceneIndex {
  scenes: SceneInfo[];
  /** Row key → position in `scenes`. */
  byKey: Map<string, number>;
  /** Rows of the file that belong to no scene (e.g. the name of a map). */
  loose: Unit[];
}

/** Part of an event page's key that names the event, i.e. the key without the page: `events[3]`, `[5]`. */
const eventOf = (id: string): string => id.replace(/\.pages\[\d+\]\.list$/, '').replace(/\.list$/, '');
const pageOf = (id: string): number | null => { const m = /\.pages\[(\d+)\]\.list$/.exec(id); return m ? Number(m[1]) + 1 : null; };

/**
 * The scenes of a file, or null when the file has none (database files, System.json, text formats). A file is never
 * split artificially: only rows that really sit in an event page's command list form a scene.
 */
export function buildSceneIndex(units: Unit[]): SceneIndex | null {
  const scenes: SceneInfo[] = [], byId = new Map<string, number>(), byKey = new Map<string, number>(), loose: Unit[] = [];
  units.forEach((u, i) => {
    const id = sceneKey(u.key);
    if (!id) { loose.push(u); return; }
    let at = byId.get(id);
    if (at === undefined) {
      at = scenes.length;
      byId.set(id, at);
      scenes.push({ id, title: u.context, page: pageOf(id), pages: 1, from: i, units: [], ...(u.page ? { cond: u.page } : {}) });
    }
    const sc = scenes[at]!;
    sc.units.push(u);
    if (u.page && !sc.cond) sc.cond = u.page;
    byKey.set(u.key, at);
  });
  if (!scenes.length) return null;
  const perEvent = new Map<string, number>();
  for (const sc of scenes) perEvent.set(eventOf(sc.id), (perEvent.get(eventOf(sc.id)) ?? 0) + 1);
  for (const sc of scenes) sc.pages = perEvent.get(eventOf(sc.id)) ?? 1;
  return { scenes, byKey, loose };
}

/** The scene a row belongs to. */
export const sceneAt = (idx: SceneIndex | null, key: string): SceneInfo | null => (idx ? idx.scenes[idx.byKey.get(key) ?? -1] ?? null : null);

/** The title with its page when the event has more than one: `EV003 · Старий солдат · сторінка 2`. */
export const sceneTitle = (sc: SceneInfo): string => (sc.pages > 1 && sc.page ? `${sc.title} · сторінка ${sc.page}` : sc.title);

/** The scene before (-1) or after (1) the one the row is in, or null at the ends. */
export function stepScene(idx: SceneIndex | null, key: string, dir: 1 | -1): SceneInfo | null {
  if (!idx) return null;
  const at = idx.byKey.get(key);
  return at === undefined ? null : idx.scenes[at + dir] ?? null;
}
