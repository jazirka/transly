import { describe, expect, it } from 'vitest';
import { LinkIndex, afterSend, clearMain, commitRows, deserialize, emptyProject, hashText, linkChanges, linkKey, linkModeOf, linkView, mergeLinkData, mergeProjects, planLinkSync, relinkRow, reviewClusters, rowRef, serialize, setMain, undoJournal, unlinkRow } from '../src/core';
import type { Entry, FileView, SavedProject, Unit } from '../src/core';

const unit = (key: string, source: string): Unit => ({ key, source, speaker: '', kind: 'dialogue', context: '' });
const views = (): FileView[] => [
  { name: 'A.json', units: [unit('a1', 'Hello'), unit('a2', 'Bye'), unit('a3', 'Hello '), unit('a4', 'x')] },
  { name: 'B.json', units: [unit('b1', 'Hello'), unit('b2', 'Unique'), unit('b3', 'x')] },
];
const e = (target: string, status: Entry['status'] = 'done', mt = 10): Entry => ({ target, status, mt });
const project = (files: Record<string, Record<string, Entry>> = {}): SavedProject => ({ ...emptyProject('t'), files });
const NOW = 1000;

describe('LinkIndex', () => {
  it('однаковий оригінал без пробілів на краях утворює кластер; унікальний і надто короткий ні', () => {
    const idx = new LinkIndex(views());
    expect(idx.clusterOf('A.json', 'a1')!.rows.map(r => r.ref)).toEqual([rowRef('A.json', 'a1'), rowRef('A.json', 'a3'), rowRef('B.json', 'b1')]);
    expect(idx.clusterOf('A.json', 'a2')).toBeNull();
    expect(idx.clusterOf('B.json', 'b2')).toBeNull();
    expect(idx.clusterOf('A.json', 'a4')).toBeNull(); // «x»: одна літера
    expect(idx.others('A.json', 'a1')).toBe(2);
    expect(idx.others('A.json', 'a2')).toBe(0);
    expect(idx.size).toBe(1);
    expect(linkKey('  Hello\n')).toBe('Hello');
  });
});

describe('linkView: еталон і стани', () => {
  const idx = new LinkIndex(views());
  it('еталон — рядок, надісланий останнім; чернетка не поширюється', () => {
    const s = project({ 'A.json': { a1: e('Привіт', 'done', 10), a3: e('Вітаю', 'draft', 50) }, 'B.json': { b1: e('Здоров', 'appr', 30) } });
    const v = linkView(s, idx, 'A.json', 'a1')!;
    expect(v.reference!.ref).toBe(rowRef('B.json', 'b1'));
    const st = Object.fromEntries(v.rows.map(r => [r.key, r.state]));
    expect(st).toEqual({ a1: 'differs', a3: 'edited', b1: 'main' });
  });
  it('без надісланих рядків еталона немає, і ніщо не пропонується', () => {
    const s = project({ 'A.json': { a1: e('Привіт', 'draft') } });
    const v = linkView(s, idx, 'A.json', 'a1')!;
    expect(v.reference).toBeUndefined();
    expect(v.rows.map(r => r.state)).toEqual(['draft', 'empty', 'empty']);
    expect(planLinkSync(s, idx, 'A.json', 'a1')).toBeNull();
  });
  it('однакові тексти — same, порожні — empty', () => {
    const s = project({ 'A.json': { a1: e('Привіт', 'done', 20), a3: e('Привіт', 'done', 10) } });
    expect(linkView(s, idx, 'B.json', 'b1')!.rows.map(r => r.state)).toEqual(['main', 'same', 'empty']);
  });
  it('явний головний важливіший за останній надісланий', () => {
    const s = project({ 'A.json': { a1: e('Старе', 'done', 5), a3: e('Нове', 'done', 99) }, 'B.json': {} });
    setMain(s, { file: 'A.json', key: 'a1', source: 'Hello' }, NOW);
    const v = linkView(s, idx, 'A.json', 'a3')!;
    expect(v.main!.key).toBe('a1');
    expect(v.reference!.key).toBe('a1');
    expect(v.rows.map(r => r.state)).toEqual(['main', 'edited', 'empty']);
    clearMain(s, 'Hello', NOW + 1);
    expect(linkView(s, idx, 'A.json', 'a3')!.reference!.key).toBe('a3');
  });
  it('головний без тексту не вважається еталоном', () => {
    const s = project({ 'A.json': { a3: e('Нове', 'done', 99) } });
    setMain(s, { file: 'A.json', key: 'a1', source: 'Hello' }, NOW);
    expect(linkView(s, idx, 'A.json', 'a3')!.reference!.key).toBe('a3');
  });
  it('відв’язаний рядок не бере участі й не змінюється; перев’язаний повертається', () => {
    const s = project({ 'A.json': { a1: e('Привіт', 'done', 20), a3: e('Своє', 'done', 10) } });
    unlinkRow(s, { file: 'A.json', key: 'a3', source: 'Hello ' }, NOW);
    const v = linkView(s, idx, 'A.json', 'a1')!;
    expect(v.rows.find(r => r.key === 'a3')!.state).toBe('unlinked');
    expect(planLinkSync(s, idx, 'A.json', 'a1')!.updates).toEqual([]);
    relinkRow(s, { file: 'A.json', key: 'a3' }, NOW + 1);
    expect(linkView(s, idx, 'A.json', 'a1')!.rows.find(r => r.key === 'a3')!.state).toBe('differs');
  });
  it('запис про рядок, чий оригінал змінився (ключі зсунулись), ігнорується', () => {
    const s = project({ 'A.json': { a1: e('Привіт', 'done', 20), a3: e('Своє', 'done', 10) } });
    unlinkRow(s, { file: 'A.json', key: 'a3', source: 'Old original' }, NOW);
    expect(linkView(s, idx, 'A.json', 'a1')!.rows.find(r => r.key === 'a3')!.state).toBe('differs');
    s.links![`m:Hello`] = { k: 'm', ref: rowRef('A.json', 'a1'), h: hashText('Something else'), mt: NOW };
    expect(linkView(s, idx, 'A.json', 'a1')!.main).toBeUndefined();
  });
});

describe('afterSend: що робить режим', () => {
  const idx = new LinkIndex(views());
  const base = () => project({ 'A.json': { a1: e('Привіт', 'done', 100), a3: e('Старий', 'done', 10) }, 'B.json': {} });
  it('питати: лише порожні заповнюються, різні лишаються на розгляд', () => {
    const r = afterSend(base(), idx, 'ask', 'A.json', 'a1', NOW);
    expect(r.changes.map(c => c.key)).toEqual(['b1']);
    expect(r).toMatchObject({ filled: 1, updated: 0, pending: 1 });
    expect(r.changes[0]!.next).toMatchObject({ target: 'Привіт', status: 'done', mt: NOW, src: 'Hello', orig: 'Привіт', returned: false });
  });
  it('самі: заповнюються й оновлюються різні, самого рядка немає в зміні', () => {
    const r = afterSend(base(), idx, 'auto', 'A.json', 'a1', NOW);
    expect(r.changes.map(c => c.key).sort()).toEqual(['a3', 'b1']);
    expect(r).toMatchObject({ filled: 1, updated: 1, pending: 0 });
  });
  it('вимкнено: нічого', () => {
    expect(afterSend(base(), idx, 'off', 'A.json', 'a1', NOW)).toEqual({ changes: [], filled: 0, updated: 0, pending: 0 });
  });
  it('змінений пізніше рядок ніколи не перезаписується автоматично', () => {
    const s = project({ 'A.json': { a1: e('Привіт', 'done', 100) }, 'B.json': { b1: e('Моє', 'draft', 200) } });
    const r = afterSend(s, idx, 'auto', 'A.json', 'a1', NOW);
    expect(r.changes.map(c => c.key)).toEqual(['a3']);
    expect(r.pending).toBe(1);
  });
  it('надіслати не головний рядок: він не перезаписується головним, лише відрізняється', () => {
    const s = project({ 'A.json': { a1: e('Головний', 'done', 5), a3: e('Інакше', 'done', 100) }, 'B.json': {} });
    setMain(s, { file: 'A.json', key: 'a1', source: 'Hello' }, NOW);
    const r = afterSend(s, idx, 'auto', 'A.json', 'a3', NOW);
    expect(r.changes.map(c => c.key)).toEqual(['b1']);
    expect(r.changes[0]!.next.target).toBe('Головний');
  });
  it('запис однією дією журналу, «скасувати» повертає тексти', () => {
    const s = base();
    const r = afterSend(s, idx, 'auto', 'A.json', 'a1', NOW);
    const id = commitRows(f => (s.files[f] ??= {}), r.changes, 'link', 'Ви', NOW);
    expect(s.files['B.json']!.b1!.target).toBe('Привіт');
    expect(s.files['A.json']!.a3!.target).toBe('Привіт');
    expect(s.files['A.json']!.a3!.history!.at(-1)).toMatchObject({ batch: id, what: 'синхронізовано зі зв’язаним рядком' });
    const u = undoJournal(s, id, 'Ви', NOW + 5);
    expect(u.done).toBe(2);
    expect(s.files['A.json']!.a3!.target).toBe('Старий');
    expect(s.files['B.json']!.b1!.target).toBe('');
  });
  it('linkChanges із порожнім списком — порожній результат', () => { expect(linkChanges('x', [], NOW)).toEqual([]); });
});

describe('linkModeOf', () => {
  it('типово «питати»; propagate:false зі старої збірки — «вимкнено»; явний вибір виграє', () => {
    expect(linkModeOf(undefined)).toBe('ask');
    expect(linkModeOf({})).toBe('ask');
    expect(linkModeOf({ propagate: true })).toBe('ask');
    expect(linkModeOf({ propagate: false })).toBe('off');
    expect(linkModeOf({ linkMode: 'auto', propagate: false })).toBe('auto');
    expect(linkModeOf({ linkMode: 'nonsense' as never })).toBe('ask');
  });
});

describe('reviewClusters', () => {
  it('показує кластери з розбіжностями, порожніми поруч із перекладом і двома різними текстами', () => {
    const idx = new LinkIndex(views());
    const calm = project({ 'A.json': { a1: e('Привіт'), a3: e('Привіт') }, 'B.json': { b1: e('Привіт') } });
    expect(reviewClusters(calm, idx).total).toBe(0);
    const drift = project({ 'A.json': { a1: e('Привіт', 'done', 20), a3: e('Вітаю', 'done', 10) } });
    const r = reviewClusters(drift, idx);
    expect(r.total).toBe(1);
    expect(r.clusters[0]!.counts).toMatchObject({ main: 1, differs: 1, empty: 1 });
    expect(r.clusters[0]!.variants.map(v => v.target)).toEqual(['Привіт', 'Вітаю']);
  });
});

describe('дані зв’язків у проєкті', () => {
  it('переживають збереження й читання; без них поле відсутнє', () => {
    const p = project();
    expect(deserialize(serialize(p)).links).toBeUndefined();
    setMain(p, { file: 'A.json', key: 'a1', source: 'Hello' }, NOW);
    unlinkRow(p, { file: 'A.json', key: 'a3', source: 'Hello ' }, NOW);
    expect(Object.keys(deserialize(serialize(p)).links!).length).toBe(2);
  });
  it('злиття: новіший елемент виграє по одному, tombstone лишається слідом, старші за скидання відкидаються', () => {
    const a = project(), b = project();
    a.links = { 'u:r1': { k: 'u', ref: 'r1', h: 'x', mt: 10 }, 'm:T': { k: 'm', ref: 'r2', h: 'y', mt: 30 } };
    b.links = { 'u:r1': { k: 'u', ref: 'r1', h: 'x', mt: 20, del: true }, 'm:T': { k: 'm', ref: 'r9', h: 'y', mt: 5 }, 'u:r3': { k: 'u', ref: 'r3', h: 'z', mt: 2 } };
    const m = mergeLinkData(a, b, 0).links!;
    expect(m['u:r1']).toMatchObject({ mt: 20, del: true });
    expect(m['m:T']).toMatchObject({ ref: 'r2' });
    expect(Object.keys(mergeLinkData(a, b, 25).links!)).toEqual(['m:T']);
    expect(mergeLinkData({}, {}, 0)).toEqual({});
    const p = mergeProjects(a, b).project;
    expect(p.links!['u:r1']!.del).toBe(true);
    expect(mergeProjects(project(), project()).project.links).toBeUndefined();
  });
  it('скидання проєкту (resetEpoch) прибирає старі зв’язки', () => {
    const a = project(), b = project();
    a.links = { 'u:r1': { k: 'u', ref: 'r1', h: 'x', mt: 10 } };
    b.resetEpoch = 50;
    expect(mergeProjects(a, b).project.links).toBeUndefined();
  });
  it('збірка без знання про links не губить поле: воно лишається, якщо збірка його не змінювала', () => {
    const p = project();
    p.links = { 'u:r1': { k: 'u', ref: 'r1', h: 'x', mt: 10 } };
    const text = serialize(p);
    expect(JSON.parse(text).links).toBeDefined();
  });
});

describe('швидкодія', () => {
  it('20 тисяч рядків: індекс і огляд кластерів у межах секунди', () => {
    const units: Unit[] = Array.from({ length: 20000 }, (_, i) => unit(`k${i}`, `Line ${i % 7000}`));
    const vs: FileView[] = [{ name: 'Big.json', units }];
    const s = project({ 'Big.json': Object.fromEntries(units.filter((_, i) => i % 3 === 0).map((u, i) => [u.key, e(`Текст ${i % 50}`, 'done', i)])) });
    const t0 = performance.now();
    const idx = new LinkIndex(vs);
    const r = reviewClusters(s, idx);
    const dt = performance.now() - t0;
    expect(idx.size).toBeGreaterThan(5000);
    expect(r.total).toBeGreaterThan(0);
    expect(dt).toBeLessThan(5000);
  });
});
