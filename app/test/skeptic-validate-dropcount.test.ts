import { describe, expect, it } from 'vitest';
import { deserializeChecked, emptyProject, serialize } from '../src/core';

// Oracle: a repair report must tell the truth about how much was thrown away.
describe('the repair note counts what was really dropped', () => {
  const base = (): Record<string, unknown> => JSON.parse(serialize(emptyProject('P')));
  it('3 unusable translation-memory records are reported as 3, not as 1', () => {
    const raw = base();
    raw.memory = [{ s: 'a', t: 'b', mt: 1 }, { s: 1 }, 'x', null];
    const { project, notes } = deserializeChecked(JSON.stringify(raw));
    expect(project.memory).toHaveLength(1);
    expect(notes.join(' ')).toMatch(/відкинуто непридатних записів: 3/);
  });
  it('1 unusable term and 3 unusable memory records are reported together as 4', () => {
    const raw = base();
    raw.terms = [{ en: 'a', uk: 'б', mt: 1 }, { en: 'c' }];
    raw.memory = [{ s: 'a', t: 'b', mt: 1 }, { s: 1 }, 'x', null];
    expect(deserializeChecked(JSON.stringify(raw)).notes.join(' ')).toMatch(/відкинуто непридатних записів: 4/);
  });
});
