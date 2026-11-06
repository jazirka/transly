import { describe, expect, it } from 'vitest';
import { HINT_GLYPH, HINT_GROUP, HINT_LABEL, HINT_ORDER, byHintOrder, groupHints } from '../src/core';
import type { IssueCat } from '../src/core';

describe('hint kinds', () => {
  it('errors come first and reference last', () => {
    expect(HINT_ORDER).toEqual(['error', 'term', 'context', 'style', 'info']);
  });

  it('every kind has its own glyph, label and group name', () => {
    expect(new Set(HINT_ORDER.map(c => HINT_GLYPH[c])).size).toBe(HINT_ORDER.length);
    expect(new Set(HINT_ORDER.map(c => HINT_LABEL[c])).size).toBe(HINT_ORDER.length);
    expect(new Set(HINT_ORDER.map(c => HINT_GROUP[c])).size).toBe(HINT_ORDER.length);
  });

  it('sorting by kind is stable inside a kind', () => {
    const items: { cat: IssueCat; id: number }[] = [{ cat: 'style', id: 1 }, { cat: 'error', id: 2 }, { cat: 'style', id: 3 }, { cat: 'term', id: 4 }, { cat: 'error', id: 5 }];
    expect(byHintOrder(items).map(x => x.id)).toEqual([2, 5, 4, 1, 3]);
  });

  it('groups leave out the kinds without remarks', () => {
    const g = groupHints([{ cat: 'info' as IssueCat }, { cat: 'error' as IssueCat }, { cat: 'info' as IssueCat }]);
    expect(g.map(x => [x.cat, x.items.length])).toEqual([['error', 1], ['info', 2]]);
  });
});
