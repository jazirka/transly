import { describe, expect, it } from 'vitest';
import {
  DEFAULT_QA, QA_RULES, activeIssues, adviceCount, build, check, commitRows, deserialize, emptyProject, fixRule, keepFromText, keepToText, maskCodes,
  mergeProjects, qaOf, readGame, ruleStats, serialize, submit, undoJournal, withRuleLevel,
} from '../src/core';
import type { Entry, GameFile, Issue, QaOptions, QaSettings, UnitKind } from '../src/core';

/* The letters that look alike are written as names, so an editor cannot hide which alphabet a test uses. */
const L = { a: 'a', c: 'c', e: 'e', i: 'i', o: 'o', p: 'p', x: 'x', y: 'y', B: 'B', C: 'C', H: 'H', K: 'K', M: 'M', P: 'P' };
const U = (...cp: number[]): string => String.fromCodePoint(...cp);
const CYR = { С: U(0x421), о: U(0x43e), а: U(0x430), е: U(0x435), і: U(0x456), х: U(0x445), В: U(0x412), К: U(0x41a), М: U(0x41c), Н: U(0x41d), Р: U(0x420), Х: U(0x425), І: U(0x406) };

const opts = (q?: QaSettings): QaOptions => ({ ...DEFAULT_QA, rules: qaOf(q ? { qa: q } : undefined) });
const run = (id: string, source: string, target: string, q?: QaSettings, kind: UnitKind = 'dialogue'): Issue | undefined => check({ source, kind }, target, opts(q)).find(i => i.key === id);
const fixed = (id: string, source: string, target: string, q?: QaSettings): string | undefined => run(id, source, target, q)?.fix?.text;

type Pos = [source: string, target: string, fixed: string | null];

function positives(id: string, cases: Pos[], q?: QaSettings, kind?: UnitKind): void {
  it.each(cases)(`${id}: %j → %j`, (source, target, want) => {
    const issue = run(id, source, target, q, kind);
    expect(issue, 'має бути зауваження').toBeDefined();
    if (want === null) expect(issue!.fix).toBeUndefined();
    else {
      expect(issue!.fix?.text).toBe(want);
      // the fix is complete: the rule has nothing more to say, and fixing again changes nothing
      expect(run(id, source, want, q, kind)).toBeUndefined();
    }
  });
}
const negatives = (id: string, cases: [source: string, target: string][], q?: QaSettings, kind?: UnitKind): void => {
  it.each(cases)(`${id} мовчить: %j → %j`, (source, target) => { expect(run(id, source, target, q, kind)).toBeUndefined(); });
};

describe('керівні коди: допоміжне', () => {
  it('maskCodes зберігає довжину й зсуви', () => {
    const t = '\\C[2]Сила\\C[0] \\{ХП\\} \\N[1]';
    const m = maskCodes(t);
    expect(m.length).toBe(t.length);
    expect(m.indexOf('Сила')).toBe(t.indexOf('Сила'));
    expect(m).not.toMatch(/[A-Za-z]/);
  });
});

describe('code-malformed (помилка)', () => {
  const S = '\\C[2]Hi\\C[0]';
  positives('code-malformed', [
    [S, `\\${CYR.С}[2]Привіт\\C[0]`, '\\C[2]Привіт\\C[0]'],
    [S, '\\C [2]Привіт\\C[0]', '\\C[2]Привіт\\C[0]'],
    [S, '\\ C[2]Привіт\\C[0]', '\\C[2]Привіт\\C[0]'],
    [S, '\\C[2Привіт\\C[0]', '\\C[2]Привіт\\C[0]'],
    [S, '\uFF3CC[2]Привіт\\C[0]', '\\C[2]Привіт\\C[0]'],
    [S, `\\${CYR.С}[2]Привіт\\${CYR.С}[0]`, '\\C[2]Привіт\\C[0]'],
    [S, '\\C[red]Привіт\\C[0]', null],
    ['\\N[1] says', '\\N[x] каже', null],
    ['\\V[3] gold', '\\V[] золота', null],
    ['\\C[2]Hi', '\\C[2]Привіт\\C[0', '\\C[2]Привіт\\C[0]'],
  ]);
  negatives('code-malformed', [
    [S, '\\C[2]Привіт\\C[0]'],
    ['\\{Big\\}', '\\{Великий\\}'],
    ['Wait\\!', 'Зачекай\\!'],
    ['Wait\\.\\|', 'Зачекай\\.\\|'],
    ['\\>Fast\\<', '\\>Швидко\\<'],
    ['\\$ gold', '\\$ золота'],
    ['\\G', '\\G'],
    ['\\FS[20]Hi', '\\FS[20]Привіт'],
    ['\\N[1] and \\V[10]', '\\N[1] і \\V[10]'],
    ['C:\\Games', 'Шлях C:\\Games'],
    // the same text in the original is the game's own, not a slip of the translator
    [`\\${CYR.С}[2]x`, `\\${CYR.С}[2]y`],
    ['\\n[player]', '\\n[player] каже'],
  ]);
  it('це помилка, яка блокує надсилання, але її можна проігнорувати', () => {
    const o = { ...DEFAULT_QA, ...opts() };
    const bad = '\\C[red]Привіт';
    const i = check({ source: '\\C[2]Hi', kind: 'dialogue' }, bad, o).find(x => x.key === 'code-malformed')!;
    expect(i.severity).toBe('bad');
    expect(i.cat).toBe('error');
    const e: Entry = { target: bad, status: 'draft', mt: 1 };
    const u = { key: '1', source: '\\C[2]Hi', kind: 'dialogue' as const };
    const r = submit(e, u as never, 'translate', 5, { blockErrors: true, qa: o });
    expect(r.ok).toBe(false);
    const ok = submit({ ...e, ign: ['code-malformed', 'codes'] }, u as never, 'translate', 5, { blockErrors: true, qa: o });
    expect(ok.ok).toBe(true);
  });
});

describe('uk-homoglyph', () => {
  positives('uk-homoglyph', [
    ['Strength', `${L.C}ила`, `${CYR.С}ила`],
    ['Portal', `п${L.o}ртал`, `п${CYR.о}ртал`],
    ['Mass', `мас${L.a}`, `мас${CYR.а}`],
    ['Elf', `${L.e}лф`, `${CYR.е}лф`],
    ['You and me', `Ти ${L.i} я`, `Ти ${CYR.і} я`],
    ['Hall', `${L.x}ол`, `${CYR.х}ол`],
    ['Wind', `${L.B}ітер`, `${CYR.В}ітер`],
    ['Cat', `${L.K}іт`, `${CYR.К}іт`],
    ['Mother', `${L.M}ати`, `${CYR.М}ати`],
    ['Letter', `${L.y}мова`, `${U(0x443)}мова`],
    ['Grass', 'тра' + 'g', null],
    ['HP: 50', `${CYR.Н}${CYR.Р}: 50`, 'HP: 50'],
    ['Level XIX', `Рівень ${CYR.Х}${CYR.І}${CYR.Х}`, 'Рівень XIX'],
    ['Hp up', `${L.H}${U(0x440)} вгору`, `${L.H}p вгору`],
  ]);
  negatives('uk-homoglyph', [
    ['Strength', 'Сила'],
    ['HP bar', 'HP-бар'],
    ['3D model', '3D-модель'],
    ['PvP', 'Режим PvP'],
    ['Wi-Fi', 'Мережа Wi-Fi'],
    ['Color', 'Колір #FF8800'],
    ['icon', 'Файл icon.png'],
    ["D'Artagnan", "Д'Артаньян"],
    ['XIX', 'XIX століття'],
    ['Press Enter', 'Натисніть Enter'],
    ['Type A', 'Тип A'],
    ['Option a', 'Опція a'],
    ['Ox', 'Ох'],
    ['\\C[2]Hi', '\\C[2]Сила\\C[0]'],
    ['Hello', 'Привіт, Hello'],
    ['Ti', 'Ти i'],
    [`${L.C}ила`, `${L.C}ила`],
    ['Ми', 'Хі-хі'],
  ]);
  it('Латинське слово з «дозволеного» списку проєкту не чіпається, інакше правило без виправлення', () => {
    const word = `${L.M}${CYR.о}b`;
    expect(run('uk-homoglyph', 'Monster', word)?.fix).toBeUndefined();
    expect(fixed('uk-homoglyph', 'Monster', word, { keep: ['mob'] })).toBe('Mob');
    // a word of the original is the game's own, so it is accepted as it stands
    expect(fixed('uk-homoglyph', 'Mob', word)).toBe('Mob');
  });
  it('НР замість HP не вважається помилкою, якщо HP немає в оригіналі', () => {
    expect(run('uk-homoglyph', 'Health', `${CYR.Н}${CYR.Р}`)).toBeUndefined();
    expect(fixed('uk-homoglyph', 'Health', `${CYR.Н}${CYR.Р}`, { keep: ['hp'] })).toBe('HP');
  });
});

describe('uk-foreign-letters', () => {
  const ch = (...cp: number[]): string => U(...cp);
  const pos: [string, string][] = [
    ['Soap', `М${ch(0x44b)}ло`], ['This', `${ch(0x44d)}тот`], ['Object', `о${ch(0x44a)}ект`], ['Hedgehog', `${ch(0x451)}ж`],
    ['Hedgehog', `${ch(0x401)}Ж`], ['Soap', `${ch(0x42b)}`], ['Soap', `${ch(0x42d)}ль`], ['Mark', `${ch(0x42a)}`], ['Short', `${ch(0x45e)}`], ['Soap', `мило, а потім мы${ch(0x44b)}`],
  ];
  it.each(pos)('%j → %j', (s, t) => {
    const i = run('uk-foreign-letters', s, t);
    expect(i).toBeDefined();
    expect(i!.fix).toBeUndefined();
    expect(i!.severity).toBe('warn');
  });
  negatives('uk-foreign-letters', [
    ['Soap', 'Мило'], ['Hedgehog', 'Їжак'], ['Porch', 'Ґанок'], ['Yulia', 'Юля'], ['Apple', 'Яблуко'], ['Is', 'Є'], ['Sign', 'Знак ь'],
    ['Soap', 'Hello'], [`${ch(0x451)}ж`, `${ch(0x451)}ж`], [`${ch(0x44b)}`, `${ch(0x44b)}`],
  ]);
});

describe('uk-normalization', () => {
  const D = { й: U(0x438, 0x306), Й: U(0x418, 0x306), ї: U(0x456, 0x308), Ї: U(0x406, 0x308) };
  positives('uk-normalization', [
    ['Soldier', `во${D.й}н`.replace('о', 'о'), `во${U(0x439)}н`],
    ['Hedgehog', `${D.Ї}жак`, `${U(0x407)}жак`],
    ['Hedgehog', `${D.ї}жак`, `${U(0x457)}жак`],
    ['War', `${D.Й}ти`, `${U(0x419)}ти`],
    ['Cafe', 'cafe\u0301', 'caf\u00e9'],
    ['x', `ма${D.й}стер`, `ма${U(0x439)}стер`],
    ['x', `${D.ї}${D.ї}`, `${U(0x457)}${U(0x457)}`],
    ['x', `Вона ${D.й}шла`, `Вона ${U(0x439)}шла`],
    ['x', `Кра${D.ї}на`, `Кра${U(0x457)}на`],
    ['x', `${D.й}`, `${U(0x439)}`],
  ]);
  negatives('uk-normalization', [
    ['Soldier', 'воїн'], ['x', 'Йти'], ['x', 'їжак'], ['x', 'Кафе'], ['x', 'а\u0301'], ['x', 'Привіт'],
    [`ма${D.й}стер`, `ма${D.й}стер`], ['x', 'Hello'], ['x', ''], ['x', 'й'],
  ]);
});

describe('ws-hidden', () => {
  const Z = { zw: '\u200B', zwnj: '\u200C', wj: '\u2060', bom: '\uFEFF', shy: '\u00AD', ls: '\u2028', em: '\u2003', ideo: '\u3000', bell: '\u0007', del: '\u007F' };
  positives('ws-hidden', [
    ['Hi', `При${Z.zw}віт`, 'Привіт'],
    ['Hi', `При${Z.zwnj}віт`, 'Привіт'],
    ['Hi', `При${Z.wj}віт`, 'Привіт'],
    [`Hi`, `${Z.bom}Привіт`, 'Привіт'],
    ['Hi', `При${Z.shy}віт`, 'Привіт'],
    ['Hi', `Привіт${Z.ls}світе`, 'Привіт\nсвіте'],
    ['Hi', `Привіт${Z.em}світе`, 'Привіт світе'],
    ['Hi', `Привіт${Z.ideo}світе`, 'Привіт світе'],
    ['Hi', `При${Z.bell}віт`, 'Привіт'],
    ['Hi', `При${Z.del}віт`, 'Привіт'],
  ]);
  negatives('ws-hidden', [
    ['Hi', 'При\u00A0віт'], ['Hi', 'При\nвіт'], ['Hi', 'При\tвіт'], ['Hi', 'Привіт'],
    [`Hi${Z.zw}`, `При${Z.zw}віт`], [`Hi${Z.shy}`, `При${Z.shy}віт`],
    ['Hi', 'Привіт 👨\u200D👩\u200D👧'], ['Hi', '\\C[2]Привіт\\C[0]'], ['Hi', 'Привіт, світе!'], ['Hi', 'При\r\nвіт'],
  ]);
});

describe('ws-edges', () => {
  // in a name, a term or a plugin text the edges must be as in the original
  positives('ws-edges', [
    ['Hi', ' Привіт', 'Привіт'],
    ['Hi ', 'Привіт', 'Привіт '],
    ['Hi\n', 'Привіт', 'Привіт\n'],
    ['  Hi', 'Привіт', '  Привіт'],
    ['Hi', 'Привіт\n', 'Привіт'],
    ['Hi', 'Привіт ', 'Привіт'],
    [' Hi ', ' Привіт', ' Привіт '],
    ['Hi', '\nПривіт', 'Привіт'],
    ['Hi ', 'Привіт  ', 'Привіт '],
    ['\\C[2]Hi ', '\\C[2]Привіт', '\\C[2]Привіт '],
  ], undefined, 'name');
  negatives('ws-edges', [
    ['Hi', 'Привіт'], [' Hi', ' Привіт'], ['Hi ', 'Привіт '], ['Hi\n', 'Привіт\n'], ['Hi\u00A0', 'Привіт\u00A0'],
    ['!', ' !'], ['Hi', ''], ['Hi', '   '], ['\\C[2]Hi', '\\C[2]Привіт'], ['A b', 'А б'],
  ], undefined, 'name');
  // a line of a dialogue: only what the translator added
  positives('ws-edges', [
    ['Hi', ' Привіт', 'Привіт'], ['Hi', 'Привіт ', 'Привіт'], ['Hi', 'Привіт\n', 'Привіт'], ['Hi ', 'Привіт  ', 'Привіт '], [' Hi', '   Привіт', ' Привіт'],
  ], undefined, 'dialogue');
  negatives('ws-edges', [
    ['Hi ', 'Привіт'], ['Hi\n', 'Привіт'], ['  Hi', 'Привіт'], ['Hi ', 'Привіт '], ['Hi', 'Привіт'],
  ], undefined, 'dialogue');
});

describe('ws-double', () => {
  positives('ws-double', [
    ['a b', 'Привіт  світе', 'Привіт світе'],
    ['a b', 'Привіт   світе', 'Привіт світе'],
    ['a b', 'Так.  Ні.', 'Так. Ні.'],
    ['a b', '\\C[2]  Привіт', '\\C[2] Привіт'],
    ['a b', 'один  два  три', 'один два три'],
    ['a b', 'Привіт,  світе', 'Привіт, світе'],
    ['a b', 'А  б', 'А б'],
    ['a b', 'рядок\nперший  другий', 'рядок\nперший другий'],
    ['a b', 'Так!  Ні!', 'Так! Ні!'],
    ['a b', 'тут  «слово»', 'тут «слово»'],
  ]);
  negatives('ws-double', [
    ['a b', 'Привіт світе'], ['a  b', 'Привіт  світе'], ['a b', '  Привіт'], ['a b', 'Привіт  '], ['a b', 'Привіт\n  світе'],
    ['a b', 'Привіт'], ['a b', ''], ['a b', 'один два\nтри'], ['a b', '\u00A0\u00A0Привіт'], ['a b', 'Привіт\u00A0\u00A0світе'],
  ]);
});

describe('uk-apostrophe', () => {
  const bad = ['`', U(0xb4), U(0x2018), U(0x2032), U(0x2b9), '"', U(0x201d), U(0x55a)];
  positives('uk-apostrophe', bad.map(a => ['x', `м${a}ясо`, 'м’ясо'] as Pos));
  positives('uk-apostrophe', [['x', 'м’ясо', "м'ясо"], ['x', 'мʼясо', "м'ясо"]], { apostrophe: "'" });
  positives('uk-apostrophe', [["x", "м'ясо", 'м’ясо'], ['x', 'мʼясо', 'м’ясо']], { apostrophe: '’' });
  positives('uk-apostrophe', [['x', "м'ясо", 'мʼясо']], { apostrophe: 'ʼ' });
  negatives('uk-apostrophe', [
    ['x', 'м’ясо'], ['x', 'мʼясо'], ['x', "м'ясо"], ['x', "Д'Артаньян"], ['x', 'ім’я'], ['x', "don't"], ['x', 'сказав «привіт»'],
    ['x', 'Він сказав "привіт"'], ['x', 'слово'], ['x', '`код`'],
  ]);
  negatives('uk-apostrophe', [['x', 'м’ясо'], ['x', 'п’ять']], { apostrophe: '’' });
  it('одним словом: знак, що не збігається з проєктним, виправляється на проєктний', () => {
    expect(fixed('uk-apostrophe', 'x', "п'ять і м’ясо", { apostrophe: '’' })).toBe('п’ять і м’ясо');
  });
});

describe('рівні правил і налаштування проєкту', () => {
  it('у реєстрі вісім правил зі стабільними id', () => {
    expect(QA_RULES.map(r => r.id)).toEqual(['code-malformed', 'uk-homoglyph', 'uk-foreign-letters', 'uk-normalization', 'ws-hidden', 'ws-edges', 'ws-double', 'uk-apostrophe']);
    for (const r of QA_RULES) { expect(r.id).toMatch(/^[a-z]+(-[a-z]+)+$/); expect(r.title.length).toBeGreaterThan(3); expect(r.explain.length).toBeGreaterThan(20); }
  });
  it('усе поради, крім пошкоджених керівних кодів', () => {
    const r = qaOf(undefined);
    for (const rule of QA_RULES) expect(r.sev[rule.id]).toBe(rule.id === 'code-malformed' ? 'bad' : 'warn');
  });
  it('без налаштування правил форми працюють лише п’ять старих перевірок', () => {
    const t = `Привіт  ${L.C}ила`;
    expect(check({ source: 'Hi', kind: 'dialogue' }, t, DEFAULT_QA).filter(i => i.key.includes('-'))).toEqual([]);
    expect(check({ source: 'Hi', kind: 'dialogue' }, t, opts()).filter(i => i.key.includes('-')).length).toBeGreaterThan(0);
  });
  it('рівень «вимкнено» ховає правило, «помилка» робить його блокуючим', () => {
    const t = `При${'\u200B'}віт`;
    const base = (q?: QaSettings): Issue | undefined => check({ source: 'Hi', kind: 'dialogue' }, t, opts(q)).find(i => i.key === 'ws-hidden');
    expect(base()?.severity).toBe('warn');
    expect(base({ rules: { 'ws-hidden': 'off' } })).toBeUndefined();
    expect(base({ rules: { 'ws-hidden': 'bad' } })?.severity).toBe('bad');
  });
  it('невідомі правила й хибні значення ігноруються', () => {
    const r = qaOf({ qa: { rules: { 'no-such-rule': 'bad', 'ws-double': 'loud' as never, 'ws-edges': 'bad' }, keep: [' Mob ', '', 'MOB', 'hp'], apostrophe: 'x' as never } });
    expect(r.sev['no-such-rule']).toBeUndefined();
    expect(r.sev['ws-double']).toBe('warn');
    expect(r.sev['ws-edges']).toBe('bad');
    expect([...r.keep].sort()).toEqual(['hp', 'mob']);
    expect(r.apostrophe).toBe('any');
    expect(qaOf({ qa: 7 as never })).toBe(qaOf(undefined));
  });
  it('результат запам’ятовується за посиланням і має підпис, що змінюється разом із налаштуванням', () => {
    const a: QaSettings = { rules: { 'ws-edges': 'off' } };
    expect(qaOf({ qa: a })).toBe(qaOf({ qa: a }));
    expect(qaOf({ qa: a }).sig).not.toBe(qaOf(undefined).sig);
    expect(qaOf({ qa: { ...a, apostrophe: '’' } }).sig).not.toBe(qaOf({ qa: a }).sig);
  });
  it('withRuleLevel не зберігає типовий рівень', () => {
    let q = withRuleLevel(undefined, 'ws-edges', 'off');
    expect(q.rules).toEqual({ 'ws-edges': 'off' });
    q = withRuleLevel(q, 'ws-edges', 'warn');
    expect(q.rules).toBeUndefined();
    expect(withRuleLevel(undefined, 'code-malformed', 'bad').rules).toBeUndefined();
  });
  it('список «лишити» перетворюється на текст і назад', () => {
    expect(keepFromText('Mob, boss\nMOB; npc')).toEqual(['mob', 'boss', 'npc']);
    expect(keepToText(['mob', 'boss'])).toBe('mob\nboss');
  });
  it('зміна рівня оновлює відповіді, закешовані для того самого рядка', () => {
    const e: Entry = { target: `При${'\u200B'}віт`, status: 'draft', mt: 1 };
    const u = { source: 'Hi', kind: 'dialogue' as const };
    expect(activeIssues(u, e, opts()).some(i => i.key === 'ws-hidden')).toBe(true);
    expect(activeIssues(u, e, opts({ rules: { 'ws-hidden': 'off' } })).some(i => i.key === 'ws-hidden')).toBe(false);
    expect(activeIssues(u, e, opts()).some(i => i.key === 'ws-hidden')).toBe(true);
  });
  it('проєкт зберігає й зливає налаштування правил разом із іншими налаштуваннями', () => {
    const a = emptyProject('p');
    a.settings = { ...a.settings, qa: { rules: { 'ws-edges': 'off' }, keep: ['mob'] } };
    a.settingsAt = 10;
    const back = deserialize(serialize(a));
    expect(qaOf(back.settings).sev['ws-edges']).toBe('off');
    expect(qaOf(back.settings).keep.has('mob')).toBe(true);
    const old = emptyProject('p');
    old.settingsAt = 5;
    expect(qaOf(mergeProjects(a, old).project.settings).sev['ws-edges']).toBe('off');
    expect(qaOf(mergeProjects(old, a).project.settings).sev['ws-edges']).toBe('off');
    expect(qaOf(deserialize(serialize(old)).settings).sev['ws-edges']).toBe('warn');
  });
});

describe('ігнорування й блокування', () => {
  it('проігнороване зауваження зникає, але інші лишаються; поради не блокують надсилання', () => {
    const o = { ...DEFAULT_QA, ...opts() };
    const u = { key: '1', source: 'Hi', kind: 'dialogue' as const };
    const text = `Привіт  ${L.C}ила `;
    const e: Entry = { target: text, status: 'draft', mt: 1 };
    const keys = activeIssues(u, e, o).map(i => i.key);
    expect(keys).toEqual(expect.arrayContaining(['ws-double', 'uk-homoglyph', 'ws-edges']));
    expect(submit(e, u as never, 'translate', 5, { blockErrors: true, qa: o }).ok).toBe(true);
    expect(activeIssues(u, { ...e, ign: ['ws-double'] }, o).map(i => i.key)).not.toContain('ws-double');
  });
  it('правило на рівні «помилка» блокує надсилання й збірку, а в рівні «порада» ні', () => {
    const game: GameFile[] = [{ name: 'Map001.json', json: { events: [null, { id: 1, name: 'A', pages: [{ list: [{ code: 101, indent: 0, parameters: ['', 0, 0, 2, ''] }, { code: 401, indent: 0, parameters: ['Hello'] }] }] }] } }];
    const views = readGame(game);
    const u = views[0]!.units[0]!;
    const saved = { ...emptyProject('t'), files: { 'Map001.json': { [u.key]: { target: `При${'\u200B'}віт`, status: 'done', mt: 1 } as Entry } } };
    const make = (q?: QaSettings) => ({ onlyApproved: false, blockErrors: true, qa: { ...DEFAULT_QA, rules: qaOf(q ? { qa: q } : undefined) } });
    expect(build(game, views, saved, make()).included).toBe(1);
    const strict = build(game, views, saved, make({ rules: { 'ws-hidden': 'bad' } }));
    expect(strict.included).toBe(0);
    expect(strict.blocked.length).toBe(1);
  });
});

describe('огляд порад і виправлення за правилом', () => {
  const game: GameFile[] = [{ name: 'Map001.json', json: { events: [null, { id: 1, name: 'A', pages: [{ list: [
    { code: 101, indent: 0, parameters: ['', 0, 0, 2, ''] }, { code: 401, indent: 0, parameters: ['One'] },
    { code: 101, indent: 0, parameters: ['', 0, 0, 2, ''] }, { code: 401, indent: 0, parameters: ['Two'] },
    { code: 101, indent: 0, parameters: ['', 0, 0, 2, ''] }, { code: 401, indent: 0, parameters: ['Three'] },
    { code: 101, indent: 0, parameters: ['', 0, 0, 2, ''] }, { code: 401, indent: 0, parameters: ['Four'] },
  ] }] }] } }];
  const views = readGame(game);
  const [u1, u2, u3, u4] = views[0]!.units;
  const mk = (): ReturnType<typeof emptyProject> => ({ ...emptyProject('t'), files: { 'Map001.json': {
    [u1!.key]: { target: 'Один  два', status: 'done', mt: 1 } as Entry,
    [u2!.key]: { target: 'Три  чотири', status: 'appr', mt: 1, ign: ['ws-double'] } as Entry,
    [u3!.key]: { target: 'Чисто', status: 'draft', mt: 1 } as Entry,
    [u4!.key]: { target: 'П’ять  шість', status: 'done', mt: 1, orig: 'П’ять  шість' } as Entry,
  } } });
  const o: QaOptions = { ...opts(), tolerancePct: 1000 };

  it('лічильник порад не враховує проігнорованих і чистих рядків', () => {
    expect(adviceCount(views, mk(), o)).toBe(2);
  });
  it('статистика правил по файлу', () => {
    const s = Object.fromEntries(ruleStats(views[0]!, mk(), o).map(x => [x.id, x]));
    expect(s['ws-double']).toEqual({ id: 'ws-double', rows: 2, fixable: 2 });
    expect(s['uk-homoglyph']!.rows).toBe(0);
  });
  it('fixRule виправляє лише рядки зі зауваженням, лишає статус і пише одну дію, яку можна скасувати', () => {
    const saved = mk();
    const changes = fixRule(views, saved, 'ws-double', o, 100);
    expect(changes.map(c => c.text).sort()).toEqual(['Один два', 'П’ять шість']);
    const batch = commitRows(f => (saved.files[f] ??= {}), changes, 'fix', 'Ви', 100);
    const ents = saved.files['Map001.json']!;
    expect(ents[u1!.key]!.target).toBe('Один два');
    expect(ents[u1!.key]!.status).toBe('done');
    expect(ents[u4!.key]!.orig).toBe('П’ять шість');
    expect(ents[u2!.key]!.target).toBe('Три  чотири');
    expect(ents[u1!.key]!.history!.at(-1)!.what).toContain('виправлено за правилом');
    expect(batch.startsWith('fix:')).toBe(true);
    expect(fixRule(views, saved, 'ws-double', o, 101)).toEqual([]);
    const r = undoJournal(saved, batch, 'Ви', 200);
    expect(r.done).toBe(2);
    expect(saved.files['Map001.json']![u1!.key]!.target).toBe('Один  два');
  });
  it('невідоме правило нічого не міняє', () => {
    expect(fixRule(views, mk(), 'nope', o, 1)).toEqual([]);
  });
});

describe('хибні спрацювання: звичайний ігровий текст не має жодної поради', () => {
  const corpus: [string, string][] = [
    ['\\C[2]Strength\\C[0] up', '\\C[2]Сила\\C[0] зростає'],
    ['\\N[1] found \\V[3] gold', '\\N[1] знайшов \\V[3] золота'],
    ['\\{Run!\\}', '\\{Тікай!\\}'],
    ['HP-bar', 'HP-бар'],
    ['3D map', '3D-карта'],
    ['PvP arena', 'Арена PvP'],
    ['Wi-Fi is down', 'Wi-Fi не працює'],
    ['#FF8800', 'Колір #FF8800'],
    ['Open Actor1.png', 'Відкрий Actor1.png'],
    ["D'Artagnan", "Д'Артаньян"],
    ['Chapter XIV', 'Розділ XIV'],
    ['Ok.', 'Гаразд.'],
    ['Wait...\\.\\.', 'Зачекай...\\.\\.'],
    ['Q&A', 'Запитання й відповіді'],
    ['100 km', '100 км'],
    ['x2 damage', 'x2 шкоди'],
    ['HP: \\V[1]/\\V[2]', 'HP: \\V[1]/\\V[2]'],
    ['She said "hi".', 'Вона сказала «привіт».'],
    ['Mother’s day', 'День матері'],
    ['Line one\nLine two', 'Перший рядок\nДругий рядок'],
    ['Items: ', 'Предмети: '],
    ['Yes', 'Так'],
    ['\\>Slow\\<', '\\>Повільно\\<'],
    ['Mr. O’Brien', 'Пан О’Браєн'],
    ['See https://example.com/a-b', 'Дивись https://example.com/a-b'],
    ['Alt+F4', 'Alt+F4'],
    ['iPhone', 'iPhone'],
    ['пʼять', 'пʼять'],
    ['Press OK', 'Натисніть OK'],
    ['A', 'А'],
    ['Where are you going?', 'Куди ти йдеш, мандрівнику? Ніч надворі, а в лісі водяться вовки.'],
    ['It’s a secret.', 'Це таємниця; нікому не кажи про м’ясника з Єрусалимської вулиці.'],
    ['Ukraine', 'Україна — це країна героїв. Слава Україні! Їжак, ґанок, Європа, єдність, ім’я, п’ять, пʼять, об’єднання.'],
    ['Level up!', 'Рівень підвищено! \\C[3]Сила +2\\C[0], \\C[2]Спритність +1\\C[0].'],
    ['\\N[1] joined the party.', '\\N[1] приєднується до загону. \\.\\.\\.'],
    ['Gold: \\G', 'Золото: \\G'],
    ['You got \\I[12]Potion x3!', 'Ти отримав \\I[12]Зілля x3!'],
    ['Press Z or Enter to continue', 'Натисніть Z або Enter, щоб продовжити'],
    ['Mon-Fri 9:00-18:00', 'Пн–Пт 9:00–18:00'],
    ['The year 1999', 'У 1999 році; XX століття; XXI століття.'],
    ['OK / Cancel', 'Гаразд / Скасувати'],
    ['Dr. Smith', 'Д-р Сміт і пані О’Генрі'],
    ['Save file 01', 'Файл збереження №01'],
    ['Use [Alt]+[Enter]', 'Натисніть [Alt]+[Enter]'],
    ['v1.2.3', 'Версія v1.2.3, збірка b45'],
    ['100%', '100% здоров’я'],
    ['\\V[1] / \\V[2]', '\\V[1] з \\V[2]'],
    ['...', '…'],
    ['A bug’s life', 'Життя комашки: «Це я!» — сказав він.'],
  ];
  it.each(corpus)('%j → %j', (s, t) => {
    const found = check({ source: s, kind: 'dialogue' }, t, opts()).filter(i => i.key.includes('-')).map(i => i.key);
    expect(found).toEqual([]);
  });
});

describe('швидкодія', () => {
  it('20 тисяч рядків проходять увесь реєстр швидко (межа 5 с з запасом для повільного CI)', () => {
    const o = opts();
    const base = ['Привіт, світе!', '\\C[2]Сила\\C[0] зростає', `Ти ${'і'} я, друже`, 'Мʼясо та п’ять яблук', 'HP-бар і 3D-карта'];
    const t0 = performance.now();
    let n = 0;
    for (let i = 0; i < 20000; i++) n += check({ source: 'Source ' + i, kind: 'dialogue' }, base[i % base.length]! + ' ' + i, o).length;
    const dt = performance.now() - t0;
    expect(n).toBeGreaterThan(0);   // the registry really ran (a check that returns nothing would pass a bare time limit)
    expect(dt).toBeLessThan(5000);
  });
});
