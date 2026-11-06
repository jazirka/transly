import { buildSceneIndex } from '../core';
import type { SceneIndex, Unit } from '../core';

const cache = new WeakMap<object, SceneIndex | null>();

/** The scenes of a file, worked out once for as long as the file's rows are the same. */
export function scenesOf(units: Unit[]): SceneIndex | null {
  let s = cache.get(units);
  if (s === undefined) { s = buildSceneIndex(units); cache.set(units, s); }
  return s;
}
