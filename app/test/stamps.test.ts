import { describe, expect, it } from 'vitest';
import { ago, copyLine, deserialize, emptyProject, mergeProjects, preflight, preflightLines, serialize, stamp, stampOf } from '../src/core';
import type { Entry, FileView, Unit } from '../src/core';

const unit = (key: string, source: string): Unit => ({ key, source, speaker: '', kind: 'dialogue', context: '' });
const e = (target: string, status: Entry['status'], extra: Partial<Entry> = {}): Entry => ({ target, status, mt: 1, ...extra });

describe('stamps: when a copy left the browser', () => {
  it('are kept, found and survive a save and a merge with the newer one winning', () => {
    const a = emptyProject('P'), b = emptyProject('P');
    stamp(a, 'copy', 'файл', 1000);
    stamp(b, 'copy', 'синхронізація', 5000);
    stamp(b, 'build', 'збірка', 2000, 12);
    expect(stampOf(a, 'copy')).toEqual({ mt: 1000, how: 'файл' });
    expect(stampOf(a, 'build')).toBeNull();
    const back = deserialize(serialize(a));
    expect(stampOf(back, 'copy')?.mt).toBe(1000);
    const m = mergeProjects(a, b).project;
    expect(stampOf(m, 'copy')).toMatchObject({ mt: 5000, how: 'синхронізація' });
    expect(stampOf(m, 'build')).toMatchObject({ mt: 2000, n: 12 });
    expect(stampOf(mergeProjects(b, a).project, 'copy')?.mt).toBe(5000);       // the order does not matter
  });

  it('says how old the copy is, and warns when there is none or it is a day old while there is work', () => {
    expect(ago(0, 30_000)).toBe('щойно');
    expect(ago(0, 5 * 60000)).toBe('5 хв тому');
    expect(ago(0, 3 * 3600000)).toBe('3 год тому');
    expect(ago(0, 4 * 86400000)).toBe('4 дн. тому');
    const p = emptyProject('P');
    expect(copyLine(p, 1e9, 0)).toEqual({ text: 'Копії поза браузером ще не було', warn: false });
    expect(copyLine(p, 1e9, 5).warn).toBe(true);
    stamp(p, 'copy', 'файл', 1e9 - 3600000);
    expect(copyLine(p, 1e9, 5)).toEqual({ text: 'Копія: 1 год тому', warn: false });
    stamp(p, 'copy', 'файл', 1e9 - 3 * 86400000);
    expect(copyLine(p, 1e9, 5).warn).toBe(true);
  });
});

describe('preflight: what a build will meet', () => {
  const views: FileView[] = [{ name: 'M.json', units: [unit('a', 'One'), unit('b', 'Two \\N[1]'), unit('c', 'Three'), unit('d', 'Four'), unit('e', 'Five')] }];
  const p = emptyProject('P');
  p.files['M.json'] = {
    a: e('раз', 'appr'),
    b: e('два', 'draft'),                                  // lost the control code: an error
    c: e('три', 'done', { src: 'Old three' }),             // the original changed
    d: e('', 'new'),
  };
  const r = preflight(views, p, { tolerancePct: 1000, terms: [] });

  it('counts the rows by what is wrong with them', () => {
    expect(r).toMatchObject({ total: 5, untranslated: 2, drafts: 1, sent: 1, errors: 1, sourceChanged: 1 });
  });

  it('says only what is not zero', () => {
    const lines = preflightLines(r);
    expect(lines.some(l => l.startsWith('помилок QA: 1'))).toBe(true);
    expect(lines.some(l => l.startsWith('оригінал змінився після перекладу: 1'))).toBe(true);
    expect(lines.some(l => l.startsWith('без перекладу: 2'))).toBe(true);
    expect(preflightLines({ total: 3, untranslated: 0, drafts: 0, sent: 3, errors: 0, advice: 0, sourceChanged: 0 })).toEqual([]);
  });
});
