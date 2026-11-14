import { describe, expect, it } from 'vitest';
import { sendBatches, undoBatch, undoneBatches } from '../src/core';
import type { FileView, SavedProject } from '../src/core';

const unit = (key: string) => ({ key, source: 'S' + key, speaker: '', kind: 'name' as const, context: '' });
const views = [{ name: 'A.json', units: ['1', '2', '3', '4', '5'].map(unit) } as unknown as FileView];
const sent = (at: number, what = 'надіслано на вичитування') => ({ target: 'T', status: 'done', mt: at, history: [{ at, who: 'я', what, text: 'T' }] });
const saved = (files: Record<string, unknown>): SavedProject => ({ files: { 'A.json': files } } as unknown as SavedProject);
const MIN = 60_000, t0 = 10_000_000;

describe('undo of a send: the safety checks', () => {
  it('a row edited after the send keeps its text and status when the old batch is undone', () => {
    const sv = saved({ 1: sent(t0), 2: sent(t0) });
    const batch = sendBatches(views, sv).find(b => !b.guessed)!;
    expect(batch.items).toHaveLength(2);
    sv.files['A.json']!['2'] = { ...sv.files['A.json']!['2']!, target: 'змінено після', mt: t0 + 5 };
    expect(undoBatch(sv, batch, 'я', t0 + 99)).toBe(1);
    expect(sv.files['A.json']!['1']!.status).toBe('draft');
    expect(sv.files['A.json']!['2']).toMatchObject({ status: 'done', target: 'змінено після' });
  });
  it('a send is never undone as an approval, and an approval never as a send', () => {
    const sv = saved({ 1: sent(t0) });
    const batch = sendBatches(views, sv)[0]!;
    sv.files['A.json']!['1'] = { ...sent(t0, 'вичитано'), status: 'appr' } as never;
    expect(undoBatch(sv, batch, 'я', t0 + 1)).toBe(0);
    expect((sv.files['A.json']!['1'] as { status: string }).status).toBe('appr');
  });
  it('a guessed batch is undone only for rows still waiting for review and unchanged since', () => {
    const sv = saved({ 1: { target: 'T', status: 'done', mt: t0 }, 2: { target: 'T', status: 'done', mt: t0 + 1000 } });
    const batch = sendBatches(views, sv)[0]!;
    expect(batch.guessed).toBe(true);
    sv.files['A.json']!['1'] = { target: 'T', status: 'appr', mt: t0 };
    sv.files['A.json']!['2'] = { target: 'T2', status: 'done', mt: t0 + 7000 };
    expect(undoBatch(sv, batch, 'я', t0 + 99)).toBe(0);
  });
  it('rows sent within 3 minutes of each other are one batch; 3 minutes and 1 ms apart are two', () => {
    const together = saved({ 1: sent(t0), 2: sent(t0 + 3 * MIN) });
    expect(sendBatches(views, together).map(b => b.items.length)).toEqual([2]);
    const apart = saved({ 1: sent(t0), 2: sent(t0 + 3 * MIN + 1) });
    expect(sendBatches(views, apart).map(b => b.items.length)).toEqual([1, 1]);
  });
  it('sends and approvals made together are listed as separate batches, newest first, and the list is limited', () => {
    const sv = saved({ 1: sent(t0), 2: { ...sent(t0 + 1000, 'вичитано'), status: 'appr' }, 3: sent(t0 + 10 * MIN), 4: sent(t0 + 20 * MIN) });
    const b = sendBatches(views, sv);
    expect(b.map(x => x.kind)).toEqual(['send', 'send', 'approve', 'send']);
    expect(b.map(x => x.at)).toEqual([t0 + 20 * MIN, t0 + 10 * MIN, t0 + 1000, t0]);
    expect(sendBatches(views, sv, 2).map(x => x.at)).toEqual([t0 + 20 * MIN, t0 + 10 * MIN]);
  });
});

describe('undoneBatches: the list of cancelled sends', () => {
  const cancelled = (at: number, what: string) => ({ target: 'T', status: 'draft', mt: at, history: [{ at, who: 'я', what, text: 'T' }] });
  it('groups cancelled sends and approvals made close together, newest first', () => {
    const sv = saved({ 1: cancelled(t0, 'надсилання скасовано'), 2: cancelled(t0 + MIN, 'надсилання скасовано'), 3: cancelled(t0 + 10 * MIN, 'вичитування скасовано'), 4: cancelled(t0 + 20 * MIN, 'надсилання скасовано'), 5: { target: 'x', status: 'draft', mt: 1, history: [{ at: 1, who: 'я', what: 'правка', text: 'x' }] } });
    expect(undoneBatches(views, sv)).toEqual([
      { kind: 'send', at: t0 + 20 * MIN, count: 1 }, { kind: 'approve', at: t0 + 10 * MIN, count: 1 }, { kind: 'send', at: t0 + MIN, count: 2 },
    ]);
    expect(undoneBatches(views, sv, 2).map(x => x.at)).toEqual([t0 + 20 * MIN, t0 + 10 * MIN]);
  });
  it('a send and an approval undone together are not merged into one entry', () => {
    const sv = saved({ 1: cancelled(t0, 'надсилання скасовано'), 2: cancelled(t0 + 1000, 'вичитування скасовано') });
    expect(undoneBatches(views, sv).map(x => [x.kind, x.count])).toEqual([['approve', 1], ['send', 1]]);
  });
  it('after undoBatch the cancelled rows show up here', () => {
    const sv = saved({ 1: sent(t0), 2: sent(t0) });
    undoBatch(sv, sendBatches(views, sv)[0]!, 'я', t0 + 5000);
    expect(undoneBatches(views, sv)).toEqual([{ kind: 'send', at: t0 + 5000, count: 2 }]);
  });
});
