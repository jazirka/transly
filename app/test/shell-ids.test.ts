import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `$('#id')` throws when the element is missing, and the whole screen stops drawing. The markup lives in strings across
 * several files, so a renamed or removed element is easy to miss. This reads the sources and checks that every id the
 * code asks for is defined somewhere (ids built from `${…}` cannot be told apart and are skipped).
 */
const read = (dir: string): Map<string, string> => new Map(readdirSync(dir).filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts')).map(f => [f, readFileSync(join(dir, f), 'utf8')]));

const defined = (sources: Iterable<string>): Set<string> => {
  const ids = new Set<string>();
  for (const src of sources) {
    for (const m of src.matchAll(/\bid=\\?["']([A-Za-z0-9_-]+)\\?["']/g)) ids.add(m[1]!);
    for (const m of src.matchAll(/\.id\s*=\s*['"]([A-Za-z0-9_-]+)['"]/g)) ids.add(m[1]!);
    for (const m of src.matchAll(/setAttribute\(\s*['"]id['"]\s*,\s*['"]([A-Za-z0-9_-]+)['"]/g)) ids.add(m[1]!);
  }
  return ids;
};

/** Ids a selector string names, e.g. `'#a, #b .c'` → a, b. */
const idsIn = (selector: string): string[] => [...selector.matchAll(/#([A-Za-z0-9_-]+)/g)].map(m => m[1]!);

describe('every id the desktop code asks for exists in its markup', () => {
  const files = read(join(__dirname, '../src/ui'));
  const known = defined(files.values());

  it('$(\'#id\') and getElementById', () => {
    const missing: string[] = [];
    for (const [name, src] of files) {
      for (const m of src.matchAll(/\$\(\s*'([^'$`]*)'/g)) for (const id of idsIn(m[1]!)) if (!known.has(id)) missing.push(`${name}: #${id}`);
      for (const m of src.matchAll(/getElementById\(\s*'([A-Za-z0-9_-]+)'/g)) if (!known.has(m[1]!)) missing.push(`${name}: #${m[1]}`);
    }
    expect([...new Set(missing)]).toEqual([]);
  });
});

describe('every id the phone code asks for exists in its markup', () => {
  const files = read(join(__dirname, '../src/mobile'));
  const known = defined(files.values());

  it('$(\'id\') and getElementById', () => {
    const missing: string[] = [];
    for (const [name, src] of files) {
      for (const m of src.matchAll(/\$(?:<[A-Za-z]+>)?\(\s*'([A-Za-z0-9_-]+)'\s*\)/g)) if (!known.has(m[1]!)) missing.push(`${name}: #${m[1]}`);
      for (const m of src.matchAll(/getElementById\(\s*'([A-Za-z0-9_-]+)'/g)) if (!known.has(m[1]!)) missing.push(`${name}: #${m[1]}`);
    }
    expect([...new Set(missing)]).toEqual([]);
  });
});
