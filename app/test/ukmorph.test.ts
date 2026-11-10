import { describe, expect, it } from 'vitest';
import { CELLS, levelOf, ukForms, ukRetarget } from '../src/core/ukmorph';
import type { Cell } from '../src/core/ukmorph';

/** lemma → forms that must be among the variants of the cell (written by hand from the Ukrainian orthography). */
const A: Record<string, Partial<Record<Cell, string>>> = {
  меч: { 'gen.sg': 'меча', 'ins.sg': 'мечем', 'loc.sg': 'мечі', 'nom.pl': 'мечі', 'gen.pl': 'мечів', 'dat.pl': 'мечам', 'ins.pl': 'мечами', 'loc.pl': 'мечах' },
  щит: { 'gen.sg': 'щита', 'ins.sg': 'щитом', 'loc.sg': 'щиті', 'nom.pl': 'щити', 'gen.pl': 'щитів' },
  ключ: { 'gen.sg': 'ключа', 'ins.sg': 'ключем', 'loc.sg': 'ключі', 'nom.pl': 'ключі', 'gen.pl': 'ключів' },
  ліс: { 'gen.sg': 'лісу', 'ins.sg': 'лісом', 'loc.sg': 'лісі', 'nom.pl': 'ліси', 'gen.pl': 'лісів' },
  клинок: { 'gen.sg': 'клинка', 'ins.sg': 'клинком', 'loc.sg': 'клинку', 'nom.pl': 'клинки', 'gen.pl': 'клинків' },
  сон: { 'gen.sg': 'сну', 'ins.sg': 'сном', 'loc.sg': 'сні', 'nom.pl': 'сни', 'gen.pl': 'снів' },
  день: { 'gen.sg': 'дня', 'ins.sg': 'днем', 'loc.sg': 'дні', 'nom.pl': 'дні', 'gen.pl': 'днів' },
  вогонь: { 'gen.sg': 'вогню', 'ins.sg': 'вогнем', 'loc.sg': 'вогні', 'nom.pl': 'вогні', 'gen.pl': 'вогнів' },
  ніж: { 'gen.sg': 'ножа', 'ins.sg': 'ножем', 'loc.sg': 'ножі', 'nom.pl': 'ножі', 'gen.pl': 'ножів' },
  камінь: { 'gen.sg': 'каменя', 'ins.sg': 'каменем', 'loc.sg': 'камені', 'nom.pl': 'камені', 'gen.pl': 'каменів' },
  перстень: { 'gen.sg': 'персня', 'ins.sg': 'перснем', 'nom.pl': 'персні' },
  дракон: { 'gen.sg': 'дракона', 'acc.sg': 'дракона', 'ins.sg': 'драконом', 'loc.sg': 'драконові', 'nom.pl': 'дракони', 'gen.pl': 'драконів', 'acc.pl': 'драконів' },
  ельф: { 'gen.sg': 'ельфа', 'acc.sg': 'ельфа', 'ins.sg': 'ельфом', 'loc.sg': 'ельфові', 'nom.pl': 'ельфи', 'gen.pl': 'ельфів' },
  лицар: { 'gen.sg': 'лицаря', 'ins.sg': 'лицарем', 'loc.sg': 'лицареві', 'nom.pl': 'лицарі', 'gen.pl': 'лицарів' },
  чарівник: { 'gen.sg': 'чарівника', 'ins.sg': 'чарівником', 'loc.sg': 'чарівникові', 'nom.pl': 'чарівники', 'gen.pl': 'чарівників' },
  вовк: { 'gen.sg': 'вовка', 'ins.sg': 'вовком', 'loc.sg': 'вовкові', 'nom.pl': 'вовки', 'gen.pl': 'вовків' },
  хлопець: { 'gen.sg': 'хлопця', 'ins.sg': 'хлопцем', 'loc.sg': 'хлопцеві', 'nom.pl': 'хлопці', 'gen.pl': 'хлопців' },
  кінь: { 'gen.sg': 'коня', 'ins.sg': 'конем', 'loc.sg': 'коні', 'nom.pl': 'коні', 'gen.pl': 'коней' },
  лев: { 'gen.sg': 'лева', 'ins.sg': 'левом', 'loc.sg': 'леві', 'nom.pl': 'леви', 'gen.pl': 'левів' },
  вежа: { 'gen.sg': 'вежі', 'acc.sg': 'вежу', 'ins.sg': 'вежею', 'loc.sg': 'вежі', 'nom.pl': 'вежі', 'gen.pl': 'веж' },
  країна: { 'gen.sg': 'країни', 'ins.sg': 'країною', 'loc.sg': 'країні', 'nom.pl': 'країни', 'gen.pl': 'країн' },
  книга: { 'gen.sg': 'книги', 'ins.sg': 'книгою', 'loc.sg': 'книзі', 'nom.pl': 'книги', 'gen.pl': 'книг' },
  рука: { 'gen.sg': 'руки', 'ins.sg': 'рукою', 'loc.sg': 'руці', 'nom.pl': 'руки', 'gen.pl': 'рук' },
  нога: { 'gen.sg': 'ноги', 'ins.sg': 'ногою', 'loc.sg': 'нозі', 'nom.pl': 'ноги', 'gen.pl': 'ніг' },
  земля: { 'gen.sg': 'землі', 'acc.sg': 'землю', 'ins.sg': 'землею', 'loc.sg': 'землі', 'nom.pl': 'землі', 'gen.pl': 'земель' },
  пісня: { 'gen.sg': 'пісні', 'ins.sg': 'піснею', 'nom.pl': 'пісні', 'gen.pl': 'пісень' },
  лінія: { 'gen.sg': 'лінії', 'acc.sg': 'лінію', 'ins.sg': 'лінією', 'loc.sg': 'лінії', 'nom.pl': 'лінії', 'gen.pl': 'ліній' },
  'сім’я': { 'gen.sg': 'сім’ї', 'ins.sg': 'сім’єю', 'nom.pl': 'сім’ї', 'gen.pl': 'сімей' },
  ніч: { 'gen.sg': 'ночі', 'ins.sg': 'ніччю', 'loc.sg': 'ночі', 'nom.pl': 'ночі', 'gen.pl': 'ночей', 'dat.pl': 'ночам' },
  любов: { 'gen.sg': 'любові', 'ins.sg': 'любов’ю', 'loc.sg': 'любові' },
  радість: { 'gen.sg': 'радості', 'ins.sg': 'радістю', 'loc.sg': 'радості', 'nom.pl': 'радості', 'gen.pl': 'радостей', 'dat.pl': 'радостям' },
  сіль: { 'gen.sg': 'солі', 'ins.sg': 'сіллю', 'nom.pl': 'солі' },
  осінь: { 'gen.sg': 'осені', 'ins.sg': 'осінню' },
  мати: { 'gen.sg': 'матері', 'ins.sg': 'матір’ю', 'nom.pl': 'матері', 'gen.pl': 'матерів' },
  місто: { 'gen.sg': 'міста', 'ins.sg': 'містом', 'loc.sg': 'місті', 'nom.pl': 'міста', 'gen.pl': 'міст' },
  море: { 'gen.sg': 'моря', 'ins.sg': 'морем', 'loc.sg': 'морі', 'nom.pl': 'моря' },
  золото: { 'gen.sg': 'золота', 'ins.sg': 'золотом', 'loc.sg': 'золоті' },
  життя: { 'gen.sg': 'життя', 'dat.sg': 'життю', 'ins.sg': 'життям', 'loc.sg': 'житті' },
  зілля: { 'gen.sg': 'зілля', 'dat.sg': 'зіллю', 'ins.sg': 'зіллям', 'loc.sg': 'зіллі' },
  'ім’я': { 'gen.sg': 'імені', 'ins.sg': 'ім’ям', 'nom.pl': 'імена', 'gen.pl': 'імен' },
  серце: { 'gen.sg': 'серця', 'ins.sg': 'серцем', 'loc.sg': 'серці', 'nom.pl': 'серця', 'gen.pl': 'сердець' },
  вікно: { 'gen.sg': 'вікна', 'ins.sg': 'вікном', 'loc.sg': 'вікні', 'nom.pl': 'вікна', 'gen.pl': 'вікон' },
  око: { 'gen.sg': 'ока', 'ins.sg': 'оком', 'loc.sg': 'оці', 'nom.pl': 'очі', 'gen.pl': 'очей' },
  кладенець: { 'gen.sg': 'кладенця', 'ins.sg': 'кладенцем', 'loc.sg': 'кладенці', 'nom.pl': 'кладенці', 'gen.pl': 'кладенців' },
  шабля: { 'gen.sg': 'шаблі', 'acc.sg': 'шаблю', 'ins.sg': 'шаблею', 'nom.pl': 'шаблі', 'gen.pl': 'шабель' },
  зброя: { 'gen.sg': 'зброї', 'acc.sg': 'зброю', 'ins.sg': 'зброєю' },
  людина: { 'nom.pl': 'люди', 'gen.pl': 'людей', 'ins.pl': 'людьми' },
  дитина: { 'nom.pl': 'діти', 'gen.pl': 'дітей' },
  друг: { 'nom.pl': 'друзі', 'voc.sg': 'друже', 'gen.sg': 'друга' },
  кафе: { 'gen.sg': 'кафе', 'ins.sg': 'кафе', 'nom.pl': 'кафе' },
};

describe('ukForms: форми слів', () => {
  for (const [lemma, cells] of Object.entries(A)) {
    for (const [cell, form] of Object.entries(cells) as [Cell, string][]) {
      it(`${lemma} · ${cell} → ${form}`, () => expect(ukForms(lemma)![cell]).toContain(form));
    }
  }
  it('основні форми — перші в черзі (родовий, орудний, називний множини, родовий множини)', () => {
    for (const [lemma, cells] of Object.entries(A)) {
      if (['ліс', 'сон', 'день', 'вогонь'].includes(lemma)) continue; // тут обидва варіанти родового мають право на перше місце
      for (const cell of ['gen.sg', 'ins.sg', 'nom.pl', 'gen.pl'] as Cell[]) {
        const form = cells[cell];
        if (form) expect(ukForms(lemma)![cell][0], `${lemma} ${cell}`).toBe(form);
      }
    }
  });
  it('у кожному слові є всі 14 комірок і жодної порожньої форми', () => {
    for (const lemma of Object.keys(A)) {
      const f = ukForms(lemma)!;
      for (const c of CELLS) { expect(f[c].length, `${lemma} ${c}`).toBeGreaterThan(0); expect(f[c].every(x => x.length > 0)).toBe(true); }
    }
  });
});

describe('прикметники й фрази', () => {
  const ph = (p: string, c: Cell): string => ukForms(p)![c][0]!;
  it('твердий, м’який, шиплячий і задньоязиковий прикметники з іменником чоловічого роду', () => {
    expect(ph('залізний меч', 'gen.sg')).toBe('залізного меча');
    expect(ph('залізний меч', 'ins.sg')).toBe('залізним мечем');
    expect(ph('залізний меч', 'nom.pl')).toBe('залізні мечі');
    expect(ph('великий меч', 'gen.pl')).toBe('великих мечів');
    expect(ph('гарячий вогонь', 'dat.sg')).toBe('гарячому вогню');
    expect(ph('синій щит', 'gen.sg')).toBe('синього щита');
    expect(ph('синій щит', 'dat.sg')).toBe('синьому щиту');
    expect(ph('останній день', 'ins.sg')).toBe('останнім днем');
    expect(ph('останній день', 'gen.pl')).toBe('останніх днів');
  });
  it('жіночий і середній рід: прикметник бере рід іменника', () => {
    expect(ph('залізна вежа', 'gen.sg')).toBe('залізної вежі');
    expect(ph('залізна вежа', 'ins.sg')).toBe('залізною вежею');
    expect(ph('залізна вежа', 'acc.sg')).toBe('залізну вежу');
    expect(ph('третя ніч', 'gen.sg')).toBe('третьої ночі');
    expect(ph('велике місто', 'ins.sg')).toBe('великим містом');
    expect(ph('синє море', 'gen.sg')).toBe('синього моря');
  });
  it('істота: знахідний як родовий', () => {
    expect(ph('чорний дракон', 'acc.sg')).toBe('чорного дракона');
    expect(ph('чорний дракон', 'acc.pl')).toBe('чорних драконів');
    expect(ph('чорний меч', 'acc.sg')).toBe('чорний меч');
  });
  it('залежна частина не відмінюється', () => {
    expect(ph('меч вогню', 'ins.sg')).toBe('мечем вогню');
  });
  it('прикладкове з дефісом відмінюється обома частинами; перша частина жар- лишається', () => {
    expect(ph('меч-кладенець', 'ins.sg')).toBe('мечем-кладенцем');
    expect(ph('меч-кладенець', 'gen.pl')).toBe('мечів-кладенців');
    expect(ph('жар-птиця', 'gen.sg')).toBe('жар-птиці');
  });
  it('слово без іменника й прикметника не має форм', () => { expect(ukForms('123')).toBeNull(); expect(ukForms('')).toBeNull(); });
});

interface Row { old: string; next: string; seen: string; prev?: string; expect: string; level?: 'high' | 'medium' | 'low' | 'notHigh' }
const RETARGET: Row[] = [
  { old: 'меч', next: 'клинок', seen: 'мечем', expect: 'клинком', level: 'high' },
  { old: 'меч', next: 'клинок', seen: 'меча', expect: 'клинка', level: 'high' },
  { old: 'меч', next: 'клинок', seen: 'мечів', expect: 'клинків', level: 'high' },
  { old: 'меч', next: 'клинок', seen: 'мечам', expect: 'клинкам', level: 'high' },
  { old: 'меч', next: 'клинок', seen: 'мечами', expect: 'клинками', level: 'high' },
  { old: 'меч', next: 'клинок', seen: 'мечах', expect: 'клинках', level: 'high' },
  { old: 'меч', next: 'клинок', seen: 'мечу', expect: 'клинку' },
  { old: 'меч', next: 'клинок', seen: 'мечі', expect: 'клинки', level: 'notHigh' },
  { old: 'меч', next: 'клинок', seen: 'мечі', prev: 'у', expect: 'клинку' },
  { old: 'меч', next: 'Клинок', seen: 'Мечем', expect: 'Клинком', level: 'high' },
  { old: 'Меч', next: 'клинок', seen: 'мечем', expect: 'клинком', level: 'high' },
  { old: 'меч', next: 'клинок', seen: 'МЕЧЕМ', expect: 'КЛИНКОМ', level: 'high' },
  { old: 'меч', next: 'ніж', seen: 'мечем', expect: 'ножем', level: 'high' },
  { old: 'меч', next: 'ельф', seen: 'мечем', expect: 'ельфом' },
  { old: 'ельф', next: 'меч', seen: 'ельфа', expect: 'меча', level: 'notHigh' },
  { old: 'день', next: 'ніч', seen: 'дня', expect: 'ночі', level: 'high' },
  { old: 'день', next: 'ніч', seen: 'днем', expect: 'ніччю', level: 'high' },
  { old: 'день', next: 'ніч', seen: 'днів', expect: 'ночей', level: 'high' },
  { old: 'день', next: 'ніч', seen: 'дні', expect: 'ночі', level: 'high' },
  { old: 'ніч', next: 'день', seen: 'ночі', expect: 'дня', level: 'notHigh' },
  { old: 'сон', next: 'мрія', seen: 'сну', expect: 'мрії' },
  { old: 'сон', next: 'мрія', seen: 'сном', expect: 'мрією', level: 'high' },
  { old: 'залізний меч', next: 'сталевий клинок', seen: 'залізним мечем', expect: 'сталевим клинком', level: 'high' },
  { old: 'залізний меч', next: 'сталевий клинок', seen: 'залізного меча', expect: 'сталевого клинка', level: 'high' },
  { old: 'залізний меч', next: 'сталевий клинок', seen: 'залізні мечі', expect: 'сталеві клинки', level: 'high' },
  { old: 'залізний меч', next: 'сталевий клинок', seen: 'залізних мечів', expect: 'сталевих клинків', level: 'high' },
  { old: 'залізний меч', next: 'сталевий клинок', seen: 'залізному мечі', expect: 'сталевому клинку' },
  { old: 'залізний меч', next: 'сталева шабля', seen: 'залізним мечем', expect: 'сталевою шаблею', level: 'high' },
  { old: 'залізний меч', next: 'сталева шабля', seen: 'залізного меча', expect: 'сталевої шаблі', level: 'high' },
  { old: 'залізний меч', next: 'сталева шабля', seen: 'залізному мечу', expect: 'сталевій шаблі', level: 'high' },
  { old: 'залізний меч', next: 'сталева шабля', seen: 'залізних мечів', expect: 'сталевих шабель', level: 'high' },
  { old: 'залізний меч', next: 'сталева шабля', seen: 'залізний меч', expect: 'сталева шабля', level: 'notHigh' },
  { old: 'Меч Вогню', next: 'Клинок Полум’я', seen: 'мечем Вогню', expect: 'клинком Полум’я', level: 'high' },
  { old: 'меч', next: 'меч-кладенець', seen: 'мечем', expect: 'мечем-кладенцем', level: 'medium' },
  { old: 'меч-кладенець', next: 'клинок', seen: 'мечем-кладенцем', expect: 'клинком', level: 'medium' },
  { old: 'кафе', next: 'меню', seen: 'кафе', prev: 'у', expect: 'меню', level: 'high' },
  { old: 'вежа', next: 'замок', seen: 'вежею', expect: 'замком', level: 'notHigh' },
  { old: 'країна', next: 'земля', seen: 'країною', expect: 'землею', level: 'high' },
  { old: 'країна', next: 'земля', seen: 'країни', expect: 'землі', level: 'high' },
  { old: 'життя', next: 'смерть', seen: 'житті', expect: 'смерті', level: 'high' },
];

describe('ukRetarget: та сама форма нового терміна', () => {
  for (const r of RETARGET) {
    it(`${r.old} → ${r.next}: «${r.prev ? r.prev + ' ' : ''}${r.seen}» → ${r.expect}`, () => {
      const x = ukRetarget(r.old, r.next, r.seen, r.prev ? { prev: r.prev } : {});
      expect(x, 'форму не розпізнано').not.toBeNull();
      expect(x!.text === r.expect || x!.alts.some(a => a.text === r.expect), `одержано «${x!.text}», очікувано «${r.expect}»`).toBe(true);
      // нуль допуску: впевнений результат завжди збігається з очікуваним
      if (x!.conf.level === 'high') expect(x!.text).toBe(r.expect);
      if (r.level === 'notHigh') expect(x!.conf.level).not.toBe('high');
      else if (r.level) expect(x!.conf.level).toBe(r.level);
    });
  }
  it('слово, що не є формою старого терміна, не розпізнається (мечник, клин)', () => {
    expect(ukRetarget('меч', 'клинок', 'мечник')).toBeNull();
    expect(ukRetarget('клинок', 'меч', 'клин')).toBeNull();
    expect(ukRetarget('сила', 'міць', 'сильний')).toBeNull();
  });
  it('різна кількість слів у старому терміні й у тексті — не розпізнається', () => {
    expect(ukRetarget('залізний меч', 'клинок', 'мечем')).toBeNull();
    expect(ukRetarget('меч', 'клинок', 'залізним мечем')).toBeNull();
  });
  it('неоднозначність: різні нові форми в комірках, де форма збігається, дають альтернативи', () => {
    const x = ukRetarget('меч', 'клинок', 'мечі')!;
    expect(x.ambiguous).toBe(true);
    expect([x.text, ...x.alts.map(a => a.text)].sort()).toEqual(['клинки', 'клинку']);
    expect(x.conf.flags).toContain('ambiguous-case');
  });
  it('апостроф береться з нового терміна', () => {
    expect(ukRetarget('меч', 'сім\'я', 'мечем')?.text).toBe('сім\'єю');
    expect(ukRetarget('меч', 'ім’я', 'мечем')?.text).toBe('ім’ям');
  });
  it('основа на -й (сувій, герой) не буває «високою»: чергування й особливі закінчення', () => {
    for (const w of ['сувій', 'герой', 'край']) expect(ukRetarget('книга', w, 'книзі')!.conf.level, w).not.toBe('high');
  });
  it('лексичний вибір без списку не буває «високим»: родовий -а/-у, випадна голосна, чергування і', () => {
    for (const word of ['жрець', 'швець', 'замок', 'горіх', 'рот', 'чобіт', 'базар', 'вівтар', 'корінь']) {
      const x = ukRetarget('меч', word, 'меча');
      expect(x, word).not.toBeNull();
      expect(x!.conf.level, `${word} → ${x!.text}`).not.toBe('high');
    }
  });
  it('збірне слово у множині не буває «високим»', () => {
    expect(ukRetarget('меч', 'золото', 'мечів')!.conf.level).not.toBe('high');
    expect(ukRetarget('меч', 'золото', 'мечами')!.conf.level).not.toBe('high');
    // а в однині воно «високе»: у мечі → у золоті
    expect(ukRetarget('меч', 'золото', 'мечі', { prev: 'у' })!.text).toBe('золоті');
  });
  it('круговий обхід: кожна форма кожного слова розпізнається назад у своїй комірці', () => {
    for (const lemma of Object.keys(A)) {
      const f = ukForms(lemma)!;
      for (const c of CELLS) for (const form of f[c]) {
        const x = ukRetarget(lemma, lemma, form);
        expect(x, `${lemma} ${c} ${form}`).not.toBeNull();
        expect(x!.cells, `${lemma} ${form}`).toContain(c);
      }
    }
  });
  it('словник перекриває правила: lexeme й info', () => {
    expect(ukForms('меч', { lexeme: l => (l === 'меч' ? { 'gen.sg': ['мечика'] } : null) })!['gen.sg']).toEqual(['мечика']);
    expect(ukForms('ліс', { info: () => ({ gender: 'f' }) })!['gen.sg'][0]).toBe('лісі');
  });
});

describe('рівні впевненості', () => {
  it('межі: ≥ 0.9 високий, ≥ 0.6 середній, нижче низький', () => {
    expect(levelOf(0.99)).toBe('high'); expect(levelOf(0.9)).toBe('high'); expect(levelOf(0.89)).toBe('medium');
    expect(levelOf(0.6)).toBe('medium'); expect(levelOf(0.59)).toBe('low'); expect(levelOf(0)).toBe('low');
  });
});
