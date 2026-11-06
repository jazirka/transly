/** Status of a translation unit. Order matters: a unit only moves forward through review. */
export type Status = 'new' | 'draft' | 'done' | 'appr';

/** One translatable string extracted from a game file. */
export interface Unit {
  /** Stable id inside the file, e.g. `events[14].pages[0].list[5]`. */
  key: string;
  /** Source text exactly as stored in the game file (lines joined with \n). */
  source: string;
  /** Speaker / owner label when the format provides one. */
  speaker: string;
  /** RPG Maker: face graphic of the message (`Actor1#3`), a stable hint for who speaks. */
  face?: string;
  /** RPG Maker: name of the event the message belongs to (often the NPC). */
  event?: string;
  /** RPG Maker: the developer's own label (an uppercase comment such as `MARCOH` or `SMALL_TALK`) in force at this message. */
  note?: string;
  /** RPG Maker database row: the `note` field (tags such as `<Cost: 50>`), on the row's name unit. */
  dbNote?: string;
  /** RPG Maker map event: how the page this row opens is triggered, on the first row of the page. */
  page?: PageInfo;
  /** Short kind label used for grouping and the Тип column. */
  kind: UnitKind;
  /** Human-readable scene path, e.g. `EV014 · Старий солдат`. */
  context: string;
}

/** Conditions of an event page. Ids refer to System.json's switch and variable names. */
export interface PageInfo {
  /** 0 action button, 1 player touch, 2 event touch, 3 autorun, 4 parallel */
  trigger: number;
  x: number;
  y: number;
  switches: number[];
  variable?: { id: number; min: number };
  selfSwitch?: string;
  item?: number;
  actor?: number;
}

export type UnitKind = 'dialogue' | 'choice' | 'scroll' | 'name' | 'description' | 'message' | 'term';

/** Per-unit translator state that is persisted and merged. */
export interface Entry {
  target: string;
  status: Status;
  /** Last modification time (ms). Used for last-writer-wins merging per unit. */
  mt: number;
  /** Source text this translation was written against; a mismatch means the original changed in the game. */
  src?: string;
  /** Translator's version at the moment it was sent to review (to show what the reviewer changed). */
  orig?: string;
  /** True when a reviewer sent the unit back to the translator. */
  returned?: boolean;
  /** QA issue keys the translator chose to ignore for this unit. */
  ign?: string[];
  /** When `ign` last changed (it has its own clock, so ignoring a warning never overrides a newer translation in a merge). */
  ignAt?: number;
  comments?: Comment[];
  /** Newest last; capped so a long-lived unit does not grow the project without bound. */
  history?: HistoryItem[];
}

export interface Comment {
  who: string; at: number; text: string;
  /** Stable id of a comment (new ones get it; older ones are identified by `commentId`). */
  id?: string;
  /** Id of the comment this one answers. */
  re?: string;
  /** Resolved (or reopened again): who and when. The newest one wins in a merge. */
  res?: { who: string; at: number; open?: boolean };
  /** When the text was last edited. */
  ed?: number;
  /** Deleted: the comment stays as a trace (without its text), so a merge with a device that still has it does not bring it back. */
  del?: boolean;
}
export interface HistoryItem {
  at: number; who: string; what: string; text: string;
  /** Id of the bulk action (send, auto-fill, replace…) this record belongs to: lets the whole action be undone and redone. */
  batch?: string;
  /** The translation, status and notes before this record (what undo restores). */
  prev?: { target: string; status: Status; returned?: boolean };
}

export type Translations = Record<string, Entry>;

export interface GameFile {
  /** File name inside the game data folder, e.g. `Map042.json`. */
  name: string;
  /** Parsed JSON as read from the game. Never mutated by the core. `null` for text formats. */
  json: unknown;
  /** Raw text of non-JSON formats (.po, .csv, .rpy). */
  text?: string;
}
