import { extract } from './rpgmaker';
import { merge } from './merge';
import type { Entry, GameFile, Translations, Unit } from './model';

/** On-disk / on-wire shape of a project's translator data. Game files are never stored here. */
export interface SavedProject {
  version: 1;
  name: string;
  sourceLang: string;
  targetLang: string;
  /** Bumped by "reset": entries older than this are dropped on merge so a reset really propagates. */
  resetEpoch: number;
  /** Translations per game file name. */
  files: Record<string, Translations>;
  /** Imported translation memory pairs. */
  memory: { s: string; t: string; mt: number }[];
  /** Project glossary. */
  terms: { en: string; uk: string; mt: number }[];
  settings: ProjectSettings;
  /**
   * Copy of the original strings as of the last time the game folder was read. Lets the app (and a phone
   * that has no game files) open the project and translate without the folder; only building needs it.
   */
  snapshot?: Record<string, Unit[]>;
}

export interface ProjectSettings {
  /** Allowed length deviation from the original, percent. Only a recommendation, never a hard limit. */
  tolerancePct: number;
  /** Refuse to send a unit to review while it has a QA error. */
  blockErrors: boolean;
  /** Name shown in comments and history. */
  who: string;
}

export const DEFAULT_SETTINGS: ProjectSettings = { tolerancePct: 25, blockErrors: true, who: 'Ви' };

export const emptyProject = (name: string, sourceLang = 'en', targetLang = 'uk'): SavedProject => ({
  version: 1, name, sourceLang, targetLang, resetEpoch: 0, files: {}, memory: [], terms: [], settings: { ...DEFAULT_SETTINGS },
});

export interface FileView { name: string; units: Unit[] }

/** Re-read the game: extract units for every file that has any. */
export function readGame(files: GameFile[]): FileView[] {
  return files.map(f => ({ name: f.name, units: extract(f) })).filter(v => v.units.length > 0);
}

export interface FileStats { total: number; translated: number; done: number; approved: number }

export function statsOf(units: Unit[], entries: Translations): FileStats {
  const s: FileStats = { total: units.length, translated: 0, done: 0, approved: 0 };
  for (const u of units) {
    const e = entries[u.key];
    if (!e || !e.target) continue;
    s.translated++;
    if (e.status === 'done') s.done++;
    if (e.status === 'appr') s.approved++;
  }
  return s;
}

/** Views from a stored snapshot, so the project opens without the game folder. */
export function viewsFromSnapshot(p: SavedProject): FileView[] {
  return Object.entries(p.snapshot ?? {}).map(([name, units]) => ({ name, units })).filter(v => v.units.length > 0);
}

export const snapshotOf = (views: FileView[]): Record<string, Unit[]> => Object.fromEntries(views.map(v => [v.name, v.units]));

export function serialize(p: SavedProject): string {
  return JSON.stringify(p);
}

/** Parse and validate; throws a readable error for unusable input instead of loading garbage. */
export function deserialize(text: string): SavedProject {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new Error('Файл проєкту пошкоджено: це не JSON'); }
  if (typeof raw !== 'object' || raw === null) throw new Error('Файл проєкту пошкоджено');
  const o = raw as Partial<SavedProject>;
  if (o.version !== 1) throw new Error(`Непідтримувана версія проєкту: ${String(o.version)}`);
  if (typeof o.name !== 'string' || typeof o.files !== 'object' || o.files === null) throw new Error('Файл проєкту пошкоджено');
  return {
    version: 1, name: o.name, sourceLang: o.sourceLang ?? 'en', targetLang: o.targetLang ?? 'uk',
    resetEpoch: o.resetEpoch ?? 0, files: o.files, memory: o.memory ?? [], terms: o.terms ?? [],
    settings: { ...DEFAULT_SETTINGS, ...(o.settings ?? {}) },
    ...(o.snapshot ? { snapshot: o.snapshot } : {}),
  };
}

/** Merge two copies of the same project (e.g. PC and phone). Entries from before the newest reset are dropped. */
export function mergeProjects(a: SavedProject, b: SavedProject): { project: SavedProject; conflicts: { file: string; key: string }[] } {
  const epoch = Math.max(a.resetEpoch, b.resetEpoch);
  const live = (t: Translations): Translations => Object.fromEntries(Object.entries(t).filter(([, e]) => e.mt > epoch));
  const files: Record<string, Translations> = {};
  const conflicts: { file: string; key: string }[] = [];
  for (const name of new Set([...Object.keys(a.files), ...Object.keys(b.files)])) {
    const r = merge(live(a.files[name] ?? {}), live(b.files[name] ?? {}));
    files[name] = r.merged;
    for (const key of r.conflicts) conflicts.push({ file: name, key });
  }
  const union = <T extends { mt: number }>(x: T[], y: T[], id: (v: T) => string): T[] => {
    const m = new Map<string, T>();
    for (const v of [...x, ...y]) { const k = id(v); const o = m.get(k); if (!o || v.mt > o.mt) m.set(k, v); }
    return [...m.values()].filter(v => v.mt > epoch);
  };
  const newer = a.resetEpoch >= b.resetEpoch ? a : b;
  // Snapshots describe the game, not the translator's work: keep a's, let b fill in files a does not have.
  const snapshot = a.snapshot || b.snapshot ? { ...(b.snapshot ?? {}), ...(a.snapshot ?? {}) } : undefined;
  return {
    project: {
      ...newer, resetEpoch: epoch, files, ...(snapshot ? { snapshot } : {}),
      memory: union(a.memory, b.memory, v => v.s + '\u0001' + v.t),
      terms: union(a.terms, b.terms, v => v.en.toLowerCase()),
    },
    conflicts,
  };
}

export type { Entry };
