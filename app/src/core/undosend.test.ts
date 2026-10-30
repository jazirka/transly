import { describe, expect, it } from 'vitest';
import { sendBatches, undoBatch } from './undosend';
import type { FileView, SavedProject } from './project';

const unit = (key: string) => ({ key, source: 'S' + key, speaker: '', kind: 'name' as const, context: '' });
const views = [{ name: 'A.json', units: ['1', '2', '3', '4'].map(unit) } as unknown as FileView];
const sent = (at: number, what = 'надіслано на вичитування') => ({ target: 'T', status: 'done', mt: at, history: [{ at, who: 'я', what, text: 'T' }] });
const saved = (files: Record<string, unknown>): SavedProject => ({ files: { 'A.json': files } } as unknown as SavedProject);

describe('undo of a send', () => {
  const t0 = 1_000_000;
  const s = () => saved({ 1: sent(t0), 2: sent(t0), 3: sent(t0 + 10 * 60_000), 4: { target: 'x', status: 'draft', mt: 1, history: [{ at: 5, who: 'я', what: 'правка', text: 'x' }] } });
  it('groups rows sent together, newest batch first, ignores rows that were not sent', () => {
    const b = sendBatches(views, s());
    expect(b.map(x => x.items.length)).toEqual([1, 2]);
    expect(b[1]!.kind).toBe('send');
  });
  it('a row edited after the send is no longer part of it', () => {
    const sv = s(); (sv.files['A.json']!['1'] as { history: unknown[] }).history.push({ at: t0 + 5, who: 'я', what: 'правка', text: 'z' });
    expect(sendBatches(views, sv).map(x => x.items.length)).toEqual([1, 1]);
  });
  it('undo returns the rows to drafts and records it', () => {
    const sv = s(); const batch = sendBatches(views, sv)[1]!;
    expect(undoBatch(sv, batch, 'я', t0 + 99)).toBe(2);
    expect(sv.files['A.json']!['1']!.status).toBe('draft');
    expect(sv.files['A.json']!['1']!.history!.at(-1)!.what).toBe('надсилання скасовано');
    expect(sendBatches(views, sv).length).toBe(1);
  });
  it('approvals are undone to «waiting for review»', () => {
    const sv = saved({ 1: { ...sent(t0, 'вичитано'), status: 'appr' } });
    const b = sendBatches(views, sv)[0]!; expect(b.kind).toBe('approve');
    undoBatch(sv, b, 'я', t0 + 1); expect(sv.files['A.json']!['1']!.status).toBe('done');
  });
});
