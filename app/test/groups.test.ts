import { describe, expect, it } from 'vitest';
import { GroupIndex, createGroup, deleteGroup, deserialize, emptyProject, extract, fileRef, findOrphans, groupBySpeaker, groupByScene, groupRows, hashText, liveGroups, mergeProjects, parseRef, placeFile, placeRows, placeScene, recolorGroup, renameGroup, rowRef, rowsOfGroup, rowsProgress, sceneRef, serialize } from '../src/core';
import type { FileView, GameFile } from '../src/core';

const cmd = (code: number, parameters: unknown[]) => ({ code, indent: 0, parameters });
const map: GameFile = {
  name: 'Map007.json', json: {
    displayName: 'Ліс', events: [null,
      { id: 1, name: 'door', x: 1, y: 1, pages: [{ list: [cmd(101, ['', 0, 0, 2, '']), cmd(401, ['It is locked.']), cmd(101, ['', 0, 0, 2, '']), cmd(401, ['Try the key.']), cmd(0, [])] }] },
      { id: 2, name: 'cook', x: 2, y: 2, pages: [{ list: [cmd(101, ['', 0, 0, 2, 'Cook']), cmd(401, ['Hungry?']), cmd(0, [])] }] },
    ],
  },
};
const items: GameFile = { name: 'Items.json', json: [null, { id: 1, name: 'Potion', description: 'Heals', note: '' }, { id: 2, name: 'Ether', description: 'Mana', note: '' }] };
const views = (): FileView[] => [{ name: 'Map007.json', units: extract(map) }, { name: 'Items.json', units: extract(items) }];
const keyOf = (v: FileView[], file: string, text: string): string => v.find(x => x.name === file)!.units.find(u => u.source === text)!.key;

describe('groups: the list', () => {
  it('makes groups in order, with colours, and reuses a name', () => {
    const p = emptyProject('t');
    const a = createGroup(p, '  Магазин ', 10)!, b = createGroup(p, 'Пролог', 20)!;
    expect(liveGroups(p).map(g => g.name)).toEqual(['Магазин', 'Пролог']);
    expect(a.color).not.toBe(b.color);
    expect(createGroup(p, 'магазин', 30)!.id).toBe(a.id);
    expect(createGroup(p, '   ', 30)).toBeNull();
  });
  it('renames (not to an empty or taken name) and recolours', () => {
    const p = emptyProject('t');
    const a = createGroup(p, 'А', 1)!, b = createGroup(p, 'Б', 2)!;
    expect(renameGroup(p, a.id, 'Б', 3)).toBe('exists');
    expect(renameGroup(p, a.id, '  ', 3)).toBe('empty');
    expect(renameGroup(p, a.id, 'А2', 3)).toBe('ok');
    expect(p.groups![a.id]!.mt).toBe(3);
    expect(recolorGroup(p, b.id, '#fff', 4)).toBe(true);
    expect(recolorGroup(p, 'nope', '#fff', 4)).toBe(false);
  });
});

describe('groups: what is in a group (nearest member wins)', () => {
  const v = views();
  const locked = keyOf(v, 'Map007.json', 'It is locked.'), tryKey = keyOf(v, 'Map007.json', 'Try the key.'), hungry = keyOf(v, 'Map007.json', 'Hungry?');

  it('a file covers all its rows, a scene its own rows, a row only itself', () => {
    const p = emptyProject('t');
    const g = createGroup(p, 'Ліс', 1)!, h = createGroup(p, 'Кухар', 2)!;
    placeFile(p, 'Map007.json', g.id, 5);
    placeScene(p, 'Map007.json', 'events[2].pages[0].list', h.id, 6);
    const idx = new GroupIndex(p);
    expect(idx.groupOf('Map007.json', locked)).toBe(g.id);
    expect(idx.groupOf('Map007.json', hungry)).toBe(h.id);
    expect(idx.groupOf('Items.json', '[1].name')).toBeNull();
    placeRows(p, v, [{ file: 'Map007.json', key: tryKey }], h.id, 7);
    const after = new GroupIndex(p);
    expect(after.groupOf('Map007.json', tryKey)).toBe(h.id);
    expect(after.groupOf('Map007.json', locked)).toBe(g.id);
    expect(rowsOfGroup(p, v, h.id).map(r => r.key).sort()).toEqual([tryKey, hungry].sort());
  });

  it('a row can be taken out of the group its scene is in, and put back by following the scene again', () => {
    const p = emptyProject('t');
    const g = createGroup(p, 'Г', 1)!;
    placeScene(p, 'Map007.json', 'events[1].pages[0].list', g.id, 2);
    expect(placeRows(p, v, [{ file: 'Map007.json', key: locked }], null, 3)).toBe(1);
    expect(new GroupIndex(p).groupOf('Map007.json', locked)).toBeNull();
    expect(new GroupIndex(p).groupOf('Map007.json', tryKey)).toBe(g.id);
    expect(placeRows(p, v, [{ file: 'Map007.json', key: locked }], g.id, 4)).toBe(1);
    expect(new GroupIndex(p).groupOf('Map007.json', locked)).toBe(g.id);
    // the row follows its scene again, so it needs no member of its own
    expect(p.members![rowRef('Map007.json', locked)]!.del).toBe(true);
    // nothing to do the second time
    expect(placeRows(p, v, [{ file: 'Map007.json', key: locked }], g.id, 5)).toBe(0);
  });

  it('putting a scene in a group lets go of the rows placed one by one inside it; a file does the same for scenes and rows', () => {
    const p = emptyProject('t');
    const a = createGroup(p, 'А', 1)!, b = createGroup(p, 'Б', 2)!;
    placeRows(p, v, [{ file: 'Map007.json', key: locked }], a.id, 3);
    placeScene(p, 'Map007.json', 'events[1].pages[0].list', b.id, 4);
    expect(new GroupIndex(p).groupOf('Map007.json', locked)).toBe(b.id);
    placeFile(p, 'Map007.json', a.id, 5);
    expect(new GroupIndex(p).groupOf('Map007.json', locked)).toBe(a.id);
    expect(new GroupIndex(p).groupOf('Map007.json', hungry)).toBe(a.id);
  });

  it('deleting a group frees its rows and leaves a trace', () => {
    const p = emptyProject('t');
    const g = createGroup(p, 'Г', 1)!;
    placeFile(p, 'Items.json', g.id, 2);
    expect(groupRows(p, v).get(g.id)?.length).toBe(4);
    expect(deleteGroup(p, g.id, 3)).toBe(true);
    expect(groupRows(p, v).size).toBe(0);
    expect(p.groups![g.id]!.del).toBe(true);
    expect(liveGroups(p)).toEqual([]);
    expect(deleteGroup(p, g.id, 4)).toBe(false);
  });

  it('a row inside a deleted group follows what is outside it', () => {
    const p = emptyProject('t');
    const a = createGroup(p, 'А', 1)!, b = createGroup(p, 'Б', 2)!;
    placeFile(p, 'Map007.json', a.id, 3);
    placeRows(p, v, [{ file: 'Map007.json', key: locked }], b.id, 4);
    deleteGroup(p, b.id, 5);
    expect(new GroupIndex(p).groupOf('Map007.json', locked)).toBe(a.id);
  });
});

describe('groups: refs, orphans, progress, automatic sets', () => {
  it('refs round-trip', () => {
    expect(parseRef(fileRef('a/b.json'))).toEqual({ kind: 'file', file: 'a/b.json' });
    expect(parseRef(sceneRef('M.json', 'events[1].pages[0].list'))).toEqual({ kind: 'scene', file: 'M.json', key: 'events[1].pages[0].list' });
    expect(parseRef(rowRef('M.json', '[1].name'))).toEqual({ kind: 'row', file: 'M.json', key: '[1].name' });
    expect(parseRef('junk')).toBeNull();
  });

  it('members whose place is gone, or whose original changed, are reported, not dropped', () => {
    const p = emptyProject('t');
    const v = views();
    const g = createGroup(p, 'Г', 1)!;
    const locked = keyOf(v, 'Map007.json', 'It is locked.');
    placeRows(p, v, [{ file: 'Map007.json', key: locked }, { file: 'Items.json', key: '[1].name' }], g.id, 2);
    placeScene(p, 'Map007.json', 'events[9].pages[0].list', g.id, 3);
    placeFile(p, 'Gone.json', g.id, 4);
    expect(findOrphans(p, v).map(o => o.ref).sort()).toEqual([fileRef('Gone.json'), sceneRef('Map007.json', 'events[9].pages[0].list')].sort());
    // the game changed a text
    const v2 = views();
    v2[1]!.units.find(u => u.key === '[1].name')!.source = 'Hi-Potion';
    const o = findOrphans(p, v2).find(x => x.key === '[1].name')!;
    expect(o.why).toBe('changed');
    // a row removed from the file
    v2[0]!.units = v2[0]!.units.filter(u => u.key !== locked);
    expect(findOrphans(p, v2).find(x => x.key === locked)?.why).toBe('gone');
    // the members stay in the project
    expect(Object.keys(p.members!).length).toBe(4);
  });

  it('progress counts translated, sent and approved rows', () => {
    const rows = [{ file: 'a', key: '1' }, { file: 'a', key: '2' }, { file: 'a', key: '3' }, { file: 'a', key: '4' }];
    const ents = { a: { '1': { target: 'x', status: 'draft' as const, mt: 1 }, '2': { target: 'y', status: 'done' as const, mt: 1 }, '3': { target: 'z', status: 'appr' as const, mt: 1 }, '4': { target: '', status: 'new' as const, mt: 1 } } };
    expect(rowsProgress(rows, f => ents[f as 'a'])).toEqual({ total: 4, translated: 3, done: 1, approved: 1 });
  });

  it('automatic sets: by speaker and by scene', () => {
    const v = views();
    const sp = groupBySpeaker(v, undefined);
    expect(sp.map(s => s.name)).toEqual(['Cook']);
    expect(sp[0]!.rows.length).toBe(1);
    const sc = groupByScene(v);
    expect(sc.map(s => s.name)).toEqual(['EV001 · door', 'EV002 · cook']);
    expect(sc[0]!.rows.length).toBe(2);
    expect(groupBySpeaker(v, { 'event:door': { name: 'Привратник', mt: 1 } }).length).toBeGreaterThanOrEqual(1);
  });

  it('the hash notices any change of the text', () => {
    expect(hashText('abc')).toBe(hashText('abc'));
    expect(hashText('abc')).not.toBe(hashText('abd'));
  });
});

describe('groups in the project file and in a merge', () => {
  it('are saved, loaded and carried through a merge', () => {
    const a = emptyProject('t');
    const g = createGroup(a, 'Г', 100)!;
    placeFile(a, 'Items.json', g.id, 101);
    const loaded = deserialize(serialize(a));
    expect(loaded.groups![g.id]!.name).toBe('Г');
    expect(loaded.members![fileRef('Items.json')]!.g).toBe(g.id);
    const b = emptyProject('t');
    const { project } = mergeProjects(b, loaded);
    expect(project.groups![g.id]).toBeTruthy();
    expect(project.members![fileRef('Items.json')]).toBeTruthy();
  });

  it('the newer change of a group or a member wins; a deletion is not undone by an older copy', () => {
    const a = emptyProject('t'), b = emptyProject('t');
    const g = createGroup(a, 'Г', 100)!;
    placeFile(a, 'Items.json', g.id, 101);
    b.groups = JSON.parse(JSON.stringify(a.groups)); b.members = JSON.parse(JSON.stringify(a.members));
    renameGroup(a, g.id, 'Новa', 200);
    renameGroup(b, g.id, 'Стара', 150);
    expect(mergeProjects(a, b).project.groups![g.id]!.name).toBe('Новa');
    deleteGroup(b, g.id, 300);
    const m = mergeProjects(a, b).project;
    expect(m.groups![g.id]!.del).toBe(true);
    expect(liveGroups(m)).toEqual([]);
    expect(new GroupIndex(m).empty).toBe(true);
  });

  it('what is older than the last reset is dropped', () => {
    const a = emptyProject('t'), b = emptyProject('t');
    const g = createGroup(a, 'Г', 100)!;
    placeFile(a, 'Items.json', g.id, 101);
    b.resetEpoch = 500;
    const m = mergeProjects(a, b).project;
    expect(m.groups).toBeUndefined();
    expect(m.members).toBeUndefined();
  });

  it('a project without groups stays without them', () => {
    const m = mergeProjects(emptyProject('t'), emptyProject('t')).project;
    expect('groups' in m).toBe(false);
    expect('members' in m).toBe(false);
  });
});
