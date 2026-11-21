import type { SavedProject } from './project';
import type { Unit } from './model';

/**
 * What the project is called to the translator: the name of the folder the game was opened from (the game's own folder, not the `data` or
 * `www` inside it), or the title the game gives itself (System.json), or a name the translator wrote. The stored `SavedProject.name` stays what
 * it was (it is the identity of the project for merges, notes about the place in a file and so on); this is only what is shown.
 */
export const DEFAULT_NAME = 'Новий проєкт';
export type NameSource = 'folder' | 'game' | 'custom';

/** Folders inside a game that are never its name. */
const INSIDE = new Set(['data', 'www', 'js', 'img', 'audio', 'movies', 'fonts', 'locales', 'resources', 'app', 'game']);

/** The name of the game's folder, from the path it was opened from (or the single name a browser gives for the picked folder). '' when there is none. */
export function nameFromFolder(path: string): string {
  const parts = path.split(/[\\/]+/).map(s => s.trim()).filter(Boolean);
  while (parts.length && INSIDE.has(parts[parts.length - 1]!.toLowerCase())) parts.pop();
  const last = parts[parts.length - 1] ?? '';
  // a drive letter or a root is not a name
  return /^[a-z]:$/i.test(last) ? '' : last.replace(/[_]+/g, ' ').trim();
}

/** The title the game gives itself (System.json `gameTitle`), from the copy of the originals. '' when there is none. */
export function gameTitleOf(snapshot: Record<string, Unit[]> | undefined): string {
  const sys = snapshot?.['System.json'] ?? Object.entries(snapshot ?? {}).find(([n]) => n.split('/').pop() === 'System.json')?.[1];
  return sys?.find(u => u.key === 'gameTitle')?.source.trim() ?? '';
}

/** Where the shown name comes from now (a name written by hand counts only when there is one). */
export function nameSourceOf(p: Pick<SavedProject, 'settings'>): NameSource {
  const from = p.settings.nameFrom;
  return from === 'custom' && p.settings.title?.trim() ? 'custom' : from === 'game' ? 'game' : 'folder';
}

/** The name shown for the project everywhere. */
export function projectTitle(p: Pick<SavedProject, 'name' | 'settings' | 'snapshot'>): string {
  const own = p.settings.title?.trim(), folder = p.settings.folderName?.trim(), game = gameTitleOf(p.snapshot);
  const from = nameSourceOf(p);
  if (from === 'custom' && own) return own;
  if (from === 'game' && game) return game;
  return folder || game || (p.name !== DEFAULT_NAME ? p.name : '') || DEFAULT_NAME;
}

/** Words that do not give a letter to the icon. */
const SKIP = new Set(['of', 'the', 'and', 'a', 'an', 'in', 'on', 'at', 'to', 'for', 'у', 'в', 'на', 'та', 'і', 'й', 'з', 'до', 'за', 'по', 'від']);

/** The letters of the project's icon: one or two. Two words give two letters; the translator may write them by hand. */
export function iconLetters(p: Pick<SavedProject, 'name' | 'settings' | 'snapshot'>): string {
  const own = Array.from(p.settings.iconText?.trim() ?? '').slice(0, 2).join('');
  if (own) return own.toUpperCase();
  const title = projectTitle(p);
  if (title === DEFAULT_NAME) return 'Н';
  const words = title.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const real = words.filter(w => !SKIP.has(w.toLowerCase()));
  const use = (real.length ? real : words).slice(0, 2);
  return use.map(w => Array.from(w)[0]!).join('').toUpperCase() || 'T';
}
