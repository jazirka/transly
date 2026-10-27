import { describe, expect, it } from 'vitest';
import { check, hasTerm, parseDelimited, parseHtmlTable, targetHasTerm, termsFromTable } from '../src/core';

const SHEET = `<html><body><table>
<tr><th></th><th>A</th><th>B</th><th>C</th><th>D</th><th>E</th><th>F</th></tr>
<tr><th>1</th><td>№</td><td>Оригінал</td><td>Розділ, підрозділ</td><td>Опис</td><td>Переклад 1</td><td>Переклад 2</td></tr>
<tr><th>2</th><td>1</td><td>build</td><td>Відеоігрова термінологія</td><td>Зібрана <b>гра</b> &amp; застосунок</td><td>збірка</td><td></td></tr>
<tr><th>3</th><td>2</td><td>tag</td><td>Відеоігрова термінологія</td><td>Значок</td><td>жетон</td><td></td></tr>
<tr><th>4</th><td>3</td><td>tag</td><td>Відеоігрова термінологія</td><td>Користувацька позначка</td><td>позначка</td><td>мітка</td></tr>
<tr><th>5</th><td>4</td><td>no translation</td><td></td><td></td><td></td><td></td></tr>
</table></body></html>`;

describe('term tables', () => {
  it('parses a Google Sheets HTML export, finds the header row and merges same originals', () => {
    const rows = parseHtmlTable(SHEET);
    expect(rows[2]![4]).toBe('Зібрана гра & застосунок');
    const { terms, skipped } = termsFromTable(rows, 1);
    expect(terms.map(t => t.en)).toEqual(['build', 'tag']);
    expect(terms[0]).toMatchObject({ uk: 'збірка', kind: 'Відеоігрова термінологія', note: 'Зібрана гра & застосунок', qa: false });
    expect(terms[1]).toMatchObject({ uk: 'жетон', alt: ['позначка', 'мітка'] });
    expect(skipped).toBe(1);
  });

  it('qa flag is kept when requested; headerless two-column input works', () => {
    expect(termsFromTable([['Dark', 'Темрява']], 1, true).terms[0]).toEqual({ en: 'Dark', uk: 'Темрява', mt: 1 });
    expect(termsFromTable([['Original', 'Translation'], ['Key', 'Ключ']], 1, true).terms).toEqual([{ en: 'Key', uk: 'Ключ', mt: 1 }]);
  });

  it('parses CSV with quotes and auto-detects the delimiter', () => {
    expect(parseDelimited('a,b\n"x, y","say ""hi"""\n')).toEqual([['a', 'b'], ['x, y', 'say "hi"']]);
    expect(parseDelimited('a;b\nc;d')).toEqual([['a', 'b'], ['c', 'd']]);
    expect(parseDelimited('a\tb\nc\td')).toEqual([['a', 'b'], ['c', 'd']]);
  });
});

describe('term matching', () => {
  it('matches English whole words with simple endings only', () => {
    expect(hasTerm('Three keys here', 'key')).toBe(true);
    expect(hasTerm('Darkness falls', 'dark')).toBe(false);
    expect(hasTerm('The Dark remembers', 'dark')).toBe(true);
  });

  it('accepts inflected Ukrainian forms and alternatives', () => {
    expect(targetHasTerm('Я бачу Темряву.', 'Темрява')).toBe(true);
    expect(targetHasTerm('Двері замкнені', 'ключ')).toBe(false);
    expect(targetHasTerm('мітки на карті', 'позначка', ['мітка'])).toBe(true);
    expect(targetHasTerm('збірку', 'збірка')).toBe(true);
  });

  it('QA warns for enforced terms, accepts alternatives and ignores hint-only terms', () => {
    const u = { source: 'The Dark remembers faces.' };
    const terms = [{ en: 'Dark', uk: 'Темрява', alt: ['Морок'] }];
    expect(check(u, 'Морок пам’ятає обличчя.', { tolerancePct: 100, terms })).toEqual([]);
    expect(check(u, 'Тьма пам’ятає обличчя.', { tolerancePct: 100, terms }).map(i => i.key)).toEqual(['term']);
    expect(check(u, 'Тьма пам’ятає обличчя.', { tolerancePct: 100, terms: [{ ...terms[0]!, qa: false }] })).toEqual([]);
  });
});
