import { test } from 'vitest';
import type { SavedProject } from '../../src/core/project';
import { planSteps, runSteps } from '../../src/core/ext/commands';
import type { ReplaceStep } from '../../src/core/ext/types';
import { rng, text, writeVectors } from './util';

const FIND = ['cat', 'dog', 'кіт', 'сім', "сім'я", 'a.b', '(x)', '', 'a', 'aa', 'Пес'];
const REPL = ['dog', '', 'cat', '$&', 'кіт', 'a', 'aa'];
const WORDS = ['cat', 'Cat', 'dog', 'кіт', 'Кіт', 'сім’я', "сім'я", 'a.b', '(x)', 'a', 'aa', 'aaa', 'Пес', 'cats', ' '];
const KEYS = ['k1', 'k2', 'k3'];

test('export commands vectors', () => {
  const r = rng(515);
  const out: Record<string, { input: unknown; output: unknown }[]> = {};
  const add = (name: string, input: unknown, output: unknown) => (out[name] ??= []).push({ input, output });
  const steps = (): ReplaceStep[] => Array.from({ length: r.int(4) }, () => ({ find: r.pick(FIND), replace: r.pick(REPL), ...(r.chance(0.4) ? { wholeWord: r.chance(0.6) } : {}), ...(r.chance(0.4) ? { caseSensitive: r.chance(0.6) } : {}) }));
  for (let i = 0; i < 300; i++) {
    const s = steps();
    const t = Array.from({ length: r.int(5) }, () => r.pick(WORDS)).join(r.pick([' ', '', ', '])) + (r.chance(0.2) ? text(r, 3) : '');
    add('runSteps', { text: t, steps: s }, runSteps(t, s));
  }
  for (let i = 0; i < 200; i++) {
    const files: SavedProject['files'] = {};
    const views = [];
    for (const fn of ['a.json', 'b.json']) {
      const units = KEYS.filter(() => r.chance(0.85)).map(key => ({ key, source: text(r, 3), speaker: '', kind: 'dialogue' as const, context: '' }));
      views.push({ name: fn, units });
      if (r.chance(0.9)) files[fn] = Object.fromEntries(KEYS.filter(() => r.chance(0.85)).map(k => [k, { target: Array.from({ length: r.int(4) }, () => r.pick(WORDS)).join(' '), status: 'done' as const, mt: 1 }]));
    }
    const s = steps(), limit = r.chance(0.2) ? 1 + r.int(3) : 2000;
    add('planSteps', { views, files, steps: s, limit }, planSteps(views as never, { files } as unknown as SavedProject, s, limit));
  }
  writeVectors('commands', out);
});
