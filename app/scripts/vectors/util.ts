import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const VECTOR_DIR = resolve(here, '../../../rust/transly-core/tests/vectors');

/** Детермінований генератор (mulberry32): однакові вектори на кожному запуску. */
export function rng(seed: number) {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n: number): number => Math.floor(next() * n);
  const pick = <T>(xs: readonly T[]): T => xs[int(xs.length)]!;
  const chance = (p: number): boolean => next() < p;
  return { next, int, pick, chance };
}
export type Rng = ReturnType<typeof rng>;

// Символи підібрано, щоб ловити розбіжності UTF-16 (JS) і UTF-8 (Rust): сурогатна пара проти символів вище U+E000.
const ALPHA = ['a', 'b', 'z', 'A', 'я', 'Я', 'ї', 'є', 'ґ', "'", ' ', '\n', '"', '\\', '1', '～', '', '😀', '𝒳', '\u0001', 'é'];
export const text = (r: Rng, max = 6): string => { let s = ''; for (let n = r.int(max + 1); n > 0; n--) s += r.pick(ALPHA); return s; };

/** Записує один модуль: { функція: [{input, output}] }. */
export function writeVectors(name: string, data: Record<string, { input: unknown; output: unknown }[]>): void {
  mkdirSync(VECTOR_DIR, { recursive: true });
  // JSON.stringify відкидає undefined так само, як це робить збереження проєкту.
  writeFileSync(resolve(VECTOR_DIR, `${name}.json`), JSON.stringify(data) + '\n');
}
