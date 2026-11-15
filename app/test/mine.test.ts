import { describe, expect, it } from 'vitest';
import { mineConstructions } from '../src/core';
import type { Entry, FileView } from '../src/core';

const unit = (key: string, source: string) => ({ key, source, speaker: '', kind: 'dialogue' as const, context: 'c' });
const entry = (target: string): Entry => ({ target, status: 'done', mt: 1 } as Entry);
const none = async () => undefined;

function corpus(rows: [string, string][]): { views: FileView[]; saved: { files: Record<string, Record<string, Entry>> } } {
  const units = rows.map(([s], i) => unit(`k${i}`, s));
  const files: Record<string, Entry> = {};
  rows.forEach(([, t], i) => { files[`k${i}`] = entry(t); });
  return { views: [{ name: 'A.json', units }], saved: { files: { 'A.json': files } } };
}

describe('finding constructions in the translated rows', () => {
  const rows: [string, string][] = [
    ['Take your hat off now.', 'Зніміть капелюх зараз, будь ласка.'], ['Please take the cloak off.', 'Будь ласка, зніміть плащ.'], ['He took his boots off.', 'Він зняв чоботи.'],
    ['Take the ring off!', 'Зніми перстень!'], ['She is taking her gloves off.', 'Вона знімає рукавички.'],
    ['Take the key.', 'Візьми ключ.'], ['Take the road north.', 'Іди дорогою на північ.'], ['I will take the sword.', 'Я візьму меч.'], ['Take care of her.', 'Бережи її.'],
    ['It is a nice day.', 'Гарний день.'], ['The door is locked.', 'Двері зачинено.'], ['Find the red apple.', 'Знайди червоне яблуко.'],
  ];

  it('proposes a construction that is rendered with one word in most rows, and not the verb alone', async () => {
    const { views, saved } = corpus(rows);
    const found = await mineConstructions(views, saved, [], none);
    const take = found.find(f => f.en === 'take … off');
    expect(take).toBeTruthy();
    expect(take!.rows).toHaveLength(5);
    expect(found.some(f => f.en.startsWith('hat'))).toBe(false);
    expect(found.some(f => f.en === 'take … up')).toBe(false);
  });

  it('writes the Ukrainian word as it is most often rendered, as a starting point', async () => {
    const { views, saved } = corpus(rows);
    const take = (await mineConstructions(views, saved, [], none)).find(f => f.en === 'take … off')!;
    expect(take.uk.startsWith('зн')).toBe(true);
  });

  it('does not propose what is in the glossary already, however it is typed', async () => {
    const { views, saved } = corpus(rows);
    expect((await mineConstructions(views, saved, [{ en: 'take … off' }], none)).some(f => f.en === 'take … off')).toBe(false);
    expect((await mineConstructions(views, saved, [{ en: 'take ... off' }], none)).some(f => f.en === 'take … off')).toBe(false);
  });

  it('needs three rows, and rows rendered with different words are no construction', async () => {
    const few = corpus(rows.slice(0, 2));
    expect(await mineConstructions(few.views, few.saved, [], none)).toEqual([]);
    const mixed = corpus([['Give it to him.', 'Віддай йому.'], ['Give the key to her.', 'Передай їй ключ.'], ['Give gold to them.', 'Подаруй їм золото.'], ['Give it to me.', 'Дай мені.']]);
    expect(await mineConstructions(mixed.views, mixed.saved, [], none)).toEqual([]);
  });

  it('a verb whose rows without the particle are rendered the same way is the verb’s entry, not a construction', async () => {
    const same = corpus([
      ['Open the door up.', 'Відчини двері.'], ['Open the gate up.', 'Відчини браму.'], ['Open the chest up.', 'Відчини скриню.'],
      ['Open the box.', 'Відчини коробку.'], ['Open the window.', 'Відчини вікно.'], ['Open the book.', 'Відчини книгу.'], ['Open the letter.', 'Відчини листа.'],
      ['A cat.', 'Кіт.'], ['A dog.', 'Пес.'],
    ]);
    expect((await mineConstructions(same.views, same.saved, [], none)).some(f => f.en === 'open … up')).toBe(false);
  });

  it('untranslated rows and drafts are not read; the screen is given back between slices', async () => {
    const { views, saved } = corpus(rows);
    for (const k of Object.keys(saved.files['A.json']!)) saved.files['A.json']![k]!.status = 'draft';
    expect(await mineConstructions(views, saved, [], none)).toEqual([]);
    const ok = corpus(rows);
    let pauses = 0;
    await mineConstructions(ok.views, ok.saved, [], async () => { pauses++; }, 20000, 4);
    expect(pauses).toBeGreaterThan(2);
  });
});

describe('finding constructions at scale', () => {
  it('twenty thousand translated rows are looked through quickly', async () => {
    const en = 'the a hat apple take off pick up give to key door red old man woman walk run open close light dark gate road north south and then he she it you'.split(' ');
    const uk = 'капелюх яблуко зняти підняти дати ключ двері червоний старий чоловік жінка йти бігти відкрити закрити світло темний брама дорога північ південь і потім він вона'.split(' ');
    let seed = 11;
    const rnd = (n: number) => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * n); };
    const rows: [string, string][] = Array.from({ length: 20000 }, () => [Array.from({ length: 6 + rnd(8) }, () => en[rnd(en.length)]).join(' ') + '.', Array.from({ length: 4 + rnd(6) }, () => uk[rnd(uk.length)]).join(' ') + '.']);
    const { views, saved } = corpus(rows);
    const t0 = Date.now();
    const found = await mineConstructions(views, saved, [], none);
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(found.length).toBeLessThanOrEqual(30);
  });
});
