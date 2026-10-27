import { describe, expect, it } from 'vitest';
import { apply, extract } from '../src/core';
import type { Translations } from '../src/core';

const cmd = (code: number, parameters: unknown[], indent = 0) => ({ code, indent, parameters });
const map = {
  displayName: 'Cellar',
  events: [null, { id: 14, name: 'Soldier', pages: [{ list: [
    cmd(101, ['', 0, 0, 2, 'Old Soldier']), cmd(401, ['You shouldn\'t be here, kid.']), cmd(401, ['The \\C[2]Dark\\C[0] remembers faces.']),
    cmd(102, [['Leave quietly', 'Stay'], 1]), cmd(402, [0, 'Leave quietly']), cmd(0, []),
    cmd(105, [2, false]), cmd(405, ['Scroll line']),
    cmd(0, []),
  ] }] }],
};

describe('extract', () => {
  it('joins dialogue lines, keeps speaker, extracts choices, scroll text and map name', () => {
    const units = extract({ name: 'Map042.json', json: map });
    expect(units.map(u => [u.key, u.kind])).toEqual([
      ['displayName', 'name'],
      ['events[1].pages[0].list[0]', 'dialogue'],
      ['events[1].pages[0].list[3].choice[0]', 'choice'],
      ['events[1].pages[0].list[3].choice[1]', 'choice'],
      ['events[1].pages[0].list[6]', 'scroll'],
    ]);
    const d = units[1]!;
    expect(d.source).toBe('You shouldn\'t be here, kid.\nThe \\C[2]Dark\\C[0] remembers faces.');
    expect(d.speaker).toBe('Old Soldier');
    expect(d.context).toBe('EV014 · Soldier');
  });

  it('extracts database fields and system terms, ignores unknown files', () => {
    const items = [null, { id: 1, name: 'Key', description: 'Opens a door.' }];
    expect(extract({ name: 'Items.json', json: items }).map(u => u.key)).toEqual(['[1].name', '[1].description']);
    const system = { gameTitle: 'T', currencyUnit: '', elements: ['', 'Blunt'], terms: { basic: ['Level'], commands: [], params: [], messages: { actionFailure: 'No effect!' } } };
    expect(extract({ name: 'System.json', json: system }).map(u => u.key)).toEqual(['gameTitle', 'elements[1]', 'terms.basic[0]', 'terms.messages.actionFailure']);
    expect(extract({ name: 'Tilesets.json', json: [] })).toEqual([]);
  });
});

describe('apply', () => {
  const tr = (entries: Record<string, string>): Translations =>
    Object.fromEntries(Object.entries(entries).map(([k, target]) => [k, { target, status: 'done', mt: 1 }]));

  it('is the identity when nothing is translated and never mutates the input', () => {
    const before = JSON.stringify(map);
    expect(apply({ name: 'Map042.json', json: map }, {})).toEqual(map);
    expect(JSON.stringify(map)).toBe(before);
  });

  it('writes dialogue back, re-splitting lines when the count changes', () => {
    const out = apply({ name: 'Map042.json', json: map }, tr({
      'events[1].pages[0].list[0]': 'Тобі тут не місце, малий.\nМорок \\C[2]Темрява\\C[0] пам’ятає обличчя.\nТретій рядок.',
      'events[1].pages[0].list[3].choice[1]': 'Лишитися',
      displayName: 'Льох',
    })) as typeof map;
    const list = out.events[1]!.pages[0]!.list;
    expect(out.displayName).toBe('Льох');
    expect(list.slice(0, 5).map(c => c.code)).toEqual([101, 401, 401, 401, 102]);
    expect(list[3]!.parameters[0]).toBe('Третій рядок.');
    expect((list[4]!.parameters[0] as string[])[1]).toBe('Лишитися');
    expect((list[4]!.parameters[0] as string[])[0]).toBe('Leave quietly');
  });
});
