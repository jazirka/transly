import type { SysNames } from './sysnames';
import type { GlossaryTerm } from './glossary';
import type { ReferenceBundle } from './reference';
import type { Group, Member } from './groups';
import { mergeGroupData } from './groups';
import { extract } from './engine';
import type { ExtractOptions } from './rpgmaker';
import { merge } from './merge';
import type { Entry, GameFile, Translations, Unit } from './model';
import type { WrapSettings } from './wrapconfig';

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
  terms: GlossaryTerm[];
  settings: ProjectSettings;
  /** When the settings were last changed on purpose; the newer side's settings win a merge, so a fresh device's defaults never replace chosen ones. */
  settingsAt?: number;
  /**
   * Copy of the original strings as of the last time the game folder was read. Lets the app (and a phone
   * that has no game files) open the project and translate without the folder; only building needs it.
   */
  snapshot?: Record<string, Unit[]>;
  /** Same game in another language, aligned to the working language: shown to the translator as a hint. */
  reference?: ReferenceBundle;
  /** Where a file takes place (map names), for context in the tree, tabs and breadcrumbs. */
  labels?: Record<string, string>;
  /** Switch and variable names, currency (from System.json): they explain codes and event conditions. */
  sysNames?: SysNames;
  /** Who speaks, as set by the translator: keys `face:Actor1#3` and `event:ghoul111`. */
  speakers?: Record<string, { name: string; mt: number }>;
  /** Time the snapshot/reference last changed. The device with the larger value owns the newer copy. */
  assetsRev?: number;
  /**
   * Version of the data layout the writing app understands. Files written before it existed have none (read as 1).
   * 2: unknown top-level fields are carried along untouched, rows merge field by field, deleted terms leave a trace.
   */
  schema?: number;
  /** Terms that were deleted: key = lower-case original word, value = when. A term not edited since is dropped by a merge, so it does not come back. */
  deletedTerms?: Record<string, number>;
  /** The translator's groups of rows (see `groups.ts`). */
  groups?: Record<string, Group>;
  /** What each file, scene or row is put into (see `groups.ts`). */
  members?: Record<string, Member>;
}

/** The layout this build writes (see `SavedProject.schema`). */
export const SCHEMA = 2;

/** Top-level fields this build knows. Everything else in a project file belongs to a newer version and is passed through unchanged. */
const KNOWN = new Set(['version', 'name', 'sourceLang', 'targetLang', 'resetEpoch', 'files', 'memory', 'terms', 'settings', 'settingsAt', 'snapshot', 'reference', 'labels', 'sysNames', 'speakers', 'assetsRev', 'schema', 'deletedTerms', 'groups', 'members']);
const extrasOf = (p: object): Record<string, unknown> => Object.fromEntries(Object.entries(p).filter(([k]) => !KNOWN.has(k)));

export interface ProjectSettings {
  /** Allowed length deviation from the original, percent. Only a recommendation, never a hard limit. */
  tolerancePct: number;
  /** Refuse to send a unit to review while it has a QA error. */
  blockErrors: boolean;
  /** Name shown in comments and history. */
  who: string;
  /** Copy a sent/approved translation to identical strings that have none (or wait with the same text). */
  propagate: boolean;
  /** Plugin commands whose arguments are player-visible text (e.g. `GabText`). */
  pluginCommands: string[];
  /** The plugin-text question has been shown for this project. */
  pluginsAsked: boolean;
  /** Longest line of a translated message, in characters; 0 = follow the longest line of the original. */
  lineLimit: number;
  /** Line wrapping (the tool «Перенесення рядків»); missing in older projects, read it with `wrapOf`. */
  wrap?: Partial<WrapSettings>;
}

export const DEFAULT_SETTINGS: ProjectSettings = { tolerancePct: 25, blockErrors: true, who: 'Ви', propagate: true, pluginCommands: [], pluginsAsked: false, lineLimit: 0 };

export const emptyProject = (name: string, sourceLang = 'en', targetLang = 'uk'): SavedProject => ({
  version: 1, schema: SCHEMA, name, sourceLang, targetLang, resetEpoch: 0, files: {}, memory: [], terms: [], settings: { ...DEFAULT_SETTINGS },
});

export interface FileView { name: string; units: Unit[]; /** Place the file takes place in (map name). */ label?: string }

/** Map names from MapInfos.json; the map's own `displayName` wins when it is set. */
function mapLabels(files: GameFile[]): Map<string, string> {
  const out = new Map<string, string>();
  const infos = files.find(f => f.name.split('/').pop() === 'MapInfos.json')?.json;
  const names = new Map<number, string>();
  if (Array.isArray(infos)) for (const i of infos) if (i && typeof i === 'object' && typeof (i as { id?: unknown }).id === 'number') names.set((i as { id: number }).id, String((i as { name?: unknown }).name ?? ''));
  for (const f of files) {
    const m = /^Map(\d+)\.json$/.exec(f.name.split('/').pop() ?? '');
    if (!m) continue;
    const display = (f.json as { displayName?: unknown } | null)?.displayName;
    const label = (typeof display === 'string' && display.trim()) || names.get(Number(m[1])) || '';
    if (label) out.set(f.name, label);
  }
  return out;
}

/** Re-read the game: extract units for every file that has any. */
export function readGame(files: GameFile[], opts: ExtractOptions = {}): FileView[] {
  const labels = mapLabels(files);
  return files.map(f => ({ name: f.name, units: extract(f, opts), ...(labels.get(f.name) ? { label: labels.get(f.name)! } : {}) })).filter(v => v.units.length > 0);
}

export const labelsOf = (views: FileView[]): Record<string, string> => Object.fromEntries(views.filter(v => v.label).map(v => [v.name, v.label!]));

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
  return Object.entries(p.snapshot ?? {}).map(([name, units]) => ({ name, units, ...(p.labels?.[name] ? { label: p.labels[name]! } : {}) })).filter(v => v.units.length > 0);
}

export const snapshotOf = (views: FileView[]): Record<string, Unit[]> => Object.fromEntries(views.map(v => [v.name, v.units]));

export function serialize(p: SavedProject): string {
  return JSON.stringify(p);
}

/**
 * Is this text a project file (as opposed to a game's JSON)? Lets a phone take both kinds from one picker.
 * The start is enough for files saved by this app; the rest is a fallback that does not depend on key order.
 */
export function looksLikeProject(text: string): boolean {
  if (!/^\s*\{/.test(text.slice(0, 64))) return false;
  const head = text.slice(0, 4000);
  if (/"version"\s*:\s*1\b/.test(head) && /"sourceLang"\s*:/.test(head)) return true;
  return text.includes('"sourceLang"') && text.includes('"targetLang"') && text.includes('"resetEpoch"') && text.includes('"files"');
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
    ...extrasOf(o),
    version: 1, name: o.name, sourceLang: o.sourceLang ?? 'en', targetLang: o.targetLang ?? 'uk',
    resetEpoch: o.resetEpoch ?? 0, files: o.files, memory: o.memory ?? [], terms: o.terms ?? [],
    settings: { ...DEFAULT_SETTINGS, ...(o.settings ?? {}) },
    ...(o.snapshot ? { snapshot: o.snapshot } : {}),
    ...(o.reference ? { reference: o.reference } : {}),
    ...(o.assetsRev ? { assetsRev: o.assetsRev } : {}),
    ...(o.speakers ? { speakers: o.speakers } : {}),
    ...(o.labels ? { labels: o.labels } : {}),
    ...(o.sysNames ? { sysNames: o.sysNames } : {}),
    ...(o.settingsAt ? { settingsAt: o.settingsAt } : {}),
    ...(o.schema ? { schema: o.schema } : {}),
    ...(o.deletedTerms ? { deletedTerms: o.deletedTerms } : {}),
    ...(o.groups ? { groups: o.groups } : {}),
    ...(o.members ? { members: o.members } : {}),
  };
}

/** What a row keeps after a reset at `epoch`: nothing when it is older, and only the newer comments and history when it is not. */
function liveEntry(e: Entry, epoch: number): Entry | null {
  if (epoch <= 0) return e;
  const newComments = e.comments?.some(c => c.at > epoch);
  if (e.mt <= epoch && !newComments) return null;
  const comments = e.comments?.filter(c => c.at > epoch), history = e.history?.filter(h => h.at > epoch);
  const out: Entry = { ...e };
  if (comments && comments.length !== e.comments!.length) { if (comments.length) out.comments = comments; else delete out.comments; }
  if (history && history.length !== e.history!.length) { if (history.length) out.history = history; else delete out.history; }
  return out;
}

const isMtRecord = (v: unknown): v is Record<string, { mt: number }> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && Object.values(v).every(e => typeof e === 'object' && e !== null && typeof (e as { mt?: unknown }).mt === 'number');

/**
 * A top-level field this build does not know (written by a newer one). Records of items with an `mt` merge item by item,
 * newest wins, and items older than the last reset are dropped; anything else keeps the local value, so it is never lost.
 */
function mergeUnknown(x: unknown, y: unknown, epoch: number): unknown {
  if (x === undefined) return y;
  if (y === undefined) return x;
  if (isMtRecord(x) && isMtRecord(y)) {
    const out: Record<string, { mt: number }> = {};
    for (const src of [x, y]) for (const [k, v] of Object.entries(src)) if (v.mt > epoch && (!out[k] || v.mt > out[k]!.mt)) out[k] = v;
    return out;
  }
  return x;
}

export interface ProjectMerge {
  project: SavedProject;
  conflicts: { file: string; key: string }[];
  /** The second project was written by an older build (without `schema`): data only a newer build keeps may be missing from it. */
  olderPeer: boolean;
}

/** Merge two copies of the same project (e.g. PC and phone). Entries from before the newest reset are dropped. */
export function mergeProjects(a: SavedProject, b: SavedProject, since = 0): ProjectMerge {
  const epoch = Math.max(a.resetEpoch, b.resetEpoch);
  const live = (t: Translations): Translations => {
    if (epoch <= 0) return t;
    const out: Translations = {};
    for (const [k, e] of Object.entries(t)) { const l = liveEntry(e, epoch); if (l) out[k] = l; }
    return out;
  };
  const files: Record<string, Translations> = {};
  const conflicts: { file: string; key: string }[] = [];
  for (const name of new Set([...Object.keys(a.files), ...Object.keys(b.files)])) {
    const r = merge(live(a.files[name] ?? {}), live(b.files[name] ?? {}), since);
    files[name] = r.merged;
    for (const key of r.conflicts) conflicts.push({ file: name, key });
  }
  const union = <T extends { mt: number }>(x: T[], y: T[], id: (v: T) => string): T[] => {
    const m = new Map<string, T>();
    for (const v of [...x, ...y]) { const k = id(v); const o = m.get(k); if (!o || v.mt > o.mt) m.set(k, v); }
    return [...m.values()].filter(v => v.mt > epoch);
  };
  const newer = a.resetEpoch >= b.resetEpoch ? a : b;
  const settingsFrom = (b.settingsAt ?? 0) > (a.settingsAt ?? 0) ? b : a;
  const settingsAt = Math.max(a.settingsAt ?? 0, b.settingsAt ?? 0);
  // Snapshot and reference describe the game, not the translator's work: the side with the newer revision wins,
  // and when only one side carries them (a lite copy from sync) they are kept.
  const owner = (b.assetsRev ?? 0) > (a.assetsRev ?? 0) && (b.snapshot || b.reference) ? b : a;
  const snapshot = owner.snapshot ?? a.snapshot ?? b.snapshot;
  const reference = owner.reference ?? a.reference ?? b.reference;
  const assetsRev = Math.max(a.assetsRev ?? 0, b.assetsRev ?? 0);
  const speakers: Record<string, { name: string; mt: number }> = {};
  for (const src of [a.speakers ?? {}, b.speakers ?? {}]) for (const [k, v] of Object.entries(src)) if (v.mt > epoch && (!speakers[k] || v.mt > speakers[k]!.mt)) speakers[k] = v;
  const deleted: Record<string, number> = {};
  for (const src of [a.deletedTerms ?? {}, b.deletedTerms ?? {}]) for (const [k, t] of Object.entries(src)) if (t > epoch && t > (deleted[k] ?? 0)) deleted[k] = t;
  const terms = union(a.terms, b.terms, v => v.en.toLowerCase()).filter(t => (deleted[t.en.toLowerCase()] ?? 0) < t.mt);
  const extra: Record<string, unknown> = {};
  const xa = extrasOf(a), xb = extrasOf(b);
  for (const k of new Set([...Object.keys(xa), ...Object.keys(xb)])) { const v = mergeUnknown(xa[k], xb[k], epoch); if (v !== undefined) extra[k] = v; }
  const grp = mergeGroupData(a, b, epoch);
  const project: SavedProject = {
      ...newer, ...extra, schema: Math.max(a.schema ?? 1, b.schema ?? 1, SCHEMA),
      settings: { ...settingsFrom.settings, pluginsAsked: a.settings.pluginsAsked || b.settings.pluginsAsked }, ...(settingsAt ? { settingsAt } : {}), resetEpoch: epoch, files, ...(snapshot ? { snapshot } : {}), ...(reference ? { reference } : {}), ...(assetsRev ? { assetsRev } : {}),
      ...(Object.keys(speakers).length ? { speakers } : {}),
      ...(a.sysNames || b.sysNames ? { sysNames: a.sysNames ?? b.sysNames } : {}),
      ...(a.labels || b.labels ? { labels: { ...(b.labels ?? {}), ...(a.labels ?? {}) } } : {}),
      memory: union(a.memory, b.memory, v => v.s + '\u0001' + v.t),
      terms,
      ...(Object.keys(deleted).length ? { deletedTerms: deleted } : {}),
      ...grp,
  };
  if (!Object.keys(deleted).length) delete project.deletedTerms;
  if (!grp.groups) delete project.groups;
  if (!grp.members) delete project.members;
  return { project, conflicts, olderPeer: (b.schema ?? 1) < SCHEMA };
}

export type { Entry };
