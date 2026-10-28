import type { GameFile } from './model';

/** Where the game hands out an item, weapon, armour or skill: `Items.json:5` → event contexts. */
export type Usage = Map<string, string[]>;

const GIVE: Record<number, string> = { 126: 'Items.json', 127: 'Weapons.json', 128: 'Armors.json' };

export function buildUsage(game: GameFile[], labelOf: (file: string) => string | undefined = () => undefined): Usage {
  const out: Usage = new Map();
  const note = (key: string, where: string) => { const a = out.get(key) ?? []; if (a.length < 8 && !a.includes(where)) a.push(where); out.set(key, a); };
  const scan = (list: unknown, where: string) => {
    if (!Array.isArray(list)) return;
    for (const c of list as { code?: number; parameters?: unknown[] }[]) {
      const p = c?.parameters;
      if (!p) continue;
      const give = c.code !== undefined ? GIVE[c.code] : undefined;
      if (give && p[1] === 0 && typeof p[0] === 'number') note(`${give}:${p[0]}`, where);
      else if (c.code === 318 && p[1] === 0 && typeof p[2] === 'number') note(`Skills.json:${p[2]}`, where);
    }
  };
  for (const f of game) {
    const j = f.json as { events?: unknown[] } | unknown[] | null;
    if (/^Map\d+\.json$/.test(f.name) && j && !Array.isArray(j) && Array.isArray(j.events)) {
      const label = labelOf(f.name);
      for (const ev of j.events as ({ id?: number; name?: string; pages?: { list?: unknown }[] } | null)[]) {
        if (!ev?.pages) continue;
        const where = `${f.name}${label ? ' (' + label + ')' : ''} · ${ev.name || 'EV' + ev.id}`;
        for (const pg of ev.pages) scan(pg.list, where);
      }
    } else if (f.name === 'CommonEvents.json' && Array.isArray(j)) {
      for (const ev of j as ({ name?: string; list?: unknown } | null)[]) if (ev) scan(ev.list, `Спільна подія · ${ev.name ?? ''}`);
    }
  }
  return out;
}

/** Usage key for a database row's unit: `Items.json`, `[5].name` → `Items.json:5`. */
export const usageKey = (file: string, unitKey: string): string | null => { const m = /^\[(\d+)\]\./.exec(unitKey); return m ? `${file}:${m[1]}` : null; };
