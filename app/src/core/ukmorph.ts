/**
 * Ukrainian case forms of nouns and adjectives, by rules, with no dictionary data («відмінювання»). It answers one question:
 * a text holds some form of an OLD term (`мечем`, `залізних мечів`); what is the same form of a NEW term (`клинком`,
 * `сталевих клинків`)? That is the job of `ukRetarget`.
 *
 * How it works («аналіз через синтез»): the old term is a known lemma, so its whole paradigm (7 cases × 2 numbers) is
 * generated and the observed word is looked up in it. That tells the case and number and, at the same time, proves that
 * the word really is a form of that term (`мечник` is not). Then the same cell of the new term is generated; an adjective
 * takes the gender and animacy of the new noun. Every step has a weight; their product is the confidence of the result,
 * cut into `high` (≥ 0.9), `medium` and `low` (< 0.6), so the doubtful ones are shown to the translator, not applied.
 *
 * The endings are facts of the Ukrainian orthography (Український правопис 2019) written out by hand. The short lists
 * (fleeting vowels, і/о/е alternation, genitive -а/-у, feminine soft-sign nouns, animate nouns, irregular words) are hand
 * made as well; nothing is copied from the VESUM/dict_uk dictionaries (their licence does not allow it). A dictionary can
 * still be plugged in later through `MorphDict`. The lists decide what is «high»: a word that is on none of them and has
 * a lexical choice to make (genitive -а or -у, a fleeting vowel, an і that may turn into о) comes out «medium».
 */

export const UK_CASES = ['nom', 'gen', 'dat', 'acc', 'ins', 'loc', 'voc'] as const;
export type UkCase = (typeof UK_CASES)[number];
export type UkNumber = 'sg' | 'pl';
export type Cell = `${UkCase}.${UkNumber}`;
export const CELLS: Cell[] = UK_CASES.flatMap(c => (['sg', 'pl'] as const).map(n => `${c}.${n}` as Cell));

export interface Conf { score: number; level: 'high' | 'medium' | 'low'; flags: string[] }
export const levelOf = (score: number): Conf['level'] => (score >= 0.9 ? 'high' : score >= 0.6 ? 'medium' : 'low');

export interface MorphInfo { gender?: 'm' | 'f' | 'n'; animate?: boolean }
/** A source of better knowledge, e.g. a dictionary: full forms of a word, or its gender and animacy. Synchronous. */
export interface MorphDict {
  lexeme?(lemma: string): Partial<Record<Cell, string[]>> | null;
  info?(lemma: string): MorphInfo | null;
}

interface Form { form: string; p: number; flags: string[] }
type Paradigm = Record<Cell, Form[]>
const blank = (): Paradigm => Object.fromEntries(CELLS.map(c => [c, [] as Form[]])) as unknown as Paradigm;
const F = (form: string, p = 0.99, flags: string[] = []): Form => ({ form, p, flags });

/* ---------- letters and small lists ---------- */

const norm = (s: string): string => s.toLowerCase().replace(/['ʼ`]/g, '’');
const CONS = 'бвгґджзклмнпрстфхцчшщ';
const isVowel = (c: string | undefined): boolean => !!c && 'аеєиіїоуюя'.includes(c);
const isCons = (c: string | undefined): boolean => !!c && CONS.includes(c);
const HUSH = 'жчшщ';
const list = (s: string): Set<string> => new Set(s.split(/\s+/).filter(Boolean));

/** Concrete things: genitive -а. */
const G_A = list('меч щит шолом кинджал клинок лук спис посох жезл плащ пояс перстень амулет браслет медальйон обруч обладунок молот ніж ключ камінь кристал самоцвіт артефакт предмет талісман свиток жетон мішок рюкзак чобіт черевик капюшон костюм кубок келих глечик горщик ліхтар факел смолоскип засув барабан тесак келеп арбалет патрон снаряд набій стілець стіл лист листок значок аркуш прапор шарф ремінь пакет ящик сундук ланцюг якір гаманець візок');
/** Substances, places, abstract things: genitive -у. */
const G_U = list('ліс світ страх вогонь дощ сніг дим пил час сон ґрунт гнів вітер лід мороз туман острів будинок міст сад двір храм цех рух звук запах смак шлях бій спокій мир порядок розум успіх голод холод жар суд гріх труд вік рік ранок вечір край');
/** Animate nouns (matter for the accusative). */
const ANIMATE = list('дракон ельф гном орк троль гоблін лицар маг чарівник чаклун воїн король принц вовк кінь лев ведмідь пес кіт ворог друг герой бог дух привид демон ангел вампір скелет павук щур змій торговець слуга гість старець селянин купець жрець мудрець хлопець чоловік лікар вчитель мисливець розбійник злодій стражник солдат капітан командир цар князь пан дід батько син брат хазяїн господар бик козел баран вепр олень лис заєць орел ворон сокіл дятел крук соловей шакал гігант велетень циклоп мертвяк упир');
/** Masculine nouns that end in -а/-я. */
const MASC_A = list('слуга воєвода староста суддя');
/** Feminine nouns with a soft sign or a consonant at the end (third declension); the -ість words are found by their ending. */
const FEM3 = list('ніч піч річ сіль ціль осінь тінь мідь подорож кров любов заметіль мозоль цвіль міць честь лють жовч смерть путь кість');
/** Mass nouns: a plural is rare, so the plural forms are never «high». */
const MASS = list('золото залізо срібло молоко масло борошно зілля вугілля насіння любов кров мідь честь лють');
/** The indeclinable. */
const INDECL = list('кафе меню метро кіно радіо таксі пальто бюро інтерв’ю шосе какао кенгуру журі цунамі хобі попурі');
/** Masculine nouns in -ар that decline hard. */
const HARD_AR = list('базар гектар комар санітар нектар тапір');
/** Nouns in -ій that are not adjectives. */
const NOUN_IJ = list('геній санаторій андрій сергій василій юрій марій гарій дарій сувій гній змій рій');
/** Soft adjectives that do not end in -ній. */
const SOFT_ADJ = list('синій третій');
/** Genitive plural in -ей. */
const GEN_EJ = list('кінь гість гусь');
/** The vowel before the last consonant drops: its stem in the forms with an ending. */
const FLEET_STEM: Record<string, string> = { день: 'дн', пень: 'пн', сон: 'сн', вогонь: 'вогн', лоб: 'лб', вітер: 'вітр', пес: 'пс', перстень: 'персн' };
/** -ок/-ець words whose vowel is a fleeting one (stated, so they come out «high»). */
const FLEET = list('клинок листок значок мішок візок хлопець палець кінець стрілець купець старець торговець мисливець гаманець');
/** -ок/-ець/-ень words whose vowel stays. */
const KEEP_VOWEL = list('урок рок мудрець олень кремень');
/** The vowel і of the last syllable becomes о or е in the forms with an ending (льо in лід). */
const ALT: Record<string, string> = { ніч: 'о', піч: 'е', річ: 'е', сіль: 'о', ніж: 'о', стіл: 'о', кіт: 'о', кінь: 'о', камінь: 'е', корінь: 'е', міст: 'о', ріг: 'о', рів: 'о', сніп: 'о', осінь: 'е', тінь: 'е', гість: 'о', кість: 'о', дім: 'о', бік: 'о', сік: 'о', пліт: 'о', лід: 'ьо' };
/** Words with an і in the last syllable where it stays. */
const NOALT = list('ліс хліб вік мир гріх біг сміх дід тріск крик');
/** The first part of a compound that does not decline. */
const COMB = list('жар напів екс віце диво міні міді максі супер квазі лейб обер анти контр мега псевдо');
/** Prepositions, conjunctions, particles: never decline. */
const FROZEN = list('в у на з із зі до від для про при над під між за по без через перед й і та або чи ні не а але як проти біля коло серед крізь навколо поруч');

/** Prepositions and the cases they ask for (the first is the usual one); a hint for choosing between forms that look alike. */
const PREP: Record<string, UkCase[]> = {
  в: ['loc', 'acc'], у: ['loc', 'acc'], на: ['loc', 'acc'], при: ['loc'], по: ['loc', 'dat', 'acc'], о: ['loc', 'acc'],
  до: ['gen'], від: ['gen'], для: ['gen'], без: ['gen'], біля: ['gen'], коло: ['gen'], серед: ['gen'], навколо: ['gen'], проти: ['gen'],
  з: ['gen', 'ins'], із: ['gen', 'ins'], зі: ['gen', 'ins'], над: ['ins'], під: ['ins', 'acc'], перед: ['ins'], між: ['ins'], за: ['ins', 'acc'],
  про: ['acc'], через: ['acc'], крізь: ['acc'],
};

/** Words whose forms are irregular: whatever is listed is used instead of the rules. */
const EXC: Record<string, { g: 'm' | 'f' | 'n'; an?: boolean; forms: Partial<Record<Cell, string[]>> }> = {
  'ім’я': { g: 'n', forms: { 'gen.sg': ['імені'], 'dat.sg': ['імені'], 'ins.sg': ['ім’ям'], 'loc.sg': ['імені'], 'nom.pl': ['імена'], 'gen.pl': ['імен'], 'dat.pl': ['іменам'], 'acc.pl': ['імена'], 'ins.pl': ['іменами'], 'loc.pl': ['іменах'], 'voc.pl': ['імена'] } },
  'сім’я': { g: 'f', forms: { 'gen.sg': ['сім’ї'], 'dat.sg': ['сім’ї'], 'acc.sg': ['сім’ю'], 'ins.sg': ['сім’єю'], 'loc.sg': ['сім’ї'], 'voc.sg': ['сім’є'], 'nom.pl': ['сім’ї'], 'gen.pl': ['сімей'], 'dat.pl': ['сім’ям'], 'acc.pl': ['сім’ї'], 'ins.pl': ['сім’ями'], 'loc.pl': ['сім’ях'], 'voc.pl': ['сім’ї'] } },
  мати: { g: 'f', an: true, forms: { 'nom.sg': ['мати'], 'gen.sg': ['матері'], 'dat.sg': ['матері'], 'acc.sg': ['матір'], 'ins.sg': ['матір’ю'], 'loc.sg': ['матері'], 'voc.sg': ['мати'], 'nom.pl': ['матері'], 'gen.pl': ['матерів'], 'dat.pl': ['матерям'], 'acc.pl': ['матерів'], 'ins.pl': ['матерями'], 'loc.pl': ['матерях'], 'voc.pl': ['матері'] } },
  око: { g: 'n', forms: { 'gen.sg': ['ока'], 'dat.sg': ['оку'], 'ins.sg': ['оком'], 'loc.sg': ['оці'], 'nom.pl': ['очі'], 'gen.pl': ['очей'], 'dat.pl': ['очам'], 'acc.pl': ['очі'], 'ins.pl': ['очима'], 'loc.pl': ['очах'], 'voc.pl': ['очі'] } },
  людина: { g: 'f', an: true, forms: { 'nom.pl': ['люди'], 'gen.pl': ['людей'], 'dat.pl': ['людям'], 'acc.pl': ['людей'], 'ins.pl': ['людьми'], 'loc.pl': ['людях'], 'voc.pl': ['люди'] } },
  дитина: { g: 'f', an: true, forms: { 'nom.pl': ['діти'], 'gen.pl': ['дітей'], 'dat.pl': ['дітям'], 'acc.pl': ['дітей'], 'ins.pl': ['дітьми'], 'loc.pl': ['дітях'], 'voc.pl': ['діти'] } },
  друг: { g: 'm', an: true, forms: { 'nom.pl': ['друзі'], 'voc.sg': ['друже'], 'voc.pl': ['друзі'] } },
  серце: { g: 'n', forms: { 'gen.pl': ['сердець'] } },
  кінь: { g: 'm', an: true, forms: { 'gen.pl': ['коней'], 'acc.pl': ['коней'], 'ins.pl': ['кіньми', 'конями'] } },
  двері: { g: 'f', forms: { 'nom.sg': ['двері'], 'gen.sg': ['дверей'], 'dat.sg': ['дверям'], 'acc.sg': ['двері'], 'ins.sg': ['дверима', 'дверми'], 'loc.sg': ['дверях'], 'voc.sg': ['двері'], 'nom.pl': ['двері'], 'gen.pl': ['дверей'], 'dat.pl': ['дверям'], 'acc.pl': ['двері'], 'ins.pl': ['дверима', 'дверми'], 'loc.pl': ['дверях'], 'voc.pl': ['двері'] } },
};

/** Genitive plural of neuter and feminine words that the rules cannot get. */
const GEN_PL: Record<string, string> = { слово: 'слів', село: 'сіл', число: 'чисел', вікно: 'вікон', місто: 'міст', озеро: 'озер', дерево: 'дерев', коло: 'кіл', крило: 'крил', ліжко: 'ліжок', горло: 'горл', дзеркало: 'дзеркал', нога: 'ніг', гора: 'гір', школа: 'шкіл', рука: 'рук', сестра: 'сестер', країна: 'країн', книга: 'книг', вода: 'вод', ціна: 'цін', земля: 'земель', пісня: 'пісень', вишня: 'вишень', шабля: 'шабель', зброя: 'зброй', море: 'морів', поле: 'полів', стріла: 'стріл', сокира: 'сокир', броня: 'броней' };

/* ---------- nouns ---------- */

type Cls = 'm_h' | 'm_m' | 'm_s' | 'm_y' | 'n_h' | 'n_s' | 'n_ya' | 'f_h' | 'f_m' | 'f_s' | 'f_y' | 'f_i' | 'f_3' | 'indecl' | 'exc';
interface Noun { kind: 'noun'; lemma: string; g: 'm' | 'f' | 'n'; an: boolean; cls: Cls; p: number; flags: string[] }

/** Gender, animacy and declension of a lemma (lower case, one kind of apostrophe). */
function parseNoun(lemma: string, dict?: MorphDict): Noun {
  const info = dict?.info?.(lemma) ?? null;
  const flags: string[] = [];
  let p = 0.99;
  let g: 'm' | 'f' | 'n', cls: Cls;
  const last = lemma.slice(-1), pre = lemma.slice(-2, -1);
  if (EXC[lemma]) { g = EXC[lemma]!.g; cls = 'exc'; }
  else if (INDECL.has(lemma)) { g = 'n'; cls = 'indecl'; flags.push('indeclinable'); }
  else if (lemma.endsWith('ія') && lemma.length > 3) { g = 'f'; cls = 'f_i'; }
  else if (last === 'а' || last === 'я') {
    if (MASC_A.has(lemma)) { g = 'm'; cls = last === 'а' ? 'f_h' : 'f_s'; }
    else if (last === 'а') { g = 'f'; cls = HUSH.includes(pre) ? 'f_m' : 'f_h'; }
    else if (pre === '’') { g = 'n'; cls = 'n_ya'; p *= 0.9; flags.push('apostrophe-я'); }
    else if (/([бвгґджзклмнпрстфхцчшщ])\1я$/.test(lemma)) { g = 'n'; cls = 'n_ya'; }
    else if (isVowel(pre)) { g = 'f'; cls = 'f_y'; }
    else { g = 'f'; cls = 'f_s'; }
  }
  else if (last === 'о') { g = 'n'; cls = 'n_h'; }
  else if (last === 'е') { g = 'n'; cls = 'n_s'; }
  else if (last === 'ь') {
    if (FEM3.has(lemma) || /(ість|сть)$/.test(lemma)) { g = 'f'; cls = 'f_3'; }
    else { g = 'm'; cls = 'm_s'; if (!ANIMATE.has(lemma) && !G_A.has(lemma) && !G_U.has(lemma) && !FLEET_STEM[lemma] && !ALT[lemma] && !KEEP_VOWEL.has(lemma)) { p *= 0.9; flags.push('soft-guess'); } }
  }
  else if (last === 'й') { g = 'm'; cls = 'm_y'; p *= 0.7; flags.push('й-stem'); }
  else if (FEM3.has(lemma)) { g = 'f'; cls = 'f_3'; }
  else if (isCons(last)) {
    g = 'm';
    cls = HUSH.includes(last) ? 'm_m' : /ар$/.test(lemma) && !HARD_AR.has(lemma) ? 'm_s' : 'm_h';
  } else { g = 'm'; cls = 'm_h'; p *= 0.5; flags.push('unknown-shape'); }
  if (info?.gender && info.gender !== g) {
    if (cls.startsWith('m_') && info.gender === 'f' && (isCons(last) || last === 'ь')) cls = 'f_3';
    else if (cls === 'f_3' && info.gender === 'm') cls = last === 'ь' ? 'm_s' : HUSH.includes(last) ? 'm_m' : 'm_h';
    g = info.gender;
  }
  const an = info?.animate ?? EXC[lemma]?.an ?? ANIMATE.has(lemma);
  if (!an && g === 'm' && info?.animate === undefined && cls !== 'indecl') flags.push('animacy-guess');
  return { kind: 'noun', lemma, g, an, cls, p, flags };
}

/** The stem of the forms with an ending: the fleeting vowel gone, і turned to о/е; with its weight. */
function oblique(n: Noun): { stem: string; p: number; flags: string[] } {
  const L = n.lemma;
  let stem = L.endsWith('ь') || L.endsWith('й') ? L.slice(0, -1) : L;
  let p = 1;
  const flags: string[] = [];
  if (n.g === 'm' && !KEEP_VOWEL.has(L)) {
    const fixed = FLEET_STEM[L];
    if (fixed) { stem = fixed; p *= 0.98; flags.push('fleeting'); }
    else if (/(ок|ець)$/.test(L)) {
      const m = /^(.*[бвгґджзклмнпрстфхцчшщ])[оеє]([кц])$/.exec(stem);
      if (m) {
        stem = (m[1] ?? '') + (m[1]!.endsWith('л') && m[2] === 'ц' ? 'ьц' : m[2] ?? '');
        p *= FLEET.has(L) ? 0.98 : 0.85; flags.push('fleeting');
      }
    } else if (/ень$/.test(L)) { p *= 0.75; flags.push('fleeting?'); }
  }
  const alt = ALT[L];
  if (alt) {
    const i = stem.lastIndexOf('і');
    if (i >= 0) stem = stem.slice(0, i) + alt + stem.slice(i + 1);
    flags.push('alt'); p *= 0.98;
  } else if (n.cls === 'f_3' && /ість$/.test(L)) { stem = stem.replace(/іст$/, 'ост'); flags.push('alt'); }
  else if (!NOALT.has(L) && (n.g === 'm' || n.cls === 'f_3') && /[бвгґджзклмнпрстфхцчшщ]і[бвгґджзклмнпрстфхцчшщ]$/.test(stem) && !/(ець|ень)$/.test(L)) { p *= 0.8; flags.push('alt?'); }
  return { stem, p, flags };
}

const VELAR: Record<string, string> = { г: 'з', к: 'ц', х: 'с', ґ: 'з' };
const VOC_ALT: Record<string, string> = { г: 'ж', к: 'ч', х: 'ш', ґ: 'ж' };

function masculine(n: Noun): Paradigm {
  const P = blank();
  const L = n.lemma, ob = oblique(n);
  const soft = n.cls === 'm_s' || n.cls === 'm_y', mixed = n.cls === 'm_m', y = n.cls === 'm_y';
  const { stem } = ob, flags = [...n.flags, ...ob.flags], base = n.p * ob.p;
  const add = (cell: Cell, form: string, p = 1, extra: string[] = []): void => { P[cell].push(F(form, Math.min(0.99, base * p), [...flags, ...extra])); };
  const last = stem.slice(-1), velarEnd = !soft && !mixed && !!VELAR[last];
  add('nom.sg', L);
  const gA = soft ? 'я' : 'а', gU = soft ? 'ю' : 'у';
  if (G_U.has(L)) { add('gen.sg', stem + gU, 0.98, ['gen-u']); add('gen.sg', stem + gA, 0.98); }
  else if (G_A.has(L) || n.an) add('gen.sg', stem + gA, 0.98);
  else { add('gen.sg', stem + gA, 0.72, ['gen-a-u']); add('gen.sg', stem + gU, 0.72, ['gen-a-u']); }
  const dE = y ? 'єві' : soft || mixed ? 'еві' : 'ові', dU = soft ? 'ю' : 'у';
  if (n.an) { add('dat.sg', stem + dE, 0.97); add('dat.sg', stem + dU, 0.97); } else { add('dat.sg', stem + dU, 0.95); add('dat.sg', stem + dE, 0.95); }
  for (const f of n.an ? P['gen.sg'] : P['nom.sg']) P['acc.sg'].push({ ...f });
  add('ins.sg', stem + (y ? 'єм' : soft || mixed ? 'ем' : 'ом'));
  const lI = y ? 'ї' : 'і';
  if (velarEnd) {
    if (n.an) { add('loc.sg', stem + dE, 0.88); add('loc.sg', stem + 'у', 0.88); }
    else { add('loc.sg', stem + 'у', 0.85); add('loc.sg', stem.slice(0, -1) + (VELAR[last] ?? last) + 'і', 0.85); }
  } else if (n.an) { add('loc.sg', stem + dE, 0.92); add('loc.sg', stem + lI, 0.92); }
  else { add('loc.sg', stem + lI, 0.95); add('loc.sg', stem + dU, 0.75); }
  if (soft) add('voc.sg', stem + 'ю', 0.6, ['voc']);
  else if (mixed) add('voc.sg', stem + 'у', 0.6, ['voc']);
  else add('voc.sg', (VOC_ALT[last] ? stem.slice(0, -1) + VOC_ALT[last] : stem) + 'е', 0.6, ['voc']);
  const pI = soft || mixed ? 'і' : 'и';
  add('nom.pl', stem + (y ? 'ї' : pI), 0.97);
  if (GEN_EJ.has(L)) { add('gen.pl', stem + 'ей', 0.95); add('gen.pl', stem + 'ів', 0.6); }
  else add('gen.pl', stem + (y ? 'їв' : 'ів'), 0.96);
  add('dat.pl', stem + (soft ? 'ям' : 'ам')); add('ins.pl', stem + (soft ? 'ями' : 'ами')); add('loc.pl', stem + (soft ? 'ях' : 'ах'));
  for (const f of n.an ? P['gen.pl'] : P['nom.pl']) P['acc.pl'].push({ ...f });
  for (const f of P['nom.pl']) P['voc.pl'].push({ ...f, p: f.p * 0.8 });
  // the accusative depends on animacy; when that was only guessed, it is less sure
  if (n.flags.includes('animacy-guess')) for (const c of ['acc.sg', 'acc.pl'] as Cell[]) for (const f of P[c]) { f.p *= 0.8; f.flags = [...f.flags, 'animacy-guess']; }
  return P;
}

function neuter(n: Noun): Paradigm {
  const P = blank();
  const L = n.lemma;
  const add = (cell: Cell, form: string, p = 1, extra: string[] = []): void => { P[cell].push(F(form, Math.min(0.99, n.p * p), [...n.flags, ...extra])); };
  if (n.cls === 'n_ya') {
    const stem = L.slice(0, -1), apos = stem.endsWith('’');
    add('nom.sg', L); add('gen.sg', L); add('dat.sg', stem + 'ю'); add('acc.sg', L); add('ins.sg', stem + 'ям'); add('loc.sg', stem + (apos ? 'ї' : 'і')); add('voc.sg', L);
    add('nom.pl', L, 0.6, ['rare-plural']); add('gen.pl', stem + 'ь', 0.5, ['rare-plural']); add('dat.pl', stem + 'ям', 0.6, ['rare-plural']); add('acc.pl', L, 0.6, ['rare-plural']);
    add('ins.pl', stem + 'ями', 0.6, ['rare-plural']); add('loc.pl', stem + 'ях', 0.6, ['rare-plural']); add('voc.pl', L, 0.5, ['rare-plural']);
    return P;
  }
  const stem = L.slice(0, -1), soft = n.cls === 'n_s', ctx = soft && !HUSH.includes(stem.slice(-1));
  add('nom.sg', L); add('gen.sg', stem + (ctx ? 'я' : 'а')); add('dat.sg', stem + (ctx ? 'ю' : 'у')); add('acc.sg', L);
  add('ins.sg', stem + (soft ? 'ем' : 'ом'));
  add('loc.sg', stem + 'і'); if (!soft) add('loc.sg', stem + 'у', 0.7);
  add('voc.sg', L);
  add('nom.pl', stem + (ctx ? 'я' : 'а'));
  const gp = GEN_PL[L];
  if (gp) add('gen.pl', gp, 0.95, ['gen-pl-listed']);
  else if (ctx) add('gen.pl', stem + 'ів', 0.6, ['gen-pl?']);
  else add('gen.pl', zeroGen(stem), 0.6, ['gen-pl?']);
  add('dat.pl', stem + (ctx ? 'ям' : 'ам')); add('acc.pl', stem + (ctx ? 'я' : 'а')); add('ins.pl', stem + (ctx ? 'ями' : 'ами')); add('loc.pl', stem + (ctx ? 'ях' : 'ах')); add('voc.pl', stem + (ctx ? 'я' : 'а'), 0.8);
  return P;
}

/** Zero ending of the genitive plural: a vowel goes in between a cluster at the end of the stem (вікн → вікон). */
function zeroGen(stem: string): string {
  const m = /^(.*[бвгґджзклмнпрстфхцчшщ])([кнлрмтц])$/.exec(stem);
  return m ? (m[1] ?? '') + ('кт'.includes(m[2] ?? '') ? 'о' : 'е') + (m[2] ?? '') : stem;
}

/** Genitive plural of a soft -я noun: пісн → пісень, земл → земель. */
function softGen(stem: string): string {
  const m = /^(.*[бвгґджзклмнпрстфхцчшщ])([лнрм])$/.exec(stem);
  return m ? (m[1] ?? '') + 'е' + (m[2] ?? '') + 'ь' : stem + 'ь';
}

function feminine(n: Noun): Paradigm {
  const P = blank();
  const L = n.lemma;
  const add = (cell: Cell, form: string, p = 1, extra: string[] = []): void => { P[cell].push(F(form, Math.min(0.99, n.p * p), [...n.flags, ...extra])); };
  if (n.cls === 'f_3') {
    const ob = oblique(n), stem = ob.stem, hasSoft = L.endsWith('ь'), hush = HUSH.includes(stem.slice(-1));
    const a = (cell: Cell, form: string, p = 1): void => { P[cell].push(F(form, Math.min(0.99, n.p * ob.p * p), [...n.flags, ...ob.flags])); };
    a('nom.sg', L); a('gen.sg', stem + 'і'); a('dat.sg', stem + 'і'); a('acc.sg', L); a('loc.sg', stem + 'і');
    // the last consonant is doubled after a vowel; an apostrophe stands after a labial or р
    const own = hasSoft ? L.slice(0, -1) : L, lc = own.slice(-1), prev = own.slice(-2, -1);
    const ins = 'бпвмфр'.includes(lc) && isVowel(prev) ? own + '’ю' : isVowel(prev) && 'дтзслнжчшц'.includes(lc) ? own + lc + 'ю' : own + 'ю';
    a('ins.sg', ins, 0.97); a('voc.sg', L, 0.6);
    a('nom.pl', stem + 'і'); a('gen.pl', stem + 'ей', 0.95);
    const soft = hasSoft && !hush;
    a('dat.pl', stem + (soft ? 'ям' : 'ам')); a('acc.pl', stem + 'і'); a('ins.pl', stem + (soft ? 'ями' : 'ами')); a('loc.pl', stem + (soft ? 'ях' : 'ах')); a('voc.pl', stem + 'і', 0.8);
    return P;
  }
  if (n.cls === 'f_i') {
    const s = L.slice(0, -2);
    add('nom.sg', L); add('gen.sg', s + 'ії'); add('dat.sg', s + 'ії'); add('acc.sg', s + 'ію'); add('ins.sg', s + 'ією'); add('loc.sg', s + 'ії'); add('voc.sg', s + 'іє', 0.6, ['voc']);
    add('nom.pl', s + 'ії'); add('gen.pl', s + 'ій'); add('dat.pl', s + 'іям'); add('acc.pl', s + 'ії'); add('ins.pl', s + 'іями'); add('loc.pl', s + 'іях'); add('voc.pl', s + 'ії', 0.8);
    return P;
  }
  if (n.cls === 'f_y') {
    const s = L.slice(0, -1);
    add('nom.sg', L); add('gen.sg', s + 'ї'); add('dat.sg', s + 'ї'); add('acc.sg', s + 'ю'); add('ins.sg', s + 'єю'); add('loc.sg', s + 'ї'); add('voc.sg', s + 'є', 0.6, ['voc']);
    const r = ['rare-plural'];
    add('nom.pl', s + 'ї', 0.5, r); add('gen.pl', GEN_PL[L] ?? s + 'їв', 0.4, r); add('dat.pl', s + 'ям', 0.5, r); add('acc.pl', s + 'ї', 0.5, r); add('ins.pl', s + 'ями', 0.5, r); add('loc.pl', s + 'ях', 0.5, r); add('voc.pl', s + 'ї', 0.4, r);
    return P;
  }
  const stem = L.slice(0, -1), last = stem.slice(-1), soft = n.cls === 'f_s', mixed = n.cls === 'f_m';
  const dl = !soft && !mixed && VELAR[last] ? stem.slice(0, -1) + VELAR[last] + 'і' : stem + 'і';
  add('nom.sg', L); add('gen.sg', stem + (soft || mixed ? 'і' : 'и')); add('dat.sg', dl); add('acc.sg', stem + (soft ? 'ю' : 'у'));
  add('ins.sg', stem + (soft || mixed ? 'ею' : 'ою')); add('loc.sg', dl); add('voc.sg', stem + (soft || mixed ? 'е' : 'о'), 0.6, ['voc']);
  add('nom.pl', stem + (soft || mixed ? 'і' : 'и'));
  const gp = GEN_PL[L];
  if (gp) add('gen.pl', gp, 0.95, ['gen-pl-listed']);
  else if (soft) add('gen.pl', softGen(stem), 0.7, ['gen-pl?']);
  else add('gen.pl', zeroGen(stem), 0.75, ['gen-pl?']);
  add('dat.pl', stem + (soft ? 'ям' : 'ам')); add('acc.pl', stem + (soft || mixed ? 'і' : 'и')); add('ins.pl', stem + (soft ? 'ями' : 'ами')); add('loc.pl', stem + (soft ? 'ях' : 'ах')); add('voc.pl', stem + (soft || mixed ? 'і' : 'и'), 0.8);
  return P;
}

function nounParadigm(n: Noun, dict?: MorphDict): Paradigm {
  let P: Paradigm;
  if (n.cls === 'exc') {
    const e = EXC[n.lemma]!;
    const L = n.lemma;
    P = e.g === 'n' ? neuter({ ...n, cls: L.endsWith('я') ? 'n_ya' : L.endsWith('о') ? 'n_h' : 'n_s' }) : e.g === 'f' ? feminine({ ...n, cls: L.endsWith('а') ? 'f_h' : L.endsWith('я') ? 'f_s' : 'f_3' }) : masculine({ ...n, cls: L.endsWith('ь') ? 'm_s' : 'm_h' });
    for (const c of CELLS) { const f = e.forms[c]; if (f) P[c] = f.map(x => F(x, 0.98, ['listed'])); }
  } else if (n.cls === 'indecl') {
    P = blank();
    for (const c of CELLS) P[c] = [F(n.lemma, 0.95, ['indeclinable'])];
  } else P = n.cls.startsWith('m_') ? masculine(n) : n.cls.startsWith('n_') ? neuter(n) : feminine(n);
  if (MASS.has(n.lemma)) for (const c of CELLS) if (c.endsWith('pl')) for (const f of P[c]) { f.p *= 0.3; f.flags = [...f.flags, 'mass-noun']; }
  const lex = dict?.lexeme?.(n.lemma);
  if (lex) for (const c of CELLS) { const f = lex[c]; if (f?.length) P[c] = f.map(x => F(norm(x), 0.99, ['dictionary'])); }
  return P;
}

/* ---------- adjectives ---------- */

interface Adj { kind: 'adj'; lemma: string; soft: boolean; stem: string; /** < 1 when the word was taken for an adjective only by its place and ending. */ p?: number }
const parseAdj = (lemma: string): Adj => ({ kind: 'adj', lemma, soft: lemma.endsWith('ій'), stem: lemma.slice(0, -2) });
/** Stems that look like adjectives (сталев-, залізн-, велик-, нов-): no doubt about the part of speech. */
const ADJ_STEM = /(ев|єв|ов|н|ськ|цьк|зьк|ичн|чн|лив|ист|аст|ян|ик|ок|ш)$/;

/** Endings in the order nom gen dat acc ins loc voc; `=` is the accusative (the nominative, or the genitive of an animate). */
const ADJ_HARD = { m: 'ий ого ому = им ому|ім ий', f: 'а ої ій у ою ій а', n: 'е ого ому = им ому|ім е', p: 'і их им = ими их і' };
const ADJ_SOFT = { m: 'ій ього ьому = ім ьому|ім ій', f: 'я ьої ій ю ьою ій я', n: 'є ього ьому = ім ьому|ім є', p: 'і іх ім = іми іх і' };

/** The paradigm of an adjective as it agrees with a noun of the given gender and animacy. */
function adjParadigm(a: Adj, g: 'm' | 'f' | 'n', an: boolean): Paradigm {
  const P = blank();
  const t = a.soft ? ADJ_SOFT : ADJ_HARD;
  const tables = { sg: t[g].split(' '), pl: t.p.split(' ') };
  UK_CASES.forEach((c, i) => {
    for (const num of ['sg', 'pl'] as const) {
      const cell = `${c}.${num}` as Cell, e = tables[num][i] ?? '';
      if (e === '=') {
        const useGen = an && ((num === 'sg' && g === 'm') || num === 'pl');
        for (const f of P[`${useGen ? 'gen' : 'nom'}.${num}` as Cell]) P[cell].push({ ...f });
      } else for (const x of e.split('|')) P[cell].push(F(a.stem + x, 0.99 * (a.p ?? 1), a.p && a.p < 1 ? ['adj-guess'] : []));
    }
  });
  return P;
}

/* ---------- phrases ---------- */

interface Word { text: string; sep: string; kind: 'adj' | 'noun' | 'frozen'; adj?: Adj; noun?: Noun; agree: boolean }
interface Parsed { words: Word[]; head: number; flags: string[]; first: string }

const TOKEN = /([\p{L}\p{N}]+(?:['’ʼ`][\p{L}]+)*)([^\p{L}\p{N}]*)/gu;

const casing = (w: string): 'upper' | 'first' | 'lower' => {
  const letters = [...w].filter(c => c.toLowerCase() !== c.toUpperCase());
  if (letters.length > 1 && letters.every(c => c === c.toUpperCase())) return 'upper';
  return letters.length && letters[0] === letters[0]!.toUpperCase() ? 'first' : 'lower';
};

function parsePhrase(phrase: string, dict?: MorphDict): Parsed {
  const words: Word[] = [];
  for (const m of phrase.matchAll(TOKEN)) {
    const text = m[1]!, sep = m[2] ?? '', low = norm(text);
    if (/[a-z0-9]/i.test(text) || (text.length > 1 && casing(text) === 'upper') || FROZEN.has(low)) words.push({ text, sep, kind: 'frozen', agree: false });
    else if (low.length >= 4 && !NOUN_IJ.has(low) && (/ий$/.test(low) || /ній$/.test(low) || SOFT_ADJ.has(low))) words.push({ text, sep, kind: 'adj', adj: parseAdj(low), agree: false });
    else words.push({ text, sep, kind: 'noun', noun: parseNoun(low, dict), agree: false });
  }
  // залізна вежа, велике місто: an adjective written in agreement with its noun ends in -а/-я or -е/-є, and the noun that follows has that gender
  for (let i = 0; i < words.length - 1; i++) {
    const w = words[i]!, nx = words[i + 1]!;
    if (w.kind !== 'noun' || nx.kind !== 'noun' || w.sep.trim() !== '') continue;
    const low = norm(w.text), last = low.slice(-1), stem = low.slice(0, -1), ng = nx.noun!.g;
    const agrees = ((last === 'а' || last === 'я') && ng === 'f') || ((last === 'е' || last === 'є') && ng === 'n');
    if (agrees && stem.length >= 3 && isCons(stem.slice(-1))) { w.kind = 'adj'; delete w.noun; w.adj = { kind: 'adj', lemma: low, soft: last === 'я' || last === 'є', stem, p: ADJ_STEM.test(stem) ? 1 : 0.9 }; }
  }
  const flags: string[] = [];
  let head = words.findIndex(w => w.kind === 'noun');
  if (head < 0) head = words.findIndex(w => w.kind === 'adj');
  words.forEach((w, i) => { if ((w.kind === 'adj' && i < head) || i === head) w.agree = true; });
  // a hyphen between two nouns makes one word that declines in both parts (меч-кладенець)
  for (let i = head + 1; i < words.length && head >= 0; i++) {
    const prev = words[i - 1]!, w = words[i]!;
    if (w.kind === 'noun' && prev.agree && prev.kind === 'noun' && prev.sep.trim() === '-') { w.agree = true; flags.push('compound'); }
  }
  // a first part such as жар-, напів- stays as it is
  const h = words[head];
  if (h && h.kind === 'noun' && COMB.has(norm(h.text)) && h.sep.trim() === '-' && words[head + 1]?.kind === 'noun') {
    h.agree = false; h.kind = 'frozen'; words[head + 1]!.agree = true; head += 1; flags.push('prefix-compound');
  }
  return { words, head, flags, first: words[0]?.text ?? '' };
}

/** The paradigm of every word that declines; the adjectives take the gender and animacy of the head noun. */
function wordParadigms(ph: Parsed, dict?: MorphDict): (Paradigm | null)[] {
  const h = ph.words[ph.head]?.noun;
  return ph.words.map(w => (!w.agree ? null : w.kind === 'noun' ? nounParadigm(w.noun!, dict) : adjParadigm(w.adj!, h?.g ?? 'm', h?.an ?? false)));
}

const CASE_PRIOR: Record<UkCase, number> = { nom: 1, acc: 0.95, gen: 0.95, dat: 0.9, ins: 0.95, loc: 0.9, voc: 0.25 };
const cellPrior = (c: Cell): number => CASE_PRIOR[c.slice(0, 3) as UkCase] * (c.endsWith('pl') ? 0.85 : 1);

export interface Retarget {
  /** The new term in the case and number of the observed text, as it should stand in its place. */
  text: string;
  conf: Conf;
  /** The cells the observed text can be (its case and number). */
  cells: Cell[];
  /** Other results: the observed form fits several cells that give different new forms. */
  alts: { text: string; conf: Conf }[];
  ambiguous: boolean;
}

/** The forms of a whole phrase in each cell (variants in the order of preference); null for a phrase without a noun or adjective. */
export function ukForms(phrase: string, dict?: MorphDict): Record<Cell, string[]> | null {
  const ph = parsePhrase(phrase, dict);
  if (ph.head < 0) return null;
  const pars = wordParadigms(ph, dict);
  const out = Object.fromEntries(CELLS.map(c => [c, [] as string[]])) as unknown as Record<Cell, string[]>;
  for (const c of CELLS) {
    const n = Math.max(1, ...pars.map(p => (p ? p[c].length : 1)));
    for (let v = 0; v < n; v++) {
      let t = '';
      ph.words.forEach((w, i) => { const f = pars[i]?.[c]; t += (f?.length ? (f[v] ?? f[0]!).form : w.text) + w.sep; });
      out[c].push(t.trim());
    }
  }
  return out;
}

/**
 * The new term in the same case and number as the old one stands in `observed`. `prev` is the word before it in the text
 * (a preposition tells the case). Returns null when `observed` is not a form of the old term, or when it does not have
 * as many words as the old term.
 */
export function ukRetarget(oldPhrase: string, newPhrase: string, observed: string, opts: { prev?: string; dict?: MorphDict } = {}): Retarget | null {
  const dict = opts.dict;
  const oldP = parsePhrase(oldPhrase, dict), newP = parsePhrase(newPhrase, dict);
  const obs = [...observed.matchAll(TOKEN)].map(m => ({ text: m[1]!, sep: m[2] ?? '' }));
  if (!oldP.words.length || !newP.words.length || obs.length !== oldP.words.length || oldP.head < 0 || newP.head < 0) return null;
  const oldPars = wordParadigms(oldP, dict);
  let cells = CELLS.slice();
  const flags: string[] = [];
  let capScore = 1;
  const variant = new Map<Cell, number>();
  for (let i = 0; i < oldP.words.length; i++) {
    const w = oldP.words[i]!, o = norm(obs[i]!.text), par = oldPars[i];
    if (!par) { if (norm(w.text) !== o) { capScore = 0.5; flags.push('frozen-differs'); } continue; }
    cells = cells.filter(c => { const vi = par[c].findIndex(f => f.form === o); if (vi >= 0 && !variant.has(c)) variant.set(c, vi); return vi >= 0; });
    if (!cells.length) return null;
  }
  const need = opts.prev ? PREP[norm(opts.prev)] : undefined;
  let prior = cellPrior;
  if (need) {
    if (cells.some(c => need.includes(c.slice(0, 3) as UkCase))) cells = cells.filter(c => need.includes(c.slice(0, 3) as UkCase));
    prior = (c: Cell): number => cellPrior(c) * (c.startsWith(need[0]!) ? 1 : 0.5);
  }
  const newPars = wordParadigms(newP, dict);
  const seen0 = casing(obs[0]!.text), sameCount = newP.words.length === obs.length, obsCase = obs.map(o => casing(o.text));
  const seps = sameCount ? obs.map(o => o.sep) : newP.words.map(w => w.sep);
  const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
  const typed = /['ʼ`’]/.exec(newPhrase)?.[0];
  const build = (cell: Cell): { text: string; p: number; fl: string[] } | null => {
    let p = capScore, text = '';
    const fl = [...flags], k = variant.get(cell) ?? 0;
    for (let i = 0; i < newP.words.length; i++) {
      const w = newP.words[i]!, par = newPars[i];
      let form = w.text;
      if (par) {
        const forms = par[cell];
        if (!forms.length) return null;
        const f = forms[Math.min(k, forms.length - 1)]!;
        form = f.form; p *= f.p; fl.push(...f.flags);
      }
      // the case of the letters follows the text that is replaced (мечем → клинком, Мечем → Клинком, МЕЧЕМ → КЛИНКОМ)
      const use = seen0 === 'upper' ? 'upper' : sameCount ? obsCase[i]! : i === 0 ? seen0 : casing(w.text);
      text += (use === 'upper' ? form.toUpperCase() : use === 'first' ? cap(form) : par ? form : w.text) + (i < newP.words.length - 1 ? (seps[i] ?? '') : '');
    }
    if (oldP.flags.includes('compound') || newP.flags.includes('compound')) { p *= 0.9; fl.push('compound'); }
    return { text: typed ? text.replace(/’/g, typed) : text, p, fl };
  };
  const results: { cell: Cell; r: { text: string; p: number; fl: string[] }; pr: number }[] = [];
  for (const c of cells) { const r = build(c); if (r) results.push({ cell: c, r, pr: prior(c) }); }
  results.sort((a, b) => b.pr - a.pr);
  const best = results[0];
  if (!best) return null;
  const others = results.filter(x => x.r.text !== best.r.text);
  const ambiguous = others.some(x => x.pr >= 0.7 * best.pr);
  const conf = (p: number, fl: string[], amb: boolean): Conf => { const s = Math.round(p * (amb ? 0.6 : 1) * 1000) / 1000; return { score: s, level: levelOf(s), flags: [...new Set([...fl, ...(amb ? ['ambiguous-case'] : [])])] }; };
  const seen = new Set<string>([best.r.text]);
  const alts = others.filter(x => !seen.has(x.r.text) && !!seen.add(x.r.text)).map(x => ({ text: x.r.text, conf: conf(x.r.p, x.r.fl, false) }));
  return { text: best.r.text, conf: conf(best.r.p, best.r.fl, ambiguous), cells: results.map(x => x.cell), alts, ambiguous };
}
