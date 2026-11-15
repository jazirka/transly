import { describe, expect, it } from 'vitest';
import { hasGap, hasTerm, normalizeGap, patternParts, prepareText, sourceTermHits, targetHasTerm, targetTermHits, termMatchesIn, termRangesIn, termRangesInTarget, termsIn } from '../src/core';

const term = (en: string, uk: string, alt?: string[]) => ({ en, uk, ...(alt ? { alt } : {}) });
const texts = (source: string, hits: { start: number; end: number; parts?: [number, number][] }[]) => hits.map(h => (h.parts ?? [[h.start, h.end]]).map(([a, b]) => source.slice(a, b)));

describe('patterns: words that belong together although others stand between them', () => {
  it('reads the gap marker however it is typed', () => {
    expect(hasGap('take … off')).toBe(true);
    expect(hasGap('take ... off')).toBe(true);
    expect(hasGap('take off')).toBe(false);
    expect(patternParts('take … off')).toEqual(['take', 'off']);
    expect(patternParts('take...off')).toEqual(['take', 'off']);
    expect(patternParts('зняти …')).toEqual(['зняти']);
    expect(patternParts('… of the world')).toEqual(['of the world']);
    expect(normalizeGap('take...off')).toBe('take … off');
    expect(normalizeGap('зняти ...')).toBe('зняти …');
  });

  it('finds the parts in order and names a range for each, not for the gap', () => {
    const src = 'Take your hat off, then pick the red apple up.';
    const m = termMatchesIn(prepareText(src), 'take … off');
    expect(m).toHaveLength(1);
    expect(m[0]!.map(([a, b]) => src.slice(a, b))).toEqual(['Take', 'off']);
    expect(termRangesIn(prepareText(src), 'pick … up').map(([a, b]) => src.slice(a, b))).toEqual(['pick', 'up']);
  });

  it('allows up to four words in the gap, no more, and the parts must keep their order', () => {
    expect(hasTerm('take a b c d off', 'take … off')).toBe(true);
    expect(hasTerm('take a b c d e off', 'take … off')).toBe(false);
    expect(hasTerm('take off', 'take … off')).toBe(true);
    expect(hasTerm('off you take', 'take … off')).toBe(false);
  });

  it('does not join parts across the end of a sentence or a line', () => {
    expect(hasTerm('Take it. Then off.', 'take … off')).toBe(false);
    expect(hasTerm('Take it!\nOff you go', 'take … off')).toBe(false);
    expect(hasTerm('Take it, then off', 'take … off')).toBe(true);
  });

  it('knows the forms of the words: took, taking, takes, taken', () => {
    for (const s of ['He took his boots off.', 'Taking the ring off hurts.', 'She takes it off.', 'Having taken your hat off']) expect(hasTerm(s, 'take … off'), s).toBe(true);
    expect(hasTerm('He took the key.', 'take … off')).toBe(false);
  });

  it('is not put off by control codes in the gap', () => {
    expect(hasTerm('Take \\C[2]the hat\\C[0] off', 'take … off')).toBe(true);
    expect(hasTerm('Take \\N[1] off', 'take … off')).toBe(true);
  });

  it('lets a term stand in the gap of a pattern: both are found', () => {
    const src = 'Take your hat off, then pick the red apple up.';
    const hits = sourceTermHits(src, termsIn(src, [term('take … off', 'зняти'), term('pick … up', 'підняти'), term('hat', 'капелюх'), term('apple', 'яблуко')]));
    expect(texts(src, hits)).toEqual([['Take', 'off'], ['hat'], ['pick', 'up'], ['apple']].sort((a, b) => src.indexOf(a[0]!) - src.indexOf(b[0]!)));
    expect(hits.find(h => h.term.en === 'take … off')!.parts).toHaveLength(2);
  });

  it('a pattern that overlaps a longer or earlier hit does not take its words twice', () => {
    const src = 'Take off your coat, then take it off.';
    const hits = sourceTermHits(src, [term('take off', 'зняти'), term('take … off', 'здійняти')]);
    const spans: [number, number][] = hits.flatMap(h => h.parts ?? [[h.start, h.end] as [number, number]]);
    for (let i = 0; i < spans.length; i++) for (let j = i + 1; j < spans.length; j++) { const a = spans[i]!, b = spans[j]!; expect(a[0] < b[1] && a[1] > b[0], `${a} ${b}`).toBe(false); }
  });

  it('a plain term without a gap behaves as before', () => {
    expect(hasTerm('a health potion', 'health potion')).toBe(true);
    expect(hasTerm('health, then potion', 'health potion')).toBe(false);
    expect(termMatchesIn(prepareText('a health potion'), 'health potion')).toEqual([[[2, 15]]]);
  });
});

describe('patterns in a translation', () => {
  it('finds a Ukrainian pattern whose words stand apart, in order', () => {
    expect(targetHasTerm('Візьми ключ і відкрий двері.', 'ключ … двері')).toBe(true);
    expect(termRangesInTarget('Візьми ключ і відкрий двері.', 'ключ … двері')).toEqual([[7, 11], [22, 27]]);
    expect(targetHasTerm('Двері зачинено, потрібен ключ.', 'ключ … двері')).toBe(false);
  });

  it('allows six words between the parts, not seven', () => {
    expect(targetHasTerm('ключ а б в г д е двері', 'ключ … двері')).toBe(true);
    expect(targetHasTerm('ключ а б в г д е є двері', 'ключ … двері')).toBe(false);
  });

  it('a gap at the edge only marks where the object goes: the phrase is just its words', () => {
    expect(targetHasTerm('Зніміть капелюх', 'зніміть …')).toBe(true);
    expect(termRangesInTarget('Зніміть капелюх', 'зніміть …')).toEqual([[0, 7]]);
    expect(targetHasTerm('Одягніть капелюх', 'зніміть …')).toBe(false);
  });

  it('alternatives are patterns too, and the hits of a pattern carry their parts', () => {
    const t = term('key … door', 'ключ … двері', ['відмичка … двері']);
    expect(targetHasTerm('Скористайся відмичкою, щоб відкрити двері.', t.uk, t.alt)).toBe(true);
    const hits = targetTermHits('Візьми ключ і відкрий двері.', [t]);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.parts).toEqual([[7, 11], [22, 27]]);
  });
});

describe('patterns at scale', () => {
  it('twenty thousand lines against fifty entries stay quick: the first word of an entry is a cheap filter', () => {
    const words = 'the a hat apple take off pick up give to key door red old man woman walk run open close light dark gate road north south and then he she it you'.split(' ');
    let seed = 7;
    const rnd = (n: number) => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * n); };
    const lines = Array.from({ length: 20000 }, () => Array.from({ length: 6 + rnd(10) }, () => words[rnd(words.length)]).join(' ') + '.');
    const entries = [...Array.from({ length: 30 }, (_, i) => term(`word${i}`, `слово${i}`)), term('take … off', 'зняти'), term('pick … up', 'підняти'), term('give … to', 'дати'), term('open … door', 'відчинити'), term('walk … north', 'іти'), ...Array.from({ length: 15 }, (_, i) => term(`run${i} … gate`, `біг${i}`))];
    const t0 = Date.now();
    let hits = 0;
    for (const l of lines) hits += sourceTermHits(l, termsIn(l, entries)).length;
    const ms = Date.now() - t0;
    expect(hits).toBeGreaterThan(100);
    expect(ms).toBeLessThan(2500);
  });
});
