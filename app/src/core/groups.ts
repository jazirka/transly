import type { Translations, Unit } from './model';
import type { FileView } from './project';
import { sceneKey } from './scene';
import { buildSceneIndex } from './sceneindex';
import { speakerOf } from './speakers';
import type { SpeakerMap } from './speakers';

/**
 * Groups: the translator's own collections of rows ("the shop", "the prologue", "Marco's lines"). A group has a name
 * and a colour; what is in it is told by members, each of which puts one file, one scene or one row into one group.
 * A row belongs to the group of the nearest member that covers it: its own, else its scene's, else its file's.
 * A row is in one group at most. Groups are one level deep and are never created by the game's files, so they
 * survive a new version of the game (a member whose place is gone is shown as an orphan, not dropped).
 */
export interface Group {
  id: string;
  name: string;
  /** One of GROUP_COLORS (or any CSS colour). */
  color?: string;
  /** When it was made (keeps the list in the order the translator made it in). */
  at: number;
  /** Last change of the name or colour; the newer side wins a merge. */
  mt: number;
  /** Deleted: stays as a trace so a merge with a device that still has the group does not bring it back. */
  del?: boolean;
}

export interface Member {
  /** The group, or '' for "in no group" (a row taken out of the group its scene or file is in). */
  g: string;
  mt: number;
  /** Short hash of the original text at the time it was put in (rows only): a different one means the game changed that row. */
  h?: string;
  /** The member was taken back: the row follows its scene or file again. */
  del?: boolean;
}

export interface GroupData { groups?: Record<string, Group>; members?: Record<string, Member> }

export const GROUP_COLORS = ['#8b72e8', '#4aa3df', '#4cc38a', '#e0a046', '#f06a78', '#c678dd', '#56b6c2', '#9aa0a6'];

const S = '\u0001';
export const fileRef = (file: string): string => `f${S}${file}`;
export const sceneRef = (file: string, scene: string): string => `s${S}${file}${S}${scene}`;
export const rowRef = (file: string, key: string): string => `r${S}${file}${S}${key}`;

export interface ParsedRef { kind: 'file' | 'scene' | 'row'; file: string; key?: string }
export function parseRef(ref: string): ParsedRef | null {
  const p = ref.split(S);
  if (p[0] === 'f' && p.length === 2) return { kind: 'file', file: p[1]! };
  if ((p[0] === 's' || p[0] === 'r') && p.length === 3) return { kind: p[0] === 's' ? 'scene' : 'row', file: p[1]!, key: p[2]! };
  return null;
}

/** A short, stable hash of a text (32-bit FNV-1a in base 36): enough to notice that a row's original changed. */
export function hashText(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}

export interface RowRef { file: string; key: string }

/** The groups that exist, in the order they were made. */
export const liveGroups = (p: GroupData): Group[] => Object.values(p.groups ?? {}).filter(g => !g.del).sort((a, b) => a.at - b.at || a.name.localeCompare(b.name, 'uk'));

const sameName = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Make a group (or return the one that already has this name). Returns null for an empty name. */
export function createGroup(p: GroupData, name: string, now: number, color?: string): Group | null {
  const n = name.trim().replace(/\s+/g, ' ');
  if (!n) return null;
  const had = liveGroups(p).find(g => sameName(g.name, n));
  if (had) return had;
  const used = new Set(liveGroups(p).map(g => g.color));
  const id = `g${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const g: Group = { id, name: n, color: color ?? GROUP_COLORS.find(c => !used.has(c)) ?? GROUP_COLORS[liveGroups(p).length % GROUP_COLORS.length]!, at: now, mt: now };
  (p.groups ??= {})[id] = g;
  return g;
}

export function renameGroup(p: GroupData, id: string, name: string, now: number): 'ok' | 'empty' | 'exists' | 'missing' {
  const g = p.groups?.[id];
  if (!g || g.del) return 'missing';
  const n = name.trim().replace(/\s+/g, ' ');
  if (!n) return 'empty';
  if (liveGroups(p).some(x => x.id !== id && sameName(x.name, n))) return 'exists';
  p.groups![id] = { ...g, name: n, mt: now };
  return 'ok';
}

export function recolorGroup(p: GroupData, id: string, color: string, now: number): boolean {
  const g = p.groups?.[id];
  if (!g || g.del) return false;
  p.groups![id] = { ...g, color, mt: now };
  return true;
}

/** Delete a group. Its rows stay where they are (they just belong to no group); its members are dropped. */
export function deleteGroup(p: GroupData, id: string, now: number): boolean {
  const g = p.groups?.[id];
  if (!g || g.del) return false;
  p.groups![id] = { ...g, del: true, mt: now };
  if (p.members) for (const [ref, m] of Object.entries(p.members)) if (m.g === id && !m.del) p.members[ref] = { ...m, del: true, mt: now };
  return true;
}

/** Who covers which rows: built once from the members, then asked for any row. */
export class GroupIndex {
  private rows = new Map<string, string>();
  private scenes = new Map<string, string>();
  private files = new Map<string, string>();
  readonly empty: boolean;
  constructor(p: GroupData) {
    const live = new Set(liveGroups(p).map(g => g.id));
    let any = false;
    for (const [ref, m] of Object.entries(p.members ?? {})) {
      // A member of a deleted group, or one that was taken back, says nothing: the row follows what is outside it.
      if (m.del || (m.g !== '' && !live.has(m.g))) continue;
      const r = parseRef(ref);
      if (!r) continue;
      any = true;
      if (r.kind === 'row') this.rows.set(r.file + S + r.key!, m.g);
      else if (r.kind === 'scene') this.scenes.set(r.file + S + r.key!, m.g);
      else this.files.set(r.file, m.g);
    }
    this.empty = !any;
  }
  /** The group the row is in (nearest member wins), or null. `skipRow` ignores the row's own member (what it would follow without it). */
  groupOf(file: string, key: string, skipRow = false): string | null {
    if (this.empty) return null;
    const own = skipRow ? undefined : this.rows.get(file + S + key);
    if (own !== undefined) return own || null;
    const sc = sceneKey(key);
    const s = sc ? this.scenes.get(file + S + sc) : undefined;
    if (s !== undefined) return s || null;
    return this.files.get(file) || null;
  }
}

/** Every group's rows, in the order of the files and rows. */
export function groupRows(p: GroupData, views: FileView[]): Map<string, RowRef[]> {
  const idx = new GroupIndex(p), out = new Map<string, RowRef[]>();
  if (idx.empty) return out;
  for (const v of views) for (const u of v.units) {
    const g = idx.groupOf(v.name, u.key);
    if (!g) continue;
    let list = out.get(g);
    if (!list) out.set(g, list = []);
    list.push({ file: v.name, key: u.key });
  }
  return out;
}

export const rowsOfGroup = (p: GroupData, views: FileView[], id: string): RowRef[] => groupRows(p, views).get(id) ?? [];

/**
 * Put rows into a group (or, with `id` null, out of any group). A row is only given a member of its own when it does
 * not already follow the right place through its scene or file, so a group made of whole scenes stays a few lines of data.
 * Returns how many rows changed.
 */
export function placeRows(p: GroupData, views: FileView[], rows: RowRef[], id: string | null, now: number): number {
  const idx = new GroupIndex(p);
  const want = id ?? '';
  const members = (p.members ??= {});
  let n = 0;
  const byFile = new Map<string, Map<string, Unit>>();
  const unitOf = (file: string, key: string): Unit | undefined => {
    let m = byFile.get(file);
    if (!m) { m = new Map((views.find(v => v.name === file)?.units ?? []).map(u => [u.key, u])); byFile.set(file, m); }
    return m.get(key);
  };
  for (const r of rows) {
    if ((idx.groupOf(r.file, r.key) ?? '') === want) continue;
    const ref = rowRef(r.file, r.key), had = members[ref];
    if ((idx.groupOf(r.file, r.key, true) ?? '') === want) { if (had && !had.del) members[ref] = { ...had, del: true, mt: now }; }
    else { const u = unitOf(r.file, r.key); members[ref] = { g: want, mt: now, ...(u ? { h: hashText(u.source) } : {}) }; }
    n++;
  }
  return n;
}

/** Put a whole scene into a group: the scene itself gets the member and the rows inside it that were placed one by one are let go. */
export function placeScene(p: GroupData, file: string, scene: string, id: string | null, now: number): void {
  const members = (p.members ??= {});
  members[sceneRef(file, scene)] = { g: id ?? '', mt: now };
  const prefix = scene + '[';
  for (const [ref, m] of Object.entries(members)) {
    const r = parseRef(ref);
    if (r?.kind === 'row' && r.file === file && r.key!.startsWith(prefix) && !m.del) members[ref] = { ...m, del: true, mt: now };
  }
}

/** Put a whole file into a group: its scenes and rows that were placed separately are let go. */
export function placeFile(p: GroupData, file: string, id: string | null, now: number): void {
  const members = (p.members ??= {});
  members[fileRef(file)] = { g: id ?? '', mt: now };
  for (const [ref, m] of Object.entries(members)) {
    const r = parseRef(ref);
    if (r && r.kind !== 'file' && r.file === file && !m.del) members[ref] = { ...m, del: true, mt: now };
  }
}

export interface Orphan { ref: string; kind: 'file' | 'scene' | 'row'; file: string; key?: string; group: string; why: 'gone' | 'changed' }

/** Members whose place the game no longer has (or whose original text changed): shown to the translator, never dropped silently. */
export function findOrphans(p: GroupData, views: FileView[]): Orphan[] {
  const out: Orphan[] = [];
  const live = new Set(liveGroups(p).map(g => g.id));
  const byName = new Map(views.map(v => [v.name, v]));
  const scenesOf = new Map<string, Set<string>>(), rowsOf = new Map<string, Map<string, Unit>>();
  for (const [ref, m] of Object.entries(p.members ?? {})) {
    if (m.del || m.g === '' || !live.has(m.g)) continue;
    const r = parseRef(ref);
    if (!r) continue;
    const v = byName.get(r.file);
    const orphan = (why: 'gone' | 'changed'): void => { out.push({ ref, kind: r.kind, file: r.file, ...(r.key !== undefined ? { key: r.key } : {}), group: m.g, why }); };
    if (!v) { orphan('gone'); continue; }
    if (r.kind === 'file') continue;
    if (r.kind === 'scene') {
      let s = scenesOf.get(r.file);
      if (!s) { s = new Set((buildSceneIndex(v.units)?.scenes ?? []).map(x => x.id)); scenesOf.set(r.file, s); }
      if (!s.has(r.key!)) orphan('gone');
      continue;
    }
    let rows = rowsOf.get(r.file);
    if (!rows) { rows = new Map(v.units.map(u => [u.key, u])); rowsOf.set(r.file, rows); }
    const u = rows.get(r.key!);
    if (!u) orphan('gone');
    else if (m.h && m.h !== hashText(u.source)) orphan('changed');
  }
  return out;
}

export interface RowsProgress { total: number; translated: number; done: number; approved: number }

/** How far a set of rows has got (as `statsOf` does for a file). */
export function rowsProgress(rows: RowRef[], entriesOf: (file: string) => Translations): RowsProgress {
  const s: RowsProgress = { total: rows.length, translated: 0, done: 0, approved: 0 };
  for (const r of rows) {
    const e = entriesOf(r.file)[r.key];
    if (!e || !e.target) continue;
    s.translated++;
    if (e.status === 'done') s.done++;
    if (e.status === 'appr') s.approved++;
  }
  return s;
}

/** A set of rows made by the app from the game's data, never stored (shown next to the translator's own groups). */
export interface AutoGroup { id: string; name: string; sub?: string; rows: RowRef[] }

/** Rows grouped by who says them (speakers that are known), the most talkative first. */
export function groupBySpeaker(views: FileView[], speakers: SpeakerMap): AutoGroup[] {
  const by = new Map<string, RowRef[]>();
  for (const v of views) for (const u of v.units) {
    if (u.kind !== 'dialogue' && u.kind !== 'choice' && u.kind !== 'scroll') continue;
    const who = speakerOf(u, speakers);
    if (!who) continue;
    let l = by.get(who);
    if (!l) by.set(who, l = []);
    l.push({ file: v.name, key: u.key });
  }
  return [...by.entries()].map(([name, rows]) => ({ id: `a:speaker:${name}`, name, rows })).sort((a, b) => b.rows.length - a.rows.length || a.name.localeCompare(b.name, 'uk'));
}

/** The scenes of every file, in file order (files without scenes give none). */
export function groupByScene(views: FileView[]): AutoGroup[] {
  const out: AutoGroup[] = [];
  for (const v of views) {
    const idx = buildSceneIndex(v.units);
    if (!idx) continue;
    for (const sc of idx.scenes) out.push({ id: `a:scene:${v.name}${S}${sc.id}`, name: sc.title + (sc.pages > 1 && sc.page ? ` · сторінка ${sc.page}` : ''), sub: v.label || v.name.replace(/\.json$/, ''), rows: sc.units.map(u => ({ file: v.name, key: u.key })) });
  }
  return out;
}

/** Two copies of the groups and members: per item the newer wins, and what is older than the last reset is dropped. */
export function mergeGroupData(a: GroupData, b: GroupData, epoch: number): GroupData {
  const pick = <T extends { mt: number }>(x: Record<string, T> | undefined, y: Record<string, T> | undefined): Record<string, T> | undefined => {
    if (!x && !y) return undefined;
    const out: Record<string, T> = {};
    for (const src of [x ?? {}, y ?? {}]) for (const [k, v] of Object.entries(src)) if (v.mt > epoch && (!out[k] || v.mt > out[k]!.mt)) out[k] = v;
    return Object.keys(out).length ? out : undefined;
  };
  const groups = pick(a.groups, b.groups), members = pick(a.members, b.members);
  return { ...(groups ? { groups } : {}), ...(members ? { members } : {}) };
}
