import { describe, expect, it } from 'vitest';
import { displayLength, lineFacts, planWrap, unwrap, wrapLines } from '../src/core';
import { DEFAULT_WRAP, wrapOf } from '../src/core/wrapconfig';
import { MV_WINDOW, pixelBudget } from '../src/core/gamewindow';
import { deserialize, emptyProject, mergeProjects, serialize } from '../src/core';

const long = 'Мандрівник дістався перекладацького містечка наприкінці осені';

describe('planWrap: звичайний перенос', () => {
  it('жадібно складає рядки, коди не мають ширини', () => {
    const r = planWrap('\\C[2]Привіт\\C[0] друже мій, як справи?', { width: 15, hyphen: 'off', keep: 'reflow' });
    expect(r.text).toBe('\\C[2]Привіт\\C[0] друже\nмій, як справи?');
    expect(r.over).toEqual([]);
    expect(r.hyphenated).toBe(0);
  });
  it('wrapLines лишається обгорткою без переносу слів і розвалює старі розриви', () => {
    expect(wrapLines('раз два\nтри чотири п’ять', 10)).toBe('раз два\nтри чотири\nп’ять');
    expect(wrapLines('раз два', 0)).toBe('раз два');
  });
  it('занадто довге слово лишається вилазити й потрапляє в over', () => {
    const r = planWrap('так Достопочтенний пане', { width: 8, hyphen: 'off', keep: 'reflow' });
    expect(r.text).toBe('так\nДостопочтенний\nпане');
    expect(r.over).toEqual([1]);
  });
  it('порожній текст і ширина 0 нічого не міняють', () => {
    expect(planWrap('', { width: 10 })).toMatchObject({ text: '', lines: 0, changed: false });
    expect(planWrap('  ', { width: 10 }).changed).toBe(false);
    const r = planWrap('а б в г д е', { width: 0, hyphen: 'fill' });
    expect(r).toMatchObject({ text: 'а б в г д е', changed: false, lines: 1 });
  });
  it('власний вимірювач (пікселі)', () => {
    const r = planWrap('аа бб вв', { width: 50, measure: s => s.length * 10, hyphen: 'off', keep: 'reflow' });
    expect(r.text).toBe('аа бб\nвв');
  });
});

describe('planWrap: переноси слів', () => {
  it('off: слово не ділиться ніколи', () => {
    const r = planWrap(long, { width: 12, hyphen: 'off', keep: 'reflow' });
    expect(r.text).not.toContain('-');
    expect(r.hyphenated).toBe(0);
  });
  it('needed: ділить лише слово, що довше за рядок, або коли рядок надто порожній', () => {
    const r = planWrap('Він сказав перекладацький', { width: 12, hyphen: 'needed', keep: 'reflow' });
    expect(r.text.split('\n').every(l => displayLength(l) <= 12)).toBe(true);
    expect(r.hyphenated).toBeGreaterThan(0);
    // рядок заповнений більш ніж на 55%: слово просто йде вниз
    const s = planWrap('Він сказав: перекладач прийшов', { width: 24, hyphen: 'needed', keep: 'reflow' });
    expect(s.text).not.toContain('-');
  });
  it('fill: ділить, щоб краще заповнити рядок', () => {
    const needed = planWrap(long, { width: 30, hyphen: 'needed', keep: 'reflow' });
    const fill = planWrap(long, { width: 30, hyphen: 'fill', keep: 'reflow' });
    expect(fill.hyphenated).toBeGreaterThanOrEqual(needed.hyphenated);
    expect(fill.hyphenated).toBeGreaterThan(0);
    expect(fill.text.split('\n').every(l => displayLength(l) <= 30)).toBe(true);
  });
  it('символ переносу береться з налаштувань, мінімум літер теж', () => {
    const r = planWrap('перекладачі', { width: 6, hyphen: 'fill', hyphenChar: '‑', keep: 'reflow' });
    expect(r.text).toContain('‑\n');
    for (const l of planWrap('перекладачі', { width: 7, hyphen: 'fill', keep: 'reflow', minLeft: 3, minRight: 3 }).text.split('\n')) {
      expect(l.replace('-', '').length).toBeGreaterThanOrEqual(3);
    }
  });
  it('слова з латинкою, цифрами чи кодом усередині не ділиться', () => {
    for (const w of ['Transly2000abcdef', 'пере\\C[2]кладач', 'Достопочтенний1']) {
      const r = planWrap(`${w} ще`, { width: 6, hyphen: 'fill', keep: 'reflow' });
      expect(r.hyphenated).toBe(0);
      expect(r.text.replace(/\n/g, ' ')).toBe(`${w} ще`);
    }
  });
  it('коди на краях слова ідуть зі своїм краєм: \\C[2]перекладач\\C[0]', () => {
    const r = planWrap('\\C[2]перекладач\\C[0] прийшов', { width: 7, hyphen: 'fill', keep: 'reflow' });
    const lines = r.text.split('\n');
    expect(lines[0]!.startsWith('\\C[2]')).toBe(true);
    expect(r.text.replace(/-\n/g, '')).toContain('перекладач\\C[0]');
    expect(r.text.split('\n').every(l => displayLength(l) <= 7)).toBe(true);
    // кінцевий код не лишається в початку нового рядка окремо
    expect(lines.some(l => l.startsWith('\\C[0]'))).toBe(false);
  });
  it('слово зі своїм дефісом не ділиться, щоб unwrap не склеїв його', () => {
    const r = planWrap('дехто кафе-бар', { width: 6, hyphen: 'fill', keep: 'reflow' });
    expect(r.text).toBe('дехто\nкафе-бар');
  });
  it('апостроф: під’їзд → під’-їзд, а не під-’їзд', () => {
    const r = planWrap('вхід під’їзд', { width: 9, hyphen: 'fill', keep: 'reflow' });
    expect(r.text).not.toMatch(/\n’/);
    expect(r.text.replace(/-\n/g, '')).toContain('під’їзд');
  });
});

describe('planWrap: збереження розривів і ліміт рядків', () => {
  it('keep long: охайний текст не чіпаємо', () => {
    const t = 'Перший рядок\nдругий рядок\nтретій';
    const r = planWrap(t, { width: 20, keep: 'long' });
    expect(r).toMatchObject({ text: t, changed: false, lines: 3, hyphenated: 0 });
  });
  it('keep long: якщо хоч один рядок ширший, усе переформатовується', () => {
    const r = planWrap('Короткий\nа цей рядок задовгий для вікна', { width: 16, keep: 'long', hyphen: 'off' });
    expect(r.changed).toBe(true);
    expect(r.text.split('\n').every(l => displayLength(l) <= 16)).toBe(true);
  });
  it('keep reflow: охайний текст теж збирається заново', () => {
    const r = planWrap('раз\nдва\nтри', { width: 20, keep: 'reflow' });
    expect(r.text).toBe('раз два три');
  });
  it('maxLines: рахує й попереджає, нічого не обрізає', () => {
    const t = Array.from({ length: 12 }, () => 'слово').join(' ');
    const r = planWrap(t, { width: 10, hyphen: 'off', keep: 'reflow', maxLines: 4 });
    expect(r.lines).toBeGreaterThan(4);
    expect(r.tooMany).toBe(true);
    expect(r.text.replace(/\n/g, ' ')).toBe(t);
    expect(planWrap(t, { width: 10, hyphen: 'off', keep: 'reflow', maxLines: 0 }).tooMany).toBe(false);
    expect(planWrap('коротко', { width: 10, maxLines: 4 }).tooMany).toBe(false);
  });
  it('lineFacts', () => {
    expect(lineFacts('раз\nдуже довгий рядок', 8)).toEqual({ lines: 2, over: 1 });
    expect(lineFacts('раз', 0)).toEqual({ lines: 1, over: 0 });
  });
});

describe('planWrap ↔ unwrap', () => {
  const samples = [long, 'Привіт, друже! Ходімо до під’їзду, там перекладач чекає на нас. \\C[2]Увага\\C[0]!',
    'Розбійник передав сімдесят підземних скарбничок міжнародному мандрівникові', 'Одеса, сонце, школа — і мільйон кілометрів'];
  it('після unwrap текст такий самий, як до переносу', () => {
    for (const s of samples) for (const hyphen of ['off', 'needed', 'fill'] as const) for (const width of [8, 12, 20, 33]) {
      const r = planWrap(s, { width, hyphen, keep: 'reflow' });
      expect(unwrap(r.text)).toBe(unwrap(s));
      expect(unwrap(planWrap(r.text, { width, hyphen, keep: 'reflow' }).text)).toBe(unwrap(s));
    }
  });
  it('повторний перенос із тими самими параметрами нічого не міняє', () => {
    for (const s of samples) for (const hyphen of ['off', 'needed', 'fill'] as const) {
      const a = planWrap(s, { width: 18, hyphen, keep: 'reflow' });
      expect(planWrap(a.text, { width: 18, hyphen, keep: 'reflow' }).text).toBe(a.text);
    }
  });
  it('unwrap склеює слово з апострофом перед переносом', () => {
    expect(unwrap('під’-\nїзд')).toBe('під’їзд');
    expect(unwrap('пере-\nкладач')).toBe('перекладач');
    expect(unwrap('раз-\nДва')).toBe('раз- Два');
    expect(unwrap('раз\n  два')).toBe('раз два');
  });
  it('усі рядки в межах ширини, якщо немає слова, що не ділиться', () => {
    for (const s of samples) for (const width of [10, 16, 24]) {
      const r = planWrap(s, { width, hyphen: 'needed', keep: 'reflow' });
      r.text.split('\n').forEach((line, i) => {
        if (r.over.includes(i)) expect(displayLength(line)).toBeGreaterThan(width);
        else expect(displayLength(line)).toBeLessThanOrEqual(width);
      });
    }
  });
});

describe('displayLength', () => {
  it('\\\\ це один символ, \\G це кілька, інші коди нічого', () => {
    expect(displayLength('a\\\\b')).toBe(3);
    expect(displayLength('\\G')).toBe(3);
    expect(displayLength('\\C[2]аб\\C[0]\\{')).toBe(2);
    expect(displayLength('аб\nвг')).toBe(4);
  });
});

describe('gamewindow', () => {
  it('бюджет пікселів вікна MV', () => {
    expect(pixelBudget(false)).toBe(780);
    expect(pixelBudget(true)).toBe(612);
    expect(pixelBudget(false, { ...MV_WINDOW, width: 640 })).toBe(604);
  });
});

describe('wrapOf: налаштування', () => {
  it('порожнє дає типові', () => {
    expect(wrapOf(undefined)).toEqual(DEFAULT_WRAP);
    expect(wrapOf({})).toEqual(DEFAULT_WRAP);
    expect(wrapOf({ wrap: {} })).toEqual(DEFAULT_WRAP);
  });
  it('невідомі й хибні значення замінюються типовими, числа обмежуються', () => {
    const w = wrapOf({ wrap: { mode: 'later' as never, unit: 'px', hyphen: 'sometimes' as never, hyphenChar: 'ab', minLeft: 99, minRight: -3, keep: 'long', maxLines: 1e6, px: { width: 1, font: 'x' as never } } });
    expect(w).toMatchObject({ mode: 'build', unit: 'px', hyphen: 'needed', hyphenChar: '-', minLeft: 6, minRight: 1, keep: 'long', maxLines: 12 });
    expect(w.px).toEqual({ width: 320, font: 28 });
  });
  it('своє значення зберігається', () => {
    const w = wrapOf({ wrap: { mode: 'text', hyphen: 'fill', hyphenChar: '‑', minLeft: 3, px: { width: 640, font: 24 } } });
    expect(w).toMatchObject({ mode: 'text', hyphen: 'fill', hyphenChar: '‑', minLeft: 3 });
    expect(w.px).toEqual({ width: 640, font: 24 });
  });
});

describe('налаштування wrap у проєкті', () => {
  it('старий проєкт без wrap читається з типовими', () => {
    const p = emptyProject('x');
    const back = deserialize(serialize(p));
    expect(back.settings.wrap).toBeUndefined();
    expect(wrapOf(back.settings)).toEqual(DEFAULT_WRAP);
  });
  it('wrap переживає збереження й читання', () => {
    const p = emptyProject('x');
    p.settings = { ...p.settings, wrap: { mode: 'text', hyphen: 'off' } };
    const back = deserialize(serialize(p));
    expect(wrapOf(back.settings)).toMatchObject({ mode: 'text', hyphen: 'off' });
  });
  it('злиття бере налаштування від новішого settingsAt', () => {
    const a = emptyProject('x'), b = emptyProject('x');
    a.settings = { ...a.settings, wrap: { mode: 'off' } }; a.settingsAt = 10;
    b.settings = { ...b.settings, wrap: { mode: 'text' } }; b.settingsAt = 20;
    expect(wrapOf(mergeProjects(a, b).project.settings).mode).toBe('text');
    expect(wrapOf(mergeProjects(b, a).project.settings).mode).toBe('text');
  });
});
