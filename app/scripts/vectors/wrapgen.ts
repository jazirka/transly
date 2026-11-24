import { wrapOf } from '../../src/core/wrapconfig';
import type { WrapPlan } from '../../src/core/wrap';
import { UK } from './corpus';
import type { Rng } from './util';

export const CODES = ['\\C[2]', '\\N[1]', '\\V[12]', '\\{', '\\}', '\\.', '\\|', '\\!', '\\>', '\\<', '\\^', '\\$', '\\\\', '\\G', '\\I[5]', '\\G[1]'];
export const LATIN = ['sword', 'HP', 'x2', '42', 'ok'];
export const WORDS = [...UK.filter(w => /^[\p{L}'’ʼ`]+$/u.test(w)), 'неймовірно', 'надзвичайно', 'українознавство', 'підземелля', 'розмова', 'безодня', 'міжнародний', 'об’єднання', 'пʼятниця', 'майор', 'країна', 'радіо', 'біологія', 'сьогодні', 'зникає', 'відчуття', 'їжак', 'джерело', 'дзвінок', 'здається', 'коханці', 'мільйонер', 'ліжко', 'суботній', 'прізвище', 'Всеукраїнський', 'АБВГДЕЖ'];

export function genWord(r: Rng): string {
  const roll = r.next();
  if (roll < 0.7) return r.pick(WORDS);
  if (roll < 0.8) return r.pick(LATIN);
  if (roll < 0.9) return r.pick(CODES) + r.pick(WORDS);
  if (roll < 0.95) return r.pick(WORDS) + r.pick(CODES);
  return r.pick(WORDS) + r.pick(['', '!', ',', '.', '…', '—']);
}
export function genMessage(r: Rng, max = 18): string {
  let s = '';
  for (let n = 1 + r.int(max); n > 0; n--) {
    s += genWord(r);
    s += r.pick([' ', ' ', ' ', ' ', '\n', '  ', ' \n ', '-\n', '\n\n', '\t', r.pick(CODES) + ' ']);
  }
  return r.chance(0.8) ? s.trim() : s;
}
export const len7 = (s: string): number => [...s].length * 7;

export function genPlan(r: Rng): { plan: WrapPlan; desc: unknown } {
  const settings = wrapOf({ wrap: { mode: r.pick(['build', 'text', 'off']), unit: r.pick(['chars', 'px']), hyphen: r.pick(['off', 'needed', 'fill']), hyphenChar: r.pick(['-', '‐', '~']), minLeft: r.pick([1, 2, 3]), minRight: r.pick([1, 2, 3]), keep: r.pick(['reflow', 'long']), maxLines: r.pick([0, 2, 4]), px: { width: r.pick([320, 500, 816]), font: r.pick([20, 28]) } } as never });
  const limit = r.pick([0, 20, 30, 50, 80]), disabled = r.chance(0.1), measure = r.chance(0.5);
  const plan: WrapPlan = { settings, limit, ...(disabled ? { disabled } : {}), ...(measure ? { measure: len7 } : {}) };
  return { plan, desc: { settings, limit, disabled, measure } };
}
export const genUnit = (r: Rng) => ({ kind: r.pick(['dialogue', 'scroll', 'name', undefined]), key: r.pick(['k1', 'L12', 'a␟L3', 'xL3', 'L', 'L1x', undefined]), face: r.pick(['Actor1#3', '', undefined]) });

