import { test } from 'vitest';
import type { Entry, Translations, Unit } from '../../src/core/model';
import { almost, learnDetailed, learnWords, plausible, proposals, tokenize, trusted } from '../../src/core/autofill';
import { AUTO_NOTE, autoBatches, autoNote, autoUndone, isAutoFilled, undoAuto } from '../../src/core/autolog';
import { adjLemma, buildLexicon, composeLine } from '../../src/core/compose';
import type { FileView, SavedProject } from '../../src/core/project';
import { emptyProject } from '../../src/core/project';
import { rng } from './util';
import { writeVectors } from './util';
import type { Rng } from './util';

// слово → українські форми (перша — основна): іменники, прикметники в різних родах і відмінках
const LEX: Record<string, string[]> = {
  sword: ['меч', 'меча'], shield: ['щит'], iron: ['залізний', 'залізна', 'залізне'], steel: ['сталевий', 'сталева'], left: ['лівий', 'ліва', 'ліве'], right: ['правий', 'права'],
  arm: ['рука', 'руку'], leg: ['нога'], villager: ['селянин', 'селянина'], hero: ['герой'], potion: ['зілля'], red: ['червоний', 'червона'], big: ['великий', 'велика', 'велике'],
  house: ['будинок'], door: ['двері'], key: ['ключ'], gold: ['золото'], old: ['старий', 'стара'], man: ['чоловік'], woman: ['жінка'], king: ['король'], castle: ['замок'],
  tower: ['вежа'], gate: ['ворота'], dragon: ['дракон'], fire: ['вогонь'], ice: ['лід'], small: ['малий', 'мала'], game: ['гра', 'гру'], new: ['новий', 'нова', 'нове'],
};
const EN = Object.keys(LEX);
const PUNCT = [',', '.', '!', '?', ':', '-', '...', '"'];
const CODES = ['\\C[2]', '\\N[1]', '\\{', '\\V[3]'];

function genSource(r: Rng): string {
  const parts: string[] = [];
  for (let n = 1 + r.int(r.chance(0.2) ? 9 : 4); n > 0; n--) {
    const w = r.pick(EN);
    parts.push(r.chance(0.2) ? w[0]!.toUpperCase() + w.slice(1) : r.chance(0.05) ? w.toUpperCase() : w);
    if (r.chance(0.15)) parts.push(r.pick(PUNCT));
    if (r.chance(0.1)) parts.push(r.pick(CODES));
    if (r.chance(0.08)) parts.push(String(r.int(100)));
    if (r.chance(0.05)) parts.push(r.pick(['xyz', 'foo', 'Zed']));
  }
  let s = parts.join(r.pick([' ', ' ', ' ', '  ']));
  if (r.chance(0.1)) s = `${s} [${r.pick(EN)} ${r.pick(EN)}]`;
  return s;
}
/** Переклад тієї ж форми: кожне слово замінено українським, решта лишилась. */
function translate(r: Rng, src: string): string {
  return src.replace(/[A-Za-z]+/g, w => {
    const forms = LEX[w.toLowerCase()];
    if (!forms) return w;
    const f = r.chance(0.8) ? forms[0]! : r.pick(forms);
    return w[0] === w[0]!.toUpperCase() && w !== w.toUpperCase() ? f[0]!.toUpperCase() + f.slice(1) : w === w.toUpperCase() && w.length > 1 ? f.toUpperCase() : f;
  });
}

function genProject(r: Rng) {
  const p: SavedProject = emptyProject('x');
  const views: FileView[] = [];
  const sources: string[] = [];
  for (let f = 0; f < 1 + r.int(2); f++) {
    const name = `F${f}.json`, units: Unit[] = [], ents: Translations = {};
    for (let k = 0; k < 4 + r.int(25); k++) {
      const key = `k${k}`;
      const source = r.chance(0.2) && sources.length ? r.pick(sources) : genSource(r);
      sources.push(source);
      units.push({ key, source, speaker: '', kind: 'dialogue', context: '' });
      const roll = r.next();
      if (roll < 0.55) {
        const target = r.chance(0.1) ? translate(r, source).repeat(3) : r.chance(0.08) ? 'інше' : translate(r, source);
        const e: Entry = { target, status: r.pick(['done', 'appr', 'draft', 'draft', 'new'] as const), mt: 10 };
        const auto = r.chance(0.12);
        if (auto) { e.status = 'draft'; e.history = [{ at: r.pick([10, 100, 200000, 400000]), who: 'x', what: r.pick([AUTO_NOTE.words, AUTO_NOTE.twin, 'автозаповнено з однакового рядка', 'підставлено з пам’яті перекладів (90%)', 'x']), text: target, ...(r.chance(0.2) ? { batch: 'b1' } : {}) }]; e.mt = r.pick([5, 10, 300000]); }
        if (r.chance(0.05)) e.target = r.pick([' ', '']);
        ents[key] = e;
      }
    }
    p.files[name] = ents;
    views.push({ name, units });
  }
  const nT = r.int(5);
  for (let i = 0; i < nT; i++) {
    const en = r.pick(EN), forms = LEX[en]!;
    p.terms.push({ en: r.chance(0.15) ? `${en} ${r.pick(EN)}` : en, uk: r.chance(0.8) ? forms[0]! : r.pick(forms), mt: 1, ...(r.chance(0.5) ? { gender: r.pick(['m', 'f', 'n', 'p']) } : {}) } as never);
  }
  return { p, views };
}
const entries = <K, V>(m: Map<K, V>) => [...m.entries()];

test('export autofill vectors', () => {
  const r = rng(1357);
  const out: Record<string, { input: unknown; output: unknown }[]> = {};
  const add = (name: string, input: unknown, output: unknown) => (out[name] ??= []).push({ input, output });

  for (const t of ['', 'Hello, \\C[2]world\\C[0] 25!', "don't-stop 'x’ a-b", '\\{big\\} text', 'ḣéllo  😀 ok', '\u0085x﻿y', 'Привіт [світ]']) add('tokenize', t, tokenize(t));
  for (let i = 0; i < 100; i++) { const t = genSource(r) + (r.chance(0.3) ? ' 😀 ' + genSource(r) : ''); add('tokenize', t, tokenize(t)); }

  for (let i = 0; i < 250; i++) {
    const source = genSource(r), target = r.chance(0.5) ? translate(r, source) : r.chance(0.5) ? translate(r, source).repeat(r.pick([2, 4])) : 'x';
    add('plausible', { source, target }, plausible(source, target));
  }
  for (const [s, t] of [['short', 'x'], ['a long enough source line here', 'м'], ['one two three four five six', 'один']]) add('plausible', { source: s, target: t }, plausible(s, t));

  for (const w of ['ліва', 'лівий', 'ліве', 'меч', 'залізна', 'велике', 'нова', 'рука', 'малий', 'мала', 'слово', 'біла', 'x', 'я', 'її', 'сталеві']) add('adjLemma', w, adjLemma(w));

  for (let i = 0; i < 70; i++) {
    const { p, views } = genProject(r), drafts = r.chance(0.3);
    const learned = learnDetailed(views, p, { drafts });
    const rows = views.flatMap(v => v.units.map(u => ({ key: u.key, trusted: trusted(p.files[v.name]?.[u.key], drafts), auto: isAutoFilled(p.files[v.name]?.[u.key]) })));
    const dict = learnWords(views, p, { drafts });
    const wholeMap = new Map(views.flatMap(v => v.units.filter(u => trusted(p.files[v.name]?.[u.key], drafts)).map(u => [u.source.trim().toLowerCase(), p.files[v.name]![u.key]!.target.trim()] as const)));
    const lex = buildLexicon(wholeMap, dict, p);
    const lines = views.flatMap(v => v.units.map(u => composeLine(u.source, lex, p, 10)));
    add('learn', { views, p, drafts }, {
      dict: entries(learned.dict), ambiguous: entries(learned.ambiguous), whole: entries(wholeMap), rows,
      lex: entries(lex), lines,
      proposals: proposals(views, p, undefined, 500, { drafts }), proposalsSmall: proposals(views, p, learned.dict, 3, { drafts }),
      almost: almost(views, p), almostSmall: almost(views, p, learned, 2),
    });
  }

  // журнал автозаповнень
  for (let i = 0; i < 50; i++) {
    const { p, views } = genProject(r);
    for (const ents of Object.values(p.files)) for (const e of Object.values(ents)) if (r.chance(0.5)) {
      const at = r.pick([1000, 2000, 100000, 190000, 400000, 400500]);
      e.history = [...(e.history ?? []), { at, who: 'x', what: r.pick([AUTO_NOTE.words, AUTO_NOTE.words, AUTO_NOTE.twin, 'автозаповнення скасовано', 'підстановку скасовано', 'x']), text: e.target }];
      e.mt = r.pick([at, at - 1, at + 1]);
    }
    const limit = r.pick([20, 1, 2]), batches = autoBatches(views, p, limit);
    const copy = JSON.parse(JSON.stringify(p)) as SavedProject;
    const done = batches.map(b => undoAuto(copy, b, 'Анна', 5000));
    add('autolog', { views, files: p.files, limit }, { batches, done, after: copy.files, undone: autoUndone(views, copy), undoneSmall: autoUndone(views, copy, 1), notes: [autoNote(0), autoNote(3)] });
  }
  writeVectors('autofill', out);
});
