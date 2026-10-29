import { describe, expect, it } from 'vitest';
import { almost, learnWords, proposals, tokenize } from './autofill';
import type { FileView, SavedProject } from './project';

const unit = (key: string, source: string) => ({ key, source, speaker: '', kind: 'name' as const, context: '' });
const view = (units: ReturnType<typeof unit>[]): FileView => ({ name: 'Items.json', units } as unknown as FileView);
const saved = (targets: Record<string, string>, terms: { en: string; uk: string }[] = []): SavedProject => ({
  files: { 'Items.json': Object.fromEntries(Object.entries(targets).map(([k, t]) => [k, { target: t, status: 'draft', mt: 1 }])) },
  terms: terms.map(t => ({ ...t, mt: 1 })),
} as unknown as SavedProject);

describe('autofill by words', () => {
  const views = [view([unit('a', 'Janitor [right leg]'), unit('b', 'Woodsman (left arm)'), unit('c', 'Janitor (left arm)'), unit('d', 'Woodsman [right leg]'), unit('e', 'Janitor (right foot)')])];
  const s = saved({ a: 'Прибиральник [права нога]', b: 'Лісоруб (ліва рука)' });

  it('tokenize keeps brackets and words apart', () => {
    expect(tokenize('Janitor [right leg]').map(t => t.text)).toEqual(['Janitor', '[', 'right', 'leg', ']']);
  });
  it('learns the words of two translated lines and fills lines made only of them', () => {
    const p = proposals(views, s);
    expect(p.map(x => [x.key, x.target])).toEqual([['c', 'Прибиральник (ліва рука)'], ['d', 'Лісоруб [права нога]']]);
  });
  it('a line with an unknown word is left alone', () => {
    expect(proposals(views, s).some(x => x.key === 'e')).toBe(false);
  });
  it('lines of a different shape teach nothing', () => {
    const d = learnWords([view([unit('x', 'Big sword')])], saved({ x: 'Меч' }));
    expect(d.size).toBe(0);
  });
  it('ambiguous words are dropped, glossary terms win', () => {
    const vs = [view([unit('1', 'Red cat'), unit('2', 'Red dog'), unit('3', 'Red cow'), unit('4', 'Red rat')])];
    const amb = learnWords(vs, saved({ 1: 'Руда кішка', 2: 'Червоний пес', 3: 'Рудий віл', 4: 'Рожева щур' }));
    expect(amb.has('red')).toBe(false);
    const withTerm = learnWords(vs, saved({ 1: 'Руда кішка', 2: 'Червоний пес' }, [{ en: 'Red', uk: 'Червоний' }]));
    expect(withTerm.get('red')).toBe('червоний');
  });

  it('explains what blocks a line: an ambiguous word and an unknown one', () => {
    const vs = [view([unit('1', 'Woodsman [head]'), unit('2', 'Woodsman [torso]'), unit('4', 'Woodsman [head] '), unit('5', 'Guard [torso]')])];
    const sv = saved({ 1: 'Лісник [голова]', 2: 'Лісоруб [тулуб]' });
    expect(proposals(vs, sv).map(p => p.key)).toEqual([]);
    const a = almost(vs, sv);
    expect(a.map(x => [x.key, x.blockers.map(b => `${b.word}:${b.reason}`)])).toEqual([['4', ['Woodsman:ambiguous']], ['5', ['Guard:unknown']]]);
    expect(a[0]!.blockers[0]!.variants.sort()).toEqual(['лісник', 'лісоруб']);
    // a glossary term settles the ambiguity and the line is composed
    const fixed = saved({ 1: 'Лісник [голова]', 2: 'Лісоруб [тулуб]' }, [{ en: 'Woodsman', uk: 'Лісник' }]);
    expect(proposals(vs, fixed).map(p => [p.key, p.target])).toEqual([['4', 'Лісник [голова]']]);
  });
});
