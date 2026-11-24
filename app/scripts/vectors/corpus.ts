import type { Rng } from './util';

// Англійські слова: правильні дієслова, множина, винятки, британське написання — щоб пройти кожну гілку enKeys.
export const EN = `sword swords knife knives wolf wolves leaf leaves life lives half halves thief thieves shelf shelves man men woman women child children foot feet tooth teeth mouse mice goose geese ox oxen person people die dice staff staves
take took taken give gave given go went gone come came make made get got gotten run ran seen see knew know known throw threw wear wore broke broken fell fallen ate eaten drank drunk rode sang swam held kept brought bought caught taught sold told stood sat spoke woke chose hid blew grew flew shook forgot froze stole wrote began sent built lay laid paid said slept met led fought sought
centre center theatre grey gray colour color armour armor honour favourite flavour labour neighbour behaviour defence defense offence licence organise organize analyse analyze travelled traveled cancelled towards learnt dialogue catalog
box boxes glass glasses bus buses wish wishes church churches buzz quiz fox foxes class classes status focus virus crisis analysis axis
story stories city cities hero heroes potato potatoes key keys day days boy boys
running runs runned jumping jumped walking walked stopped stopping hopped hopping loving loved moved moving making taking baking tapped tipped added adding sing singing ring king ping thing bring string
use used using car cars bed beds bad dad pass passed kiss kissed miss missed Chris's king's dogs' dog's world's
1 2 10 100 3rd 42 99 level lvl hp mp HP MP Lv15 x2 e-mail don't can't isn't rock'n'roll
fire ice water earth wind light dark heal poison shield armor helmet potion elixir scroll key door chest gate cave tower village castle forest river mountain
off on up down out in over under away back with from into onto upon about against between through`.split(/\s+/).filter(Boolean);

export const UK = `меч мечем мечі мечів мечу мечеві мечами нога нозі ногою ноги рука руці рукою руки кінь коня коні коней вежа вежі вежею залізний залізного залізним залізних залізні залізна залізної сталевий сталевого сталеві сталевих
майстер майстра майстром майстрові пес пса псу собака собаки собаці дракон дракона драконові дракони драконів богдан бог бога богу богів боги бо навичка навичок навичці навички кінець кінця кінцем кінці
лікар лікаря лікарю зілля зілля вогонь вогню вогнем вогні гість гостя гостю гості гостей двері дверей дверям ворота воріт
ім'я імені імена імен сім'я сім'ї обʼєкт об'єкта об’єкти п'ять
зняти знімає знімають знімати зняв зі з із на у в до про від по й та
квітка квітки квіткою півень півня ніч ночі ніччю річ речі річчю сіль солі
Дракон ДРАКОН Меч МЕЧІ`.split(/\s+/).filter(Boolean);

export const CODES = ['\\N[1]', '\\C[2]', '\\{', '\\}', '\\.', '\\|', '\\!', '\\>', '\\<', '\\^', '\\$', '\\V[12]', '\\n'];
export const PUNCT = [' ', ' ', ' ', ' ', ', ', '. ', '! ', '? ', '; ', '\n', '-', ' - ', ' – ', '—', '"', '(', ')', '...', '…', ' … ', '😀', ' 🙂 ', '’', "'", '`', 'ʼ', '\t', ' ', ' '];

export function genText(r: Rng, lang: 'en' | 'uk' | 'mix'): string {
  let s = '';
  const n = 1 + r.int(14);
  for (let i = 0; i < n; i++) {
    const roll = r.next();
    if (roll < 0.06) s += r.pick(CODES);
    else if (lang === 'en' || (lang === 'mix' && r.chance(0.5))) s += r.pick(EN);
    else s += r.pick(UK);
    s += r.pick(PUNCT);
  }
  if (r.chance(0.1)) s = s.toUpperCase();
  return s;
}
export function genTerm(r: Rng, lang: 'en' | 'uk'): string {
  const pool = lang === 'en' ? EN : UK;
  const k = r.pick([1, 1, 1, 2, 2, 3]);
  const parts: string[] = [];
  for (let i = 0; i < k; i++) parts.push(r.pick(pool));
  const sep = r.pick([' ', ' ', ' ', '-', ' - ']);
  let t = parts.join(sep);
  if (r.chance(0.35)) {
    // шаблон з пропуском: «take … off»
    const gap = r.pick([' … ', '…', ' ... ', '...', ' …', '… ']);
    t = r.pick(pool) + gap + (r.chance(0.3) ? r.pick(pool) + ' ' + r.pick(pool) : r.pick(pool));
    if (r.chance(0.1)) t += gap + r.pick(pool);
    if (r.chance(0.08)) t = '… ' + t;
    if (r.chance(0.08)) t += ' …';
  }
  return r.chance(0.05) ? ' ' + t + ' ' : t;
}

