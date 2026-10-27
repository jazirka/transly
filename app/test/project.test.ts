import { describe, expect, it, vi } from 'vitest';
import { Autosave, DupIndex, MemoryStore, deserialize, edit, emptyProject, mergeProjects, propagate, reconcile, serialize, sendBack, statsOf, submit } from '../src/core';
import type { Entry, FileView, SavedProject, Unit } from '../src/core';

const unit = (source = 'Where are you going?', key = 'k1'): Unit => ({ key, source, speaker: '', kind: 'dialogue', context: 'x' });

describe('workflow', () => {
  it('edit: empty text is new, text becomes draft, editing a finished row reopens it in the translate pass', () => {
    const u = unit();
    let e = edit(undefined, u, 'Куди ти йдеш?', 'translate', 10);
    expect(e).toMatchObject({ status: 'draft', mt: 10, src: u.source });
    const sent = submit(e, u, 'translate', 20);
    expect(sent.ok && sent.entry.status).toBe('done');
    e = (sent as { entry: Entry }).entry;
    expect(edit(e, u, 'Куди йдеш?', 'translate', 30).status).toBe('draft');
    expect(edit(e, u, 'Куди йдеш?', 'review', 30).status).toBe('done');
    expect(edit(e, u, '', 'translate', 40).status).toBe('new');
  });

  it('submit blocks QA errors but allows warnings', () => {
    const u = unit('Take the \\C[2]key\\C[0].');
    const bad = edit(undefined, u, 'Візьми ключ.', 'translate', 1);
    const r = submit(bad, u, 'translate', 2);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toContain('\\C[2]');
    const ok = edit(undefined, u, 'Візьми \\C[2]ключ\\C[0].', 'translate', 1);
    expect(submit(ok, u, 'translate', 2).ok).toBe(true);
    const long = edit(undefined, unit('Hi'), 'Привіт, любий друже!', 'translate', 1);
    expect(submit(long, unit('Hi'), 'translate', 2).ok).toBe(true);
  });

  it('review: approve only after sending to review; sendBack returns to draft', () => {
    const u = unit();
    const draft = edit(undefined, u, 'Куди ти йдеш?', 'translate', 1);
    expect(submit(draft, u, 'review', 2).ok).toBe(false);
    const done = (submit(draft, u, 'translate', 2) as { entry: Entry }).entry;
    const appr = (submit(done, u, 'review', 3) as { entry: Entry }).entry;
    expect(appr.status).toBe('appr');
    expect(sendBack(appr, 4)).toMatchObject({ status: 'draft', returned: true });
  });

  it('reconcile: a changed original downgrades finished units to draft', () => {
    const u = unit('A');
    const entries: Record<string, Entry> = { k1: { target: 'Б', status: 'appr', mt: 1, src: 'A' } };
    expect(reconcile([u], entries, 5)).toEqual([]);
    const changed = { ...u, source: 'A!' };
    expect(reconcile([changed], entries, 6)).toEqual(['k1']);
    expect(entries.k1).toMatchObject({ status: 'draft', mt: 6 });
  });
});

describe('project', () => {
  const e = (target: string, mt: number): Entry => ({ target, status: 'draft', mt });
  const proj = (files: SavedProject['files'], epoch = 0): SavedProject => ({ ...emptyProject('T'), files, resetEpoch: epoch });

  it('serialize round-trips and deserialize rejects broken input', () => {
    const p = proj({ 'Map001.json': { a: e('x', 5) } });
    expect(deserialize(serialize(p))).toEqual(p);
    expect(() => deserialize('nope')).toThrow(/пошкоджено/);
    expect(() => deserialize('{"version":9,"name":"x","files":{}}')).toThrow(/версі/);
  });

  it('statsOf counts translated, done, approved', () => {
    const units = [unit('a', 'a'), unit('b', 'b'), unit('c', 'c')];
    const s = statsOf(units, { a: { target: 'А', status: 'done', mt: 1 }, b: { target: 'Б', status: 'appr', mt: 1 } });
    expect(s).toEqual({ total: 3, translated: 2, done: 1, approved: 1 });
  });

  it('mergeProjects keeps the newer edit per unit, reports conflicts and honours resets', () => {
    const pc = proj({ 'F.json': { a: e('pc', 10), b: e('only-pc', 5) } });
    const phone = proj({ 'F.json': { a: e('phone', 20), c: e('only-phone', 6) } });
    const { project, conflicts } = mergeProjects(pc, phone);
    expect(project.files['F.json']).toMatchObject({ a: { target: 'phone' }, b: { target: 'only-pc' }, c: { target: 'only-phone' } });
    expect(conflicts).toEqual([{ file: 'F.json', key: 'a' }]);
    const reset = proj({}, 20);
    const afterReset = mergeProjects(pc, reset).project;
    expect(afterReset.resetEpoch).toBe(20);
    expect(Object.keys(afterReset.files['F.json'] ?? {})).toEqual([]);
  });
});

describe('storage', () => {
  it('MemoryStore saves and loads', async () => {
    const s = new MemoryStore();
    expect(await s.load()).toBeNull();
    await s.save(emptyProject('T'));
    expect((await s.load())?.name).toBe('T');
  });

  it('Autosave coalesces bursts into one write and keeps the data when saving fails', async () => {
    vi.useFakeTimers();
    let fail = true;
    const saves: string[] = [];
    const store = { load: async () => null, save: async (p: SavedProject) => { if (fail) throw new Error('disk'); saves.push(p.name); } };
    const status: boolean[] = [];
    const a = new Autosave(store, 100, ok => status.push(ok));
    a.queue(emptyProject('1')); a.queue(emptyProject('2'));
    await vi.advanceTimersByTimeAsync(150);
    expect(status).toEqual([false]);
    fail = false;
    await a.flush();
    expect(saves).toEqual(['2']);
    expect(status).toEqual([false, true]);
    vi.useRealTimers();
  });
});

describe('duplicates', () => {
  const u = (key: string, source: string): Unit => ({ key, source, speaker: '', kind: 'dialogue', context: 'c' });
  const views: FileView[] = [
    { name: 'A.json', units: [u('1', 'Yes'), u('2', 'No')] },
    { name: 'B.json', units: [u('9', 'Yes'), u('8', 'Yes')] },
  ];
  const idx = new DupIndex(views);
  const sent = (t: string): Entry => ({ target: t, status: 'done', mt: 1 });

  it('finds identical originals across files', () => {
    expect(idx.others('A.json', '1')).toEqual([{ file: 'B.json', key: '9' }, { file: 'B.json', key: '8' }]);
    expect(idx.others('A.json', '2')).toEqual([]);
    expect(idx.others('Nope.json', 'x')).toEqual([]);
  });

  it('translate: fills only empty duplicates and never overwrites existing translations', () => {
    const saved: SavedProject = { ...emptyProject('t'), files: { 'B.json': { '8': { target: 'Своє', status: 'draft', mt: 1 } } } };
    const n = propagate(saved, idx, 'A.json', views[0]!.units[0]!, sent('Так'), 'translate', 5, 'Я');
    expect(n).toBe(1);
    expect(saved.files['B.json']!['9']).toMatchObject({ target: 'Так', status: 'done', src: 'Yes' });
    expect(saved.files['B.json']!['8']!.target).toBe('Своє');
  });

  it('review: approves duplicates waiting with the same text, leaves different text alone', () => {
    const saved: SavedProject = { ...emptyProject('t'), files: { 'B.json': { '9': sent('Так'), '8': sent('Ага') } } };
    const n = propagate(saved, idx, 'A.json', views[0]!.units[0]!, { ...sent('Так'), status: 'appr' }, 'review', 5, 'Я');
    expect(n).toBe(1);
    expect(saved.files['B.json']!['9']!.status).toBe('appr');
    expect(saved.files['B.json']!['8']!.status).toBe('done');
  });
});

describe('looksLikeProject', () => {
  it('recognises a saved project, also after a merge, and not a game file', async () => {
    const { emptyProject, looksLikeProject, mergeProjects, serialize } = await import('../src/core');
    const p = emptyProject('Гра');
    expect(looksLikeProject(serialize(p))).toBe(true);
    expect(looksLikeProject(serialize(mergeProjects(p, emptyProject('Гра')).project))).toBe(true);
    expect(looksLikeProject('[null,{"id":1,"name":"Torch"}]')).toBe(false);
    expect(looksLikeProject('{"events":[null],"displayName":"","versionId":1}')).toBe(false);
  });
});
