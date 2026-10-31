import { describe, expect, it } from 'vitest';
import { picOfFace, picsOfRow } from './gameimg';

const game = [
  { name: 'Items.json', json: [null, { name: 'Potion', iconIndex: 176 }, { name: 'Plain', iconIndex: 0 }] },
  { name: 'Actors.json', json: [null, { name: 'Eric', faceName: 'Actor1', faceIndex: 3 }] },
  { name: 'Enemies.json', json: [null, { name: 'Slime', battlerName: 'Slime' }] },
];

describe('game pictures', () => {
  it('item icon, actor face and enemy battler come from the database row', () => {
    expect(picsOfRow(game as never, 'Items.json', '[1].name')).toEqual([{ kind: 'icon', n: 176, label: 'Potion' }]);
    expect(picsOfRow(game as never, 'data/Actors.json', '[1].name')).toEqual([{ kind: 'face', name: 'Actor1', index: 3, label: 'Eric' }]);
    expect(picsOfRow(game as never, 'Enemies.json', '[1].name')).toEqual([{ kind: 'enemy', name: 'Slime', label: 'Slime' }]);
  });
  it('nothing for rows without a picture or keys that are not rows', () => {
    expect(picsOfRow(game as never, 'Items.json', '[2].name')).toEqual([]);
    expect(picsOfRow(game as never, 'Items.json', 'terms.basic[0]')).toEqual([]);
  });
  it('<Picture: name> in a note gives a picture from img/pictures', () => {
    const g = [{ name: 'Items.json', json: [null, { name: 'Suit', iconIndex: 0, note: 'Slash 90% <Picture: icon_jumpsuit>' }, { name: 'Two', note: '<picture:a> <Picture : b>' }, { name: 'Bad', note: '<Picture: ../x> <Picture: a/b>' }] }];
    expect(picsOfRow(g as never, 'Items.json', '[1].name')).toEqual([{ kind: 'picture', name: 'icon_jumpsuit', label: 'icon_jumpsuit' }]);
    expect(picsOfRow(g as never, 'Items.json', '[2].name').map(p => (p as { name: string }).name)).toEqual(['a', 'b']);
    expect(picsOfRow(g as never, 'Items.json', '[3].name')).toEqual([]);
  });
  it('message face "Actor1#3"', () => {
    expect(picOfFace('Actor1#3')).toEqual([{ kind: 'face', name: 'Actor1', index: 3, label: '' }]);
    expect(picOfFace(undefined)).toEqual([]);
  });
});
