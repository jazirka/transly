import { describe, expect, it } from 'vitest';
import { TmIndex, similarity } from '../src/core';

const rnd = (() => { let s = 7; return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296; })();
const WORDS = Array.from({ length: 150 }, (_, i) => 'word' + i.toString(36));
const sentence = (n: number): string => Array.from({ length: n }, () => WORDS[Math.floor(rnd() * WORDS.length)]!).join(' ');

describe('similarity with a floor', () => {
  it('is exact whenever the pair reaches the floor and below it otherwise', () => {
    for (let i = 0; i < 400; i++) {
      const a = sentence(3 + Math.floor(rnd() * 8)), b = rnd() < 0.5 ? sentence(3 + Math.floor(rnd() * 8)) : a.replace(/word/g, () => (rnd() < 0.2 ? 'wurd' : 'word'));
      const full = similarity(a, b);
      for (const min of [50, 70, 85]) {
        const cut = similarity(a, b, min);
        if (full >= min) expect(cut).toBe(full); else expect(cut).toBeLessThan(min);
      }
    }
  });
});

describe('translation memory lookups', () => {
  it('a bulk fill over a big memory of near-duplicate lines stays fast', () => {
    const tm = new TmIndex();
    const bases = Array.from({ length: 40 }, () => sentence(25 + Math.floor(rnd() * 15)));
    const vary = (b: string): string => b.split(' ').map(w => (rnd() < 0.15 ? WORDS[Math.floor(rnd() * WORDS.length)]! : w)).join(' ');
    for (let i = 0; i < 5600; i++) { const s = vary(bases[i % bases.length]!); tm.add({ s, t: 'T ' + s, src: 'x' }); }
    const queries = Array.from({ length: 300 }, (_, i) => vary(bases[i % bases.length]!));
    const t0 = Date.now();
    for (const q of queries) tm.find(q, { min: 70, limit: 1 });
    const ms = Date.now() - t0;
    console.log('300 lookups:', ms, 'ms');
    expect(ms).toBeLessThan(2500);
  });
});

describe('long texts in the memory', () => {
  it('a lookup among many 900-letter messages stays fast and still finds the near copy', () => {
    const tm = new TmIndex();
    const base = Array.from({ length: 150 }, () => sentence(1)).join(' ');
    for (let i = 0; i < 400; i++) { const s = Array.from({ length: 150 }, () => WORDS[Math.floor(rnd() * 60)]!).join(' '); tm.add({ s, t: 'T ' + s, src: 'x' }); }
    tm.add({ s: base, t: 'ПЕРЕКЛАД', src: 'x' });
    const near = base.split(' '); near[40] = 'changed'; near[90] = 'other';
    const t0 = Date.now();
    let hit: ReturnType<TmIndex['find']>[number] | undefined;
    for (let i = 0; i < 20; i++) hit = tm.find(near.join(' '), { min: 70, limit: 1 })[0];
    const ms = Date.now() - t0;
    expect(hit?.t).toBe('ПЕРЕКЛАД');
    expect(hit?.score).toBeGreaterThan(95);
    expect(ms).toBeLessThan(1500);
  });
});
