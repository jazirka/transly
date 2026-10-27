import { describe, expect, it } from 'vitest';
import { apply, extract, fileText, formatOf, build, emptyProject, readGame } from '../src/core';
import type { Translations } from '../src/core';

const tr = (o: Record<string, string>): Translations => Object.fromEntries(Object.entries(o).map(([k, target]) => [k, { target, status: 'done' as const, mt: 1 }]));

describe('format detection', () => {
  it('picks the format from the file name', () => {
    expect(formatOf({ name: 'Map001.json' })).toBe('rpgmaker');
    expect(formatOf({ name: 'data/Items.json' })).toBe('rpgmaker');
    expect(formatOf({ name: 'locales/en.json' })).toBe('locale-json');
    expect(formatOf({ name: 'package.json' })).toBeNull();
    expect(formatOf({ name: 'game/script.rpy' })).toBe('renpy');
    expect(formatOf({ name: 'lang/messages.po' })).toBe('gettext');
    expect(formatOf({ name: 'x.csv' })).toBe('csv');
    expect(formatOf({ name: 'readme.txt' })).toBeNull();
  });
});

const PO = `# translator comment
msgid ""
msgstr ""
"Content-Type: text/plain; charset=UTF-8\\n"
"Plural-Forms: nplurals=3; plural=(n%10==1 && n%100!=11 ? 0 : 1);\\n"

#: src/menu.c:12
msgid "Start game"
msgstr ""

msgctxt "button"
msgid "Open"
msgstr ""

msgid "You have one coin."
msgid_plural "You have %d coins."
msgstr[0] ""
msgstr[1] ""
msgstr[2] ""

msgid "Line one\\n"
"line two"
msgstr "Вже є"

#~ msgid "Old"
#~ msgstr "Старе"
`;

describe('gettext', () => {
  const file = { name: 'game.po', json: null, text: PO };
  it('extracts entries (not the header or obsolete ones), with context and plurals', () => {
    const u = extract(file);
    expect(u.map(x => x.key)).toEqual(['Start game', 'button::Open', 'You have one coin.#0', 'You have one coin.#1', 'Line one\nline two']);
    expect(u[0]!.context).toBe('src/menu.c:12');
    expect(u[4]!.source).toBe('Line one\nline two');
  });
  it('writes translations, keeps comments/header/obsolete, fills all plural forms and is valid again', () => {
    const out = apply(file, tr({ 'Start game': 'Почати гру', 'button::Open': 'Відкрити', 'You have one coin.#0': 'Є одна монета.', 'You have one coin.#1': 'Монет: %d.', 'Line one\nline two': 'Рядок один\nрядок два' })) as string;
    expect(out).toContain('# translator comment');
    expect(out).toContain('#~ msgid "Old"');
    expect(out).toContain('msgstr "Почати гру"');
    expect(out).toContain('msgstr[2] "Монет: %d."');
    expect(out).toContain('msgid "Line one\\nline two"');
    // reparse: translated entries now carry their msgstr and the same keys exist
    const again = extract({ name: 'game.po', json: null, text: out });
    expect(again.map(x => x.key)).toEqual(extract(file).map(x => x.key));
    expect(apply(file, {})).toContain('msgstr "Вже є"');
  });
});

const CSV = 'key,source,translation\r\nmenu.start,"Start, game",\r\nmenu.quit,Quit,Вихід\r\n,Say "hi",\r\nmenu.start,Again,\r\n';

describe('csv', () => {
  const file = { name: 'ui.csv', json: null, text: CSV };
  it('uses the key and source columns, numbers rows without a key and tolerates duplicate keys', () => {
    expect(extract(file).map(u => [u.key, u.source])).toEqual([['menu.start', 'Start, game'], ['menu.quit', 'Quit'], ['row4', 'Say "hi"'], ['menu.start#5', 'Again']]);
  });
  it('fills the translation column, keeps quoting and line endings', () => {
    const out = apply(file, tr({ 'menu.start': 'Почати, гру', row4: 'Скажи "привіт"' })) as string;
    expect(out).toBe('key,source,translation\r\nmenu.start,"Start, game","Почати, гру"\r\nmenu.quit,Quit,Вихід\r\n,"Say ""hi""","Скажи ""привіт"""\r\nmenu.start,Again,\r\n');
  });
  it('adds a translation column when there is none', () => {
    const out = apply({ name: 'a.csv', json: null, text: 'id,text\n1,Hello\n' }, tr({ '1': 'Привіт' })) as string;
    expect(out).toBe('id,text,translation\n1,Hello,Привіт\n');
  });
});

describe('locale json', () => {
  it('walks nested objects and arrays and writes values back by path', () => {
    const json = { menu: { start: 'Start', items: ['One', 'Two'] }, version: '1.0', empty: '' };
    const file = { name: 'en.json', json };
    expect(extract(file).map(u => u.key)).toEqual(['menu.start', 'menu.items[0]', 'menu.items[1]']);
    const out = apply(file, tr({ 'menu.start': 'Почати', 'menu.items[1]': 'Два' })) as typeof json;
    expect(out).toEqual({ menu: { start: 'Почати', items: ['One', 'Два'] }, version: '1.0', empty: '' });
    expect(json.menu.start).toBe('Start');
  });
});

const RPY = `define e = Character("Eileen")
label start:
    scene bg room
    e "Hello, \\"world\\"!"
    "Narrator line."
    "Eileen" "Speaker as string."
    e "Wait..." with dissolve
    $ x = "not text"
    python:
        y = "also not text"
    menu:
        "Go left":
            jump left
        "Go right" if flag:
            jump right
    show eileen happy
    return
`;

describe('renpy', () => {
  const file = { name: 'script.rpy', json: null, text: RPY };
  it('finds dialogue and menu choices, skips code', () => {
    const u = extract(file);
    expect(u.map(x => [x.key, x.kind, x.speaker, x.source])).toEqual([
      ['L4', 'dialogue', 'e', 'Hello, "world"!'],
      ['L5', 'dialogue', '', 'Narrator line.'],
      ['L6', 'dialogue', 'Eileen', 'Speaker as string.'],
      ['L7', 'dialogue', 'e', 'Wait...'],
      ['L12', 'choice', '', 'Go left'],
      ['L14', 'choice', '', 'Go right'],
    ]);
  });
  it('replaces only the text, with escaping, leaving the rest of every line intact', () => {
    const out = apply(file, tr({ L4: 'Привіт, "світе"!', L7: 'Зачекай...', L14: 'Іти праворуч' })) as string;
    const lines = out.split('\n');
    expect(lines[3]).toBe('    e "Привіт, \\"світе\\"!"');
    expect(lines[6]).toBe('    e "Зачекай..." with dissolve');
    expect(lines[13]).toBe('        "Іти праворуч" if flag:');
    expect(lines[7]).toBe('    $ x = "not text"');
    expect(out.split('\n').length).toBe(RPY.split('\n').length);
  });
});

describe('build with text formats', () => {
  it('outputs text for text formats and JSON for JSON formats', () => {
    const game = [{ name: 'ui.csv', json: null, text: 'id,text\n1,Hello\n' }, { name: 'en.json', json: { a: 'Hi' } }];
    const views = readGame(game);
    const saved = { ...emptyProject('t'), files: { 'ui.csv': { '1': { target: 'Привіт', status: 'appr' as const, mt: 1 } }, 'en.json': { a: { target: 'Вітаю', status: 'appr' as const, mt: 1 } } } };
    const r = build(game, views, saved, { onlyApproved: true, blockErrors: true, qa: { tolerancePct: 100, terms: [] } });
    expect(r.files.map(f => fileText(f))).toEqual(['id,text,translation\n1,Hello,Привіт\n', '{"a":"Вітаю"}']);
  });
});
