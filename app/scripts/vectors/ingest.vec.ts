import { test } from 'vitest';
import type { Entry, Translations, Unit } from '../../src/core/model';
import { GONE, alignSources, ingestCount, ingestNote, ingestQuiet, isParked, looksLikeAnotherGame, planIngest } from '../../src/core/ingest';
import { rng, writeVectors } from './util';
import type { Rng } from './util';

const VOCAB = ['Hello', 'Hi', 'Yes', 'No', 'Thanks', 'Go on', 'Wait', 'Run!', 'Look', 'Take it', 'Open', 'Close', 'Fire', 'Ice'];
const SPEAKERS = ['', '', 'A', 'B'];

function mkUnits(r: Rng, n: number, unique = false): Unit[] {
  return Array.from({ length: n }, (_, i) => ({ key: `k${i}`, source: unique ? `line ${r.int(1e6)}` : r.pick(VOCAB), speaker: r.pick(SPEAKERS), kind: 'dialogue' as const, context: '' }));
}
const rekey = (us: Unit[]): Unit[] => us.map((u, i) => ({ ...u, key: `k${i}` }));
function edit(r: Rng, old: Unit[]): Unit[] {
  const u = old.map(x => ({ ...x }));
  for (let n = 1 + r.int(5); n > 0; n--) {
    const roll = r.int(5), i = r.int(Math.max(1, u.length));
    if (roll === 0) u.splice(i, 0, { key: '', source: r.pick(VOCAB), speaker: r.pick(SPEAKERS), kind: 'dialogue', context: '' });
    else if (roll === 1) u.splice(i, 1);
    else if (roll === 2 && u[i]) u[i]!.source = r.pick(VOCAB) + r.pick(['', '!', ' now']);
    else if (roll === 3 && u.length > 3) { const blk = u.splice(i, 1 + r.int(2)); u.splice(r.int(u.length + 1), 0, ...blk); }
    else if (u[i]) u[i]!.speaker = r.pick(SPEAKERS);
  }
  return rekey(u);
}
function mkEntries(r: Rng, units: Unit[]): Translations {
  const t: Translations = {};
  for (const u of units) if (r.chance(0.7)) {
    const e: Entry = { target: r.chance(0.9) ? `T:${u.source}` : '', status: r.pick(['draft', 'done', 'appr'] as const), mt: r.pick([1, 5, 100]), src: u.source };
    if (r.chance(0.1)) e.comments = [{ who: 'a', at: 1, text: 'c' }];
    t[u.key] = e;
  }
  return t;
}

test('export ingest vectors', () => {
  const r = rng(444);
  const out: Record<string, { input: unknown; output: unknown }[]> = {};
  const add = (name: string, input: unknown, output: unknown) => (out[name] ??= []).push({ input, output });

  add('consts', null, { GONE, parked: [isParked('a' + GONE), isParked('a')] });
  for (let i = 0; i < 200; i++) {
    const a = Array.from({ length: r.int(14) }, () => r.pick(VOCAB));
    const b = r.chance(0.6) ? (() => { const x = [...a]; for (let n = r.int(4); n > 0; n--) x.splice(r.int(x.length + 1), r.int(2), ...(r.chance(0.7) ? [r.pick(VOCAB)] : [])); return x; })() : Array.from({ length: r.int(14) }, () => r.pick(VOCAB));
    const maxEdits = r.pick([600, 600, 2, 5]);
    add('align', { a, b, maxEdits }, alignSources(a, b, maxEdits));
  }
  {
    const a = Array.from({ length: 700 }, (_, i) => `a${i}`), b = Array.from({ length: 700 }, (_, i) => `b${i}`);
    add('align', { a, b, maxEdits: 600 }, alignSources(a, b));
  }

  for (let i = 0; i < 160; i++) {
    const files: Record<string, Translations> = {}, old: Record<string, Unit[]> = {}, views: { name: string; units: Unit[] }[] = [];
    for (const name of ['F0.json', 'F1.json', 'F2.json']) {
      if (r.chance(0.15)) continue;
      const before = mkUnits(r, 2 + r.int(14), r.chance(0.1));
      old[name] = before;
      files[name] = mkEntries(r, before);
      // запарковані переклади з минулих оновлень
      if (r.chance(0.4)) for (let k = 0; k < 1 + r.int(3); k++) files[name]![`k${50 + k}${GONE}`] = { target: `P${k}`, status: 'draft', mt: 1, src: r.pick(VOCAB) };
      const roll = r.next();
      const after = roll < 0.1 ? before.map(u => ({ ...u })) : roll < 0.2 ? mkUnits(r, 3 + r.int(10), true) : edit(r, before);
      if (r.chance(0.7)) views.push({ name, units: after });
    }
    const snap = r.chance(0.9) ? old : undefined, now = r.pick([5, 1000]);
    const plan = planIngest(snap, views, files, now);
    add('plan', { snap: snap ?? null, views, files, now }, { plan, count: ingestCount(plan.report), quiet: ingestQuiet(plan.report), note: ingestNote(plan.report), another: looksLikeAnotherGame(snap, views, files) });
  }
  {
    const before = Array.from({ length: 700 }, (_, i) => ({ key: `k${i}`, source: `x${i}`, speaker: '', kind: 'dialogue' as const, context: '' }));
    const after = Array.from({ length: 700 }, (_, i) => ({ key: `k${i}`, source: `y${i}`, speaker: '', kind: 'dialogue' as const, context: '' }));
    const files = { 'Big.json': mkEntries(r, before) };
    const views = [{ name: 'Big.json', units: after }];
    const plan = planIngest({ 'Big.json': before }, views, files, 9);
    add('plan', { snap: { 'Big.json': before }, views, files, now: 9 }, { plan, count: ingestCount(plan.report), quiet: ingestQuiet(plan.report), note: ingestNote(plan.report), another: looksLikeAnotherGame({ 'Big.json': before }, views, files) });
  }
  writeVectors('ingest', out);
});
