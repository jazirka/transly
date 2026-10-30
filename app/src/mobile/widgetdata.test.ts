import { describe, expect, it } from 'vitest';
import { buildWidget } from './widgetdata';
import type { FileView, SavedProject } from '../core';

const u = (key: string, kind = 'dialogue') => ({ key, source: 'S ' + key, speaker: '', kind, context: '' });
const views = [{ name: 'A.json', units: ['1', '2', '3', '4', '5'].map(k => u(k)) } as unknown as FileView, { name: 'B.json', units: [u('x')] } as unknown as FileView];
const now = new Date(2026, 9, 30, 12, 0).getTime();
const at = (daysAgo: number) => now - daysAgo * 86_400_000;
const saved = {
  name: 'P',
  files: { 'A.json': {
    2: { target: 'T2', status: 'draft', mt: at(0), history: [{ at: at(1), who: 'я', what: 'правка', text: '' }] },
    3: { target: 'T3', status: 'done', mt: at(0), history: [{ at: at(0), who: 'я', what: 'надіслано на вичитування', text: '' }] },
    4: { target: 'T4', status: 'draft', mt: at(2), history: [{ at: at(2), who: 'я', what: 'автозаповнено за словами', text: '' }] },
  } },
} as unknown as SavedProject;

describe('widget data', () => {
  const w = buildWidget(views, saved, { file: 'A.json', key: '2' }, now);
  it('counts and queues by mode', () => {
    expect(w.counts).toEqual({ new: 3, draft: 1, auto: 1, waiting: 1 });
    expect(w.queue.new.map(r => r.key)).toEqual(['5', '1', 'x']); // rows after the open one first, then wrap, then other files
    expect(w.queue.auto.map(r => r.key)).toEqual(['4']);
  });
  it('current row, days, streak', () => {
    expect(w.cur).toMatchObject({ key: '2', pos: 2, of: 5, t: 'T2' });
    expect(w.days).toEqual([0, 0, 0, 0, 1, 1, 2]);
    expect(w.today).toBe(w.days[6]);
    expect(w.streak).toBe(2);
    expect(w.next?.key).toBe('5');
  });
});
