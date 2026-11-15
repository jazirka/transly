import { describe, expect, it } from 'vitest';
import { activeIssues, buildSceneIndex, check, emptyProject, extract, sceneAt, sceneTitle, stepScene, sourceTermHits, targetTermHits, termRangesInTarget, touchTerms, unwrap, wrapLines } from '../src/core';
import type { Entry, GameFile, Unit } from '../src/core';

const cmd = (code: number, parameters: unknown[], indent = 0) => ({ code, indent, parameters });
const mapJson = {
  displayName: 'Ліс', events: [null,
    { id: 1, name: 'door', x: 4, y: 7, pages: [{ conditions: { switch1Valid: true, switch1Id: 5 }, list: [cmd(101, ['', 0, 0, 2, '']), cmd(401, ['\\C[2]']), cmd(101, ['', 0, 0, 2, '']), cmd(401, ['It is locked.']), cmd(0, [])] }] },
    { id: 2, name: 'cook', x: 9, y: 3, pages: [
      { list: [cmd(101, ['Cook', 0, 0, 2, '']), cmd(401, ['Hungry?']), cmd(0, [])] },
      { list: [cmd(101, ['Cook', 0, 0, 2, '']), cmd(401, ['Come back soon.']), cmd(0, [])] }] },
  ],
};
const game: GameFile = { name: 'Map007.json', json: mapJson };

describe('scene index', () => {
  const units = extract(game);
  const idx = buildSceneIndex(units)!;

  it('one scene per event page, in game order, and rows outside scenes stay outside', () => {
    expect(idx.scenes.map(s => s.title)).toEqual(['EV001 · door', 'EV002 · cook', 'EV002 · cook']);
    expect(idx.scenes.map(s => s.page)).toEqual([1, 1, 2]);
    expect(idx.scenes.map(s => s.pages)).toEqual([1, 2, 2]);
    expect(idx.loose.map(u => u.key)).toEqual(['displayName']);
    expect(sceneTitle(idx.scenes[2]!)).toBe('EV002 · cook · сторінка 2');
    expect(sceneTitle(idx.scenes[0]!)).toBe('EV001 · door');
  });

  it('finds the scene of a row and the neighbouring scenes', () => {
    const hungry = units.find(u => u.source === 'Hungry?')!;
    expect(sceneAt(idx, hungry.key)?.title).toBe('EV002 · cook');
    expect(stepScene(idx, hungry.key, 1)?.units.map(u => u.source)).toEqual(['Come back soon.']);
    expect(stepScene(idx, hungry.key, -1)?.units.map(u => u.source)).toEqual(['It is locked.']);
    expect(stepScene(idx, units.find(u => u.source === 'Come back soon.')!.key, 1)).toBeNull();
    expect(sceneAt(idx, 'displayName')).toBeNull();
  });

  it('files without scenes have no index, and nothing is invented for them', () => {
    const db: Unit[] = [{ key: '[1].name', source: 'Potion', speaker: '', kind: 'name', context: 'Items' }, { key: '[2].name', source: 'Ether', speaker: '', kind: 'name', context: 'Items' }];
    expect(buildSceneIndex(db)).toBeNull();
    expect(buildSceneIndex([])).toBeNull();
    expect(sceneAt(null, 'x')).toBeNull();
  });

  it('the conditions of a page stay with it when its first row has no text of its own', () => {
    const door = idx.scenes[0]!;
    expect(door.cond).toMatchObject({ switches: [5] });
    expect(door.units[0]!.source).toBe('It is locked.');
    expect(door.units[0]!.page).toMatchObject({ switches: [5] });
  });
});

describe('term hits', () => {
  const terms = [{ en: 'Sword', uk: 'меч', mt: 1 }, { en: 'Iron Gate', uk: 'залізна брама', alt: ['залізні ворота'], mt: 1 }];

  it('finds the English terms in the original in any form, longest first', () => {
    const src = 'The Swords by the iron gate.';
    const hits = sourceTermHits(src, terms);
    expect(hits.map(h => [src.slice(h.start, h.end), h.term.en])).toEqual([['Swords', 'Sword'], ['iron gate', 'Iron Gate']]);
  });

  it('finds the Ukrainian rendering in the translation in any case, also as a phrase and as an alternative', () => {
    const text = 'Мечі біля залізної брами і залізні ворота.';
    expect(termRangesInTarget(text, 'меч').map(([a, b]) => text.slice(a, b))).toEqual(['Мечі']);
    expect(termRangesInTarget(text, 'залізна брама', ['залізні ворота']).map(([a, b]) => text.slice(a, b))).toEqual(['залізної брами', 'залізні ворота']);
    expect(termRangesInTarget('Він мечник.', 'меч')).toEqual([]);
    expect(termRangesInTarget('Я йду.', 'я', [])).toHaveLength(1);
    expect(termRangesInTarget('Яблуко.', 'я', [])).toEqual([]);
  });

  it('target hits follow the terms that occur in the original', () => {
    const hits = targetTermHits('Мечі та брама.', [terms[0]!]);
    expect(hits.map(h => h.term.en)).toEqual(['Sword']);
  });
});

describe('unwrap', () => {
  it('joins the lines of a wrapped text and a word broken at a line end', () => {
    expect(unwrap('Куди ти\nйдеш, друже?')).toBe('Куди ти йдеш, друже?');
    expect(unwrap('при-\nклад слова')).toBe('приклад слова');
    expect(unwrap('Перший.\n  Другий.\n')).toBe('Перший. Другий.');
    expect(unwrap(wrapLines('Дуже довгий рядок, який точно не влізе у вікно гри', 20))).toBe('Дуже довгий рядок, який точно не влізе у вікно гри');
  });
});

describe('issues', () => {
  const u: Unit = { key: 'k', source: 'Take the \\C[2]key\\C[0] to the Sword smith.', speaker: '', kind: 'dialogue', context: 'x' };
  const e = (target: string, extra: Partial<Entry> = {}): Entry => ({ target, status: 'draft', mt: 1, ...extra });

  it('every issue says what kind it is, and offers a correction where one can be made', () => {
    const missing = check(u, 'Візьми ключ до майстра.');
    const codes = missing.find(i => i.key === 'codes')!;
    expect(codes).toMatchObject({ severity: 'bad', cat: 'error' });
    // the codes go where the original has them (about a quarter of the way in, before a word), not to the end
    expect(codes.fix?.text).toBe('Візьми \\C[2]\\C[0] ключ до майстра.');
    const long = check({ ...u, source: 'x'.repeat(60) }, 'слово '.repeat(20).trim(), { tolerancePct: 500, terms: [], lineLimit: 40 });
    const wrap = long.find(i => i.key === 'wrap')!;
    expect(wrap).toMatchObject({ severity: 'warn', cat: 'style' });
    expect(wrap.fix?.text).toBe(wrapLines('слово '.repeat(20).trim(), 40));
    const term = check({ ...u, source: 'The Sword.' }, 'Клинок.', { tolerancePct: 500, terms: [{ en: 'Sword', uk: 'меч' }] }).find(i => i.key === 'term')!;
    expect(term).toMatchObject({ severity: 'warn', cat: 'term' });
    expect(term.fix).toBeUndefined();
  });

  it('the answer for a row is remembered, and forgotten when the settings or the glossary change', () => {
    const terms = [{ en: 'Sword', uk: 'меч' }];
    const opts = { tolerancePct: 500, terms };
    const row = e('Візьми \\C[2]ключ\\C[0] до коваля.');
    const a = activeIssues(u, row, opts);
    expect(activeIssues(u, row, opts)).toBe(a);
    expect(a.some(i => i.key === 'term')).toBe(true);
    // the glossary changed in place (a term replaced, the length unchanged)
    terms[0] = { en: 'Sword', uk: 'коваль' };
    touchTerms(terms);
    expect(activeIssues(u, row, opts).some(i => i.key === 'term')).toBe(false);
    // other settings
    expect(activeIssues(u, row, { ...opts, tolerancePct: 1 }).some(i => i.key === 'len')).toBe(true);
    // a row that was replaced is checked again; ignoring a warning needs no new check
    expect(activeIssues(u, e('Візьми ключ.'), opts).some(i => i.key === 'codes')).toBe(true);
    expect(activeIssues(u, e('Візьми ключ.', { ign: ['codes'] }), opts).some(i => i.key === 'codes')).toBe(false);
    expect(emptyProject('x').terms).toEqual([]);
  });
});
