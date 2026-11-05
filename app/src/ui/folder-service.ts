import type { PickedFile } from './folder';
import { dataDirOf } from './desktop';
import type { Reopened } from './desktop';

/**
 * Where the project's game folder stands when the app starts:
 * `none` the project has no folder (opened from a file, or never picked);
 * `ok` the folder is there and holds this project's game;
 * `other` the folder is there but looks like another game (or another version): nothing may be written into it;
 * `missing` the folder was moved, deleted or is not reachable.
 */
export type FolderState =
  | { kind: 'none' }
  | { kind: 'ok'; root: string; dataDir: string | null; files: PickedFile[] }
  | { kind: 'other'; root: string; dataDir: string | null; files: PickedFile[]; matched: number; expected: number }
  | { kind: 'missing'; root: string; reason: 'missing' | 'failed' };

/** The share of the project's files a folder has to contain to count as the same game. */
export const SAME_GAME = 0.5;

const baseName = (n: string): string => n.split('/').pop() ?? n;

/** Decide what a remembered folder is, from what was found in it and the files the project knows. */
export function classifyFolder(found: Reopened | null, projectFiles: string[]): FolderState {
  if (!found) return { kind: 'none' };
  if (!found.ok) return { kind: 'missing', root: found.root, reason: found.reason };
  const dataDir = dataDirOf(found.files);
  const names = new Set(found.files.map(f => baseName(f.name)));
  const expected = projectFiles.length;
  const matched = projectFiles.filter(n => names.has(baseName(n))).length;
  if (!expected || matched / expected >= SAME_GAME) return { kind: 'ok', root: found.root, dataDir, files: found.files };
  return { kind: 'other', root: found.root, dataDir, files: found.files, matched, expected };
}

export type FolderAction = 'repick' | 'use' | 'hide';

/** What the banner says about a folder that needs attention, and what can be done; `null` when there is nothing to say. */
export function folderBanner(f: FolderState): { text: string; actions: FolderAction[] } | null {
  if (f.kind === 'missing') {
    return {
      text: f.reason === 'missing'
        ? `Папку гри не знайдено: ${f.root}. Переклад і оригінали в проєкті збережено; збірка й запуск гри недоступні, поки папку не вказано.`
        : `Немає доступу до папки гри: ${f.root}. Переклад і оригінали в проєкті збережено; збірка й запуск гри недоступні, поки папку не вказано.`,
      actions: ['repick', 'hide'],
    };
  }
  if (f.kind === 'other') {
    return {
      text: `У папці ${f.root} інша гра або інша версія: збігається ${f.matched} із ${f.expected} файлів проєкту. Збірку в неї вимкнено, щоб не пошкодити чужу гру.`,
      actions: ['repick', 'use', 'hide'],
    };
  }
  return null;
}

/** A short line for the project card and the settings: where the folder is and whether it can be used. */
export function folderLine(f: FolderState, remembered: string | null): string {
  if (f.kind === 'missing') return `${f.root} (не знайдено)`;
  if (f.kind === 'other') return `${f.root} (схоже, інша гра)`;
  if (f.kind === 'ok') return f.root;
  return remembered ?? 'Папку гри не вибрано';
}
