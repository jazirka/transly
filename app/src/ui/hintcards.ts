import { HINT_GLYPH, HINT_LABEL, KIND_LABEL, activeIssues, byHintOrder, check, describePage, explainCodes, isMessageUnit, prepareText, sceneAt, sourceChanged, targetHasTerm, termRangesIn, termRangesInTarget, usageKey, usesPixels, widthOf } from '../core';
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

export { KIND_LABEL };
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

/** What the card of a term shows now: its tab ('a' the term, 'c' the term in the context of other rows) and which other row. */
export const termView = { key: '', tab: 'a' as 'a' | 'c', i: 0 };
export function resetTermView(key: string): void { if (termView.key !== key) { termView.key = key; termView.tab = 'a'; termView.i = 0; } }

interface Use { file: string; key: string }
const usesCache = new Map<string, { views: unknown; list: Use[] }>();

/** The rows of the game (other than the open one) whose original has the term, in game order. */
function usesOf(ctx: Ctx, t: GlossaryTerm): Use[] {
  const hit = usesCache.get(t.en);
  if (hit && hit.views === ctx.s.views) return hit.list;
  const first = (t.en.toLowerCase().match(/[\p{L}\p{N}]{3,}/u)?.[0] ?? t.en.toLowerCase()).slice(0, 3);
  const list: Use[] = [];
  for (const v of ctx.s.views) for (const u of v.units) {
    if (!u.source.toLowerCase().includes(first)) continue;
    if (termRangesIn(prepareText(u.source), t.en).length) list.push({ file: v.name, key: u.key });
  }
  usesCache.set(t.en, { views: ctx.s.views, list });
  return list;
}

const mark = (text: string, ranges: [number, number][]): string => {
  let out = '', at = 0;
  for (const [a, b] of [...ranges].sort((x, y) => x[0] - y[0])) { if (a < at) continue; out += esc(text.slice(at, a)) + `<mark>${esc(text.slice(a, b))}</mark>`; at = b; }
  return out + esc(text.slice(at));
};

function termCard(ctx: Ctx, en: string): string {
  const t: GlossaryTerm | undefined = ctx.s.saved.terms.find(x => x.en.toLowerCase() === en.toLowerCase());
  if (!t) return '';
  resetTermView(t.en);
  const u = ctx.s.cur ? ctx.unit(ctx.s.cur) : undefined;
  const row = u ? realOf(ctx, u) : null;
  const target = u && ctx.s.current ? ctx.entries(ctx.s.current)[u.key]?.target ?? '' : '';
  const used = target ? targetHasTerm(target, t.uk, t.alt) : null;
  const all = usesOf(ctx, t).filter(x => !(row && x.file === row.file && x.key === row.key));
  if (all.length) termView.i = ((termView.i % all.length) + all.length) % all.length; else termView.i = 0;
  const head = `<div class="tc-head"><span class="tc-dot ${used === false ? 'warn' : 'ok'}" title="${used === null ? 'Переклад ще не написано' : used ? 'Є в перекладі' : 'Немає в перекладі'}"></span><b>${esc(t.uk)}</b><span class="tc-from">← ${esc(t.en)}</span>${t.kind ? `<span class="tg k" title="Категорія терміна">${esc(t.kind)}</span>` : ''}<span class="tc-tabs" role="group" aria-label="Вкладки картки"><button type="button" class="${termView.tab === 'a' ? 'on' : ''}" data-hca="tab" data-v="a" aria-pressed="${termView.tab === 'a'}" title="Переклад терміна">Aa</button><button type="button" class="${termView.tab === 'c' ? 'on' : ''}" data-hca="tab" data-v="c" aria-pressed="${termView.tab === 'c'}" title="Інші рядки з цим терміном" ${all.length ? '' : 'disabled'}>▦ ${all.length}</button></span></div>`;
  if (termView.tab === 'c' && all.length) {
    // Variants of the rendering across the game: the term's own, an alternative, something else, not translated yet.
    const sums = { main: 0, alt: 0, other: 0, none: 0 };
    for (const x of all) {
      const tr = ctx.entries(x.file)[x.key]?.target;
      if (!tr) sums.none++; else if (targetTermHitsMain(tr, t)) sums.main++; else if (targetTermHitsAlt(tr, t)) sums.alt++; else sums.other++;
    }
    const cur = all[termView.i]!;
    const cu = ctx.s.views.find(v => v.name === cur.file)?.units.find(x => x.key === cur.key);
    const ctr = ctx.entries(cur.file)[cur.key]?.target ?? '';
    const sc = cu ? sceneAt(scenesOf(ctx.s.views.find(v => v.name === cur.file)?.units ?? []), cur.key) : null;
    const srcRanges = cu ? termRangesIn(prepareText(cu.source), t.en) : [];
    const trRanges = ctr ? termRangesInTarget(ctr, t.uk, t.alt) : [];
    const verdict = !ctr ? '<span class="tg">ще не перекладено</span>' : targetTermHitsMain(ctr, t) ? '<span class="tg ok">як у глосарії</span>' : targetTermHitsAlt(ctr, t) ? '<span class="tg warn">альтернатива</span>' : trRanges.length ? '' : '<span class="tg warn">без терміна</span>';
    const sumLine = [sums.main ? `${sums.main} × «${esc(t.uk)}»` : '', sums.alt ? `<span class="tc-w">${sums.alt} × альтернатива</span>` : '', sums.other ? `<span class="tc-w">${sums.other} × інакше</span>` : '', sums.none ? `${sums.none} ще не перекладено` : ''].filter(Boolean).join(' · ');
    return `${head}
      <div class="tc-sum">${sumLine}</div>
      <div class="tc-ctx"><div class="tc-nav"><button type="button" class="tc-arr" data-hca="step" data-v="-1" aria-label="Попереднє вживання" title="Попереднє вживання">‹</button><span>${termView.i + 1} з ${all.length}</span><button type="button" class="tc-arr" data-hca="step" data-v="1" aria-label="Наступне вживання" title="Наступне вживання">›</button><small>${esc(cur.file.replace(/\.json$/, ''))}${sc ? ' · ' + esc(sc.title) : ''}</small>${verdict}</div>
        <div class="tc-line"><span class="tc-lang">EN</span><span>${cu ? mark(cu.source, srcRanges) : ''}</span></div>
        <div class="tc-line"><span class="tc-lang">UK</span><span>${ctr ? mark(ctr, trRanges) : '<i>ще не перекладено</i>'}</span></div></div>
      <div class="tc-acts"><button type="button" class="btn p" data-hca="goto" data-file="${esc(cur.file)}" data-key="${esc(cur.key)}">Перейти до рядка</button></div>`;
  }
  return `${head}
    <div class="tc-alt">${t.alt?.length ? `також: ${t.alt.map(a => `<span>${esc(a)}</span>`).join('')}` : ''}${t.note ? `<span class="tc-n">${esc(t.note)}</span>` : ''}</div>
    ${checkRows(u, target, t)}
    <div class="tc-status"><span class="tg ${t.qa === false ? '' : 'ok'}">${t.qa === false ? 'лише підказка' : 'перевіряється в QA'}</span></div>
    <div class="tc-acts"><button type="button" class="btn p" data-hca="insert" data-v="${esc(t.uk)}" ${u ? '' : 'disabled'} title="Вставити в переклад на місці курсора">${used ? 'Замінити на' : 'Вставити'} «${esc(t.uk)}»</button><button type="button" class="btn ic" data-hca="edit" data-v="${esc(t.en)}" title="Змінити термін у глосарії" aria-label="Змінити термін">✎</button></div>`;
}

/** Whether it is right, side by side: what the original has and what the translation has, each with its own verdict. */
function checkRows(u: Unit | undefined, target: string, t: GlossaryTerm): string {
  if (!u) return '';
  const sr = termRangesIn(prepareText(u.source), t.en)[0];
  const row = (cls: string, lang: string, what: string, verdict: string): string => `<div class="tc-cr ${cls}"><span class="tc-lang">${lang}</span><span class="tc-v">${what}</span><span class="tc-r">${verdict}</span></div>`;
  const en = sr ? row('ok', 'EN', `«${esc(u.source.slice(sr[0], sr[1]))}»`, '✔ у оригіналі') : '';
  if (!target) return `<div class="tc-chk">${en}${row('', 'UK', '<i>ще не перекладено</i>', `має бути «${esc(t.uk)}»`)}</div>`;
  const tr = termRangesInTarget(target, t.uk, t.alt)[0];
  if (!tr) return `<div class="tc-chk">${en}${row('warn', 'UK', '<i>терміна немає</i>', `▲ має бути «${esc(t.uk)}»`)}</div>`;
  const word = esc(target.slice(tr[0], tr[1]));
  return `<div class="tc-chk">${en}${targetTermHitsMain(target, t) ? row('ok', 'UK', `«${word}»`, '✔ як у глосарії') : row('ok', 'UK', `«${word}»`, '✔ прийнятна альтернатива')}</div>`;
}

const targetTermHitsMain = (tr: string, t: GlossaryTerm): boolean => targetHasTerm(tr, t.uk);
const targetTermHitsAlt = (tr: string, t: GlossaryTerm): boolean => !!t.alt?.length && targetHasTerm(tr, t.alt[0]!, t.alt.slice(1));

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
    const rows = ctx.links().clusterOf(r.file, r.key)?.rows.filter(x => !(x.file === r.file && x.key === r.key)) ?? [];
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
  const plan = ctx.wrapPlan(), limit = isMessageUnit(u) ? widthOf(plan, u) : 0;
  const sc = scenesOf(s.views.find(v => v.name === r.file)?.units ?? []);
  const first = sc ? sceneAt(sc, r.key)?.units[0] : undefined;
  const uk = usageKey(r.file, r.key);
  const used = uk ? ctx.usage().get(uk) ?? [] : [];
  const same = ctx.links().others(r.file, r.key);
  const st = (t: string, title: string): string => `<span class="cc" title="${esc(title)}">${esc(t)}</span>`;
  const act = (which: string, t: string, title: string, warn = false): string => `<button type="button" class="cc act ${warn ? 'warn' : ''}" data-hc="ctx" data-hk="${which}" title="${esc(title)}">${esc(t)} <span aria-hidden="true">▾</span></button>`;
  // What the row is (plain words) and what can be opened (buttons); the header puts a divider before each group.
  const meta = [
    st(KIND_LABEL[u.kind] ?? u.kind, 'Тип рядка'),
    ctx.speaker(u) ? st(ctx.speaker(u), 'Хто говорить') : '',
    label ? st(label, 'Місцевість') : '',
    u.note ? st(`позначка: ${u.note}`, 'Позначка розробників') : '',
    limit ? st(`рядок до ${limit} ${usesPixels(plan) ? 'px' : 'зн.'}`, `Ширина рядка в грі${u.face ? ' (поруч обличчя)' : ''}${plan.settings.mode === 'build' ? '. Гра переносить рядки сама' : ''}`) : '',
  ].filter(Boolean);
  const acts = [
    first?.page ? act('cond', 'умови сторінки', 'Коли показується ця сцена') : '',
    used.length ? act('used', 'де видається', 'Де гравець це отримує') : '',
    u.dbNote ? act('db', 'примітка в базі', 'Примітка розробників у базі даних') : '',
    same ? act('same', `зв’язано: ${same}`, 'Інші рядки з тим самим оригіналом (докладніше в правій панелі)', true) : '',
  ].filter(Boolean);
  const sep = '<span class="fsep" aria-hidden="true"></span>';
  return (meta.length ? sep + meta.join('<span class="fdot" aria-hidden="true"></span>') : '') + (acts.length ? sep + acts.join('') : '');
}

let tmCur: { t: string; score: number }[] = [];
export const tmMatch = (i: number): { t: string; score: number } | undefined => tmCur[i];

/** The matches of the translation memory as a list for the right panel (a click puts one into the translation). */
export function tmListHtml(ctx: Ctx, u: Unit, target: string): string {
  const m = ctx.tm().find(u.source, { min: 60, limit: 5, exclude: x => x.s === u.source && x.t === target });
  tmCur = m;
  const srcLabel = (s: string): string => (s === 'Імпорт' ? 'імпорт' : s.replace(/\.json$/, ''));
  return m.map((x, n) => `<button type="button" class="pn-sug" data-tm="${n}" title="Підставити цей переклад у поле"><span class="pn-sug-t">${esc(x.t)}</span><span class="pn-sug-m"><b class="${x.score >= 90 ? 'hi' : ''}">${x.score}%</b> збігається${x.s !== u.source ? ` · «${esc(oneLine(x.s, 50))}»` : ''} · ${esc(srcLabel(x.src))}</span></button>`).join('');
}

export const keyInView = (ctx: Ctx, file: string, key: string): string => (ctx.s.current === GROUP ? file + SEP + key : key);
