import { describe, expect, it } from 'vitest';
import { DEFAULT_PAGES, clampPage, normalizePages, normalizePlaces, pageCount, pageOfIndex, pageOfKey, pageRange, rememberPlace } from '../src/core/pages';

describe('pages', () => {
  it('counts the pages: an empty list is one page', () => {
    expect(pageCount(0, 50)).toBe(1);
    expect(pageCount(50, 50)).toBe(1);
    expect(pageCount(51, 50)).toBe(2);
    expect(pageCount(573, 50)).toBe(12);
  });
  it('finds the page of a row and the rows of a page', () => {
    expect(pageOfIndex(0, 50)).toBe(0);
    expect(pageOfIndex(49, 50)).toBe(0);
    expect(pageOfIndex(50, 50)).toBe(1);
    expect(pageRange(2, 573, 50)).toEqual([100, 150]);
    expect(pageRange(11, 573, 50)).toEqual([550, 573]);
  });
  it('keeps a page inside the list', () => {
    expect(clampPage(-3, 573, 50)).toBe(0);
    expect(clampPage(99, 573, 50)).toBe(11);
    expect(clampPage(NaN, 573, 50)).toBe(0);
    expect(clampPage(2.9, 573, 50)).toBe(2);
    expect(pageRange(5, 0, 50)).toEqual([0, 0]);
  });
  it('says where a key stands, or that it is not there', () => {
    const keys = Array.from({ length: 120 }, (_, i) => 'k' + i);
    expect(pageOfKey(keys, 'k0', 50)).toBe(0);
    expect(pageOfKey(keys, 'k75', 50)).toBe(1);
    expect(pageOfKey(keys, 'k119', 50)).toBe(2);
    expect(pageOfKey(keys, 'nope', 50)).toBeNull();
    expect(pageOfKey(keys, null, 50)).toBeNull();
  });
  it('reads damaged preferences one field at a time', () => {
    expect(normalizePages(undefined)).toEqual(DEFAULT_PAGES);
    expect(normalizePages({ mode: 'flow', size: 100, remember: false })).toEqual({ mode: 'flow', size: 100, remember: false });
    expect(normalizePages({ mode: 'weird', size: 7, remember: 'yes' })).toEqual(DEFAULT_PAGES);
    expect(normalizePages({ mode: 'off', size: 200 })).toEqual({ mode: 'off', size: 200, remember: true });
  });
  it('remembers places, newest last, and forgets the oldest past the cap', () => {
    let p: Record<string, { page: number }> = {};
    for (let i = 0; i < 130; i++) p = rememberPlace(p, 'f' + i, { page: i });
    expect(Object.keys(p).length).toBe(120);
    expect(p.f0).toBeUndefined();
    expect(p.f129).toEqual({ page: 129 });
    const q = rememberPlace(p, 'f50', { page: 1 });
    expect(Object.keys(q).pop()).toBe('f50');
    expect(q.f50).toEqual({ page: 1 });
  });
  it('reads stored places and drops what is not a place', () => {
    expect(normalizePlaces({ a: { page: 2, key: 'k', top: 10 }, b: { page: -1 }, c: 'x', d: { page: 'z' }, e: { page: 3, top: -5 } })).toEqual({ a: { page: 2, key: 'k', top: 10 }, e: { page: 3 } });
    expect(normalizePlaces(null)).toEqual({});
  });
});
