import { beforeEach, describe, expect, it } from 'vitest';
import { loadRowMemo, rowNumber, saveRowMemo } from '../src/ui/rowmemo';

const store: Record<string, string> = {};
beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  (globalThis as unknown as { localStorage: Storage }).localStorage = { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; } } as unknown as Storage;
});

describe('the row each file was left on', () => {
  it('is kept per project and read back', () => {
    saveRowMemo('Game A', { 'Map001.json': 'k5', 'Items.json': 'k2' });
    saveRowMemo('Game B', { 'Map001.json': 'k9' });
    expect(loadRowMemo('Game A')).toEqual({ 'Map001.json': 'k5', 'Items.json': 'k2' });
    expect(loadRowMemo('Game B')).toEqual({ 'Map001.json': 'k9' });
    expect(loadRowMemo('Game C')).toEqual({});
  });
  it('survives a damaged store: broken JSON, an array, other types', () => {
    store['transly.rowat:X'] = '{oops';
    expect(loadRowMemo('X')).toEqual({});
    store['transly.rowat:X'] = '[1,2]';
    expect(loadRowMemo('X')).toEqual({});
    store['transly.rowat:X'] = JSON.stringify({ a: 'k1', b: 5, c: null, d: { x: 1 } });
    expect(loadRowMemo('X')).toEqual({ a: 'k1' });
  });
  it('a store that throws means no memory, not a crash', () => {
    (globalThis as unknown as { localStorage: Storage }).localStorage = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('full'); } } as unknown as Storage;
    expect(loadRowMemo('X')).toEqual({});
    expect(() => saveRowMemo('X', { a: 'k' })).not.toThrow();
  });
  it('the number of a row is its place in the file, 1-based; 0 when it is not there', () => {
    const units = [{ key: 'a' }, { key: 'b' }, { key: 'c' }];
    expect(rowNumber(units, 'c')).toBe(3);
    expect(rowNumber(units, 'a')).toBe(1);
    expect(rowNumber(units, 'zzz')).toBe(0);
    expect(rowNumber(units, undefined)).toBe(0);
  });
});
