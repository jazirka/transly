import { HINT_GLYPH, HINT_LABEL, activeIssues, byHintOrder, check, describePage, explainCodes, limitFor, prepareText, sceneAt, sourceChanged, targetHasTerm, termRangesIn, usageKey } from '../core';
import type { Entry, GlossaryTerm, Unit } from '../core';
import { esc, plural } from './dom';
import { scenesOf } from './scenecache';
import { GROUP, SEP, splitKey } from './state';
import type { Ctx } from './state';
import type { TermMark } from './markup';

/**
 * What used to be a panel of hints, as cards in the place of their cause: a term, a control code or a name the game
 * defines opens its card from the word itself; the facts about the line are chips under the header, each with a card
 * where there is more to say; the memory's proposals stand under the translation field.
 */

/** The file and key a row really belongs to: in a group of files the row's key carries its file. */
export const realOf = (ctx: Ctx, u: Unit): { file: string; key: string } => splitKey(u.key) ?? { file: ctx.s.current!, key: u.key };

export const KIND_LABEL: Record<Unit['kind'], string> = { dialogue: 'діалог', choice: 'варіант вибору', scroll: 'прокрутний текст', name: 'назва', description: 'опис', message: 'повідомлення', term: 'термін гри' };
export const oneLine = (t: string, n = 90): string => { const f = t.replace(/\s+/g, ' ').trim(); return f.length > n ? f.slice(0, n) + '…' : f; };

export interface RowName { file: string; key: string; name: string }
let namesFor = '';
let names: RowName[] = [];

/** Names the game's database defines that stand in the original of the row (not the row itself). */
export function namesOfRow(ctx: Ctx, u: Unit): RowName[] {
  const r = realOf(ctx, u), id = `${r.file}\u0001${r.key}\u0001${u.source}`;
  if (id !== namesFor) { namesFor = id; names = ctx.names().find(u.source).filter(g => !(g.file === r.file && g.key === r.key)); }
  return names;
}

/** Where those names stand in the original, for underlining (a name that overlaps a term is left to the term). */
export function nameMarks(u: Unit, list: RowName[], taken: { start: number; end: number }[]): TermMark[] {
  const prep = prepareText(u.source), out: TermMark[] = [];
  list.forEach((g, i) => {
    for (const [start, end] of termRangesIn(prep, g.name)) if (!taken.some(x => start < x.end && end > x.start) && !out.some(x => start < x.end && end > x.start)) out.push({ start, end, en: g.name, missing: false, kind: 'name', key: String(i) });
  });
  return out;
}

const chip = (k: string, title = ''): string => `<span class="tg k" ${title ? `title="${esc(title)}"` : ''}>${esc(k)}</span>`;

function termCard(ctx: Ctx, en: string): string {
  const t: GlossaryTerm | undefined = ctx.s.saved.terms.find(x => x.en.toLowerCase() === en.toLowerCase());
  if (!t) return '';
  const u = ctx.s.cur ? ctx.unit(ctx.s.cur) : undefined;
  const target = u && ctx.s.current ? ctx.entries(ctx.s.current)[u.key]?.target ?? '' : '';
  const used = target ? targetHasTerm(target, t.uk, t.alt) : null;
  const tags = [
    t.kind ? `<span class="tg k" title="Категорія терміна">${esc(t.kind)}</span>` : '',
    t.qa === false ? '<span class="tg">лише підказка</span>' : '<span class="tg ok" title="Відсутність терміна в перекладі буде позначено в QA">перевіряється в QA</span>',
    used === null ? '' : used ? '<span class="tg ok">є в перекладі</span>' : '<span class="tg warn">немає в перекладі</span>',
  ].join('');
  return `<div class="tc-row"><span class="tc-lang">UK</span><div class="tc-main"><b>${esc(t.uk)}</b>${t.alt?.length ? `<div class="tc-alt">також: ${t.alt.map(a => `<span>${esc(a)}</span>`).join('')}</div>` : ''}<div class="tc-tags">${tags}</div></div></div>
    <div class="tc-row tc-en"><span class="tc-lang">EN</span><div class="tc-main"><b>${esc(t.en)}</b>${t.note ? `<div class="tc-note">${esc(t.note)}</div>` : ''}</div></div>
    <div class="tc-acts"><button type="button" class="btn p" data-hca="insert" data-v="${esc(t.uk)}" ${u ? '' : 'disabled'} title="Вставити в переклад на місці курсора">Вставити «${esc(t.uk)}»</button><button type="button" class="btn" data-hca="edit" data-v="${esc(t.en)}">Змінити термін</button></div>`;
}

function codeCard(ctx: Ctx, code: string): string {
  const { s } = ctx;
  const actor = (n: number): string | undefined => { const a = s.views.find(v => v.name === 'Actors.json')?.units.find(x => x.key === `[${n}].name`); return a ? s.saved.files['Actors.json']?.[a.key]?.target || a.source : undefined; };
  const meaning = explainCodes(code, actor, s.saved.sysNames)[0]?.meaning ?? 'керівний код гри';
  const u = s.cur ? ctx.unit(s.cur) : undefined;
  const target = u && s.current ? ctx.entries(s.current)[u.key]?.target ?? '' : '';
  const has = target.includes(code);
  return `<div class="tc-row"><span class="tc-lang">КОД</span><div class="tc-main"><b class="mono">${esc(code)}</b><div class="tc-note">${esc(meaning)}. Гра підставляє це сама: код має стояти в перекладі так само, як в оригіналі.</div>${target ? `<div class="tc-tags">${has ? '<span class="tg ok">є в перекладі</span>' : '<span class="tg warn">немає в перекладі</span>'}</div>` : ''}</div></div>
    ${has ? '' : `<div class="tc-acts"><button type="button" class="btn p" data-hca="insert" data-v="${esc(code)}" ${u ? '' : 'disabled'}>Вставити «${esc(code)}»</button></div>`}`;
}

function nameCard(ctx: Ctx, i: number): string {
  const g = names[i];
  if (!g) return '';
  const tr = ctx.entries(g.file)[g.key]?.target;
  const file = chip(g.file.replace(/\.json$/, ''), `Назва з бази гри: файл ${g.file}`);
  return `<div class="tc-row"><span class="tc-lang">ГРА</span><div class="tc-main"><b>${esc(g.name)}</b><div class="tc-tags">${file}${tr ? '<span class="tg ok">перекладено</span>' : '<span class="tg warn">ще не перекладено</span>'}</div>${tr ? `<div class="tc-note">Переклад: <b>${esc(tr)}</b></div>` : '<div class="tc-note">Назва з бази даних гри; гравець бачить її в меню й у діалогах.</div>'}</div></div>
    <div class="tc-acts">${tr ? `<button type="button" class="btn p" data-hca="insert" data-v="${esc(tr)}">Вставити «${esc(tr)}»</button>` : ''}<button type="button" class="btn" data-hca="goto" data-file="${esc(g.file)}" data-key="${esc(g.key)}">Перейти до рядка</button></div>`;
}

/** Facts of the line that need more room than a chip: the conditions of the page, where the player gets it, the database note. */
function factCard(ctx: Ctx, which: string): string {
  const { s } = ctx;
  const u = s.cur ? ctx.unit(s.cur) : undefined;
  if (!u) return '';
  const r = realOf(ctx, u);
  if (which === 'cond') {
    const first = (() => { const sc = scenesOf(s.views.find(v => v.name === r.file)?.units ?? []); return sc ? sceneAt(sc, r.key)?.units[0] : undefined; })();
    const cond = first?.page ? describePage(first.page, s.saved.sysNames) : [];
    return `<div class="tc-row"><span class="tc-lang">УМОВИ</span><div class="tc-main"><b>Коли показується ця сцена</b><ul class="tc-list">${cond.map(c => `<li>${esc(c)}</li>`).join('') || '<li>без особливих умов</li>'}</ul></div></div>`;
  }
  if (which === 'used') {
    const uk = usageKey(r.file, r.key);
    const used = uk ? ctx.usage().get(uk) ?? [] : [];
    return `<div class="tc-row"><span class="tc-lang">ГРА</span><div class="tc-main"><b>Де гравець це отримує</b><ul class="tc-list">${used.map(c => `<li>${esc(c)}</li>`).join('')}</ul></div></div>`;
  }
  if (which === 'db') return `<div class="tc-row"><span class="tc-lang">БАЗА</span><div class="tc-main"><b>Примітка розробників у базі</b><div class="tc-note"><code>${esc(u.dbNote ?? '')}</code></div></div></div>`;
  if (which === 'same') {
    const rows = ctx.dups().others(r.file, r.key);
    return `<div class="tc-row"><span class="tc-lang">=</span><div class="tc-main"><b>Однаковий оригінал: ${plural(rows.length, ['рядок', 'рядки', 'рядків'])}</b><div class="tc-same">${rows.slice(0, 10).map(x => { const t = ctx.entries(x.file)[x.key]?.target; return `<button type="button" class="tc-s" data-hca="goto" data-file="${esc(x.file)}" data-key="${esc(x.key)}"><span>${t ? esc(oneLine(t, 60)) : '<i>ще не перекладено</i>'}</span><small>${esc(x.file.replace(/\.json$/, ''))} · ${esc(x.key.replace(/^.*\.list/, 'list'))}</small></button>`; }).join('')}${rows.length > 10 ? `<div class="tc-note">Показано 10 із ${rows.length}.</div>` : ''}</div></div></div>`;
  }
  return '';
}

/** The remarks of a row, most important first, each with its kind named and drawn (not only coloured). Shared by the editor, the right zone and the card of the table. */
export function qaRows(ctx: Ctx, u: Unit, e: Entry | undefined): { html: string; count: number } {
  const t = e?.target ?? '';
  const opts = ctx.qaOpts();
  const iss = byHintOrder(activeIssues(u, e, opts));
  const ignored = e?.ign?.length ? check(u, e.target, opts).filter(i => e.ign?.includes(i.key)) : [];
  const kind = (c: keyof typeof HINT_GLYPH): string => `<span class="kind k-${c}" title="${HINT_LABEL[c]}"><span aria-hidden="true">${HINT_GLYPH[c]}</span> ${HINT_LABEL[c]}</span>`;
  let h = '';
  if (sourceChanged(e, u)) h += `<div class="qa-row warn cat-context">${kind('context')}<span class="qa-msg">Оригінал змінено в грі після перекладу. Було: «${esc(e?.src ?? '')}». Перевірте переклад</span></div>`;
  if (t) {
    if (!iss.length) h += `<div class="qa-row good"><span class="dot"></span>${ignored.length ? 'QA: активних проблем немає' : 'QA: проблем не знайдено'}</div>`;
    h += iss.map(x => `<div class="qa-row ${x.severity} cat-${x.cat}">${kind(x.cat)}<span class="qa-msg">${esc(x.message)}</span><span class="qa-act">${x.fix ? `<button class="fix" data-fix="${esc(x.key)}" title="Застосувати виправлення (можна скасувати в історії рядка)">${esc(x.fix.label)}</button>` : ''}<button class="ign" data-ign="${x.key}" title="Не вважати проблемою для цього рядка">Ігнорувати</button></span></div>`).join('');
    h += ignored.map(x => `<div class="qa-row muted"><span class="dot"></span><span class="qa-msg">${esc(x.message)}</span><span class="qa-act"><span class="tagi">ігноровано</span><button class="ign" data-unign="${x.key}">Повернути</button></span></div>`).join('');
  }
  return { html: h, count: t ? iss.length : 0 };
}


/** The remarks of a row of the table: its status mark opens them with their buttons. */
function qaCard(ctx: Ctx, key: string): string {
  const u = ctx.unit(key);
  if (!u || !ctx.s.current) return '';
  const q = qaRows(ctx, u, ctx.entries(ctx.s.current)[u.key]);
  return q.html ? `<div class="qa-under">${q.html}</div>` : '';
}

/** The html of a card: `kind` and `key` come from the word that was pointed at. */
export function cardHtml(ctx: Ctx, kind: string, key: string): string {
  switch (kind) {
    case 'term': return termCard(ctx, key);
    case 'code': return codeCard(ctx, key);
    case 'name': return nameCard(ctx, Number(key));
    case 'ctx': return factCard(ctx, key);
    case 'qa': return qaCard(ctx, key);
    default: return '';
  }
}

/** The facts about the line as chips under the header; the ones with more to say open a card. */
export function chipsHtml(ctx: Ctx, u: Unit): string {
  const { s } = ctx;
  const r = realOf(ctx, u);
  const label = ctx.view()?.label ?? s.views.find(v => v.name === r.file)?.label;
  const limit = u.kind === 'dialogue' || u.kind === 'scroll' ? limitFor(ctx.lineLimit(), u.face) : 0;
  const sc = scenesOf(s.views.find(v => v.name === r.file)?.units ?? []);
  const first = sc ? sceneAt(sc, r.key)?.units[0] : undefined;
  const uk = usageKey(r.file, r.key);
  const used = uk ? ctx.usage().get(uk) ?? [] : [];
  const same = ctx.dups().others(r.file, r.key).length;
  const st = (t: string, title: string): string => `<span class="cc" title="${esc(title)}">${esc(t)}</span>`;
  const act = (which: string, t: string, title: string, warn = false): string => `<button type="button" class="cc act ${warn ? 'warn' : ''}" data-hc="ctx" data-hk="${which}" title="${esc(title)}">${esc(t)} <span aria-hidden="true">▾</span></button>`;
  return [
    st(KIND_LABEL[u.kind] ?? u.kind, 'Тип рядка'),
    ctx.speaker(u) ? st(ctx.speaker(u), 'Хто говорить') : '',
    label ? st(label, 'Місцевість') : '',
    u.note ? st(`позначка: ${u.note}`, 'Позначка розробників') : '',
    limit ? st(`рядок до ${limit} зн.`, `Ширина рядка в грі${u.face ? ' (поруч обличчя)' : ''}`) : '',
    first?.page ? act('cond', 'умови сторінки', 'Коли показується ця сцена') : '',
    used.length ? act('used', 'де видається', 'Де гравець це отримує') : '',
    u.dbNote ? act('db', 'примітка в базі', 'Примітка розробників у базі даних') : '',
    same ? act('same', `однакових: ${same}`, 'Інші рядки з тим самим оригіналом', true) : '',
  ].filter(Boolean).join('');
}

let tmCur: { t: string; score: number }[] = [];
export const tmMatch = (i: number): { t: string; score: number } | undefined => tmCur[i];

/** The best matches of the translation memory as proposals under the field (a click puts one in). */
export function tmBarHtml(ctx: Ctx, u: Unit, target: string): string {
  const m = ctx.tm().find(u.source, { min: 60, limit: 3, exclude: x => x.s === u.source && x.t === target });
  tmCur = m;
  if (!m.length) return '';
  return `<span class="tm-l" title="Збіги з пам’яті перекладів: клік підставляє варіант у переклад">З пам’яті</span>${m.map((x, n) => `<button type="button" class="tm-i" data-tm="${n}" title="${esc(x.src)} · «${esc(oneLine(x.s, 60))}»"><b class="${x.score >= 90 ? 'hi' : ''}">${x.score}%</b><span>${esc(oneLine(x.t, 70))}</span></button>`).join('')}`;
}

export const keyInView = (ctx: Ctx, file: string, key: string): string => (ctx.s.current === GROUP ? file + SEP + key : key);
