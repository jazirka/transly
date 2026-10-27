import { TmIndex, activeIssues } from '../core';
import type { Autosave, DupIndex, Entry, FileView, GameFile, SavedProject, Status, Unit } from '../core';

export type Mode = 'table' | 'edit' | 'review';
export type Filter = 'all' | 'new' | 'draft' | 'done' | 'appr' | 'qa' | 'cm';
export type SideTab = 'hints' | 'glossary' | 'comments' | 'history';
export type LeftTab = 'files' | 'rows';
export type LenFilter = 'all' | 'far' | 'longer' | 'shorter';

export interface State {
  views: FileView[];
  game: GameFile[];
  saved: SavedProject;
  /** File whose rows are shown. */
  current: string | null;
  /** Files open as tabs, in the order they were opened. */
  open: string[];
  /** Unit key selected in the current file. */
  cur: string | null;
  mode: Mode;
  filter: Filter;
  q: string;
  speaker: string | null;
  lenFilter: LenFilter;
  /** Keys ticked for bulk actions in the current file. */
  checked: Set<string>;
  sideTab: SideTab;
  saveOk: boolean;
  savedAt: number | null;
  who: string;
  /** Narrow screen: one column, side panels become drawers. */
  phone: boolean;
  /** Left panel: which list it shows and whether it is open (always open on desktop). */
  leftTab: Record<Mode, LeftTab>;
  leftOpen: boolean;
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
  qaOpts(): { tolerancePct: number; terms: { en: string; uk: string; alt?: string[]; qa?: boolean }[] };
  view(): FileView | null;
  unit(key: string): Unit | undefined;
  /** Units of the current file that pass the status/search/speaker/length filters. */
  visible(): Unit[];
  tm(): TmIndex;
  invalidateTm(): void;
  dups(): DupIndex;
  persist(): void;
  render(): void;
  select(key: string, mode?: Mode): void;
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
