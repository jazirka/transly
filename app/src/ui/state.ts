import { TmIndex, activeIssues } from '../core';
import type { BatchKind, GameNameIndex, RowChange, Usage } from '../core';
import type { Autosave, DupIndex, Entry, FileView, GameFile, Group, RowRef, SavedProject, Status, Unit } from '../core';

export type Mode = 'table' | 'edit';
export type Filter = 'all' | 'new' | 'draft' | 'done' | 'appr' | 'qa' | 'cm';
export type SideTab = 'panel';
export type LeftTab = 'files' | 'rows' | 'glossary' | 'scenes';
export type LenFilter = 'all' | 'far' | 'longer' | 'shorter';
/** Order of the rows list: as in the file, untranslated first, problems first, longest first. */
export type SortMode = 'order' | 'new' | 'qa' | 'long';

/** `State.current` while several files are shown together: their rows get keys `file␟key` and their entries are reached through ctx.entries(GROUP). */
export const GROUP = '⁖group';
export const SEP = '␟';
/** Split a row key of the group view into the file and the key inside it; a plain key has no file. */
export const splitKey = (key: string): { file: string; key: string } | null => {
  const i = key.indexOf(SEP);
  return i < 0 ? null : { file: key.slice(0, i), key: key.slice(i + SEP.length) };
};

export interface State {
  views: FileView[];
  game: GameFile[];
  saved: SavedProject;
  /** File whose rows are shown. */
  current: string | null;
  /** Files open as tabs, in the order they were opened. */
  open: string[];
  /** Files shown together in one table (`current` is then GROUP); null when no group is open. */
  group: string[] | null;
  /** When the group shows only some rows of its files (a group of the translator's, a speaker, a scene): the title and which keys of each file; `gid` is the translator's group it follows. */
  groupSel: { title: string; gid?: string; keys: Map<string, Set<string>> } | null;
  /** Files ticked in the file tree (Ctrl/Shift-click) to open together. */
  picked: Set<string>;
  /** Unit key selected in the current file. */
  cur: string | null;
  mode: Mode;
  filter: Filter;
  q: string;
  speaker: string | null;
  lenFilter: LenFilter;
  sort: SortMode;
  /** Phone: the editor shows only the text (no context, neighbours or notes). */
  compact: boolean;
  /** Phone: the on-screen keyboard is up, so the bottom bar gives its space to the editor. */
  kb: boolean;
  /** Keys ticked for bulk actions in the current file. */
  checked: Set<string>;
  sideTab: SideTab;
  /** Right-hand panels that are switched on (like tool windows): several are stacked, none folds the zone to its rail. */
  sideOn: SideTab[];
  saveOk: boolean;
  savedAt: number | null;
  who: string;
  /** Narrow screen: one column, side panels become drawers. */
  phone: boolean;
  /** Left panel: which list it shows and whether it is open (always open on desktop). */
  leftTab: Record<Mode, LeftTab>;
  leftOpen: boolean;
  /** Desktop: files and rows stacked in the left panel, each taking half. */
  leftBoth: boolean;
  rightOpen: boolean;
  collapsed: Set<string>;
  sess: { n: number; t0: number };
  lastBuild: { at: number; n: number } | null;
}

/** Everything UI modules need from the shell, so they stay free of globals. */
export interface Ctx {
  s: State;
  autosave: Autosave;
  entries(file: string): Record<string, Entry>;
  /** Who speaks this unit (game name, or the translator's face/event mapping). */
  speaker(u: Unit): string;
  qaOpts(): { tolerancePct: number; terms: { en: string; uk: string; alt?: string[]; qa?: boolean }[]; lineLimit?: number };
  /** Effective longest line of a message, 0 when not checked. */
  lineLimit(): number;
  /** Names the game's database defines (items, skills, characters…). */
  names(): GameNameIndex;
  /** Where the game hands out items and skills (needs the game's files; empty on a phone). */
  usage(): Usage;
  /** The game's data folder when the desktop app knows it (needed to start the game); null otherwise. */
  gameDir(): string | null;
  /** A build was written into the game: update the status bar. */
  built(n: number): void;
  view(): FileView | null;
  unit(key: string): Unit | undefined;
  /** Units of the current file that pass the status/search/speaker/length filters. */
  visible(): Unit[];
  tm(): TmIndex;
  invalidateTm(): void;
  /** The memory is a little out of date (a row was typed in): it is rebuilt on its next use, but not more than about once a second. */
  softTm(): void;
  dups(): DupIndex;
  persist(): void;
  /** Always the translate pass: a translation is approved with the ✓ in the right panel, not in a mode of its own. */
  stage(): 'translate' | 'review';
  /** Write rows as one action of the journal: each gets a history record with what it was before, and the whole action can be taken back. Returns the action's id. */
  commit(changes: RowChange[], kind: BatchKind, what?: string): string;
  render(): void;
  select(key: string, mode?: Mode): void;
  /** Show some rows of the game in one table (a group of the translator's when `gid` is given: the table then follows it when rows are moved). */
  openRows(title: string, rows: RowRef[], gid?: string): void;
  /** The groups or what is in them changed: the lists, the marks and an open group table are redrawn. */
  groupsChanged(): void;
  /** The group a row is in, or null. */
  groupOf(file: string, key: string): Group | null;
  /** Open a file as a tab. */
  openFile(file: string): void;
  /** Open a row of any file in the editor (the file is opened, the filters that would hide the row are dropped). */
  open(file: string, key: string): void;
}

export function buildTm(s: State): TmIndex {
  const tm = new TmIndex();
  for (const v of s.views) {
    const ents = s.saved.files[v.name];
    if (!ents) continue;
    for (const u of v.units) {
      const e = ents[u.key];
      if (e && e.target.trim()) tm.add({ s: u.source, t: e.target, src: v.name });
    }
  }
  for (const m of s.saved.memory) tm.add({ s: m.s, t: m.t, src: 'Імпорт' });
  return tm;
}

export type ShownStatus = Status | 'qa';

/** Status as shown to the user: a unit with an active QA issue shows the red triangle. */
export function shownStatus(ctx: Ctx, u: Unit, e: Entry | undefined): ShownStatus {
  const st: Status = e?.status ?? 'new';
  return e && e.target && st !== 'new' && activeIssues(u, e, ctx.qaOpts()).length ? 'qa' : st;
}

export const STATUS_LABEL: Record<ShownStatus, string> = { new: 'без перекладу', draft: 'чернетка', done: 'чекає вичитування', appr: 'вичитано', qa: 'є проблема QA' };
export const STATUS_CAP: Record<ShownStatus, string> = { new: 'Без перекладу', draft: 'Чернетка', done: 'Очікує вичитування', appr: 'Вичитано', qa: 'Є проблема QA' };
