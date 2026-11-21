import { describe, expect, it } from 'vitest';
import { I18n, PluginRegistry, i18n as appI18n, parsePoCatalog, pluginStrings, plural, registerBuiltins } from '../src/core';
import { BUNDLED_LANGUAGES } from '../src/lang';
import { langPluginId } from '../src/core/ext/builtin';

/** The English pack that comes with the application (src/lang/en.po): complete for what the application says about itself, and safe to switch on. */
const reg = (): { reg: PluginRegistry; i18n: I18n } => {
  const i18n = new I18n();
  const r = new PluginRegistry(i18n);
  registerBuiltins(r);
  return { reg: r, i18n };
};
const en = BUNDLED_LANGUAGES.find(l => l.code === 'en')!;
const cat = parsePoCatalog(en.po);
const SEP = '\u0004';
const placeholders = (s: string): string[] => [...s.matchAll(/\{[^}]*\}/g)].map(m => m[0]).sort();

describe('the bundled English pack', () => {
  it('is a built-in plugin that offers English and falls back to Ukrainian', () => {
    const { reg: r, i18n } = reg();
    const rec = r.get(langPluginId('en'));
    expect(rec?.builtin).toBe(true);
    expect(rec?.state).toBe('enabled');
    expect(i18n.languages().map(l => l.code)).toEqual(['uk', 'en']);
    i18n.setLanguage('en');
    expect(i18n.language).toBe('en');
    expect(i18n.translateText('Файл')).toBe('File');
    expect(i18n.translateText('Цього рядка в пакеті немає')).toBeNull();
    i18n.setLanguage('uk');
    expect(i18n.translateText('Файл')).toBeNull();
  });

  it('can be switched off, and then English is gone', () => {
    const { reg: r, i18n } = reg();
    i18n.setLanguage('en');
    r.setEnabled(langPluginId('en'), false);
    expect(i18n.languages().map(l => l.code)).toEqual(['uk']);
    expect(i18n.language).toBe('uk');
  });

  it('keeps every placeholder of the source, so no number or name is lost', () => {
    let n = 0;
    for (const [key, forms] of cat.entries) {
      const id = key.slice(key.indexOf(SEP) + 1);
      for (const f of forms) { n++; expect(placeholders(f), `${id} → ${f}`).toEqual(placeholders(id)); }
    }
    expect(n).toBeGreaterThan(500);
  });

  it('has no leftover Ukrainian in a translation, except where the text is about Ukrainian letters', () => {
    const ABOUT_LETTERS = /ы|э|ъ|ё|ї/;
    for (const [key, forms] of cat.entries) for (const f of forms) {
      if (/[а-щьюяєіїґ]/i.test(f)) expect(ABOUT_LETTERS.test(f), `${key.slice(key.indexOf(SEP) + 1)} → ${f}`).toBe(true);
    }
  });

  it('translates the names, descriptions and help of every built-in plugin', () => {
    const { reg: r, i18n } = reg();
    i18n.setLanguage('en');
    const left: string[] = [];
    for (const rec of r.list().filter(x => x.builtin)) for (const s of pluginStrings(rec.manifest, p => rec.files.get(p))) if (/[а-яіїєґ]/i.test(s) && !i18n.has(s)) left.push(`${rec.manifest.id}: ${s}`);
    expect(left).toEqual([]);
  });

  it('puts the right form after a number: 1 row, 2 rows, 21 rows, 1 234 rows', () => {
    const { i18n } = reg();
    i18n.setLanguage('en');
    // the interface's own text is Ukrainian (plural() writes it and tells the count word); the layer that draws the other language finds the same text and replaces it
    i18n.countWord(['рядок', 'рядки', 'рядків']);
    expect(i18n.translateText('1 рядок')).toBe('1 row');
    expect(i18n.translateText('2 рядки')).toBe('2 rows');
    expect(i18n.translateText('5 рядків')).toBe('5 rows');
    expect(i18n.translateText('21 рядок')).toBe('21 rows');
    expect(i18n.translateText('1 234 рядків')).toBe('1 234 rows');
    expect(i18n.translateText('1,234 рядків')).toBe('1,234 rows');
  });

  it('puts the right form in a longer message, too', () => {
    const { i18n } = reg();
    i18n.setLanguage('en');
    i18n.countWord(['рядок чекає', 'рядки чекають', 'рядків чекають']);
    expect(i18n.translateText('1 рядок чекає вичитки')).toBe('1 row waits for proofreading');
    expect(i18n.translateText('5 рядків чекають вичитки')).toBe('5 rows wait for proofreading');
  });

  it('does not take any text for a number: a phrase that merely ends in a count word is left alone', () => {
    const { i18n } = reg();
    i18n.setLanguage('en');
    i18n.countWord(['рядок', 'рядки', 'рядків']);
    expect(i18n.translateText('Новий рядок')).toBeNull();
    expect(i18n.translateText('Рядок 5 рядків')).toBeNull();
  });

  it('plural() tells the application’s language layer which words count things', () => {
    const { reg: r } = reg();
    void r;
    appI18n.setLanguage('en');
    try {
      const text = plural(5, ['рядок', 'рядки', 'рядків']);
      expect(text).toMatch(/^5\s+рядків$/);
      // the application’s own registry has the same built-in pack
      expect(appI18n.translateText(text)).toBe('5 rows');
    } finally { appI18n.setLanguage('uk'); }
  });
});
