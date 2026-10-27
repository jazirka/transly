import type { FileView } from './project';

export interface GameName { file: string; key: string; name: string }

const NAME_FILES = new Set(['Actors.json', 'Armors.json', 'Classes.json', 'Enemies.json', 'Items.json', 'Skills.json', 'States.json', 'Weapons.json']);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Names the game defines itself (items, skills, weapons, characters, enemies). When one of them is mentioned in a
 * dialogue, the translator should use the same translation there as in the database.
 */
export class GameNameIndex {
  private byName = new Map<string, GameName>();
  private re: RegExp | null = null;

  constructor(views: FileView[], minLength = 4) {
    for (const v of views) {
      if (!NAME_FILES.has(v.name.split('/').pop() ?? '')) continue;
      for (const u of v.units) {
        if (u.kind !== 'name' || u.source.length < minLength) continue;
        const k = u.source.toLowerCase();
        if (!this.byName.has(k)) this.byName.set(k, { file: v.name, key: u.key, name: u.source });
      }
    }
    const names = [...this.byName.keys()].sort((a, b) => b.length - a.length);
    if (names.length) this.re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${names.map(esc).join('|')})(?![\\p{L}\\p{N}])`, 'giu');
  }

  get size(): number { return this.byName.size; }

  /** Game names mentioned in `source`, in order of appearance, without repeats. */
  find(source: string): GameName[] {
    if (!this.re) return [];
    const seen = new Set<string>();
    const out: GameName[] = [];
    for (const m of source.matchAll(this.re)) {
      const k = m[0].toLowerCase();
      const g = this.byName.get(k);
      if (g && !seen.has(k)) { seen.add(k); out.push(g); }
    }
    return out;
  }
}
