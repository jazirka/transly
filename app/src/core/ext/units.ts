import { safeKey } from '../keys';
import type { Unit, UnitKind } from '../model';

const KINDS: readonly UnitKind[] = ['dialogue', 'choice', 'scroll', 'name', 'description', 'message', 'term'];
const MAX_UNITS = 200_000;
const MAX_TEXT = 100_000;

/**
 * What a plugin returns as rows is untrusted: the rows are kept in the project, shown in the interface and written back into a game. Every row is brought
 * to the shape the application knows (a text key, a text source, a known kind), keys are made safe and unique, and what is not a row is dropped.
 */
export function cleanUnits(raw: unknown): Unit[] {
  if (!Array.isArray(raw)) throw new Error('the plugin did not return a list of rows');
  const out: Unit[] = [], seen = new Set<string>();
  for (const r of raw.slice(0, MAX_UNITS)) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    if (typeof o.key !== 'string' || typeof o.source !== 'string' || !o.key || o.key.length > 400 || o.source.length > MAX_TEXT) continue;
    const key = safeKey(o.key);
    if (seen.has(key)) continue;
    seen.add(key);
    const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');
    out.push({ key, source: o.source, speaker: str(o.speaker, 200), kind: KINDS.includes(o.kind as UnitKind) ? (o.kind as UnitKind) : 'message', context: str(o.context, 400) });
  }
  return out;
}
