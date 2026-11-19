import { describe, expect, it } from 'vitest';
import { builtDrift, inboxOf } from '../src/core';
import type { Entry, FileView, SavedProject } from '../src/core';

const unit = (key: string, source = 'Hello') => ({ key, source, speaker: '', kind: 'dialogue', context: '' });
const view = (keys: string[]): FileView => ({ name: 'A.json', units: keys.map(k => unit(k)), meta: {} } as unknown as FileView);
const saved = (ents: Record<string, Entry>): SavedProject => ({ files: { 'A.json': ents }, settings: {} } as unknown as SavedProject);
const e = (over: Partial<Entry>): Entry => ({ target: 'т', status: 'draft', mt: 10, ...over });

describe('builtDrift', () => {
  it('counts the sent and proofread rows written after the build, and ignores drafts, empty rows and older ones', () => {
    const s = saved({
      a: e({ status: 'done', mt: 200 }), b: e({ status: 'appr', mt: 300 }), c: e({ status: 'draft', mt: 400 }),
      d: e({ status: 'done', mt: 50 }), f: e({ target: '', status: 'new', mt: 500 }),
    });
    const d = builtDrift(s, 100);
    expect(d).toMatchObject({ n: 2, sent: 1, approved: 1 });
    expect(d.rows.map(r => r.key).sort()).toEqual(['a', 'b']);
  });
  it('a build with nothing after it has no drift', () => {
    expect(builtDrift(saved({ a: e({ status: 'done', mt: 50 }) }), 100).n).toBe(0);
  });
});

describe('inboxOf', () => {
  const none = { who: 'Ви', seen: 100, errors: [] };
  it('is empty when nothing waits', () => {
    expect(inboxOf({ ...none, views: [view(['a'])], saved: saved({ a: e({ status: 'appr' }) }) })).toEqual([]);
  });
  it('lists the states that need attention with the rows they are about', () => {
    const s = saved({ a: e({ status: 'draft' }), b: e({ status: 'done' }), c: e({ status: 'done' }), d: e({ status: 'appr', src: 'Old' }) });
    const items = inboxOf({ ...none, views: [view(['a', 'b', 'c', 'd'])], saved: s, errors: [{ file: 'A.json', key: 'a' }] });
    expect(items.map(i => i.kind)).toEqual(['error', 'unreviewed', 'draft', 'source']);
    expect(items.find(i => i.kind === 'unreviewed')!.rows.map(r => r.key)).toEqual(['b', 'c']);
    expect(items[0]!.title).toBe('1 помилка QA');
    expect(items.find(i => i.kind === 'draft')!.title).toBe('1 чернетка не надіслано');
    expect(items.some(i => /застар/i.test(i.title))).toBe(false);
  });
  it('shows the comments and the work of others since the translator last looked, not their own and not older ones', () => {
    const s = saved({
      a: e({ status: 'appr', comments: [{ who: 'Оля', at: 150, text: 'Гм' }, { who: 'Ви', at: 160, text: 'Так' }, { who: 'Іван', at: 50, text: 'старе' }], history: [{ at: 170, who: 'Іван', what: 'вичитано', text: 'т' }, { at: 120, who: 'Іван', what: 'надіслано', text: 'т' }, { at: 130, who: 'Ви', what: 'правка', text: 'т' }, { at: 20, who: 'Іван', what: 'надіслано', text: 'т' }] }),
      b: e({ status: 'appr', history: [{ at: 180, who: 'Іван', what: 'вичитано', text: 'т' }, { at: 0, who: 'інший пристрій', what: 'версія з іншого пристрою, замінена пізнішою правкою', text: 'т' }] }),
    });
    const items = inboxOf({ ...none, views: [view(['a', 'b'])], saved: s });
    expect(items.map(i => i.id)).toEqual(['replies:Оля', 'others:Іван']);
    expect(items[0]!.title).toBe('Оля: 1 новий коментар');
    expect(items[1]!.sub).toBe('надіслано 1 · вичитано 2');
    expect(items[1]!.rows.map(r => r.key)).toEqual(['a', 'b']);
    expect(items.every(i => i.news)).toBe(true);
  });
  it('marking as read hides the news and keeps the states', () => {
    const s = saved({ a: e({ status: 'done', comments: [{ who: 'Оля', at: 150, text: 'Гм' }] }) });
    const items = inboxOf({ ...none, seen: 1000, views: [view(['a'])], saved: s });
    expect(items.map(i => i.kind)).toEqual(['unreviewed']);
  });
});
