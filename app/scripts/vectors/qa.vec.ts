import { test } from 'vitest';
import type { Entry, Translations } from '../../src/core/model';
import { check, activeIssues, lengthDeviation, DEFAULT_QA } from '../../src/core/qa';
import type { QaOptions } from '../../src/core/qa';
import { keepFromText, keepToText, qaOf, withRuleLevel } from '../../src/core/qaconfig';
import { QA_RULES, runRules } from '../../src/core/qarules';
import { adviceCount, adviceOf, fixRule, hasAdvice, ruleStats } from '../../src/core/qaadvice';
import { approveEntry, submit } from '../../src/core/workflow';
import type { FileView } from '../../src/core/project';
import { UK } from './corpus';
import { genEntry } from './entrygen';
import { genMessage, genPlan, genUnit } from './wrapgen';
import { rng, writeVectors } from './util';
import type { Rng } from './util';

// Уламки, що вмикають кожне правило: схожі літери, пошкоджені коди, невидимі знаки, краї, апострофи, розкладені літери.
const FRAGS = [
  'Привіт', 'слово', 'Прiвіт', 'cлово', 'cлoвo', 'мoва', 'HP', 'НР', 'КС', 'ХІХ', 'ІІ', 'АТОМ', 'МАМА!', 'XIX', 'KC', 'II', 'i', 'a', 'o', 'x', 'y', 'ok', 'OK', 'ТАК', 'так',
  '\\С[2]', '\\ C[2]', '\\C [2]', '\\C[2', '\\C[x]', '\\C[', '＼C[2]', '\\N[abc]', '\\Ｖ[1]', '\\C[2]', '\\N[1]', '\\V[12]', '\\{', '\\G', '\\C[ 2 ]', '\\C[2 ]',
  "п`ять", "м'ясо", 'м’ясо', 'мʼясо', 'сл"ово', '«Так"і', '„Так”і', "п´ять", 'п‘ять', 'ім\'я', 'об’єкт',
  '​', '­', ' ', '　', ' ', ' ', '\u0085', '\u0001', '👨‍👩', 'a‍b', '﻿',
  'ы', 'э', 'ё', 'ъ', 'ґанок', 'й', 'ї', 'й', 'ї',
  ' ', ' ', ' ', '  ', '   ', '\n', ' ', '\t', '', 'sword', 'Hero', '42', 'x2', '2x', 'lv', 'HP-бар', 'м\'яч', 'ЯКОСЬ', 'Test', 'тест',
];
function genQaText(r: Rng): string {
  let s = '';
  for (let n = 1 + r.int(7); n > 0; n--) { s += r.chance(0.75) ? r.pick(FRAGS) : r.pick(UK); s += r.pick([' ', ' ', ' ', '', '  ', '\n']); }
  if (r.chance(0.3)) s = r.pick([' ', '\n', ' ']) + s;
  if (r.chance(0.3)) s += r.pick([' ', '\n', ' ', '  ']);
  return s;
}
/** Переклад із самих уламків оригіналу, щоб правила про «власні» слова й знаки спрацьовували. */
function genPair(r: Rng): { source: string; target: string } {
  const source = genQaText(r);
  const target = r.chance(0.4) ? genQaText(r) : r.chance(0.5) ? source + r.pick(FRAGS) : source.split(' ').map(w => (r.chance(0.5) ? r.pick(FRAGS) : w)).join(' ');
  return { source, target };
}
function genSettings(r: Rng): unknown {
  if (r.chance(0.3)) return null;
  const rules: Record<string, string> = {};
  for (const ru of QA_RULES) if (r.chance(0.3)) rules[ru.id] = r.pick(['off', 'warn', 'bad', 'weird']);
  if (r.chance(0.1)) rules['unknown-rule'] = 'bad';
  return { ...(r.chance(0.8) ? { rules } : {}), ...(r.chance(0.5) ? { keep: Array.from({ length: r.int(4) }, () => r.pick(['sword', ' Hero ', 'ТАК', '', 7, 'x'.repeat(41), 'ok'])) } : {}), ...(r.chance(0.6) ? { apostrophe: r.pick(['any', '’', 'ʼ', "'", 'x', '`']) } : {}) };
}
const KINDS = ['dialogue', 'scroll', 'name', 'description', 'choice', undefined];

function genOpts(r: Rng) {
  const settings = genSettings(r);
  const wrap = r.chance(0.5) ? genPlan(r) : null;
  const terms = Array.from({ length: r.int(4) }, () => ({ en: r.pick(['sword', 'Hero', 'iron sword', 'take … off']), uk: r.pick(UK.filter(w => /^\p{L}+$/u.test(w))), ...(r.chance(0.3) ? { alt: [r.pick(UK)] } : {}), ...(r.chance(0.2) ? { qa: false } : {}) }));
  const tolerancePct = r.pick([0, 10, 25, 50, 100]), lineLimit = r.pick([undefined, 0, 20, 40]);
  const desc = { tolerancePct, terms, lineLimit: lineLimit ?? null, wrap: wrap ? wrap.desc : null, settings };
  const opts: QaOptions = { tolerancePct, terms, ...(lineLimit !== undefined ? { lineLimit } : {}), ...(wrap ? { wrap: wrap.plan } : {}), ...(settings !== null ? { rules: qaOf({ qa: settings as never }) } : {}) };
  return { desc, opts };
}

const FILES = ['F0.json', 'F1.json'], KEYS = ['k0', 'k1', 'k2', 'k3', 'k4', 'k5'];
function genProject(r: Rng) {
  const views: FileView[] = FILES.map(name => ({ name, units: KEYS.filter(() => r.chance(0.85)).map(key => ({ key: r.chance(0.1) ? 'L' + key.slice(1) : key, source: genQaText(r), speaker: '', kind: r.pick(['dialogue', 'scroll', 'name', 'choice'] as const), context: '', ...(r.chance(0.2) ? { face: 'Actor1#3' } : {}) })) })) as FileView[];
  const files: Record<string, Translations> = {};
  for (const v of views) {
    files[v.name] = {};
    for (const u of v.units) if (r.chance(0.8)) {
      const e = genEntry(r);
      e.target = r.chance(0.1) ? '' : genQaText(r);
      if (r.chance(0.2)) e.ign = [r.pick(['len', 'ws-edges', 'ws-double', 'uk-apostrophe', 'codes'])];
      if (r.chance(0.3)) e.orig = 'orig';
      files[v.name]![u.key] = e;
    }
  }
  return { views, files };
}

test('export qa vectors', () => {
  const r = rng(8080);
  const out: Record<string, { input: unknown; output: unknown }[]> = {};
  const add = (name: string, input: unknown, output: unknown) => (out[name] ??= []).push({ input, output });

  // налаштування правил
  add('rules', null, QA_RULES.map(x => ({ id: x.id, title: x.title, explain: x.explain, cat: x.cat, def: x.def, fixable: x.fixable })));
  for (let i = 0; i < 150; i++) {
    const s = genSettings(r);
    const q = qaOf(s === null ? undefined : { qa: s as never });
    add('qaOf', { qa: s }, { sev: q.sev, keep: [...q.keep].sort(), apostrophe: q.apostrophe, sig: q.sig });
  }
  for (let i = 0; i < 100; i++) {
    const s = genSettings(r), id = r.pick([...QA_RULES.map(x => x.id), 'nope']), level = r.pick(['off', 'warn', 'bad'] as const);
    add('withRuleLevel', { q: s, id, level }, withRuleLevel(s === null ? undefined : (s as never), id, level));
  }
  for (const t of ['a b\nc,d;e  A', '', ' , ; ', 'x x X']) add('keepText', t, keepFromText(t));
  add('keepText2', ['a', 'b'], keepToText(['a', 'b']));
  add('keepFromBig', null, keepFromText(Array.from({ length: 600 }, (_, i) => 'w' + i).join(' ')).length);

  // правила форми
  for (let i = 0; i < 900; i++) {
    const { source, target } = genPair(r), s = genSettings(r), kind = r.pick(KINDS);
    const rules = qaOf(s === null ? undefined : { qa: s as never });
    add('runRules', { source, target, kind: kind ?? null, qa: s }, runRules(source, target, rules, kind));
  }

  // довжина й check
  for (let i = 0; i < 200; i++) { const { source, target } = genPair(r); add('lengthDeviation', { source, target }, lengthDeviation(source, target)); }
  for (let i = 0; i < 450; i++) {
    const { source, target } = r.chance(0.5) ? genPair(r) : { source: genMessage(r), target: genMessage(r) };
    const unit = genUnit(r), { desc, opts } = genOpts(r);
    const ul = { source, ...(unit.kind ? { kind: unit.kind } : {}), ...(unit.face ? { face: unit.face } : {}), ...(unit.key ? { key: unit.key } : {}) };
    add('check', { unit: ul, target, opts: desc }, check(ul as never, target, opts));
    const ign = r.chance(0.4) ? [r.pick(['len', 'codes', 'term', 'wrap', 'lines', 'ws-edges'])] : undefined;
    const entry = { target, ...(ign ? { ign } : {}) };
    add('activeIssues', { unit: ul, entry, opts: desc }, activeIssues(ul as never, entry, opts));
  }
  add('check', { unit: { source: 'x' }, target: '  ', opts: { tolerancePct: 25, terms: [], lineLimit: null, wrap: null, settings: null } }, check({ source: 'x' }, '  ', DEFAULT_QA));

  // поради по проєкту
  for (let i = 0; i < 14; i++) {
    const { views, files } = genProject(r), { desc, opts } = genOpts(r);
    const saved = { files } as never;
    const ruleId = r.pick(QA_RULES.map(x => x.id)), now = r.pick([5, 1000]);
    add('advice', { views, files, opts: desc, ruleId, now }, {
      count: adviceCount(views, saved, opts),
      rows: views.flatMap(v => v.units.map(u => ({ has: hasAdvice(u, files[v.name]?.[u.key], opts), advice: adviceOf(u, files[v.name]?.[u.key], opts).map(x => x.key) }))),
      stats: views.map(v => ruleStats(v, saved, opts)),
      fix: fixRule(views, saved, ruleId, opts, now),
      fixNone: fixRule(views, saved, 'nope', opts, now),
    });
  }

  // надсилання й затвердження
  for (let i = 0; i < 450; i++) {
    const { source, target } = genPair(r), unit = { key: r.pick(['k', 'L3']), source, speaker: '', kind: r.pick(['dialogue', 'scroll', 'name'] as const), context: '', ...(r.chance(0.2) ? { face: 'Actor1#3' } : {}) };
    const prev = r.chance(0.9) ? { ...genEntry(r), target } : undefined;
    if (prev && r.chance(0.5)) prev.status = r.pick(['draft', 'done', 'appr', 'new'] as const);
    const stage = r.pick(['translate', 'review'] as const), now = r.pick([0, 5, 1000]), blockErrors = r.chance(0.8), { desc, opts } = genOpts(r);
    const so = { blockErrors, qa: opts };
    add('submit', { prev: prev ?? null, unit, stage, now, blockErrors, opts: desc }, submit(prev as Entry | undefined, unit as never, stage, now, so));
    add('approve', { prev: prev ?? null, unit, now, blockErrors, opts: desc }, approveEntry(prev as Entry | undefined, unit as never, now, so));
  }
  writeVectors('qa', out);
});
