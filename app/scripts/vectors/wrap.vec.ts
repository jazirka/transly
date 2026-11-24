import { test } from 'vitest';
import { codesOf, displayLength, missingCodes, visibleText, withCodes } from '../../src/core/controlCodes';
import { hyphenPoints, isHyphenatable, syllables } from '../../src/core/hyphen';
import { DEFAULT_WRAP, wrapOf } from '../../src/core/wrapconfig';
import { MV_WINDOW, pixelBudget } from '../../src/core/gamewindow';
import { autoLineLimit, flowText, isMessageUnit, limitFor, lineFacts, linesShown, maxLineWidth, measureOf, planSig, planWrap, tooWide, unitWord, unwrap, widthOf, wrapLines, wrapMessage } from '../../src/core/wrap';
import type { FileView } from '../../src/core/project';
import { CODES, WORDS, genMessage, genPlan, genUnit, len7 } from './wrapgen';
import { rng, text, writeVectors } from './util';

test('export wrap vectors', () => {
  const r = rng(2468);
  const out: Record<string, { input: unknown; output: unknown }[]> = {};
  const add = (name: string, input: unknown, output: unknown) => (out[name] ??= []).push({ input, output });

  // керівні коди
  for (let i = 0; i < 400; i++) {
    const t = genMessage(r, 8);
    add('codes', t, { codes: codesOf(t), visible: visibleText(t), len: displayLength(t) });
  }
  for (let i = 0; i < 600; i++) {
    const source = genMessage(r, 8);
    const target = r.chance(0.5) ? source.replace(/\\[A-Za-z]+\[\d+\]|\\[{}.|!><^$]|\\\\/g, m => (r.chance(0.5) ? '' : m)) : genMessage(r, 8) + (r.chance(0.2) ? '😀 ' + genMessage(r, 3) : '');
    const miss = missingCodes(source, target);
    add('missingCodes', { source, target }, { miss, fixed: withCodes(source, target, miss) });
  }
  // власний список пропущених (зокрема кілька однакових і відсутніх в оригіналі)
  for (let i = 0; i < 100; i++) {
    const source = genMessage(r, 6), target = genMessage(r, 6), miss = Array.from({ length: 1 + r.int(3) }, () => r.pick(CODES));
    add('withCodes', { source, target, miss }, withCodes(source, target, miss));
  }

  // переноси слів
  const words = new Set<string>([...WORDS, 'а', 'я', 'ий', 'ьо', "'", 'ааа', 'ККК', 'аб', 'Привіт!', 'a', 'слово1', 'ы', 'мільйонний']);
  while (words.size < 900) words.add(Array.from({ length: 2 + r.int(8) }, () => r.pick([...'бвгґджзклмнпрстфхцчшщйь'])  + r.pick([...'аеєиіїоуюя'])).join('') + r.pick(['', 'ь', "'я", 'ся', 'ка']));
  for (const w of words) {
    add('isHyphenatable', w, isHyphenatable(w));
    for (const [a, b] of [[2, 2], [1, 1], [3, 2]] as const) add('hyphenPoints', { w, a, b }, hyphenPoints(w, a, b));
    add('syllables', w, syllables(w));
  }

  // налаштування
  const junk = [undefined, null, 5, 'x', [], {}, { mode: 'text' }, { mode: 'nope', unit: 5, hyphen: 'fill', hyphenChar: '', minLeft: 99, minRight: -3, keep: 'long', maxLines: 100, px: { width: 10, font: 1000 } }, { hyphenChar: 'ab', minLeft: 2.5, minRight: '3', maxLines: -1, px: 5 }, { hyphenChar: ' ', minLeft: 1.4999, maxLines: 11.5, px: { width: 5000.4 } }, { hyphenChar: '😀' }, { px: { width: NaN, font: Infinity } }];
  for (const w of junk) add('wrapOf', { wrap: w === undefined ? null : w }, wrapOf(w === undefined ? undefined : { wrap: w } as never));
  add('wrapOf', { wrap: 'none' }, wrapOf(undefined));
  add('defaults', null, { DEFAULT_WRAP, MV_WINDOW, budgets: [pixelBudget(false), pixelBudget(true), pixelBudget(true, { ...MV_WINDOW, width: 640 })] });

  // перенесення
  for (let i = 0; i < 900; i++) {
    const t = genMessage(r), width = r.pick([0, -1, 10, 15, 20, 25, 30, 40, 60]);
    const hyphen = r.pick(['off', 'needed', 'fill'] as const), keep = r.pick(['reflow', 'long'] as const), maxLines = r.pick([0, 2, 4]);
    const o = { width, hyphen, keep, maxLines, hyphenChar: r.pick(['-', '‐']), minLeft: r.pick([1, 2, 3]), minRight: r.pick([1, 2, 3]) };
    const px = r.chance(0.2);
    add('planWrap', { text: t, o, px }, planWrap(t, px ? { ...o, width: o.width * 7, measure: len7 } : o));
    add('wrapLines', { text: t, width }, wrapLines(t, width));
    add('unwrap', t, { unwrap: unwrap(t), flow: flowText(t), maxLineWidth: maxLineWidth(t), facts: lineFacts(t, width) });
  }
  for (const t of ['слово-\nбуде', 'слово‐\nБуде', 'a-\nb', 'слово ­\nx', 'x­\nслово', 'один\n\nдва', '  a \t\n  b  ', '']) add('unwrap', t, { unwrap: unwrap(t), flow: flowText(t), maxLineWidth: maxLineWidth(t), facts: lineFacts(t, 5) });
  for (const [l, f] of [[0, 'a'], [50, ''], [50, 'a'], [45, 'a'], [33, undefined]] as const) add('limitFor', { l, f: f ?? null }, limitFor(l, f));

  // повідомлення за планом
  for (const k of ['k1', 'L12', 'a␟L3', 'xL3', 'L', 'L1x', '␟L9']) for (const kind of ['dialogue', 'scroll', 'name']) add('isMessageUnit', { kind, key: k }, isMessageUnit({ kind, key: k }));
  add('isMessageUnit', {}, isMessageUnit({}));
  for (let i = 0; i < 700; i++) {
    const { plan, desc } = genPlan(r), unit = genUnit(r), t = genMessage(r);
    const w = wrapMessage(plan, unit, t);
    add('plan', { plan: desc, unit, text: t }, { width: widthOf(plan, unit), measure: measureOf(plan)('\\C[2]привіт!'), wrap: w, lines: linesShown(plan, unit, t), wide: tooWide(plan, unit, t), sig: planSig(plan), word: unitWord(plan), isMsg: isMessageUnit(unit) });
  }
  add('planSig', null, planSig(undefined));

  // межа за оригіналом
  for (let i = 0; i < 20; i++) {
    const n = r.pick([0, 5, 150, 400, 800]);
    const views: FileView[] = [{ name: 'a', units: Array.from({ length: n }, (_, k) => ({ key: `k${k}`, source: Array.from({ length: 1 + r.int(3) }, () => 'x'.repeat(r.int(60))).join('\n'), speaker: '', kind: r.pick(['dialogue', 'scroll', 'name', 'choice'] as const), context: '' })) }, { name: 'b', units: [{ key: 'z', source: text(r) + '\n' + text(r), speaker: '', kind: 'dialogue', context: '' }] }] as FileView[];
    add('autoLineLimit', { views }, autoLineLimit(views));
  }
  writeVectors('wrap', out);
});
