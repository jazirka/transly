import { test } from 'vitest';
import { TmIndex, similarity } from '../../src/core/tm';
import type { TmEntry } from '../../src/core/tm';
import { EN, UK } from './corpus';
import { rng, writeVectors } from './util';
import type { Rng } from './util';

const CODES = ['\\C[2]', '\\N[1]', '\\V[12]', '\\{', '\\.', '\\G'];
const PUNCT = [',', '.', '!', '?', '...', '—'];
const WORDS = [...EN.filter(w => /^[a-z]+$/.test(w)), ...UK.filter(w => /^\p{L}+$/u.test(w)), 'Ґанок', 'ÉCOLE', '𝒳y', 'straße'];

function sentence(r: Rng, n = 1 + r.int(8)): string {
  const parts: string[] = [];
  for (let i = 0; i < n; i++) {
    parts.push(r.pick(WORDS));
    if (r.chance(0.1)) parts.push(r.pick(PUNCT));
    if (r.chance(0.07)) parts.push(r.pick(CODES));
    if (r.chance(0.05)) parts.push(String(r.int(500)));
  }
  let s = parts.join(r.pick([' ', ' ', ' ', '  ', '\n']));
  if (r.chance(0.2)) s = s[0]!.toUpperCase() + s.slice(1);
  return s;
}
function mutate(r: Rng, s: string): string {
  const ws = s.split(' ');
  for (let n = 1 + r.int(3); n > 0; n--) {
    const roll = r.int(5), i = r.int(Math.max(1, ws.length));
    if (roll === 0) ws.splice(i, 1);
    else if (roll === 1) ws.splice(i, 0, r.pick(WORDS));
    else if (roll === 2) ws[i] = r.pick(WORDS);
    else if (roll === 3 && ws[i]) ws[i] = ws[i]!.slice(0, -1) + r.pick(['a', 'x', 'я']);
    else ws[i] = ws[i]?.toUpperCase() ?? '';
  }
  return ws.join(' ');
}

test('export tm vectors', () => {
  const r = rng(2025);
  const out: Record<string, { input: unknown; output: unknown }[]> = {};
  const add = (name: string, input: unknown, output: unknown) => (out[name] ??= []).push({ input, output });

  for (let i = 0; i < 400; i++) {
    const a = sentence(r), b = r.chance(0.5) ? mutate(r, a) : r.chance(0.2) ? a : sentence(r), min = r.pick([0, 0, 30, 50, 60, 80, 95, 99.5]);
    add('similarity', { a, b, min }, similarity(a, b, min));
  }
  for (const [a, b] of [['', ''], ['a', ''], ['', 'a'], ['same', 'same'], ['kitten', 'sitting'], ['😀a', '😀b'], ['абв', 'абг']]) add('similarity', { a, b, min: 0 }, similarity(a!, b!));

  for (let n = 0; n < 40; n++) {
    const flow = r.chance(0.3);
    const entries: TmEntry[] = [];
    for (let i = 0; i < 5 + r.int(60); i++) {
      let s = sentence(r), t = sentence(r);
      if (r.chance(0.08)) { s = Array.from({ length: 60 }, () => r.pick(WORDS)).join(' '); t = s; }
      if (flow && r.chance(0.5)) t = t.replace(/ /g, r.pick([' ', '\n']));
      if (r.chance(0.04)) s = ' ';
      if (r.chance(0.04)) t = '';
      entries.push({ s, t, src: r.pick(['F0.json', 'Імпорт']) });
    }
    const idx = new TmIndex({ flow });
    for (const e of entries) idx.add(e);
    const good = entries.filter(e => e.s.trim() && e.t.trim());
    const queries: { q: string; min: number | null; limit: number | null; excl: string | null }[] = [];
    for (let i = 0; i < 25; i++) {
      const base = good.length && r.chance(0.8) ? r.pick(good).s : sentence(r);
      queries.push({ q: r.chance(0.6) ? mutate(r, base) : base, min: r.pick([null, 0, 50, 80, 95]), limit: r.pick([null, 1, 3]), excl: r.chance(0.3) && good.length ? r.pick(good).t : null });
    }
    const results = queries.map(q => idx.find(q.q, { ...(q.min !== null ? { min: q.min } : {}), ...(q.limit !== null ? { limit: q.limit } : {}), ...(q.excl !== null ? { exclude: (e: TmEntry) => e.t === q.excl } : {}) }));
    const searches = Array.from({ length: 10 }, () => { const q = r.chance(0.7) && good.length ? r.pick(good)[r.pick(['s', 't'] as const)].split(/\s+/)[0] ?? '' : r.pick(WORDS); const limit = r.pick([100, 2]); return { q, limit, res: idx.search(q, limit) }; });
    add('index', { entries, flow, queries, searches: searches.map(s => ({ q: s.q, limit: s.limit })) }, { size: idx.size, results, searches: searches.map(s => s.res) });
  }
  writeVectors('tm', out);
});
