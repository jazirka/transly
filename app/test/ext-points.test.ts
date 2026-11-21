import { afterEach, describe, expect, it } from 'vitest';
import { I18n, PluginRegistry, applyGlossaryImport, check, checkManifest, declarativeRules, glossaryTerms, pluginCommands, planGlossaryImport, planSteps, qaOf, runSteps, setPluginQaRules, withRuleLevel } from '../src/core';
import type { FileView, SavedProject } from '../src/core';
import { activeIssues } from '../src/core/qa';

/** The extension points that need no code: commands (replacements, help, links), rules of QA and glossaries, all written as data in the manifest. */
const sha = 'sha256-' + 'a'.repeat(64);
const base = { manifestVersion: 1, id: 'acme.style', name: 'Style pack', version: '1.0.0', author: 'Acme' };
const add = (reg: PluginRegistry, contributes: unknown, extra: Record<string, unknown> = {}, files: Record<string, string> = {}, enabled = true) => {
  const r = checkManifest({ ...base, contributes, ...extra });
  if (!r.ok) throw new Error(r.errors.join('; '));
  return reg.add({ manifest: r.manifest, builtin: false, enabled, handlers: [], files: new Map(Object.entries(files)), source: { kind: 'file' } });
};
const errorsOf = (contributes: unknown, extra: Record<string, unknown> = {}): string => { const r = checkManifest({ ...base, contributes, ...extra }); return r.ok ? '' : r.errors.join(' | '); };

afterEach(() => setPluginQaRules([]));

describe('manifest: commands, qaRules, glossaries', () => {
  it('accepts well-formed contributions', () => {
    const r = checkManifest({ ...base, files: { 'terms.tsv': sha }, contributes: {
      help: [{ id: 'how', title: 'How', body: 'text' }],
      commands: [
        { id: 'fix-quotes', title: 'Fix quotes', action: 'replace', steps: [{ find: '"', replace: '«' }] },
        { id: 'how', title: 'How to use', action: 'help', help: 'how' },
        { id: 'site', title: 'Site', action: 'link', url: 'https://example.com/guide' },
      ],
      qaRules: [{ id: 'no-slang', title: 'No slang', severity: 'warn', check: { type: 'forbid', items: [{ find: 'круто' }] } }],
      glossaries: [{ id: 'core', title: 'Core terms', terms: [{ en: 'sword', uk: 'меч' }] }, { id: 'big', title: 'Big', file: 'terms.tsv' }],
    } });
    expect(r.ok).toBe(true);
  });

  it('rejects what is wrong, saying where', () => {
    expect(errorsOf({ commands: [{ id: 'x', title: 'X', action: 'replace', steps: [] }] })).toMatch(/steps/);
    expect(errorsOf({ commands: [{ id: 'x', title: 'X', action: 'link', url: 'http://example.com' }] })).toMatch(/https/);
    expect(errorsOf({ commands: [{ id: 'x', title: 'X', action: 'help', help: 'nope' }] })).toMatch(/help/);
    expect(errorsOf({ commands: [{ id: 'x', title: 'X', action: 'run' }] })).toMatch(/action/);
    expect(errorsOf({ commands: [{ id: 'x', title: 'X', action: 'link', url: 'https://a.b' }, { id: 'x', title: 'Y', action: 'link', url: 'https://a.b' }] })).toMatch(/повторюється/);
    expect(errorsOf({ qaRules: [{ id: 'r', title: 'R', check: { type: 'regex', pattern: '(a+)+' } }] })).toMatch(/type/);
    expect(errorsOf({ qaRules: [{ id: 'r', title: 'R', severity: 'fatal', check: { type: 'sameAsSource' } }] })).toMatch(/severity/);
    expect(errorsOf({ qaRules: [{ id: 'r', title: 'R', check: { type: 'maxLength', max: 0 } }] })).toMatch(/max/);
    expect(errorsOf({ qaRules: [{ id: 'r', title: 'R', kinds: ['weird'], check: { type: 'sameAsSource' } }] })).toMatch(/kinds/);
    expect(errorsOf({ qaRules: [{ id: 'r', title: 'R', check: { type: 'forbid', items: [{ find: '' }] } }] })).toMatch(/find/);
    expect(errorsOf({ glossaries: [{ id: 'g', title: 'G' }] })).toMatch(/terms|file/);
    expect(errorsOf({ glossaries: [{ id: 'g', title: 'G', file: 'terms.tsv' }] })).toMatch(/контрольної суми/);
    expect(errorsOf({ glossaries: [{ id: 'g', title: 'G', terms: [{ en: 'a' }] }] })).toMatch(/en/);
  });
});

describe('rules of QA from a plugin', () => {
  const rule = (q: object, enabled = true) => {
    const reg = new PluginRegistry(new I18n());
    add(reg, { qaRules: [{ id: 'r', title: 'R', ...q }] }, {}, {}, enabled);
    setPluginQaRules(declarativeRules(reg.list()));
    return reg;
  };
  const issues = (source: string, target: string, kind?: string) => check({ source, ...(kind ? { kind: kind as 'dialogue' } : {}) }, target, { tolerancePct: 100, terms: [], rules: qaOf(undefined) }).filter(i => i.key.startsWith('acme.style:'));

  it('forbid: an advice with a ready fix; the project\'s own text before the word is kept', () => {
    rule({ check: { type: 'forbid', items: [{ find: 'круто', replace: 'чудово' }, { find: 'ок', wholeWord: true, replace: 'добре' }] } });
    const [i] = issues('Cool!', 'Це круто, ок?');
    expect(i?.key).toBe('acme.style:r');
    expect(i?.severity).toBe('warn');
    expect(i?.fix?.text).toBe('Це чудово, добре?');
    expect(issues('Cool!', 'Це чудово.')).toEqual([]);
    // «ок» as a whole word only
    expect(issues('x', 'Це покинув')).toEqual([]);
  });

  it('forbid: a word that stands in the original is the game\'s own and is left alone', () => {
    rule({ check: { type: 'forbid', items: [{ find: 'ok' }] } });
    expect(issues('ok', 'ok')).toEqual([]);
    expect(issues('yes', 'ok')).toHaveLength(1);
  });

  it('forbid: control codes are not text', () => {
    rule({ check: { type: 'forbid', items: [{ find: 'C', caseSensitive: true }] } });
    expect(issues('\\C[2]Hi', '\\C[2]Привіт')).toEqual([]);
  });

  it('require: when the original has the word, the translation must have its counterpart', () => {
    rule({ check: { type: 'require', when: { find: 'Sir', wholeWord: true }, then: { find: 'пане' } } });
    expect(issues('Yes, Sir.', 'Так, пане.')).toEqual([]);
    expect(issues('Yes, Sir.', 'Так.')).toHaveLength(1);
    expect(issues('Yes.', 'Так.')).toEqual([]);
  });

  it('maxLength and sameAsSource', () => {
    rule({ check: { type: 'maxLength', max: 10 } });
    expect(issues('Hello', 'Привіт, друже мій')).toHaveLength(1);
    expect(issues('Hello', 'Привіт')).toEqual([]);
    rule({ check: { type: 'sameAsSource' } });
    expect(issues('Hello there', 'Hello there')).toHaveLength(1);
    expect(issues('1234', '1234')).toEqual([]);
    expect(issues('Hello there', 'Привіт')).toEqual([]);
  });

  it('severity bad is an error that blocks, kinds limit the rule, the project can switch it off', () => {
    rule({ severity: 'bad', kinds: ['name'], check: { type: 'maxLength', max: 3 } });
    expect(issues('Hero', 'Герой', 'dialogue')).toEqual([]);
    const [i] = issues('Hero', 'Герой', 'name');
    expect(i?.severity).toBe('bad');
    const off = withRuleLevel(undefined, 'acme.style:r', 'off');
    const out = check({ source: 'Hero', kind: 'name' }, 'Герой', { tolerancePct: 100, terms: [], rules: qaOf({ qa: off }) });
    expect(out.filter(x => x.key === 'acme.style:r')).toEqual([]);
  });

  it('a plugin that is switched off brings no rules', () => {
    rule({ check: { type: 'maxLength', max: 1 } }, false);
    expect(issues('Hello', 'Привіт')).toEqual([]);
  });

  it('the translator can ignore a remark of a plugin like any other', () => {
    rule({ check: { type: 'maxLength', max: 1 } });
    const unit = { source: 'Hello' };
    const opts = { tolerancePct: 100, terms: [], rules: qaOf(undefined) };
    expect(activeIssues(unit, { target: 'Привіт' }, opts).some(i => i.key === 'acme.style:r')).toBe(true);
    expect(activeIssues(unit, { target: 'Привіт', ign: ['acme.style:r'] }, opts).some(i => i.key === 'acme.style:r')).toBe(false);
  });

  it('a rule that throws does not stop the check of the row', () => {
    setPluginQaRules([{ id: 'bad.plugin:boom', title: 'Boom', explain: '', cat: 'style', def: 'warn', fixable: false, plugin: 'bad.plugin', run() { throw new Error('boom'); } }]);
    expect(() => check({ source: 'Hello' }, 'Привіт', { tolerancePct: 25, terms: [], rules: qaOf(undefined) })).not.toThrow();
  });
});

describe('glossaries of a plugin', () => {
  const saved = (terms: { en: string; uk: string }[]): SavedProject => ({ version: 1, name: 'p', sourceLang: 'en', targetLang: 'uk', resetEpoch: 0, files: {}, memory: [], terms: terms.map(t => ({ ...t, mt: 1 })), settings: {} } as unknown as SavedProject);

  it('reads the terms of the manifest, of a .tsv and of a .json', () => {
    const reg = new PluginRegistry(new I18n());
    const rec = add(reg, { glossaries: [
      { id: 'a', title: 'A', terms: [{ en: 'sword', uk: 'меч', alt: ['клинок'] }, { en: 'sword', uk: 'дубль' }] },
      { id: 'b', title: 'B', file: 'b.tsv' }, { id: 'c', title: 'C', file: 'c.json' },
    ] }, { files: { 'b.tsv': sha, 'c.json': sha } }, { 'b.tsv': '# comment\nshield\tщит\tбуклер; тарч\tnote\n\nbow\tлук', 'c.json': JSON.stringify([{ en: 'axe', uk: 'сокира' }, { en: 'x' }]) });
    const [a, b, c] = rec.manifest.contributes!.glossaries!;
    const ra = glossaryTerms(rec, a!), rb = glossaryTerms(rec, b!), rc = glossaryTerms(rec, c!);
    expect(ra.terms).toEqual([{ en: 'sword', uk: 'меч', alt: ['клинок'] }]);
    expect(ra.skipped).toBe(1);
    expect(rb.terms).toEqual([{ en: 'shield', uk: 'щит', alt: ['буклер', 'тарч'], note: 'note' }, { en: 'bow', uk: 'лук' }]);
    expect(rc.terms).toEqual([{ en: 'axe', uk: 'сокира' }]);
    expect(rc.skipped).toBe(1);
  });

  it('plans: new, the same, and different (kept as the translator has them); applies only the new', () => {
    const s = saved([{ en: 'Sword', uk: 'меч' }, { en: 'bow', uk: 'цибуля' }]);
    const plan = planGlossaryImport(s, [{ en: 'sword', uk: 'Меч' }, { en: 'bow', uk: 'лук' }, { en: 'axe', uk: 'сокира', alt: ['топір'] }]);
    expect(plan.same.map(t => t.en)).toEqual(['sword']);
    expect(plan.differ).toEqual([{ brought: { en: 'bow', uk: 'лук' }, has: 'цибуля' }]);
    expect(plan.add.map(t => t.en)).toEqual(['axe']);
    expect(applyGlossaryImport(s, plan, 5)).toBe(1);
    expect(s.terms.find(t => t.en === 'axe')).toMatchObject({ uk: 'сокира', alt: ['топір'] });
    expect(s.terms.find(t => t.en === 'bow')?.uk).toBe('цибуля');
  });
});

describe('commands of a plugin', () => {
  it('lists the commands of working plugins only, with the plugin\'s name', () => {
    const reg = new PluginRegistry(new I18n());
    add(reg, { help: [{ id: 'how', title: 'How', body: 'b' }], commands: [{ id: 'q', title: 'Quotes', action: 'replace', steps: [{ find: '"', replace: '«' }] }, { id: 'h', title: 'Help', action: 'help', help: 'how' }] });
    const cmds = pluginCommands(reg.list());
    expect(cmds.map(c => [c.ref, c.title, c.pluginName, c.action])).toEqual([['acme.style/q', 'Quotes', 'Style pack', 'replace'], ['acme.style/h', 'Help', 'Style pack', 'help']]);
    expect(cmds[1]?.help).toBe('acme.style:how');
    reg.setEnabled('acme.style', false);
    expect(pluginCommands(reg.list())).toEqual([]);
  });

  it('runs the steps in order, whole words and case as asked', () => {
    expect(runSteps('Привіт, привіт-привіт!', [{ find: 'привіт', replace: 'здоров', wholeWord: true }]).after).toBe('здоров, здоров-здоров!');
    expect(runSteps('Привіт', [{ find: 'привіт', replace: 'х', caseSensitive: true }])).toEqual({ after: 'Привіт', count: 0 });
    expect(runSteps('aa', [{ find: 'a', replace: 'b' }, { find: 'bb', replace: 'c' }])).toEqual({ after: 'c', count: 3 });
  });

  it('plans the changes of a replacing command over the project without touching it', () => {
    const views = [{ name: 'f.json', units: [{ key: 'a', source: 'A' }, { key: 'b', source: 'B' }, { key: 'c', source: 'C' }] }] as unknown as FileView[];
    const saved = { files: { 'f.json': { a: { target: 'так "ок"' }, b: { target: 'ні' }, c: { target: '' } } } } as unknown as SavedProject;
    const plan = planSteps(views, saved, [{ find: '"', replace: '«' }]);
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({ key: 'a', before: 'так "ок"', after: 'так «ок«', count: 2 });
    expect(saved.files['f.json']!.a!.target).toBe('так "ок"');
  });
});
