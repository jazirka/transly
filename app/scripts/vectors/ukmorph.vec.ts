import { test } from 'vitest';
import { plural, rows } from '../../src/core/plural';
import { CELLS, ukForms, ukNorm, ukRetarget, ukWordForms } from '../../src/core/ukmorph';
import { rng, writeVectors } from './util';
import type { Rng } from './util';

// Слова з усіх списків ukmorph.ts плюс «звичайні» й випадкові: щоб охопити кожну гілку відмінювання.
const NOUNS = `меч щит шолом кинджал клинок лук спис посох плащ перстень амулет молот ніж ключ камінь кристал лист листок значок мішок візок гаманець ліс світ страх вогонь дощ сніг час сон вітер лід острів будинок міст шлях бій
дракон ельф гном орк лицар маг чарівник воїн король вовк кінь лев ведмідь пес кіт майстер умілець торговець слуга гість старець хлопець чоловік лікар цар батько дід
слуга воєвода суддя микола петро павло данило тарас ілля мирослав остап іван богдан
жінка відьма сестра корова королева миша дочка дівчина лисиця принцеса вежа книга нога рука гора школа земля пісня шабля зброя стріла сокира броня країна вода ціна гра людина дитина стаття сім’я ім’я мати
ніч піч річ сіль ціль осінь тінь мідь подорож кров любов заметіль честь лють смерть путь кість радість міць сила істота
золото залізо срібло молоко масло борошно зілля вугілля слово село число вікно місто озеро дерево коло крило ліжко горло дзеркало море поле око серце
кафе меню метро кіно інтерв’ю ворота штани окуляри ножиці сани гроші ліки плечі двері
день пень лоб вітер орел козел заєць корабель рівень олень кремень урок рок мудрець гість гусь геній санаторій андрій сергій змій рій край герой музей
аватар радар лікар пекар кобзар бондар гончар секретар бібліотекар
армія історія стратегія лінія ідея пісня мрія надія аудиторія
ящик пакет арбалет тесак келеп ліхтар факел засув барабан якір ремінь
стіл стілець дім бік сік пліт ріг рів сніп хліб гріх біг сміх тріск крик`.split(/\s+/).filter(Boolean);
const ADJS = ['залізний', 'сталевий', 'великий', 'новий', 'давній', 'синій', 'третій', 'нижній', 'верхній', 'чорний', 'старий', 'лісовий', 'магічний', 'вогняний', 'залізна', 'сталева', 'залізне', 'велике', 'нова', 'нове', 'чорні', 'залізні', 'давні', 'нижні', 'Залізний'];
const FROZEN = ['на', 'з', 'у', 'для', 'of', 'II', 'HP', '3', 'та'];
const SEPS = [' ', ' ', ' ', '-', ' - ', ', '];
const CONS = 'бвгґджзклмнпрстфхцчшщ', VOW = 'аеєиіїоуюя', ENDS = ['', 'а', 'я', 'о', 'е', 'ь', 'й', 'к', 'ок', 'ець', 'ень', 'ість', 'ія', 'ий', 'ій', 'ар', 'ір', 'ль', 'ш', 'ч', 'ця', 'ка'];

function randomWord(r: Rng): string {
  let s = '';
  for (let n = 1 + r.int(2); n > 0; n--) s += r.pick([...CONS]) + r.pick([...VOW]);
  return s + r.pick(ENDS);
}
function genPhrase(r: Rng): string {
  const noun = (): string => (r.chance(0.8) ? r.pick(NOUNS) : randomWord(r));
  const out: string[] = [];
  const k = r.pick([1, 1, 1, 2, 2, 3]);
  for (let i = 0; i < k; i++) {
    const roll = r.next();
    out.push(roll < 0.35 ? r.pick(ADJS) : roll < 0.45 ? r.pick(FROZEN) : noun());
    if (i < k - 1) out.push(r.pick(SEPS));
  }
  let s = out.join('');
  if (r.chance(0.1)) s = s.replace(/[’]/g, "'");
  if (r.chance(0.1)) s = s.toUpperCase();
  else if (r.chance(0.2)) s = s.charAt(0).toUpperCase() + s.slice(1);
  if (r.chance(0.05)) s += ' ';
  return s;
}
const PREV = [undefined, undefined, 'в', 'на', 'з', 'до', 'під', 'про', 'бачив', 'біля', 'і', 'у', 'по', 'над', 'За'];

test('export ukmorph vectors', () => {
  const r = rng(77);
  const out: Record<string, { input: unknown; output: unknown }[]> = {};
  const add = (name: string, input: unknown, output: unknown) => (out[name] ??= []).push({ input, output });

  const ns = [0, 1, 2, 3, 4, 5, 10, 11, 12, 13, 14, 15, 20, 21, 22, 25, 99, 100, 101, 111, 112, 999, 1000, 1001, 4000, 12345, 40899, 105000, 1234567, 0, -1, -5, -21, -1000];
  for (const n of ns) { add('plural', n, plural(n, ['файл', 'файли', 'файлів'])); add('rows', n, rows(n)); }

  for (const w of ['Меч', "М'ЯЧ", 'ПЕТРО', "ім'я", 'А`Б', '']) add('ukNorm', w, ukNorm(w));
  add('cells', null, CELLS);

  const phrases = new Set<string>();
  for (const w of NOUNS) phrases.add(w);
  while (phrases.size < 1500) phrases.add(genPhrase(r));
  for (const p of phrases) {
    const f = ukForms(p);
    add('ukForms', p, f);
    const wf = ukWordForms(p);
    add('ukWordForms', p, wf && wf.map(s => [...s].sort()));
  }

  const list = [...phrases];
  for (let i = 0; i < 4000; i++) {
    const oldP = r.chance(0.85) ? r.pick(list) : r.pick(NOUNS), newP = r.chance(0.8) ? r.pick(list) : r.pick(NOUNS);
    const forms = ukForms(oldP);
    let observed: string;
    if (forms && r.chance(0.9)) {
      const f = forms[r.pick(CELLS)]!;
      observed = r.pick(f);
      if (r.chance(0.25)) observed = observed.charAt(0).toUpperCase() + observed.slice(1);
      else if (r.chance(0.1)) observed = observed.toUpperCase();
    } else observed = r.pick(list);
    const prev = r.pick(PREV);
    add('ukRetarget', { oldP, newP, observed, prev: prev ?? null }, ukRetarget(oldP, newP, observed, prev === undefined ? {} : { prev }));
  }
  writeVectors('ukmorph', out);
});
