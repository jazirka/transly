import { describe, expect, it } from 'vitest';
import { build, emptyProject, readGame, withEdges } from '../src/core';
import type { Entry, GameFile } from '../src/core';

describe('withEdges', () => {
  it('gives the translation the spaces and line breaks the original has at its edges', () => {
    expect(withEdges(' Continue', 'Продовжити')).toBe(' Продовжити');
    expect(withEdges('Options ', 'Настави')).toBe('Настави ');
    expect(withEdges('\nLine\n', 'Рядок')).toBe('\nРядок\n');
  });
  it('takes away what the translator added that the original does not have', () => {
    expect(withEdges('Continue', '  Продовжити ')).toBe('Продовжити');
  });
  it('leaves alone what already fits, and blank texts', () => {
    expect(withEdges(' Continue', ' Продовжити')).toBe(' Продовжити');
    expect(withEdges('Continue', 'Продовжити')).toBe('Продовжити');
    expect(withEdges('Continue', '   ')).toBe('   ');
    expect(withEdges('   ', 'Продовжити')).toBe('Продовжити');
  });
  it('keeps the inside of the text as it is', () => {
    expect(withEdges(' a  b', 'x  y')).toBe(' x  y');
  });
});

describe('build keeps the padding of the terms of the game, not of the messages', () => {
  const game: GameFile[] = [{ name: 'System.json', json: { gameTitle: 'T', terms: { basic: [], commands: ['Fight', ' Continue', 'Options'], params: [], messages: {} } } },
    { name: 'Map001.json', json: { events: [null, { id: 1, name: 'A', pages: [{ list: [{ code: 101, indent: 0, parameters: ['', 0, 0, 2, ''] }, { code: 401, indent: 0, parameters: [' Hello'] }] }] }] } }];
  const views = readGame(game);
  const entry = (target: string): Entry => ({ target, status: 'done', mt: 1 });
  it('puts the leading space of « Continue» back into the translation of the term, and leaves the message as the translator wrote it', () => {
    const sys = views.find(v => v.name === 'System.json')!, map = views.find(v => v.name === 'Map001.json')!;
    const cont = sys.units.find(u => u.source === ' Continue')!, opt = sys.units.find(u => u.source === 'Options')!, msg = map.units.find(u => u.source.includes('Hello'))!;
    const saved = { ...emptyProject('t'), files: { 'System.json': { [cont.key]: entry('Продовжити'), [opt.key]: entry('Настави') }, 'Map001.json': { [msg.key]: entry('Привіт') } } };
    const r = build(game, views, saved, { onlyApproved: false, blockErrors: false, qa: { tolerancePct: 25, terms: [] } });
    const sysOut = r.files.find(f => f.name === 'System.json')!.json as { terms: { commands: string[] } };
    expect(sysOut.terms.commands).toEqual(['Fight', ' Продовжити', 'Настави']);
    const mapOut = r.files.find(f => f.name === 'Map001.json')!.json as { events: { pages: { list: { parameters: string[] }[] }[] }[] };
    expect(mapOut.events[1]!.pages[0]!.list[1]!.parameters[0]).toBe('Привіт');
  });
});
