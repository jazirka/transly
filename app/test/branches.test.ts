import { describe, expect, it } from 'vitest';
import { branchNames, branchOf, createBranch, defaultDecision, deleteBranch, deserialize, diffBranches, emptyProject, mergeProjects, nameProblem, planMerge, renameBranch, rowId, serialize, switchBranch } from '../src/core';
import type { Entry, SavedProject } from '../src/core';

const ent = (target: string, status: Entry['status'] = 'draft', mt = 1): Entry => ({ target, status, mt });
const base = (): SavedProject => ({ ...emptyProject('Гра'), files: { 'F.json': { k0: ent('Привіт'), k2: ent('Стара'), k3: ent('Спільна'), k4: ent('Вичитана', 'appr') } } });

/** main with the rows above, a branch `olya` made from it and changed, and main changed too: the state a merge starts from. */
function scene(): SavedProject {
  let p = createBranch(base(), 'olya', 10);
  const f = p.files['F.json']!;
  f.k0 = ent('Привіт, світе', 'appr', 20);     // only Olya changed it
  f.k1 = ent('Нове', 'draft', 20);             // only she has it
  f.k2 = ent('Її варіант', 'draft', 20);       // both changed it
  f.k4 = ent('Вичитана інакше', 'draft', 20);  // she changed a row that is proofread in main
  p = switchBranch(p, 'main');
  p.files['F.json']!.k2 = ent('Наш варіант', 'draft', 30);
  p.files['F.json']!.k3 = ent('Лише наша', 'draft', 30);   // only main changed it: nothing to take
  return p;
}

describe('branches: making, switching, naming', () => {
  it('a new branch becomes the current one and starts as an independent copy', () => {
    const p = createBranch(base(), 'olya', 10);
    expect(branchOf(p)).toBe('olya');
    expect(p.files['F.json']!.k0!.target).toBe('Привіт');
    p.files['F.json']!.k0 = ent('Інакше');
    expect(p.branches!.main!.files!['F.json']!.k0!.target).toBe('Привіт');
    expect(branchNames(p)).toEqual(['main', 'olya']);
    expect(p.branches!.olya).toMatchObject({ from: 'main', at: 10 });
  });
  it('switching there and back gives the same rows', () => {
    const p = createBranch(base(), 'olya', 10);
    const back = switchBranch(switchBranch(p, 'main'), 'olya');
    expect(back.files).toEqual(p.files);
    expect(branchOf(switchBranch(p, 'main'))).toBe('main');
    expect(() => switchBranch(p, 'нема')).toThrow();
  });
  it('names: empty, too long, a copy (any case) and a control character are refused', () => {
    const p = createBranch(base(), 'olya', 10);
    expect(nameProblem(p, '  ')).toMatch(/порожн/);
    expect(nameProblem(p, 'x'.repeat(41))).toMatch(/довш/);
    expect(nameProblem(p, 'Main')).toMatch(/уже є/);
    expect(nameProblem(p, 'OLYA')).toMatch(/уже є/);
    expect(nameProblem(p, 'a\nb')).toMatch(/керівних/);
    expect(nameProblem(p, 'вичитка')).toBeNull();
    expect(nameProblem(p, 'olya', 'olya')).toBeNull();
  });
  it('rename keeps the rows and the branches made from it; delete leaves a trace and re-parents', () => {
    let p = createBranch(base(), 'olya', 10);
    p = createBranch(p, 'ivan', 20);                 // made from olya
    p = switchBranch(p, 'main');
    const r = renameBranch(p, 'olya', 'вичитка');
    expect(r.branches!['вичитка']!.files).toBeTruthy();
    expect(r.branches!.ivan!.from).toBe('вичитка');
    expect(() => renameBranch(p, 'main', 'x')).toThrow();
    const d = deleteBranch(p, 'olya', 99);
    expect(d.branches!.olya).toBeUndefined();
    expect(d.branches!.ivan!.from).toBe('main');
    expect(d.goneBranches).toEqual({ olya: 99 });
    expect(() => deleteBranch(p, 'main', 1)).toThrow();
    expect(() => deleteBranch(createBranch(p, 'x', 30), 'x', 1)).toThrow();   // the current one
  });
});

describe('branches: compare and merge', () => {
  it('lists what the other branch brings: new, changed only there, conflicts, proofread rows locked; not what only main changed', () => {
    const d = diffBranches(scene(), 'olya');
    const by = Object.fromEntries(d.map(r => [r.key, r]));
    expect(Object.keys(by).sort()).toEqual(['k0', 'k1', 'k2', 'k4']);
    expect(by.k0!.kind).toBe('changed');
    expect(by.k1!.kind).toBe('new');
    expect(by.k2!.kind).toBe('conflict');
    expect(by.k4).toMatchObject({ kind: 'changed', locked: true });
    expect(by.k0!.locked).toBe(false);
  });
  it('the starting decisions: they alone changed it → take; conflict → wait; proofread → keep', () => {
    const by = Object.fromEntries(diffBranches(scene(), 'olya').map(r => [r.key, defaultDecision(r)]));
    expect(by.k0).toEqual({ take: 'theirs' });
    expect(by.k1).toEqual({ take: 'theirs' });
    expect(by.k2).toBeUndefined();
    expect(by.k4).toEqual({ take: 'mine' });
  });
  it('the plan writes theirs with their status, a custom text as a draft, and nothing for a kept or undecided row', () => {
    const p = scene(), rows = diffBranches(p, 'olya');
    const plan = planMerge(p, rows, r => (r.key === 'k2' ? { take: 'custom', text: 'Свій' } : defaultDecision(r)), 100);
    expect(plan.kind).toBe('merge');
    const by = Object.fromEntries(plan.changes.map(c => [c.key, c.next]));
    expect(Object.keys(by).sort()).toEqual(['k0', 'k1', 'k2']);
    expect(by.k0).toMatchObject({ target: 'Привіт, світе', status: 'appr' });
    expect(by.k2).toMatchObject({ target: 'Свій', status: 'draft' });
    expect(by.k1!.mt).toBeGreaterThan(1);
  });
  it('a proofread row of main is never written, even when theirs was asked for', () => {
    const p = scene(), rows = diffBranches(p, 'olya');
    const plan = planMerge(p, rows.filter(r => r.key === 'k4'), () => ({ take: 'theirs' }), 100);
    expect(plan.changes).toEqual([]);
    expect(plan.skipped).toEqual([{ file: 'F.json', key: 'k4', reason: 'proofread' }]);
  });
  it('without a common ground two different translations are a conflict, an empty row is new', () => {
    const p: SavedProject = { ...emptyProject('Гра'), files: { 'F.json': { a: ent('1'), b: ent('') } }, branch: 'x', branches: { x: { at: 5 }, main: { at: 0, files: { 'F.json': { a: ent('2'), b: ent('3'), c: ent('4') } } } } };
    const d = diffBranches(p, 'main');
    expect(d.map(r => `${r.key}:${r.kind}`).sort()).toEqual(['a:conflict', 'b:new', 'c:new']);
  });
});

describe('branches in a project that is saved and synced', () => {
  it('survive serialize → deserialize; a branch of a wrong shape is dropped, wrong rows in a branch are repaired', () => {
    const p = scene();
    expect(deserialize(serialize(p))).toEqual(p);
    const raw = JSON.parse(serialize(p));
    raw.branches.broken = { at: 'вчора' };
    raw.branches.olya.files['F.json'].k0.target = 5;
    const back = deserialize(JSON.stringify(raw));
    expect(back.branches!.broken).toBeUndefined();
    expect(back.branches!.olya!.files!['F.json']!.k0!.target).toBe('5');
  });
  it('a project without branches is the same bytes as before (no new fields)', () => {
    const p = base();
    expect(Object.keys(JSON.parse(serialize(mergeProjects(p, p).project))).some(k => /branch/i.test(k))).toBe(false);
  });
  it('two copies that stand on different branches are put on one: the rows of two branches never mix', () => {
    const a = scene();                          // stands on main, olya parked
    const b = switchBranch(scene(), 'olya');    // stands on olya, main parked
    const ab = mergeProjects(a, b).project, ba = mergeProjects(b, a).project;
    expect(branchOf(ab)).toBe(branchOf(ba));
    expect(ab).toEqual(ba);
    const cur = branchOf(ab);
    const other = cur === 'main' ? 'olya' : 'main';
    expect(ab.files['F.json']!.k2!.target).toBe(cur === 'main' ? 'Наш варіант' : 'Її варіант');
    expect(ab.branches![other]!.files!['F.json']!.k2!.target).toBe(other === 'main' ? 'Наш варіант' : 'Її варіант');
  });
  it('a parked branch edited on two devices merges row by row; a deleted branch does not come back from a copy that still has it', () => {
    const a = scene(), b = scene();
    a.branches!.olya!.files!['F.json']!.k9 = ent('з телефона', 'draft', 50);
    b.branches!.olya!.files!['F.json']!.k0 = ent('з ПК', 'draft', 60);
    const m = mergeProjects(a, b).project;
    expect(m.branches!.olya!.files!['F.json']!.k9!.target).toBe('з телефона');
    expect(m.branches!.olya!.files!['F.json']!.k0!.target).toBe('з ПК');
    const c = deleteBranch(a, 'olya', 500);
    const gone = mergeProjects(c, b).project, gone2 = mergeProjects(b, c).project;
    expect(gone.branches?.olya).toBeUndefined();
    expect(gone).toEqual(gone2);
    expect(gone.goneBranches).toEqual({ olya: 500 });
  });
  it('rowId is one string per row', () => { expect(rowId({ file: 'a', key: 'b' })).not.toBe(rowId({ file: 'ab', key: '' })); });
});
