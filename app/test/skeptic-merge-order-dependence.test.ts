import { describe, expect, it } from 'vitest';
import { emptyProject, mergeEntry, mergeProjects } from '../src/core';
import type { Entry, SavedProject, Unit } from '../src/core';

// Oracle: a merge of two replicas must be commutative, merge(a,b) = merge(b,a) (otherwise two devices that
// merge each other's copy never converge). The project's own "merge laws" test leaves these fields out of its comparison.
const unit = (source: string): Unit => ({ key: 'a', source, speaker: '', kind: 'dialogue', context: '' });
const m = (a: SavedProject, b: SavedProject): SavedProject => mergeProjects(a, b).project;

describe('mergeProjects is commutative for the fields the law test leaves out', () => {
  it('snapshot: two different snapshots with the same (absent) assetsRev', () => {
    const a = emptyProject('P'), b = emptyProject('P');
    a.snapshot = { 'M.json': [unit('game v1')] };
    b.snapshot = { 'M.json': [unit('game v2')] };
    expect(m(a, b).snapshot).toEqual(m(b, a).snapshot);
  });
  it('labels: the same map renamed on two devices', () => {
    const a = emptyProject('P'), b = emptyProject('P');
    a.labels = { 'Map001.json': 'Ліс' }; b.labels = { 'Map001.json': 'Діброва' };
    expect(m(a, b).labels).toEqual(m(b, a).labels);
  });
  it('sysNames: different system names on two devices', () => {
    const a = emptyProject('P'), b = emptyProject('P');
    a.sysNames = { elements: ['', 'Вогонь'] } as never; b.sysNames = { elements: ['', 'Полум’я'] } as never;
    expect(m(a, b).sysNames).toEqual(m(b, a).sysNames);
  });
  it('comment text: the same comment edited on two devices in the same millisecond', () => {
    const mk = (text: string): Entry => ({ target: 't', status: 'draft', mt: 1, comments: [{ id: 'c1', who: 'x', at: 5, ed: 9, text }] });
    expect(mergeEntry(mk('A'), mk('B')).comments).toEqual(mergeEntry(mk('B'), mk('A')).comments);
  });
});

describe('a reset that drops recent rows says so', () => {
  const row = (target: string, mt: number): Entry => ({ target, status: 'draft', mt });
  it('counts translated rows dropped within a day before the reset, and only those', () => {
    const day = 24 * 3600 * 1000;
    const a = emptyProject('P'), b = emptyProject('P');
    a.resetEpoch = 10 * day;                                   // the device that reset: its clock says day 10
    b.files['Map001.json'] = { x: row('зроблено годину тому за годинником B', 10 * day - 3600_000), y: row('давня робота', 2 * day), z: row('', 10 * day - 5) };
    const r = mergeProjects(a, b);
    expect(r.droppedByReset).toBe(1);
    // the row stays, empty, with the text in its history; the old one and the empty one are gone
    expect(Object.keys(r.project.files['Map001.json'] ?? {})).toEqual(['x']);
    expect(r.project.files['Map001.json']!.x!.history!.map(h => h.text)).toEqual(['зроблено годину тому за годинником B']);
  });
  it('counts nothing when there was no reset', () => {
    const a = emptyProject('P'), b = emptyProject('P');
    b.files['Map001.json'] = { x: row('є', 5000) };
    expect(mergeProjects(a, b).droppedByReset).toBe(0);
  });
});

describe('a merge keeps the version it replaced', () => {
  const row = (target: string, mt: number): Entry => ({ target, status: 'draft', mt });
  it('the text of the version that lost goes into the history of the winner, the same in either order', () => {
    const a = emptyProject('P'), b = emptyProject('P');
    a.files['Map001.json'] = { x: row('перший пристрій', 10) };
    b.files['Map001.json'] = { x: row('другий пристрій', 20) };
    for (const r of [mergeProjects(a, b), mergeProjects(b, a)]) {
      const e = r.project.files['Map001.json']!.x!;
      expect(e.target).toBe('другий пристрій');
      expect(e.history!.map(h => [h.who, h.text])).toEqual([['інший пристрій', 'перший пристрій']]);
      expect(r.conflicts).toHaveLength(1);
    }
  });
  it('a version that is the text again in the end is not kept as lost', () => {
    const a = emptyProject('P'), b = emptyProject('P'), c = emptyProject('P');
    a.files['Map001.json'] = { x: row('Так', 10) };
    b.files['Map001.json'] = { x: row('Ага', 20) };
    c.files['Map001.json'] = { x: row('Так', 30) };
    const e = mergeProjects(mergeProjects(a, b).project, c).project.files['Map001.json']!.x!;
    expect(e.target).toBe('Так');
    expect(e.history!.map(h => h.text)).toEqual(['Ага']);
  });
  it('nothing is kept when the other side had no text', () => {
    const a = emptyProject('P'), b = emptyProject('P');
    a.files['Map001.json'] = { x: row('', 10) };
    b.files['Map001.json'] = { x: row('текст', 20) };
    expect(mergeProjects(a, b).project.files['Map001.json']!.x!.history).toBeUndefined();
  });
});
