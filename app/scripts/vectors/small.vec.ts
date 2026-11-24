import { test } from 'vitest';
import type { GameFile, PageInfo, Unit } from '../../src/core/model';
import { explainCodes } from '../../src/core/codes';
import { gorohUrl, multitranUrl, wordsOf } from '../../src/core/dictlinks';
import { GameNameIndex } from '../../src/core/gamenames';
import { byHintOrder, groupHints, HINT_GLYPH, HINT_GROUP, HINT_LABEL, HINT_ORDER } from '../../src/core/hints';
import { describePage, sysNamesOf } from '../../src/core/sysnames';
import type { SysNames } from '../../src/core/sysnames';
import { rng, text, writeVectors } from './util';
import type { Rng } from './util';

const CODES = ['\\N[1]', '\\n[2]', '\\V[3]', '\\v[99]', '\\P[1]', '\\I[5]', '\\C[0]', '\\C[7]', '\\c[3]', '\\G', '\\g', '\\S', '\\s', '\\{', '\\}', '\\.', '\\|', '\\!', '\\>', '\\<', '\\^', '\\$', '\\FS[22]', '\\xyz[1]', '\\N[0]', '\\N[12345]', '\\\\', '\\', '\\N[x]'];
const WORDS = ['Привіт', 'hello', "п'ять", 'сім’я', 'a-', 'x', 'Я', 'Hello', 'ґанок', 'Word-Word', "it's", '\n', ' ', '1', '😀', 'é'];

const gen = (r: Rng, pool: string[], n = 8): string => Array.from({ length: r.int(n + 1) }, () => r.pick(pool)).join(r.pick([' ', '', ' ']));

test('export small vectors', () => {
  const r = rng(314);
  const out: Record<string, { input: unknown; output: unknown }[]> = {};
  const add = (name: string, input: unknown, output: unknown) => (out[name] ??= []).push({ input, output });

  // sysnames
  const sysFiles = (): GameFile[] => {
    const sys = r.pick([
      () => ({ variables: ['', 'Gold', ' Level ', 5, null, 'Final'], switches: ['', 'Door', '  '], currencyUnit: r.pick(['G', '', 5, undefined]) }),
      () => ({ variables: [], switches: [] }),
      () => ({ currencyUnit: '₴' }),
      () => ({ variables: 'x', switches: { a: 1 } }),
      () => null, () => 5, () => [1],
    ])();
    const files: GameFile[] = [{ name: 'Map001.json', json: {} }];
    if (r.chance(0.9)) files.push({ name: 'System.json', json: sys as never });
    return files;
  };
  const names: (SysNames | undefined)[] = [];
  for (let i = 0; i < 80; i++) { const files = sysFiles(); const s = sysNamesOf(files); names.push(s); add('sysNamesOf', files, s ?? null); }
  const realNames = names.filter(Boolean) as SysNames[];
  const pg = (): PageInfo => ({ trigger: r.pick([0, 1, 2, 3, 4, 5, -1, 9]), x: r.int(20), y: r.int(20), switches: Array.from({ length: r.int(4) }, () => r.pick([0, 1, 2, 3, 7])), ...(r.chance(0.5) ? { variable: { id: r.pick([0, 1, 2, 5]), min: r.pick([0, 1, 5, 1.5, 100]) } } : {}), ...(r.chance(0.3) ? { selfSwitch: r.pick(['A', 'B', '']) } : {}), ...(r.chance(0.3) ? { item: r.pick([0, 1, 7]) } : {}), ...(r.chance(0.3) ? { actor: r.pick([0, 2]) } : {}) });
  for (let i = 0; i < 200; i++) {
    const nm = r.chance(0.3) ? undefined : r.pick(realNames.length ? realNames : [undefined]);
    const p = pg();
    add('describePage', { p, names: nm ?? null }, describePage(p, nm));
  }

  // codes
  for (let i = 0; i < 300; i++) {
    const t = gen(r, [...CODES, ...WORDS], 10);
    const nm = r.chance(0.3) ? undefined : r.pick(realNames.length ? realNames : [undefined]);
    const actors: Record<string, string> = { 1: 'Ерік', 2: '', 12345: 'Big' };
    add('explainCodes', { text: t, names: nm ?? null, actors }, explainCodes(t, n => actors[n], nm));
  }

  // dictlinks
  for (const w of ['слово', 'Слово', 'Ґанок', "п'ять", 'a b', 'x&y=z', 'сім’я', '😀', '(x)!~*\'', '']) { add('urls', w, { goroh: gorohUrl(w), syn: gorohUrl(w, 'Синоніми'), mt: multitranUrl(w) }); }
  for (let i = 0; i < 200; i++) { const t = gen(r, [...CODES, ...WORDS], 12), limit = r.pick([24, 3, 1, 100]); add('wordsOf', { t, limit }, wordsOf(t, limit)); }

  // hints
  const cats = ['error', 'term', 'context', 'style', 'info'] as const;
  add('hintTables', null, { order: HINT_ORDER, label: HINT_LABEL, group: HINT_GROUP, glyph: HINT_GLYPH });
  for (let i = 0; i < 100; i++) {
    const items = Array.from({ length: r.int(10) }, (_, k) => ({ cat: r.pick(cats), n: k }));
    add('hints', items, { ordered: byHintOrder(items), groups: groupHints(items) });
  }

  // game names
  const FILES = ['Items.json', 'data/Skills.json', 'Actors.json', 'Map001.json', 'Weapons.json', 'www/data/Enemies.json', 'Other.json'];
  const NAMES = ['Sword', 'sword', 'Iron Sword', 'Potion', 'Ґанок', 'ґанок', 'Fire', 'Ice (rare)', 'A+B', 'Ab', 'Hero', 'Зілля', '😀 Gem', 'x'.repeat(10)];
  for (let i = 0; i < 150; i++) {
    const views = Array.from({ length: r.int(5) }, () => ({ name: r.pick(FILES), units: Array.from({ length: r.int(6) }, (_, k): Unit => ({ key: `k${k}`, source: r.pick(NAMES), speaker: '', kind: r.pick(['name', 'name', 'dialogue', 'description'] as const), context: '' })) }));
    const min = r.pick([4, 4, 1, 6]);
    const idx = new GameNameIndex(views, min);
    const texts = Array.from({ length: 6 }, () => gen(r, [...NAMES, ...WORDS, 'The', 'Zілля'], 8));
    add('gameNames', { views, min, texts }, { size: idx.size, found: texts.map(t => idx.find(t)) });
  }
  void text;
  writeVectors('small', out);
});
