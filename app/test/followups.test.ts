import { describe, expect, it } from 'vitest';
import { emptyProject, rowsWithTerm, termRowsNote } from '../src/core';
import type { Entry, FileView, Unit } from '../src/core';

const unit = (key: string, source: string): Unit => ({ key, source, speaker: '', kind: 'dialogue', context: '' });
const e = (target: string): Entry => ({ target, status: 'draft', mt: 1 });

describe('rows that meet a new term', () => {
  const views: FileView[] = [{ name: 'M.json', units: [unit('a', 'The harbour is quiet.'), unit('b', 'Another harbour.'), unit('c', 'The harbour wall'), unit('d', 'Nothing here')] }];
  const p = emptyProject('P');
  p.files['M.json'] = { a: e('Порт тихий.'), b: e('Гавань інша.'), d: e('Нічого') };

  it('separates rows translated without the term from rows still waiting, over all files', () => {
    const r = rowsWithTerm(views, p, { en: 'harbour', uk: 'гавань' });
    expect(r.lacking.map(x => x.key)).toEqual(['a']);
    expect(r.waiting.map(x => x.key)).toEqual(['c']);
    expect(termRowsNote('harbour', r)).toBe('У рядках із «harbour» перекладено без нього: 1, чекають перекладу: 1');
  });

  it('knows the other renderings of the term and says nothing when the term is nowhere', () => {
    expect(rowsWithTerm(views, p, { en: 'harbour', uk: 'порт', alt: ['гавань'] }).lacking).toEqual([]);
    const none = rowsWithTerm(views, p, { en: 'castle', uk: 'замок' });
    expect(none).toEqual({ lacking: [], waiting: [] });
    expect(termRowsNote('castle', none)).toBe('');
    expect(rowsWithTerm(views, p, { en: '', uk: 'x' })).toEqual({ lacking: [], waiting: [] });
  });
});
