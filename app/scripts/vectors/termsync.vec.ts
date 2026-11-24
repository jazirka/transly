import { test } from 'vitest';
import type { Entry, Unit } from '../../src/core/model';
import type { FileView, SavedProject } from '../../src/core/project';
import { applySpans, proposeTermSync, termChange, termChanges } from '../../src/core/termsync';
import type { TermProposal } from '../../src/core/termsync';
import { CELLS, ukForms } from '../../src/core/ukmorph';
import { rng, writeVectors } from './util';
import type { Rng } from './util';

const PAIRS: [string, string][] = [['меч', 'клинок'], ['кіт', 'пес'], ['ґанок', 'дім'], ['вовк', 'звір'], ['залізний меч', 'сталевий клинок'], ['зелене зілля', 'червоний еліксир'], ['лицар', 'воїн'], ['книга', 'сувій'], ['сестра', 'мати'], ['місто', 'село'], ['Меч', 'Клинок'], ['чарівниця', 'відьма']];
const FILLER = ['Він узяв', 'Вона побачила', 'Дай мені', 'Поговори', 'Це', '—', 'Старий', 'Купи', 'Без', 'У', 'Біля', 'Над'];
const PREPS = ['з', 'із', 'зі', 'З', 'Зі', 'до', 'на', 'про'];
const SOURCES = ['The sword is here', 'Take the sword', 'cat and dog', 'The wolf', 'Iron sword', 'Nothing', 'He met the knight', 'sister', 'the book'];

function formOf(r: Rng, phrase: string): string {
  const f = ukForms(phrase);
  if (!f) return phrase;
  const cell = r.pick(CELLS);
  return r.pick(f[cell]?.length ? f[cell] : [phrase]);
}

test('export termsync vectors', () => {
  const r = rng(404040);
  const out: Record<string, { input: unknown; output: unknown }[]> = {};
  const add = (name: string, input: unknown, output: unknown) => (out[name] ??= []).push({ input, output });

  // termChange
  const R = [{ en: 'sword', uk: 'меч' }, { en: 'Sword', uk: ' Меч ', alt: ['клинок', "м'яч"] }, { en: 'sword', uk: 'клинок', alt: ['меч'] }, { en: 'sword', uk: 'клинок' }, { en: 'cat', uk: 'кіт' }, { en: 'sword', uk: 'мЕч' }, { en: 'sword', uk: '', alt: [' '] }, { en: 'sword', uk: 'м’яч' }, { en: 'sword', uk: "м'яч" }];
  for (let i = 0; i < 200; i++) { const prev = r.chance(0.1) ? undefined : r.pick(R), next = r.pick(R); add('termChange', { prev: prev ?? null, next }, termChange(prev, next)); }

  for (let i = 0; i < 220; i++) {
    const [o, n] = r.pick(PAIRS);
    const change = termChange({ en: 'x', uk: o }, { en: 'x', uk: n, ...(r.chance(0.2) ? { alt: [o + 'ик'] } : {}) }) ?? { en: 'sword', old: [o], next: n };
    const change2 = r.chance(0.2) ? { ...change, old: [...change.old, r.pick(PAIRS)[0]] } : change;
    if (r.chance(0.3)) change2.en = r.pick(['sword', 'cat', 'wolf', 'knight']);
    const views: FileView[] = [];
    const files: SavedProject['files'] = {};
    for (const name of ['a.json', 'b.json']) {
      const units: Unit[] = Array.from({ length: 1 + r.int(5) }, (_, k) => ({ key: `${name}:${k}`, source: r.pick(SOURCES), speaker: '', kind: 'dialogue', context: '' }));
      views.push({ name, units });
      const rows: Record<string, Entry> = {};
      for (const u of units) {
        if (!r.chance(0.85)) continue;
        const old = r.pick(change2.old);
        const parts = [r.pick(FILLER), r.chance(0.4) ? r.pick(PREPS) : '', formOf(r, old), r.chance(0.3) ? formOf(r, old) : '', r.pick(['.', '!', '', ' і ' + formOf(r, o)])].filter(Boolean);
        rows[u.key] = { target: r.chance(0.1) ? r.pick(['', ' ', 'Нічого']) : parts.join(' '), status: r.pick(['draft', 'done', 'appr'] as const), mt: 100, ...(r.chance(0.2) ? { orig: 'orig' } : {}) };
      }
      files[name] = rows;
    }
    const saved = { files } as unknown as SavedProject;
    const limit = r.pick([2000, 2, 1]);
    const res = proposeTermSync(views, saved, change2, { limit });
    // picks: some proposals, a few alt choices; one row changed before applying
    const picks = res.proposals.filter(() => r.chance(0.7)).map(p => ({ proposal: p, ...(r.chance(0.3) ? { choice: p.spans.map(s => (s.alts.length && r.chance(0.5) ? r.int(s.alts.length) : -1)) } : {}) }));
    const stale = JSON.parse(JSON.stringify(files)) as SavedProject['files'];
    if (picks.length && r.chance(0.4)) { const p = picks[0]!.proposal; stale[p.file]![p.key] = { ...stale[p.file]![p.key]!, target: 'змінено' }; }
    const changes = termChanges(picks as never, { files: stale } as unknown as SavedProject, 5000);
    const applied = res.proposals.slice(0, 3).map((p: TermProposal) => applySpans(p.before, p.spans, p.spans.map(() => 0)));
    add('sync', { change: change2, views, files, limit, pickIdx: picks.map(p => res.proposals.indexOf(p.proposal)), choices: picks.map(p => p.choice ?? null), stale }, { res, changes, applied });
  }
  writeVectors('termsync', out);
});
