import { describe, expect, it } from 'vitest';
import { applySpans, commitRows, emptyProject, proposeTermSync, termChange, termChanges, undoJournal } from '../src/core';
import type { Entry, FileView, SavedProject, TermChange, Unit } from '../src/core';

const unit = (key: string, source: string): Unit => ({ key, source, speaker: '', kind: 'dialogue', context: '' });
const e = (target: string, status: Entry['status'] = 'draft', extra: Partial<Entry> = {}): Entry => ({ target, status, mt: 10, ...extra });
const setup = (rows: [string, string, string, Entry['status']?][]): { views: FileView[]; saved: SavedProject } => {
  const units = rows.map(([k, src]) => unit(k, src));
  const files: Record<string, Entry> = {};
  for (const [k, , tr, st] of rows) files[k] = e(tr, st ?? 'draft');
  return { views: [{ name: 'A.json', units }], saved: { ...emptyProject('t'), files: { 'A.json': files } } };
};
const SWORD: TermChange = { en: 'sword', old: ['меч'], next: 'клинок' };

describe('termChange: чи треба щось замінювати', () => {
  it('змінився перший переклад → старі форми й нова', () => {
    expect(termChange({ en: 'sword', uk: 'меч' }, { en: 'sword', uk: 'клинок' })).toEqual({ en: 'sword', old: ['меч'], next: 'клинок' });
  });
  it('стара форма, що лишилась альтернативою, не чіпається; зникла альтернатива теж стара', () => {
    expect(termChange({ en: 'sword', uk: 'меч' }, { en: 'sword', uk: 'клинок', alt: ['меч'] })).toBeNull();
    expect(termChange({ en: 'sword', uk: 'меч', alt: ['шабля'] }, { en: 'sword', uk: 'клинок' })).toEqual({ en: 'sword', old: ['меч', 'шабля'], next: 'клинок' });
    expect(termChange({ en: 'sword', uk: 'меч', alt: ['шабля'] }, { en: 'sword', uk: 'клинок', alt: ['шабля'] })).toEqual({ en: 'sword', old: ['меч'], next: 'клинок' });
  });
  it('новий термін, перейменований оригінал, той самий переклад (інший регістр, апостроф) — нічого', () => {
    expect(termChange(undefined, { en: 'sword', uk: 'меч' })).toBeNull();
    expect(termChange({ en: 'sword', uk: 'меч' }, { en: 'blade', uk: 'клинок' })).toBeNull();
    expect(termChange({ en: 'sword', uk: 'Меч' }, { en: 'sword', uk: 'меч' })).toBeNull();
    expect(termChange({ en: 'name', uk: "ім'я" }, { en: 'name', uk: 'ім’я' })).toBeNull();
  });
});

describe('proposeTermSync', () => {
  const rows: [string, string, string, Entry['status']?][] = [
    ['k1', 'The sword is here.', 'Меч тут.'],
    ['k2', 'He cut with the sword.', 'Він різав мечем.', 'done'],
    ['k3', 'The sword and the shield', 'Меч і щит.'],
    ['k4', 'The swordsman came.', 'Мечник прийшов.'],
    ['k5', 'A blade.', 'Меч тут.'],
    ['k6', 'The sword, the sword.', 'Меч і ще один меч.'],
    ['k7', 'The sword is red.', '\\C[2]меч\\C[0] і щит.'],
    ['k8', 'No sword here.', 'Тут нічого немає.'],
    ['k9', 'Swords', 'Мечів тут багато.', 'appr'],
  ];
  const { views, saved } = setup(rows);
  saved.files['A.json']!.k9!.orig = 'Мечів тут багато.';
  const r = proposeTermSync(views, saved, SWORD);
  const by = (k: string) => r.proposals.find(p => p.key === k);
  it('знаходить форми в різних відмінках і замінює тією самою формою', () => {
    expect(by('k1')!.after).toBe('Клинок тут.');
    expect(by('k2')!.after).toBe('Він різав клинком.');
    expect(by('k3')!.after).toBe('Клинок і щит.');
    expect(by('k9')!.after).toBe('Клинків тут багато.');
  });
  it('мечник і рядки без терміна не чіпаються', () => {
    expect(by('k4')).toBeUndefined();
    expect(by('k8')).toBeUndefined();
    expect(r.total).toBe(7);
    expect(r.truncated).toBe(false);
  });
  it('кілька входжень в одному рядку; коди керування лишаються на місці', () => {
    expect(by('k6')!.after).toBe('Клинок і ще один клинок.');
    expect(by('k6')!.spans.length).toBe(2);
    expect(by('k7')!.after).toBe('\\C[2]клинок\\C[0] і щит.');
  });
  it('позначені за замовчуванням лише впевнені й з терміном в оригіналі', () => {
    expect(by('k1')!.tick).toBe(true);
    expect(by('k2')!.tick).toBe(true);
    const k5 = by('k5')!;
    expect(k5.hasSource).toBe(false);
    expect(k5.tick).toBe(false);
    expect(k5.conf.level).toBe('low');
    expect(k5.conf.flags).toContain('no-source');
  });
  it('найкращі спершу', () => {
    const levels = r.proposals.map(p => p.conf.level);
    expect(levels).toEqual([...levels].sort((a, b) => ({ high: 0, medium: 1, low: 2 })[a] - ({ high: 0, medium: 1, low: 2 })[b]));
    expect(r.proposals.at(-1)!.key).toBe('k5');
  });
  it('неоднозначна форма (мечі) дає альтернативи й не позначена', () => {
    const s = setup([['m1', 'The swords of kings', 'Мечі королів.']]);
    const x = proposeTermSync(s.views, s.saved, SWORD).proposals[0]!;
    expect(x.tick).toBe(false);
    expect(x.spans[0]!.alts.length).toBeGreaterThan(0);
    expect([x.spans[0]!.text, ...x.spans[0]!.alts.map(a => a.text)].sort()).toEqual(['Клинки', 'Клинку']);
    expect(applySpans(x.before, x.spans, [0])).not.toBe(x.after);
  });
  it('фраза з прикметником: залізним мечем → сталевим клинком', () => {
    const s = setup([['p1', 'The iron sword', 'Він бився залізним мечем.'], ['p2', 'The iron sword', 'Залізні мечі.']]);
    const x = proposeTermSync(s.views, s.saved, { en: 'iron sword', old: ['залізний меч'], next: 'сталевий клинок' }).proposals;
    expect(x.find(p => p.key === 'p1')!.after).toBe('Він бився сталевим клинком.');
    expect(x.find(p => p.key === 'p2')!.after).toBe('Сталеві клинки.');
  });
  it('прийменник підказує відмінок: у мечі → у клинку', () => {
    const s = setup([['q1', 'In the sword', 'Він у мечі.']]);
    expect(proposeTermSync(s.views, s.saved, SWORD).proposals[0]!.after).toBe('Він у клинку.');
  });
  it('ліміт: показуються найкращі, лічильник чесний', () => {
    const s = setup(Array.from({ length: 30 }, (_, i) => [`r${i}`, 'The sword', 'Меч.'] as [string, string, string]));
    const x = proposeTermSync(s.views, s.saved, SWORD, { limit: 10 });
    expect(x.proposals.length).toBe(10);
    expect(x.total).toBe(30);
    expect(x.truncated).toBe(true);
  });
  it('порожній або невпізнаний старий термін нічого не знаходить', () => {
    expect(proposeTermSync(views, saved, { en: 'x', old: [''], next: 'клинок' }).total).toBe(0);
    expect(proposeTermSync(views, saved, { en: 'x', old: ['123'], next: 'клинок' }).total).toBe(0);
  });
});

describe('termChanges: запис однією дією журналу', () => {
  const rows: [string, string, string, Entry['status']?][] = [['a', 'The sword.', 'Меч тут.', 'appr'], ['b', 'The sword.', 'Бачу мечем.', 'done'], ['c', 'The sword.', 'Меч чернетка.']];
  it('статус лишається, orig оновлюється лише де він був, історія «змінено термін», «Скасувати» повертає все', () => {
    const { views, saved } = setup(rows);
    saved.files['A.json']!.a!.orig = 'Меч тут.';
    const props = proposeTermSync(views, saved, SWORD).proposals;
    const changes = termChanges(props.map(p => ({ proposal: p })), saved, 500);
    expect(changes.length).toBe(3);
    const id = commitRows(f => saved.files[f]!, changes, 'term', 'Ви', 500);
    const a = saved.files['A.json']!.a!, c = saved.files['A.json']!.c!;
    expect(a).toMatchObject({ target: 'Клинок тут.', status: 'appr', orig: 'Клинок тут.', mt: 500 });
    expect(c).toMatchObject({ target: 'Клинок чернетка.', status: 'draft' });
    expect(c.orig).toBeUndefined();
    expect(saved.files['A.json']!.b!.status).toBe('done');
    expect(a.history!.at(-1)).toMatchObject({ batch: id, what: 'змінено термін', text: 'Клинок тут.' });
    const u = undoJournal(saved, id, 'Ви', 600);
    expect(u.done).toBe(3);
    expect(saved.files['A.json']!.a!).toMatchObject({ target: 'Меч тут.', status: 'appr' });
    expect(saved.files['A.json']!.c!.target).toBe('Меч чернетка.');
  });
  it('рядок, який змінили після пропозицій, не перезаписується', () => {
    const { views, saved } = setup(rows);
    const props = proposeTermSync(views, saved, SWORD).proposals;
    saved.files['A.json']!.a!.target = 'Вже інакше.';
    const changes = termChanges(props.map(p => ({ proposal: p })), saved, 500);
    expect(changes.map(c => c.key).sort()).toEqual(['b', 'c']);
  });
  it('вибір альтернативи для неоднозначної форми', () => {
    const s = setup([['m1', 'The swords', 'Мечі королів.']]);
    const p = proposeTermSync(s.views, s.saved, SWORD).proposals[0]!;
    const main = termChanges([{ proposal: p }], s.saved, 1)[0]!.text;
    const alt = termChanges([{ proposal: p, choice: [0] }], s.saved, 1)[0]!.text;
    expect(main).not.toBe(alt);
    expect([main, alt].sort()).toEqual(['Клинки королів.', 'Клинку королів.']);
  });
});

describe('швидкодія', () => {
  it('один термін × 20 тисяч рядків — швидко (межа 5 с з запасом для повільного CI)', () => {
    const words = 'Він бачив великий меч у руці старого лицаря і ще багато інших речей на столі біля стіни'.split(' ');
    const rows = Array.from({ length: 20000 }, (_, i) => [`k${i}`, 'The sword', words.slice(i % 7, (i % 7) + 9).join(' ') + (i % 5 === 0 ? ' мечем' : '.')] as [string, string, string]);
    const { views, saved } = setup(rows);
    const t0 = performance.now();
    const r = proposeTermSync(views, saved, SWORD, { limit: 500 });
    const dt = performance.now() - t0;
    expect(r.total).toBeGreaterThan(3000);
    expect(dt).toBeLessThan(5000);
  });
});
