import { describe, expect, it } from 'vitest';
import { DEFAULT_NAME, emptyProject, gameTitleOf, iconLetters, nameFromFolder, nameSourceOf, projectTitle, deserialize, serialize } from '../src/core';
import type { SavedProject } from '../src/core';

const proj = (settings: Partial<SavedProject['settings']> = {}, over: Partial<SavedProject> = {}): SavedProject => { const p = emptyProject(DEFAULT_NAME); return { ...p, ...over, settings: { ...p.settings, ...settings } }; };
const sys = (title: string) => ({ 'System.json': [{ key: 'gameTitle', source: title, speaker: '', kind: 'name' as const, context: '' }] });

describe('the name of a project', () => {
  it('comes from the game folder, not from the folders inside it', () => {
    expect(nameFromFolder('D:\\Games\\Deserted cottage\\www\\data')).toBe('Deserted cottage');
    expect(nameFromFolder('/home/me/games/moon_vale/data')).toBe('moon vale');
    expect(nameFromFolder('C:\\')).toBe('');
    expect(nameFromFolder('data')).toBe('');
    expect(nameFromFolder('Neon Ruins')).toBe('Neon Ruins');
  });
  it('reads the title the game gives itself', () => {
    expect(gameTitleOf(sys('The Deserted Cottage'))).toBe('The Deserted Cottage');
    expect(gameTitleOf(undefined)).toBe('');
  });
  it('is the folder by default, the game title or a name written by hand when asked, and falls back step by step', () => {
    expect(projectTitle(proj({ folderName: 'Cottage' }, { snapshot: sys('The Cottage') }))).toBe('Cottage');
    expect(projectTitle(proj({ nameFrom: 'game', folderName: 'Cottage' }, { snapshot: sys('The Cottage') }))).toBe('The Cottage');
    expect(projectTitle(proj({ nameFrom: 'custom', title: 'Покинута хатина', folderName: 'Cottage' }))).toBe('Покинута хатина');
    expect(projectTitle(proj({ nameFrom: 'custom', title: '  ', folderName: 'Cottage' }))).toBe('Cottage');
    expect(nameSourceOf(proj({ nameFrom: 'custom' }))).toBe('folder');
    expect(projectTitle(proj({}, { snapshot: sys('The Cottage') }))).toBe('The Cottage');
    expect(projectTitle(proj({}, { name: 'Мій переклад' }))).toBe('Мій переклад');
    expect(projectTitle(proj())).toBe(DEFAULT_NAME);
  });
});

describe('the icon of a project', () => {
  it('has one letter for one word, two for two words, skips the little words, and may be written by hand', () => {
    expect(iconLetters(proj({ folderName: 'Transly' }))).toBe('T');
    expect(iconLetters(proj({ folderName: 'Deserted cottage' }))).toBe('DC');
    expect(iconLetters(proj({ folderName: 'Dungeon of the Forgotten King' }))).toBe('DF');
    expect(iconLetters(proj({ folderName: 'Покинута хатина' }))).toBe('ПХ');
    expect(iconLetters(proj({ folderName: 'Deserted cottage', iconText: 'xyz' }))).toBe('XY');
    expect(iconLetters(proj({ folderName: '  ' }))).toBe('Н');
  });
});

describe('the name settings are kept and repaired', () => {
  it('survive a save; wrong types are dropped', () => {
    const p = proj({ nameFrom: 'custom', title: 'Хатина', folderName: 'Cottage', iconText: 'ХТ' });
    expect(deserialize(serialize(p)).settings).toMatchObject({ nameFrom: 'custom', title: 'Хатина', folderName: 'Cottage', iconText: 'ХТ' });
    const raw = JSON.parse(serialize(p)); raw.settings.nameFrom = 'wild'; raw.settings.title = 5; raw.settings.iconText = 'toolong';
    const back = deserialize(JSON.stringify(raw)).settings;
    expect(back.nameFrom).toBeUndefined(); expect(back.title).toBeUndefined(); expect(back.iconText).toBeUndefined();
  });
});
