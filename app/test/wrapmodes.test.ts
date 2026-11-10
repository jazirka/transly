import { describe, expect, it } from 'vitest';
import { activeIssues, build, check, displayLength, emptyProject, readGame, submit, wrapOf } from '../src/core';
import type { Entry, GameFile, QaOptions, WrapPlan, WrapSettings } from '../src/core';

const cmd = (code: number, parameters: unknown[]) => ({ code, indent: 0, parameters });
const TEXT = 'Мандрівник дістався перекладацького містечка наприкінці осені, і там на нього чекав старий друг, якого він не бачив багато років.';
const game: GameFile[] = [{ name: 'Map001.json', json: { events: [null, { id: 1, name: 'A', pages: [{ list: [
  cmd(101, ['', 0, 0, 2, '']), cmd(401, ['Hello']),
  cmd(105, [2, false]), cmd(405, ['Scroll']),
  cmd(102, [['Yes', 'No'], 0, 0, 2, 0]),
] }] }] } }];

const plan = (wrap: Partial<WrapSettings> = {}, limit = 30): WrapPlan => ({ settings: wrapOf({ wrap }), limit });
const qa = (p: WrapPlan | undefined): QaOptions => ({ tolerancePct: 1000, terms: [], ...(p ? { wrap: p } : {}) });
const e = (target: string, status: Entry['status'] = 'done'): Entry => ({ target, status, mt: 1 });
const listOf = (r: ReturnType<typeof build>): { code: number; parameters: unknown[] }[] =>
  (r.files[0]!.json as { events: { pages: { list: { code: number; parameters: unknown[] }[] }[] }[] }).events[1]!.pages[0]!.list;

describe('збірка з перенесенням рядків (режим «при збірці»)', () => {
  const views = readGame(game);
  const units = views[0]!.units;
  const dlg = units.find(u => u.kind === 'dialogue')!, scr = units.find(u => u.kind === 'scroll')!, ch = units.find(u => u.kind === 'choice');
  const saved = { ...emptyProject('t'), files: { 'Map001.json': {
    [dlg.key]: e(TEXT), [scr.key]: e(TEXT), ...(ch ? { [ch.key]: e(TEXT) } : {}),
  } } };
  const opts = (p: WrapPlan | undefined) => ({ onlyApproved: false, blockErrors: true, qa: qa(p) });

  it('рядки в 401 і 405 розкладаються за шириною, проєкт лишається цілим', () => {
    const before = JSON.stringify(saved);
    const r = build(game, views, saved, opts(plan()));
    const list = listOf(r);
    const lines401 = list.filter(c => c.code === 401).map(c => String(c.parameters[0]));
    expect(lines401.length).toBeGreaterThan(2);
    expect(lines401.every(l => displayLength(l) <= 30)).toBe(true);
    expect(lines401.join(' ').replace(/- /g, '')).toBe(TEXT);
    expect(list.filter(c => c.code === 405).length).toBeGreaterThan(2);
    expect(JSON.stringify(saved)).toBe(before);
    expect(r.wrap.messages).toBe(2);
    expect(r.wrap.hyphens).toBeGreaterThanOrEqual(0);
  });
  it('повідомлення довше за 4 рядки рахується, але не обрізається', () => {
    const r = build(game, views, saved, opts(plan({ maxLines: 3 })));
    expect(r.wrap.tooMany).toBe(1); // лише діалог: прокрутний текст не рахується
    expect(listOf(r).filter(c => c.code === 401).length).toBeGreaterThan(3);
  });
  it('варіанти вибору не переносяться', () => {
    if (!ch) return;
    const list = listOf(build(game, views, saved, opts(plan())));
    expect(JSON.stringify(list.find(c => c.code === 102)!.parameters)).toContain(TEXT);
  });
  it('у режимах «у тексті» й «вимкнено» збірка нічого не переносить', () => {
    for (const mode of ['text', 'off'] as const) {
      const r = build(game, views, saved, opts(plan({ mode })));
      expect(listOf(r).filter(c => c.code === 401).map(c => c.parameters[0])).toEqual([TEXT]);
      expect(r.wrap).toEqual({ messages: 0, hyphens: 0, tooMany: 0, over: 0 });
    }
  });
  it('без налаштувань переносу (старий виклик) збірка як раніше', () => {
    expect(listOf(build(game, views, saved, opts(undefined))).filter(c => c.code === 401).map(c => c.parameters[0])).toEqual([TEXT]);
  });
  it('вимкнена ширина не переносить', () => {
    expect(build(game, views, saved, opts({ ...plan(), disabled: true })).wrap.messages).toBe(0);
  });
  it('охайний текст не чіпаємо (keep long), а reflow збирає наново', () => {
    const neat = 'Перший рядок\nдругий рядок';
    const s2 = { ...saved, files: { 'Map001.json': { [dlg.key]: e(neat) } } };
    expect(listOf(build(game, views, s2, opts(plan()))).filter(c => c.code === 401).map(c => c.parameters[0])).toEqual(['Перший рядок', 'другий рядок']);
    expect(listOf(build(game, views, s2, opts(plan({ keep: 'reflow' })))).filter(c => c.code === 401).map(c => c.parameters[0])).toEqual(['Перший рядок другий рядок']);
  });
});

describe('QA: wrap і lines', () => {
  const unit = { source: 'x', kind: 'dialogue' as const, key: 'events[1].pages[0].list[0]' };
  it('у режимі «при збірці» ширина не вимагається, а число рядків так', () => {
    const issues = check(unit, TEXT, qa(plan({}, 12)));
    expect(issues.some(i => i.key === 'wrap')).toBe(false);
    const lines = issues.find(i => i.key === 'lines');
    expect(lines?.severity).toBe('warn');
    expect(lines?.cat).toBe('style');
    expect(lines?.message).toMatch(/4/);
    expect(check(unit, TEXT, qa(plan({}, 60))).some(i => i.key === 'lines')).toBe(false);
  });
  it('у режимі «у тексті» довгий рядок має виправлення, що переносить', () => {
    const i = check(unit, TEXT, qa(plan({ mode: 'text' }))).find(x => x.key === 'wrap');
    expect(i?.fix?.text.split('\n').every(l => displayLength(l) <= 30)).toBe(true);
    expect(i?.fix?.label).toBe('Перенести за шириною');
  });
  it('у режимі «вимкнено» рядки рахуються як написані', () => {
    const p = plan({ mode: 'off' }, 12);
    expect(check(unit, TEXT, qa(p)).some(i => i.key === 'lines')).toBe(false);
    expect(check(unit, 'а\nб\nв\nг\nґ', qa(p)).some(i => i.key === 'lines')).toBe(true);
  });
  it('maxLines 0 вимикає попередження', () => {
    expect(check(unit, TEXT, qa(plan({ maxLines: 0 }, 12))).some(i => i.key === 'lines')).toBe(false);
  });
  it('не стосується варіантів вибору, назв і рядків Ren’Py', () => {
    for (const u of [{ source: 'x', kind: 'choice' as const, key: 'k' }, { source: 'x', kind: 'name' as const, key: 'k' }, { source: 'x', kind: 'dialogue' as const, key: 'L12' }]) {
      expect(check(u, TEXT, qa(plan({ mode: 'text' }, 12))).filter(i => i.key === 'wrap' || i.key === 'lines')).toEqual([]);
    }
  });
  it('прокрутний текст: ширина є, число рядків не рахується', () => {
    const s = { source: 'x', kind: 'scroll' as const, key: 'events[1].pages[0].list[2]' };
    const issues = check(s, TEXT, qa(plan({ mode: 'text', maxLines: 1 }, 12)));
    expect(issues.some(i => i.key === 'wrap')).toBe(true);
    expect(issues.some(i => i.key === 'lines')).toBe(false);
  });
  it('пікселі: ширина береться з вікна гри, символи не потрібні', () => {
    const p: WrapPlan = { settings: wrapOf({ wrap: { mode: 'text', unit: 'px' } }), limit: 0, measure: s => s.length * 20 };
    const wide = 'слово слово слово слово слово слово слово слово слово слово слово';
    const i = check(unit, wide, qa(p)).find(x => x.key === 'wrap');
    expect(i?.message).toMatch(/пікселів/);
    expect(i?.fix?.text.split('\n').every(l => l.length * 20 <= 780)).toBe(true);
    // з портретом у вікні менше місця
    expect(check({ ...unit, face: 'Actor1#0' }, 'слово '.repeat(6).trim(), qa(p)).some(x => x.key === 'wrap')).toBe(true);
    expect(check(unit, 'слово '.repeat(6).trim(), qa(p)).some(x => x.key === 'wrap')).toBe(false);
  });
  it('кеш QA бачить зміну налаштувань переносу', () => {
    const entry = e(TEXT);
    const a = activeIssues(unit, entry, qa(plan({}, 12))).some(i => i.key === 'lines');
    const b = activeIssues(unit, entry, qa(plan({ maxLines: 0 }, 12))).some(i => i.key === 'lines');
    const c = activeIssues(unit, entry, qa(plan({}, 12))).some(i => i.key === 'lines');
    expect([a, b, c]).toEqual([true, false, true]);
  });
  it('ігнорування працює для lines', () => {
    const entry = { ...e(TEXT), ign: ['lines'] };
    expect(activeIssues(unit, entry, qa(plan({}, 12))).some(i => i.key === 'lines')).toBe(false);
  });
});

describe('надсилання в режимі «у тексті»', () => {
  const unit = { key: 'events[1].pages[0].list[0]', source: 'Hello', speaker: '', kind: 'dialogue' as const, context: '' };
  const send = (mode: 'build' | 'text' | 'off', stage: 'translate' | 'review' = 'translate', entry = e(TEXT, 'draft')) =>
    submit(entry, unit, stage, 5, { blockErrors: true, qa: qa(plan({ mode }, 40)) });
  it('розриви вставляються при надсиланні', () => {
    const r = send('text');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.entry.target).toContain('\n');
      expect(r.entry.target.split('\n').every(l => displayLength(l) <= 40)).toBe(true);
      expect(r.entry.orig).toBe(r.entry.target);
      expect(r.entry.status).toBe('done');
    }
  });
  it('в інших режимах текст не змінюється', () => {
    for (const mode of ['build', 'off'] as const) {
      const r = send(mode);
      expect(r.ok && r.entry.target).toBe(TEXT);
    }
  });
  it('вичитування не переносить заново', () => {
    const r = send('text', 'review', e(TEXT, 'done'));
    expect(r.ok && r.entry.target).toBe(TEXT);
  });
  it('охайний текст не чіпається', () => {
    const neat = 'Перший рядок\nдругий рядок';
    const r = send('text', 'translate', e(neat, 'draft'));
    expect(r.ok && r.entry.target).toBe(neat);
  });
});

describe('пам’ять перекладів і пошук у режимі «у тексті»', () => {
  it('збіг віддає переклад суцільним текстом, але виключення порівнює з тим, що записано', async () => {
    const { TmIndex, flowText } = await import('../src/core');
    const wrapped = 'Мандрівник дістався пере-\nкладацького містечка\nнаприкінці осені';
    for (const flow of [true, false]) {
      const tm = new TmIndex({ flow });
      tm.add({ s: 'The traveller reached the town in late autumn', t: wrapped, src: 'f' });
      const m = tm.find('The traveller reached the town in late autumn', { min: 60 });
      expect(m[0]?.t).toBe(flow ? 'Мандрівник дістався перекладацького містечка наприкінці осені' : wrapped);
      expect(tm.find('The traveller reached the town in late autumn', { exclude: x => x.t === wrapped })).toEqual([]);
    }
    expect(flowText('без розривів')).toBe('без розривів');
    expect(flowText('пере-\nкладач і\nдруг')).toBe('перекладач і друг');
  });
});
