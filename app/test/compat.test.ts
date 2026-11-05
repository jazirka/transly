import { describe, expect, it } from 'vitest';
import { HISTORY_LIMIT, SCHEMA, addComment, commentId, deserialize, edit, emptyProject, merge, mergeEntry, mergeProjects, serialize, setIgnored } from '../src/core';
import type { Entry, SavedProject, Unit } from '../src/core';

const unit: Unit = { key: 'k', source: 'Hello', speaker: '', kind: 'dialogue', context: 'x' };
const e = (target: string, mt: number, rest: Partial<Entry> = {}): Entry => ({ target, status: 'draft', mt, ...rest });
const proj = (files: SavedProject['files'], extra: Partial<SavedProject> = {}): SavedProject => ({ ...emptyProject('T'), files, ...extra });

describe('files from older builds', () => {
  it('a project written before `schema` existed loads, and keeps loading the same way after a save', () => {
    const old = JSON.stringify({ version: 1, name: 'Гра', sourceLang: 'en', targetLang: 'uk', resetEpoch: 0, files: { 'A.json': { k: e('Привіт', 5) } }, memory: [], terms: [], settings: { tolerancePct: 25, blockErrors: true, who: 'Я', propagate: true, pluginCommands: [], pluginsAsked: false, lineLimit: 0 } });
    const p = deserialize(old);
    expect(p.schema).toBeUndefined();
    expect(p.files['A.json']!.k!.target).toBe('Привіт');
    expect(deserialize(serialize(p))).toEqual(p);
  });

  it('fields of a newer build are carried along untouched, also through a merge', () => {
    const raw = JSON.parse(serialize(emptyProject('T'))) as Record<string, unknown>;
    raw.groups = { g1: { name: 'Вступ', mt: 10 } };
    raw.futureThing = [1, 2, 3];
    const p = deserialize(JSON.stringify(raw));
    expect((JSON.parse(serialize(p)) as Record<string, unknown>).groups).toEqual({ g1: { name: 'Вступ', mt: 10 } });
    const other = emptyProject('T');
    const m = mergeProjects(other, p).project as unknown as Record<string, unknown>;
    expect(m.groups).toEqual({ g1: { name: 'Вступ', mt: 10 } });
    expect(m.futureThing).toEqual([1, 2, 3]);
    const m2 = mergeProjects(p, other).project as unknown as Record<string, unknown>;
    expect(m2.groups).toEqual({ g1: { name: 'Вступ', mt: 10 } });
  });

  it('records of items with a time merge item by item, and a reset drops the older ones', () => {
    const a = { ...proj({}), groups: { x: { name: 'старе', mt: 5 }, y: { name: 'лише тут', mt: 8 } } } as unknown as SavedProject;
    const b = { ...proj({}), groups: { x: { name: 'нове', mt: 9 } } } as unknown as SavedProject;
    expect((mergeProjects(a, b).project as unknown as { groups: unknown }).groups).toEqual({ x: { name: 'нове', mt: 9 }, y: { name: 'лише тут', mt: 8 } });
    const reset = { ...proj({}, { resetEpoch: 8 }), groups: {} } as unknown as SavedProject;
    expect((mergeProjects(a, reset).project as unknown as { groups: unknown }).groups).toEqual({});
  });

  it('merging stamps the current layout and says when the other side is older', () => {
    const fresh = emptyProject('T'), legacy = { ...emptyProject('T') } as SavedProject;
    delete legacy.schema;
    const m = mergeProjects(fresh, legacy);
    expect(m.project.schema).toBe(SCHEMA);
    expect(m.olderPeer).toBe(true);
    expect(mergeProjects(fresh, emptyProject('T')).olderPeer).toBe(false);
  });
});

describe('merging one row', () => {
  it('a comment written on a stale copy does not replace a newer translation', () => {
    const pc = e('нове', 300);
    const phone = addComment(e('старе', 100), 'Рецензент', 'Перевірте', 350);
    expect(phone.mt).toBe(100); // a comment is not a change of the translation
    const m = mergeEntry(pc, phone);
    expect(m.target).toBe('нове');
    expect(m.comments?.map(c => c.text)).toEqual(['Перевірте']);
    expect(mergeEntry(phone, pc)).toEqual(m);
  });

  it('the same comment on both sides is kept once, also when one side lost its id', () => {
    const c = addComment(undefined, 'Я', 'Привіт', 50).comments![0]!;
    const { id: _id, ...legacy } = c;
    const a = e('x', 1, { comments: [c] }), b = e('x', 1, { comments: [legacy] });
    expect(commentId(legacy)).toBe(c.id);
    expect(mergeEntry(a, b).comments).toHaveLength(1);
    const later = addComment(a, 'Інший', 'Друге', 60);
    expect(mergeEntry(later, b).comments?.map(x => x.text)).toEqual(['Привіт', 'Друге']);
  });

  it('later edit and later resolve of one comment both survive', () => {
    const base = addComment(undefined, 'Я', 'Текст', 10).comments![0]!;
    const edited = { ...base, text: 'Виправлено', ed: 20 };
    const resolved = { ...base, res: { who: 'Рецензент', at: 30 } };
    const m = mergeEntry(e('x', 1, { comments: [edited] }), e('x', 1, { comments: [resolved] })).comments![0]!;
    expect(m).toMatchObject({ text: 'Виправлено', res: { who: 'Рецензент', at: 30 } });
  });

  it('history of both sides is combined in time order and capped', () => {
    const h = (at: number, what = 'правка') => ({ at, who: 'Я', what, text: String(at) });
    const m = mergeEntry(e('x', 1, { history: [h(1), h(3)] }), e('x', 1, { history: [h(2), h(3)] }));
    expect(m.history?.map(x => x.at)).toEqual([1, 2, 3]);
    const many = Array.from({ length: HISTORY_LIMIT }, (_, i) => h(i + 10));
    expect(mergeEntry(e('x', 1, { history: many }), e('x', 1, { history: [h(1), h(2)] })).history).toHaveLength(HISTORY_LIMIT);
  });

  it('ignored warnings: the later list wins, so a warning can come back; without clocks both lists count', () => {
    const base = e('x', 1);
    const ignored = setIgnored(base, 'len', true, 10);
    const back = setIgnored(ignored, 'len', false, 20);
    expect(ignored.mt).toBe(1);
    expect(mergeEntry(ignored, back).ign).toEqual([]);
    expect(mergeEntry(back, ignored).ign).toEqual([]);
    expect(mergeEntry(e('x', 1, { ign: ['a'] }), e('x', 1, { ign: ['b'] })).ign).toEqual(['a', 'b']);
  });

  it('the translation itself still follows the later change, and conflicts are still reported', () => {
    const { merged, conflicts } = merge({ k: e('pc', 10) }, { k: e('phone', 20) }, 5);
    expect(merged.k!.target).toBe('phone');
    expect(conflicts).toEqual(['k']);
    expect(merge({ k: e('same', 10) }, { k: e('same', 20) }, 5).conflicts).toEqual([]);
  });

  it('a row with only comments survives a merge, also after a reset that predates the comment', () => {
    const commented = addComment(undefined, 'Я', 'Питання', 500);
    expect(commented.mt).toBe(0);
    expect(mergeProjects(proj({ 'A.json': { k: commented } }), proj({})).project.files['A.json']!.k!.comments).toHaveLength(1);
    const reset = proj({}, { resetEpoch: 400 });
    expect(mergeProjects(proj({ 'A.json': { k: commented } }), reset).project.files['A.json']!.k!.comments).toHaveLength(1);
    const old = addComment(undefined, 'Я', 'Давнє', 300);
    expect(mergeProjects(proj({ 'A.json': { k: old } }), reset).project.files['A.json']).toEqual({});
    // newer comment, older history of the same row: only the newer parts stay
    const mixed = { ...addComment(e('x', 1, { history: [{ at: 100, who: 'Я', what: 'правка', text: 'x' }] }), 'Я', 'Нове', 500) };
    const kept = mergeProjects(proj({ 'A.json': { k: mixed } }), reset).project.files['A.json']!.k!;
    expect(kept.comments).toHaveLength(1);
    expect(kept.history).toBeUndefined();
  });

  it('edit() still moves a row forward and keeps what a comment or ignore added', () => {
    const c = addComment(e('x', 5), 'Я', 'К', 6);
    const edited = edit(setIgnored(c, 'len', true, 7), unit, 'y', 'translate', 8);
    expect(edited).toMatchObject({ target: 'y', mt: 8, ign: ['len'], ignAt: 7 });
    expect(edited.comments).toHaveLength(1);
  });
});

describe('deleted terms', () => {
  const term = (en: string, mt: number) => ({ en, uk: 'х', mt });

  it('a term deleted on one device does not come back from the other', () => {
    const a = proj({}, { terms: [term('Sword', 10)] });
    const b = proj({}, { terms: [], deletedTerms: { sword: 20 } });
    for (const [x, y] of [[a, b], [b, a]] as const) {
      const m = mergeProjects(x, y).project;
      expect(m.terms).toEqual([]);
      expect(m.deletedTerms).toEqual({ sword: 20 });
    }
  });

  it('a term added or changed after its deletion stays', () => {
    const a = proj({}, { terms: [term('Sword', 30)] });
    const b = proj({}, { deletedTerms: { sword: 20 } });
    expect(mergeProjects(a, b).project.terms.map(t => t.en)).toEqual(['Sword']);
  });

  it('a reset forgets old deletions', () => {
    const a = proj({}, { deletedTerms: { sword: 20 }, resetEpoch: 50 });
    expect(mergeProjects(a, proj({})).project.deletedTerms).toBeUndefined();
  });
});
