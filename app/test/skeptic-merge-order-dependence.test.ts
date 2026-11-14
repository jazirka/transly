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
