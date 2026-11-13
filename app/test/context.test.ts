import { describe, expect, it } from 'vitest';
import { buildUsage, describePage, emptyProject, explainCodes, extract, findReplace, sysNamesOf, usageKey } from '../src/core';
import type { Entry, FileView, GameFile, Unit } from '../src/core';

const cmd = (code: number, parameters: unknown[], indent = 0) => ({ code, indent, parameters });
const system: GameFile = { name: 'System.json', json: { currencyUnit: 'Gold', variables: ['', 'Karma', '', 'Coins'], switches: ['', 'Met cook'], terms: {} } };
const items: GameFile = { name: 'Items.json', json: [null, { id: 1, name: 'Torch', description: 'Burns.', note: '<Cost: 50>' }] };
const map: GameFile = { name: 'Map003.json', json: { events: [null, { id: 1, name: 'cook', x: 5, y: 6, pages: [
  { trigger: 3, conditions: { switch1Valid: true, switch1Id: 1, variableValid: true, variableId: 3, variableValue: 10, selfSwitchValid: true, selfSwitchCh: 'B' }, list: [cmd(126, [1, 0, 0, 2]), cmd(101, ['', 0, 0, 2, '']), cmd(401, ['Hi']), cmd(0, [])] }] }] } };
const e = (target: string): Entry => ({ target, status: 'draft', mt: 1 });

describe('game context', () => {
  it('reads switch and variable names and the currency', () => {
    expect(sysNamesOf([system])).toEqual({ variables: { 1: 'Karma', 3: 'Coins' }, switches: { 1: 'Met cook' }, currency: 'Gold' });
    expect(sysNamesOf([items])).toBeUndefined();
  });
  it('explains control codes once each', () => {
    const names = sysNamesOf([system]);
    const r = explainCodes('\\N[1] has \\V[3] \\G, \\V[3] and \\C[2]x\\C[0]\\!', n => (n === 1 ? 'Hero' : undefined), names);
    expect(r.map(x => x.code)).toEqual(['\\N[1]', '\\V[3]', '\\G', '\\C[2]', '\\C[0]', '\\!']);
    expect(r[0]!.meaning).toContain('Hero'); expect(r[1]!.meaning).toContain('Coins'); expect(r[2]!.meaning).toContain('Gold');
  });
  it('keeps the page conditions on the first row of the page', () => {
    const rows = extract(map);
    expect(rows[0]!.page).toEqual({ trigger: 3, x: 5, y: 6, switches: [1], variable: { id: 3, min: 10 }, selfSwitch: 'B' });
    expect(rows[1]).toBeUndefined();
    expect(describePage(rows[0]!.page!, sysNamesOf([system]))).toEqual(['запуск: автозапуск', 'клітинка 5, 6', 'перемикач 1 «Met cook» увімкнено', 'змінна 3 «Coins» ≥ 10', 'локальний перемикач B']);
  });
  it('keeps a database note and finds where an item is handed out', () => {
    expect(extract(items)[0]!.dbNote).toBe('<Cost: 50>');
    const u = buildUsage([map], f => (f === 'Map003.json' ? 'Kitchen' : undefined));
    expect(u.get(usageKey('Items.json', '[1].name')!)).toEqual(['Map003.json (Kitchen) · cook']);
  });
});

const unit = (key: string, source: string): Unit => ({ key, source, speaker: '', kind: 'dialogue', context: 'c' });
const views: FileView[] = [{ name: 'a.json', units: [unit('1', 'Sword'), unit('2', 'Sword'), unit('3', 'Shield')] }, { name: 'b.json', units: [unit('1', 'Sword'), unit('2', 'Shield')] }];
const saved = { ...emptyProject('p'), files: { 'a.json': { 1: e('Меч'), 2: e('Клинок'), 3: e('Щит') }, 'b.json': { 1: e('Меч'), 2: e('Щит') } } };

describe('find and replace', () => {
  it('previews matches in translations, whole words and case on request', () => {
    const m = findReplace(views, saved, { find: 'меч', replace: 'Меч', caseSensitive: false, wholeWord: true });
    expect(m.map(x => [x.file, x.key, x.after])).toEqual([['a.json', '1', 'Меч'], ['b.json', '1', 'Меч']]);
    expect(findReplace(views, saved, { find: 'меч', replace: 'x', caseSensitive: true, wholeWord: false })).toHaveLength(0);
    expect(findReplace(views, saved, { find: 'Ще', replace: 'x', caseSensitive: false, wholeWord: true })).toHaveLength(0);
    expect(findReplace(views, saved, { find: '', replace: 'x', caseSensitive: false, wholeWord: false })).toEqual([]);
  });
});

