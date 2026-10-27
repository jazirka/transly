import { TmIndex } from '../core';
import type { DupIndex } from '../core';
import type { Autosave, Entry, FileView, GameFile, SavedProject, Unit } from '../core';

export type Mode = 'table' | 'edit' | 'review';
export type Filter = 'all' | 'new' | 'draft' | 'done' | 'appr' | 'qa';
export type SideTab = 'hints' | 'glossary' | 'comments' | 'history';
export type Drawer = 'left' | 'right' | null;

export interface State {
  views: FileView[];
  game: GameFile[];
  saved: SavedProject;
  current: string | null;
  cur: string | null;
  mode: Mode;
  filter: Filter;
  q: string;
  sideTab: SideTab;
  saveOk: boolean;
  who: string;
  /** Narrow screen: one column, side panels become drawers. */
  phone: boolean;
  drawer: Drawer;
  leftTab: 'files' | 'rows';
}

/** Everything UI modules need from the shell, so they stay free of globals. */
export interface Ctx {
  s: State;
  autosave: Autosave;
  entries(file: string): Record<string, Entry>;
  qaOpts(): { tolerancePct: number; terms: { en: string; uk: string }[] };
  view(): FileView | null;
  unit(key: string): Unit | undefined;
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
