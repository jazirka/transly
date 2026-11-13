import { describe, expect, it } from 'vitest';
import { applyPlan, commitRows, emptyProject, isProtected, planMessage, planNote, planOf, undoJournal } from '../src/core';
import type { Entry, RowChange } from '../src/core';

const e = (target: string, status: Entry['status'], mt = 1): Entry => ({ target, status, mt });
const setup = () => {
  const p = emptyProject('P');
  p.files['M.json'] = { a: e('old a', 'appr'), b: e('old b', 'done'), c: e('old c', 'draft'), d: e('', 'new') };
  const entries = (f: string): Record<string, Entry> => (p.files[f] ??= {});
  const change = (key: string, target: string, status: Entry['status'] = 'draft'): RowChange => ({ file: 'M.json', key, next: { ...p.files['M.json']![key]!, target, status, mt: 9 }, text: target });
  return { p, entries, change };
};

describe('change plan', () => {
  it('a proofread row is protected from a change of its text or status, but approving it is no change', () => {
    expect(isProtected(e('x', 'appr'), e('y', 'draft'))).toBe(true);
    expect(isProtected(e('x', 'appr'), e('x', 'draft'))).toBe(true);
    expect(isProtected(e('x', 'appr'), e('x', 'appr'))).toBe(false);
    expect(isProtected(e('x', 'done'), e('y', 'draft'))).toBe(false);
    expect(isProtected(undefined, e('y', 'draft'))).toBe(false);
  });

  it('by default proofread rows are left out and counted; sent rows that fall back to drafts are counted', () => {
    const { entries, change } = setup();
    const plan = planOf(entries, [change('a', 'new a'), change('b', 'new b'), change('c', 'new c'), change('d', 'new d')], 'replace');
    expect(plan.changes.map(c => c.key)).toEqual(['b', 'c', 'd']);
    expect(plan.skipped).toEqual([{ file: 'M.json', key: 'a', reason: 'proofread' }]);
    expect(plan.demotes).toEqual({ appr: 0, done: 1 });
    expect(planNote(plan)).toBe('Вичитаних пропущено: 1. Надісланих стане чернетками: 1');
  });

  it('when the translator includes proofread rows they are written and counted as falling back to drafts', () => {
    const { entries, change } = setup();
    const plan = planOf(entries, [change('a', 'new a'), change('c', 'new c')], 'replace', 'include');
    expect(plan.changes.map(c => c.key)).toEqual(['a', 'c']);
    expect(plan.skipped).toEqual([]);
    expect(plan.demotes).toEqual({ appr: 1, done: 0 });
  });

  it('applying writes one action of the journal that can be taken back, and nothing for an empty plan', () => {
    const { p, entries, change } = setup();
    const commit = (changes: RowChange[], kind: Parameters<typeof commitRows>[2], what?: string): string => commitRows(entries, changes, kind, 'Ви', 10, what);
    const plan = planOf(entries, [change('a', 'new a'), change('c', 'new c')], 'replace');
    const id = applyPlan(commit, plan)!;
    expect(p.files['M.json']!.c!.target).toBe('new c');
    expect(p.files['M.json']!.a!.target).toBe('old a');          // proofread: untouched
    expect(undoJournal(p, id, 'Ви', 20).done).toBe(1);
    expect(p.files['M.json']!.c!.target).toBe('old c');
    expect(applyPlan(commit, planOf(entries, [change('a', 'x')], 'replace'))).toBeUndefined();
  });

  it('the message says what was done and what was left alone', () => {
    const { entries, change } = setup();
    const plan = planOf(entries, [change('a', 'x'), change('c', 'y')], 'replace');
    expect(planMessage(plan, plan.changes.length)).toBe('Знайдено й замінено: 1 рядок. Вичитаних пропущено: 1');
  });
});

describe('reconcile as an action', () => {
  it('sent and proofread rows with a changed original go back to drafts as one action that can be taken back; the count includes drafts', async () => {
    const { reconcileChanges, undoJournal, commitRows, journalBatches } = await import('../src/core');
    const p = emptyProject('P');
    const u = (key: string, source: string) => ({ key, source, speaker: '', kind: 'dialogue' as const, context: '' });
    p.files['M.json'] = {
      a: { target: 'т1', status: 'appr', mt: 1, src: 'old A' },
      b: { target: 'т2', status: 'done', mt: 1, src: 'old B' },
      c: { target: 'т3', status: 'draft', mt: 1, src: 'old C' },
      d: { target: 'т4', status: 'done', mt: 1, src: 'same' },
    };
    const views = [{ name: 'M.json', units: [u('a', 'new A'), u('b', 'new B'), u('c', 'new C'), u('d', 'same')] }];
    const r = reconcileChanges(views, p.files, 50);
    expect(r.changed).toBe(3);                                   // a, b, c changed their original
    expect(r.changes.map(c => c.key)).toEqual(['a', 'b']);       // only the sent and proofread ones fall back
    const entries = (f: string) => (p.files[f] ??= {});
    const id = commitRows(entries, r.changes, 'reconcile', 'Ви', 50);
    expect(p.files['M.json']!.a!.status).toBe('draft');
    expect(journalBatches(views as never, p).map(b => b.kind)).toEqual(['reconcile']);
    expect(undoJournal(p, id, 'Ви', 60).done).toBe(2);
    expect(p.files['M.json']!.a!.status).toBe('appr');
  });
});
