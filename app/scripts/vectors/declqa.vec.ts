import { test } from 'vitest';
import { declarativeRule } from '../../src/core/ext/declqa';
import { i18n, parseJsonCatalog } from '../../src/core/ext/i18n';
import { maskCodes } from '../../src/core/qacodes';
import type { QaRuleContribution, TextMatch } from '../../src/core/ext/types';
import { rng, writeVectors } from './util';

const PID = 'test.plug';
const F = ['cat', 'Cat', 'кіт', 'сім', "сім'я", 'a.b', '(x)', 'foo', 'bar', 'ґанок', '\C[2]', 'x'.repeat(50), 'ab'.repeat(30), 'dog'];
const TXT = ['cat', 'The Cat sat', 'кіт і сім’я', 'сім', 'сімʼя', 'a.b a b', '(x) y', 'foo bar', '\C[2]cat\C[0]', 'x'.repeat(60), 'ab'.repeat(35), 'Hello', 'hello', 'HELLO', 'Привіт', 'привіт', '1234', '12 34', '\V[1]', '', ' ', 'dog dog cat', 'cats', 'barfoo', 'Ґанок', 'one\ntwo', '\C[3]ABCD\C[0]'];
const MSG = [undefined, 'Моє повідомлення', 'Own msg', ''];
const tm = (r: ReturnType<typeof rng>, repl = false): TextMatch & { replace?: string } => ({ find: r.pick(F), ...(r.chance(0.4) ? { wholeWord: r.chance(0.6) } : {}), ...(r.chance(0.4) ? { caseSensitive: r.chance(0.6) } : {}), ...(repl && r.chance(0.7) ? { replace: r.pick(['', 'dog', '$&', 'Пес']) } : {}) });

function genRule(r: ReturnType<typeof rng>): QaRuleContribution {
  const type = r.pick(['forbid', 'require', 'maxLength', 'sameAsSource'] as const);
  const message = r.pick(MSG);
  const check = type === 'forbid' ? { type, items: Array.from({ length: 1 + r.int(5) }, () => tm(r, true)), ...(message !== undefined ? { message } : {}) }
    : type === 'require' ? { type, when: tm(r), then: tm(r), ...(message !== undefined ? { message } : {}) }
    : type === 'maxLength' ? { type, max: r.pick([0, 5, 10, 40, 100]), ...(message !== undefined ? { message } : {}) }
    : { type, ...(message !== undefined ? { message } : {}) };
  return { id: r.pick(['r1', 'rule-2']), title: r.pick(['Title', 'Заголовок']), ...(r.chance(0.5) ? { description: r.pick(['Desc', 'Опис', '']) } : {}), ...(r.chance(0.4) ? { severity: r.pick(['warn', 'bad'] as const) } : {}), ...(r.chance(0.3) ? { kinds: ['dialogue'] } : {}), check } as QaRuleContribution;
}

test('export declqa vectors', () => {
  const r = rng(4242);
  const out: Record<string, { input: unknown; output: unknown }[]> = {};
  const add = (name: string, input: unknown, output: unknown) => (out[name] ??= []).push({ input, output });
  const cat = JSON.stringify({ language: 'en', messages: { 'Не варто вживати': 'Avoid', 'В оригіналі є {when}: у перекладі має бути {then}': 'Source has {when}: need {then}', 'Переклад довший за {max} знаків ({n})': 'Longer than {max} ({n})', 'Переклад збігається з оригіналом': 'Same as source' }, contexts: { [`plugin:${PID}`]: { Title: 'T-en', Desc: 'D-en', 'Own msg': 'Own-en', 'Моє повідомлення': 'My-en' } } });
  const rules = { sev: {}, keep: [], apostrophe: 'any', sig: '' };
  for (let i = 0; i < 700; i++) {
    const q = genRule(r);
    const en = r.chance(0.4);
    if (en) { i18n.add('en', parseJsonCatalog(cat), 'cat'); i18n.setLanguage('en', []); }
    const rule = declarativeRule({ manifest: { id: PID } } as never, q);
    const runs = Array.from({ length: 6 }, () => {
      const source = r.pick(TXT), target = r.chance(0.2) ? source : r.pick(TXT), kind = r.chance(0.5) ? 'dialogue' : undefined;
      const ctx = { kind, source, target, ms: maskCodes(source), mt: maskCodes(target), rules, srcWords: () => new Set<string>() };
      return { source, target, kind, out: rule.run(ctx as never) };
    });
    add('rule', { q, en }, { rule: { id: rule.id, title: rule.title, explain: rule.explain, cat: rule.cat, def: rule.def, fixable: rule.fixable, plugin: rule.plugin, kinds: rule.kinds ?? null }, runs });
    if (en) { i18n.remove('cat'); i18n.setLanguage('uk', []); }
  }
  writeVectors('declqa', out);
});
