import { commandLists, hasText, splitPluginCommand } from './rpgmaker';
import type { GameFile } from './model';

export interface PluginCandidate {
  name: string;
  /** Commands with this name. */
  count: number;
  /** Of those, how many carry text with letters. */
  withText: number;
  /** Distinct example texts. */
  samples: string[];
  /** Looks like sentences for the player (two or more words in most cases): safe to pre-select. */
  likely: boolean;
}

/**
 * Plugin commands (code 356) whose arguments contain text. Names and counts come from the game itself,
 * so this works for any plugin: the translator decides which commands show text to the player.
 */
export function pluginCandidates(game: GameFile[]): PluginCandidate[] {
  const m = new Map<string, { count: number; withText: number; wordy: number; samples: Set<string> }>();
  for (const f of game) for (const list of commandLists(f)) for (const c of list) {
    if (c.code !== 356 || typeof c.parameters[0] !== 'string') continue;
    const { name, text } = splitPluginCommand(c.parameters[0]);
    if (!name) continue;
    const e = m.get(name) ?? { count: 0, withText: 0, wordy: 0, samples: new Set<string>() };
    e.count++;
    if (hasText(text)) {
      e.withText++;
      if (/\p{L}{2,}\s+\p{L}{2,}/u.test(text)) e.wordy++;
      if (e.samples.size < 3) e.samples.add(text.slice(0, 80));
    }
    m.set(name, e);
  }
  return [...m]
    .filter(([, e]) => e.withText > 0)
    .map(([name, e]) => ({ name, count: e.count, withText: e.withText, samples: [...e.samples], likely: e.wordy / e.withText >= 0.6 && e.withText >= 3 }))
    .sort((a, b) => Number(b.likely) - Number(a.likely) || b.withText - a.withText);
}
