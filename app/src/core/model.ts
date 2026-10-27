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
  /** Short kind label used for grouping and the Тип column. */
  kind: UnitKind;
  /** Human-readable scene path, e.g. `EV014 · Старий солдат`. */
  context: string;
}

export type UnitKind = 'dialogue' | 'choice' | 'scroll' | 'name' | 'description' | 'message' | 'term';

/** Per-unit translator state that is persisted and merged. */
export interface Entry {
  target: string;
  status: Status;
  /** Last modification time (ms). Used for last-writer-wins merging per unit. */
  mt: number;
}

export type Translations = Record<string, Entry>;

export interface GameFile {
  /** File name inside the game data folder, e.g. `Map042.json`. */
  name: string;
  /** Parsed JSON as read from the game. Never mutated by the core. */
  json: unknown;
}
