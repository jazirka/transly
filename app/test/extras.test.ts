import { describe, expect, it } from 'vitest';
import { GameNameIndex, apply, autoLineLimit, check, extract, pluginCandidates, readGame, splitPluginCommand, wrapLines } from '../src/core';
import type { Translations, Unit } from '../src/core';

const cmd = (code: number, parameters: unknown[]) => ({ code, indent: 0, parameters });
const tr = (o: Record<string, string>): Translations => Object.fromEntries(Object.entries(o).map(([k, target]) => [k, { target, status: 'done' as const, mt: 1 }]));
const map = { displayName: '', events: [null, { id: 1, name: 'cook', pages: [{ list: [
  cmd(108, ['SMALL_TALK']), cmd(101, ['', 0, 0, 2, '']), cmd(401, ['Hello there.']),
  cmd(356, ['GabText You have travelled a great distance']), cmd(356, ['choice_text 2 Leave quietly']), cmd(356, ['choice_text 1 ????']), cmd(356, ['ShowGab']),
  cmd(108, ['MARCOH']), cmd(101, ['', 0, 0, 2, '']), cmd(401, ['I know you.']), cmd(101, ['', 0, 0, 2, '']), cmd(401, ['Still Marcoh.']),
] }] }] };

describe('plugin command text', () => {
  it('splits name, numeric arguments and text', () => {
    expect(splitPluginCommand('GabText Hello world')).toEqual({ name: 'GabText', prefix: 'GabText ', text: 'Hello world' });
    expect(splitPluginCommand('choice_text 2 Leave')).toEqual({ name: 'choice_text', prefix: 'choice_text 2 ', text: 'Leave' });
    expect(splitPluginCommand('ShowGab').name).toBe('ShowGab');
  });
  it('is opt-in: nothing from plugin commands unless named', () => {
    expect(extract({ name: 'Map001.json', json: map }).some(u => u.key.endsWith('.cmd'))).toBe(false);
    const u = extract({ name: 'Map001.json', json: map }, { pluginCommands: ['GabText', 'choice_text'] }).filter(x => x.key.endsWith('.cmd'));
    expect(u.map(x => x.source)).toEqual(['You have travelled a great distance', 'Leave quietly']);
  });
  it('writes translations back keeping the command name and numeric arguments', () => {
    const file = { name: 'Map001.json', json: map };
    const units = extract(file, { pluginCommands: ['GabText', 'choice_text'] }).filter(x => x.key.endsWith('.cmd'));
    const out = apply(file, tr({ [units[0]!.key]: 'Ви пройшли довгий шлях', [units[1]!.key]: 'Піти тихо' })) as typeof map;
    const l = out.events[1]!.pages[0]!.list;
    expect(l[3]!.parameters[0]).toBe('GabText Ви пройшли довгий шлях');
    expect(l[4]!.parameters[0]).toBe('choice_text 2 Піти тихо');
    expect(l[5]!.parameters[0]).toBe('choice_text 1 ????');
  });
  it('lists candidates from the game and pre-selects sentence-like ones', () => {
    const many = { events: [null, { id: 1, name: 'a', pages: [{ list: [...Array(5)].flatMap((_, i) => [cmd(356, [`GabText Line number ${i} here`]), cmd(356, ['choice_text 1 ????'])]) }] }] };
    const c = pluginCandidates([{ name: 'Map001.json', json: many }]);
    expect(c.map(x => [x.name, x.likely])).toEqual([['GabText', true]]);
    expect(c[0]!.count).toBe(5);
  });
});

describe('developer notes and labels', () => {
  it('attaches the latest uppercase comment to messages after it', () => {
    const u = extract({ name: 'Map001.json', json: map }).filter(x => x.kind === 'dialogue');
    expect(u.map(x => x.note)).toEqual(['SMALL_TALK', 'MARCOH', 'MARCOH']);
  });
  it('labels maps from MapInfos and displayName', () => {
    const files = [
      { name: 'MapInfos.json', json: [null, { id: 1, name: 'outskirts' }, { id: 2, name: 'cellar' }] },
      { name: 'Map001.json', json: { displayName: '', events: [null, { id: 1, name: 'x', pages: [{ list: [cmd(101, ['', 0, 0, 2, '']), cmd(401, ['Hi there'])] }] }] } },
      { name: 'Map002.json', json: { displayName: 'Old cellar', events: [null, { id: 1, name: 'x', pages: [{ list: [cmd(101, ['', 0, 0, 2, '']), cmd(401, ['Hi again'])] }] }] } },
    ];
    expect(readGame(files).map(v => [v.name, v.label])).toEqual([['Map001.json', 'outskirts'], ['Map002.json', 'Old cellar']]);
  });
});

describe('game names', () => {
  const unit = (key: string, source: string): Unit => ({ key, source, speaker: '', kind: 'name', context: 'c' });
  const idx = new GameNameIndex([{ name: 'Items.json', units: [unit('[1].name', 'Torch'), unit('[2].name', 'Old Key'), unit('[3].name', 'Ax')] }, { name: 'Map001.json', units: [unit('x', 'Hidden')] }]);
  it('finds database names mentioned in text, whole words, once each, skipping very short names', () => {
    expect(idx.find('You light the torch. The torch burns. Take the old key.').map(g => g.name)).toEqual(['Torch', 'Old Key']);
    expect(idx.find('Torchlight and an ax')).toEqual([]);
    expect(idx.size).toBe(2);
  });
});

describe('line width', () => {
  it('wraps greedily and ignores control codes in the width', () => {
    expect(wrapLines('one two three four', 9)).toBe('one two\nthree\nfour');
    expect(wrapLines('\\C[2]red\\C[0] word', 8)).toBe('\\C[2]red\\C[0] word');
    expect(wrapLines('a\nb c', 10)).toBe('a b c');
  });
  it('derives the limit from the original, only with enough text', () => {
    const lines = Array.from({ length: 300 }, (_, i) => 'x'.repeat(20 + (i % 40)));
    const unit: Unit = { key: 'k', source: lines.join('\n'), speaker: '', kind: 'dialogue', context: 'c' };
    expect(autoLineLimit([{ name: 'a', units: [unit] }])).toBeGreaterThan(50);
    expect(autoLineLimit([{ name: 'a', units: [{ ...unit, source: 'short\nlines' }] }])).toBe(0);
  });
  it('QA warns when a translated line is wider than the window, narrower with a face', () => {
    const u = { source: 'x'.repeat(70), kind: 'dialogue' as const };
    const long = 'я'.repeat(70);
    expect(check(u, long, { tolerancePct: 1000, terms: [], lineLimit: 66 }).map(i => i.key)).toEqual(['wrap']);
    expect(check(u, wrapLines('слово '.repeat(14), 40), { tolerancePct: 1000, terms: [], lineLimit: 66 }).map(i => i.key)).toEqual([]);
    expect(check({ ...u, face: 'A#1' }, 'я'.repeat(60), { tolerancePct: 1000, terms: [], lineLimit: 66 }).map(i => i.key)).toEqual(['wrap']);
    expect(check({ source: 'x'.repeat(70), kind: 'choice' as const }, long, { tolerancePct: 1000, terms: [], lineLimit: 66 })).toEqual([]);
  });
});
