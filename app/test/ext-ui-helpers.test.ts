import { describe, expect, it } from 'vitest';
import { I18n, build, checkManifest, parsePoCatalog, pluginStrings, pluginTemplate, plugins } from '../src/core';
import type { FileView, SavedProject } from '../src/core';
import { miniMarkdown } from '../src/ui/minimd';
import { emptyProject } from '../src/core';

describe('the strings of a plugin for a translator', () => {
  const m = (() => { const r = checkManifest({ manifestVersion: 1, id: 'acme.x', name: 'Wolf', version: '1.0.0', description: 'Reads Wolf games', files: { 'help.md': 'sha256-' + 'a'.repeat(64) }, contributes: { formats: [{ id: 'f', label: 'Wolf data', extensions: ['.wolf'], text: true, spec: { type: 'keyvalue' } }], help: [{ id: 'h', title: 'Open', file: 'help.md' }], settings: [{ id: 's', title: 'Options', fields: [{ key: 'k', type: 'select', label: 'Mode', description: 'How', options: [{ value: 'a', label: 'Fast' }] }] }] } }); if (!r.ok) throw new Error(r.errors.join()); return r.manifest; })();
  it('collects every user-facing string once', () => {
    expect(pluginStrings(m, () => 'Pick the folder').sort()).toEqual(['Fast', 'How', 'Mode', 'Open', 'Options', 'Pick the folder', 'Reads Wolf games', 'Wolf', 'Wolf data']);
  });
  it('writes a template in the context of the plugin that a language pack can fill in', () => {
    const pot = pluginTemplate(m, 'uk', () => 'Pick the folder');
    expect(pot).toContain('msgctxt "plugin:acme.x"');
    const i = new I18n();
    i.add('uk', parsePoCatalog(pot.replace('msgid "Wolf data"\nmsgstr ""', 'msgid "Wolf data"\nmsgstr "Дані Wolf"')), 'pack');
    i.setLanguage('uk');
    expect(i.t('Wolf data', undefined, 'plugin:acme.x')).toBe('Дані Wolf');
    expect(i.t('Wolf data')).toBe('Wolf data');      // another context is another string
  });
});

describe('help text from a plugin', () => {
  it('makes paragraphs, lists, bold, code and https links, and never any other markup', () => {
    const h = miniMarkdown('Hello **world** and `code`\n\n- one\n- two\n\n[site](https://example.com/a?b=1)');
    expect(h).toContain('<p>Hello <b>world</b> and <code>code</code></p>');
    expect(h).toContain('<ul><li>one</li><li>two</li></ul>');
    expect(h).toContain('href="https://example.com/a?b=1"');
  });
  it('escapes HTML, scripts and links that are not https', () => {
    const h = miniMarkdown('<img src=x onerror=alert(1)> <script>alert(1)</script> [bad](javascript:alert(1)) [bad2](http://x.test) [q](https://a.test/"onmouseover="x)');
    expect(h).not.toContain('<img'); expect(h).not.toContain('<script'); expect(h).not.toContain('href="javascript');
    expect(h).not.toContain('href="http://');
    expect(h).not.toMatch(/ onmouseover=/);
  });
});

describe('a build does not hand back files nobody can write', () => {
  it('lists the files whose plugin is off instead of leaving them silently untranslated', () => {
    const saved: SavedProject = { ...emptyProject('P'), files: { 'Map001.json': { k0: { target: 'Привіт', status: 'done', mt: 1 } } } };
    const views: FileView[] = [{ name: 'Map001.json', label: '', units: [{ key: 'k0', source: 'Hello', speaker: '', kind: 'dialogue', context: '' }] } as FileView];
    const game = [{ name: 'Map001.json', json: { events: [] } }];
    const opts = { onlyApproved: false, blockErrors: false, qa: {} as never };
    plugins.setEnabled('transly.rpgmaker', false);
    try { expect(build(game, views, saved, opts).unsupported).toEqual(['Map001.json']); } finally { plugins.setEnabled('transly.rpgmaker', true); }
    expect(build(game, views, saved, opts).unsupported).toEqual([]);
  });
});
