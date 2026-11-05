import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { classifyFolder, folderBanner, folderLine, SAME_GAME } from '../src/ui/folder-service';
import type { PickedFile } from '../src/ui/folder';
import { forgetGameDir, migrateGameDirKeys, rememberedExe, rememberedGameDir, setProject } from '../src/ui/desktop';

const file = (name: string, path = `C:/Games/Hero/www/data/${name}`): PickedFile => ({ name, path, read: async () => '[]' }) as PickedFile;
const names = (...n: string[]): PickedFile[] => n.map(x => file(x));

describe('classifyFolder: what a remembered folder is', () => {
  const project = ['Actors.json', 'Items.json', 'Map001.json', 'Map002.json'];

  it('no remembered folder', () => {
    expect(classifyFolder(null, project)).toEqual({ kind: 'none' });
  });

  it('a folder that was moved or deleted keeps its path and the reason', () => {
    expect(classifyFolder({ ok: false, root: 'D:/old', reason: 'missing' }, project)).toEqual({ kind: 'missing', root: 'D:/old', reason: 'missing' });
    expect(classifyFolder({ ok: false, root: 'D:/old', reason: 'failed' }, project)).toEqual({ kind: 'missing', root: 'D:/old', reason: 'failed' });
  });

  it('the same game: all (or at least half of) the files are there', () => {
    const all = classifyFolder({ ok: true, root: 'C:/Games/Hero', files: names(...project) }, project);
    expect(all.kind).toBe('ok');
    const half = classifyFolder({ ok: true, root: 'C:/Games/Hero', files: names('Actors.json', 'Items.json', 'Skills.json') }, project);
    expect(half.kind).toBe('ok');
    expect(SAME_GAME).toBe(0.5);
  });

  it('another game: fewer than half of the project files are found, and the build must stay off', () => {
    const r = classifyFolder({ ok: true, root: 'C:/Games/Other', files: names('Actors.json', 'Weapons.json') }, project);
    expect(r).toMatchObject({ kind: 'other', matched: 1, expected: 4 });
  });

  it('file names are compared without the folders they came from', () => {
    const nested = [file('data/Actors.json'), file('data/Items.json'), file('data/Map001.json')];
    expect(classifyFolder({ ok: true, root: 'C:/G', files: nested }, project).kind).toBe('ok');
    expect(classifyFolder({ ok: true, root: 'C:/G', files: names('Actors.json', 'Items.json') }, ['data/Actors.json', 'data/Items.json']).kind).toBe('ok');
  });

  it('a project that knows no files yet cannot tell games apart: the folder is accepted', () => {
    expect(classifyFolder({ ok: true, root: 'C:/G', files: names('Anything.json') }, []).kind).toBe('ok');
  });

  it('the data folder is taken from the files that were read, not guessed', () => {
    const r = classifyFolder({ ok: true, root: 'C:/Games/Hero', files: names(...project) }, project);
    expect(r.kind === 'ok' && r.dataDir).toBe('C:/Games/Hero/www/data');
  });
});

describe('folderBanner and folderLine', () => {
  it('say nothing about a folder that is fine or absent', () => {
    expect(folderBanner({ kind: 'none' })).toBeNull();
    expect(folderBanner({ kind: 'ok', root: 'C:/G', dataDir: 'C:/G/data', files: [] })).toBeNull();
  });

  it('a missing folder: says the translation is safe and offers a new folder or work without one', () => {
    const b = folderBanner({ kind: 'missing', root: 'D:/old', reason: 'missing' })!;
    expect(b.text).toContain('Папку гри не знайдено');
    expect(b.text).toContain('D:/old');
    expect(b.text).toContain('збережено');
    expect(b.actions).toEqual(['repick', 'hide']);
  });

  it('an unreachable folder is told apart from a missing one', () => {
    const b = folderBanner({ kind: 'missing', root: 'D:/old', reason: 'failed' })!;
    expect(b.text).toContain('Немає доступу');
  });

  it('another game: names the counts and offers to use it anyway', () => {
    const b = folderBanner({ kind: 'other', root: 'C:/Other', dataDir: null, files: [], matched: 1, expected: 4 })!;
    expect(b.text).toContain('1 із 4');
    expect(b.actions).toEqual(['repick', 'use', 'hide']);
  });

  it('one line for the project card and the settings', () => {
    expect(folderLine({ kind: 'ok', root: 'C:/G', dataDir: null, files: [] }, 'C:/G')).toBe('C:/G');
    expect(folderLine({ kind: 'missing', root: 'D:/old', reason: 'missing' }, 'D:/old')).toBe('D:/old (не знайдено)');
    expect(folderLine({ kind: 'other', root: 'C:/O', dataDir: null, files: [], matched: 0, expected: 3 }, 'C:/O')).toBe('C:/O (схоже, інша гра)');
    expect(folderLine({ kind: 'none' }, null)).toBe('Папку гри не вибрано');
    // Before the folder is looked up the remembered path is shown as it is.
    expect(folderLine({ kind: 'none' }, 'C:/G')).toBe('C:/G');
  });
});

describe('the game folder belongs to the project', () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
    });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('the old shared key is handed to the first project once and then dropped, so a second project does not inherit it', () => {
    store.set('transly-game-dir', 'C:/Old/Hero');
    store.set('transly-game-exe', 'C:/Old/Hero/Game.exe');
    setProject('default');
    expect(rememberedGameDir()).toBe('C:/Old/Hero');
    expect(rememberedExe()).toBe('C:/Old/Hero/Game.exe');
    expect(store.has('transly-game-dir')).toBe(false);
    setProject('other');
    expect(rememberedGameDir()).toBeNull();
    expect(rememberedExe()).toBeNull();
    setProject('default');
    expect(rememberedGameDir()).toBe('C:/Old/Hero');
  });

  it('a project that already has its own folder keeps it; the shared key is still dropped', () => {
    store.set('transly-game-dir:default', 'C:/New/Hero');
    store.set('transly-game-dir', 'C:/Old/Other');
    setProject('default');
    expect(rememberedGameDir()).toBe('C:/New/Hero');
    expect(store.has('transly-game-dir')).toBe(false);
  });

  it('migration without anything stored changes nothing', () => {
    setProject('default');
    migrateGameDirKeys();
    expect(rememberedGameDir()).toBeNull();
  });

  it('forgetting removes the folder of this project only', () => {
    store.set('transly-game-dir:a', 'C:/A');
    store.set('transly-game-dir:b', 'C:/B');
    setProject('a');
    forgetGameDir();
    expect(rememberedGameDir()).toBeNull();
    setProject('b');
    expect(rememberedGameDir()).toBe('C:/B');
  });
});
