import { describe, expect, it } from 'vitest';
import { WordIndex, strandKind, strandsOf, termUsage } from '../src/core';
import type { Entry, FileView } from '../src/core';

const term = (en: string, uk: string, alt?: string[]) => ({ en, uk, ...(alt ? { alt } : {}) });
const unit = (key: string, source: string) => ({ key, source, speaker: '', kind: 'dialogue' as const, context: 'c' });
const entry = (target: string): Entry => ({ target, status: 'done', mt: 1 } as Entry);

const TERMS = [term('take … off', 'зняти'), term('pick … up', 'підняти'), term('hat', 'капелюх', ['шапка']), term('apple', 'яблуко')];

describe('the strands of a row', () => {
  const src = 'Take your hat off, then pick the red apple up.';

  it('one strand per entry, in the order they stand in the original, with the parts of a pattern', () => {
    const s = strandsOf(src, '', TERMS);
    expect(s.map(x => x.term.en)).toEqual(['take … off', 'hat', 'pick … up', 'apple']);
    expect(s[0]!.kind).toBe('construction');
    expect(s[0]!.src.map(([a, b]) => src.slice(a, b))).toEqual(['Take', 'off']);
    expect(s[1]!.kind).toBe('word');
    expect(s.map(x => x.ci)).toEqual([0, 1, 2, 3]);
    expect(s.every(x => x.state === 'pending' && x.dst.length === 0)).toBe(true);
  });

  it('says where the translation renders each one and how well', () => {
    const tr = 'Зніміть шапку, потім підніміть яблуко.';
    const s = strandsOf(src, tr, TERMS);
    const by = (en: string) => s.find(x => x.term.en === en)!;
    expect(by('hat').state).toBe('alt');
    expect(by('hat').dst.map(([a, b]) => tr.slice(a, b))).toEqual(['шапку']);
    expect(by('apple').state).toBe('ok');
    expect(by('pick … up').state).toBe('missing');
    expect(by('pick … up').dst).toEqual([]);
  });

  it('knows a word from a phrase from a construction', () => {
    expect(strandKind('hat')).toBe('word');
    expect(strandKind('health potion')).toBe('phrase');
    expect(strandKind('take … off')).toBe('construction');
    expect(strandKind('Wait...')).toBe('word');
  });

  it('a row with more entries than colours wraps round', () => {
    const many = Array.from({ length: 8 }, (_, i) => term(`w${i}`, `с${i}`));
    const s = strandsOf(many.map(t => t.en).join(' '), '', many);
    expect(s.map(x => x.ci)).toEqual([0, 1, 2, 3, 4, 5, 0, 1]);
  });
});

describe('how an entry is used across the game', () => {
  const views: FileView[] = [{ name: 'A.json', units: [
    unit('a', 'Take your hat off.'), unit('b', 'He took his boots off.'), unit('c', 'Please take the cloak off.'), unit('d', 'Take it off!'), unit('e', 'Take the key.'), unit('f', 'We are taking all of it off now.'),
  ] }];
  const saved = { files: { 'A.json': { a: entry('Треба зняти капелюх.'), b: entry('Він здійняв чоботи.'), c: entry('Можна зняти плащ.'), f: entry('Ми знімаємо') } } };
  const ix = WordIndex.of(views);

  it('finds the rows whatever the form of the verb, and counts the renderings', () => {
    const u = termUsage(ix, saved as never, TERMS[0]!);
    expect(u.rows.map(r => r.key)).toEqual(['a', 'b', 'c', 'd', 'f']);
    expect(u.main).toBe(2);
    expect(u.other).toBe(2);
    expect(u.otherRows.map(r => r.key)).toEqual(['b', 'f']);
    expect(u.none).toBe(1);
  });

  it('leaves out the open row', () => {
    expect(termUsage(ix, saved as never, TERMS[0]!, { file: 'A.json', key: 'a' }).rows.map(r => r.key)).toEqual(['b', 'c', 'd', 'f']);
  });

  it('counts an alternative apart from the main rendering', () => {
    const v: FileView[] = [{ name: 'B.json', units: [unit('x', 'A hat.'), unit('y', 'The hat fell.'), unit('z', 'My hat.')] }];
    const sv = { files: { 'B.json': { x: entry('Капелюх.'), y: entry('Шапка впала.'), z: entry('Ковпак.') } } };
    const u = termUsage(WordIndex.of(v), sv as never, TERMS[2]!);
    expect([u.main, u.alt, u.other]).toEqual([1, 1, 1]);
  });

  it('is built in slices without changing the answer', async () => {
    let pauses = 0;
    const sliced = await WordIndex.build(views, async () => { pauses++; }, 2);
    expect(pauses).toBe(3);
    expect(termUsage(sliced, saved as never, TERMS[0]!).rows.map(r => r.key)).toEqual(['a', 'b', 'c', 'd', 'f']);
  });
});
