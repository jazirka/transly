import type { SavedProject } from './project';

/**
 * Marks of what was done with the project outside this browser: when a copy of it last left the browser's storage (a project
 * file saved, a sync that went through), and when a build of the game was last made. The project lives in one place only
 * (the browser's storage), so the age of the newest copy is the thing a translator most needs to see. They are part of the
 * project, merge by their time like any record of items with an `mt`, and an older build that does not know them carries them along.
 */
export type StampKind = 'copy' | 'build';
export interface Stamp { mt: number; how: string; n?: number }

export function stamp(saved: SavedProject, kind: StampKind, how: string, now: number, n?: number): void {
  const all = (saved.stamps ??= {});
  all[kind] = { mt: now, how, ...(n !== undefined ? { n } : {}) };
}

export const stampOf = (saved: SavedProject, kind: StampKind): Stamp | null => {
  const s = saved.stamps?.[kind];
  return s && Number.isFinite(s.mt) ? s : null;
};

/** «щойно», «5 хв тому», «3 год тому», «2 дн. тому». */
export function ago(mt: number, now: number): string {
  const min = Math.max(0, Math.floor((now - mt) / 60000));
  if (min < 1) return 'щойно';
  if (min < 60) return `${min} хв тому`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} год тому`;
  return `${Math.floor(h / 24)} дн. тому`;
}

/** The line about the newest copy: how old it is, and whether it is old enough (or missing) to be worth a reminder. */
export function copyLine(saved: SavedProject, now: number, translated: number): { text: string; warn: boolean } {
  const c = stampOf(saved, 'copy');
  if (!c) return { text: 'Копії поза браузером ще не було', warn: translated > 0 };
  return { text: `Копія: ${ago(c.mt, now)}`, warn: translated > 0 && now - c.mt > 24 * 3600 * 1000 };
}
