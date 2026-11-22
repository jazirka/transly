import { describe, expect, it } from 'vitest';
import { proposals } from '../src/core/autofill';
import { adjLemma } from '../src/core/compose';
import type { FileView, SavedProject } from '../src/core/project';

const unit = (key: string, source: string) => ({ key, source, context: '' }) as unknown as FileView['units'][number];
const view = (units: FileView['units']): FileView => ({ name: 'Enemies', units } as unknown as FileView);
const saved = (rows: Record<string, string>, terms: unknown[] = []): SavedProject => ({ files: { Enemies: Object.fromEntries(Object.entries(rows).map(([k, t]) => [k, { target: t, status: 'done', mt: 1, history: [] }])) }, terms } as unknown as SavedProject);

describe('a line put together from parts', () => {
  const vs = [view([unit('1', 'Villager'), unit('2', 'Woodsman (left arm)'), unit('3', 'Villager [left arm]'), unit('4', 'Villager [left eye]'), unit('5', 'Woodsman (left eye)'), unit('6', 'Woodsman (right arm)')])];
  const s = saved({ '1': 'Селянин', '2': 'Лісоруб (ліва рука)', '5': 'Лісоруб (ліве око)', '6': 'Лісоруб (права рука)' });
  it('keeps the brackets, takes the words from the lines and the terms, agrees the adjective', () => {
    const p = proposals(vs, s, undefined, 50);
    const by = (k: string) => p.find(x => x.key === k)?.target;
    expect(by('3')).toBe('Селянин [ліва рука]');
    const t = proposals(vs, { ...s, terms: [{ en: 'eye', uk: 'око', gender: 'n' }] } as unknown as SavedProject, undefined, 50);
    expect(t.find(x => x.key === '4')?.target).toBe('Селянин [ліве око]');
  });
  it('knows the lemma of an adjective seen in another gender', () => {
    expect(adjLemma('ліва')).toBe('лівий');
    expect(adjLemma('ліве')).toBe('лівий');
    expect(adjLemma('рука')).not.toBe('лівий');
  });
});
