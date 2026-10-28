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

import { headerName, speakerCandidates, speakerOf } from '../src/core';

describe('speakers', () => {
  const faceMap = { events: [null, { id: 1, name: 'ghoul', pages: [{ list: [
    cmd(101, ['Aura1', 3, 0, 2, '']), cmd(401, ['I see you.']),
    cmd(101, ['', 0, 0, 2, 'Named']), cmd(401, ['Hi.']),
    cmd(101, ['', 0, 0, 2, '']), cmd(401, ['Plain line.']),
    cmd(101, ['', 0, 0, 2, '']), cmd(401, ['Another.']),
  ] }] }] };
  const units = extract({ name: 'Map005.json', json: faceMap });

  it('keeps the face graphic and the event name on messages', () => {
    expect(units.map(u => [u.speaker, u.face, u.event])).toEqual([['', 'Aura1#3', 'ghoul'], ['Named', undefined, 'ghoul'], ['', undefined, 'ghoul'], ['', undefined, 'ghoul']]);
  });

  it('resolves the speaker: game name, then face mapping, then event mapping', () => {
    const map = { 'face:Aura1#3': { name: 'Марина', mt: 1 }, 'event:ghoul': { name: 'Гуль', mt: 1 } };
    expect(units.map(u => speakerOf(u, map))).toEqual(['Марина', 'Named', 'Гуль', 'Гуль']);
    expect(units.map(u => speakerOf(u, undefined))).toEqual(['', 'Named', '', '']);
  });

  it('reads a name printed as the first line, its first letter drawn as an icon', () => {
    expect(headerName('\\>\\i[73]\\}ANITOR\\{\\<\n"Gyah gyah!"')).toBe('JANITOR');
    expect(headerName('\\i[76]\\}ARCOH\\{\\< "Hi"')).toBe('MARCOH');
    expect(headerName('\\>\\i[84]\\}ILLAGER\\{\\<\nHm')).toBe('VILLAGER');
    expect(headerName('\\i[144]\\}OCKETCAT\\{\\<\nHm')).toBe('');
    expect(headerName('\\v[355]\\c[2]\\i[217]Shillings\\c[0] is all you got.')).toBe('');
    const u = { speaker: '', source: '\\>\\i[73]\\}ANITOR\\{\\<\nHm' };
    expect(speakerOf(u, undefined)).toBe('JANITOR');
    expect(speakerOf(u, { 'hdr:JANITOR': { name: 'Двірник', mt: 1 } })).toBe('Двірник');
    expect(speakerOf({ ...u, speaker: 'Named' }, { 'hdr:JANITOR': { name: 'Двірник', mt: 1 } })).toBe('Named');
    const c = speakerCandidates([{ name: 'Map005.json', units: [{ key: 'a', source: u.source, speaker: '', kind: 'dialogue', context: '', face: 'Aura1#3' }, { key: 'b', source: u.source, speaker: '', kind: 'dialogue', context: '' }] }]);
    expect(c.map(x => [x.key, x.count])).toEqual([['hdr:JANITOR', 2]]);
  });

  it('lists candidates: faces first, events only when they carry enough messages', () => {
    const c = speakerCandidates([{ name: 'Map005.json', units }], 2);
    expect(c.map(x => [x.key, x.count])).toEqual([['face:Aura1#3', 1], ['event:ghoul', 3]]);
    expect(speakerCandidates([{ name: 'Map005.json', units }], 5).map(x => x.key)).toEqual(['face:Aura1#3']);
  });
});
