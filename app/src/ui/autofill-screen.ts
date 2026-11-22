import { diffWords, edit, learnWords, plausible, proposals, uiLocale } from '../core';
import type { RowChange, Unit } from '../core';
import { $, esc, plural, toast } from './dom';
import { oneLine } from './hintcards';
import { fileIcon, screenTreeHtml } from './tree-nodes';
import { undoToast } from './undo-toast';
import type { Ctx } from './state';

/**
 * The screen of the autofill. It is built like the screen that merges a branch: it takes the place of the work area, every empty row the app
 * can fill is a line of a table, and the translator settles each with «−» (leave it empty) or «+» (write it), or writes the text by hand in
 * the «Результат» cell. Three sources, told apart by the dot: a line with the same original that was translated, the translation memory
 * (with how close the match is), and the words of translated short lines. The slider says from which closeness a proposal is taken
 * without asking; what is below stays grey until it is decided. What is learned from is the translator's choice: the lines that were sent
 * (the default) or the drafts too. Nothing is written until «Вписати»; then the rows are written as one action of the journal («autofill»),
 * drafts with the note «авто», with its «Скасувати».
 */

const sv = (p: string, s = 14): string => `<svg class="gi" viewBox="0 0 16 16" width="${s}" height="${s}" aria-hidden="true"><path d="${p}"/></svg>`;
const ICON = {
  plus: sv('M3 8h10M8 3v10'), minus: sv('M3 8h10'), x: sv('M4 4l8 8M12 4l-8 8', 12), up: sv('M8 13V3M4 7l4-4 4 4', 11), down: sv('M8 3v10M4 9l4 4 4-4', 11),
  search: '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/></svg>',
  all: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M3 4.5h10M3 8h10M3 11.5h10"/></svg>',
  wand: '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M3 13L11 5M10 3.5l1.5 1.5M12.5 1.5v2M11.5 2.5h2M5 3v1.5M4.2 3.7h1.6"/></svg>',
};

type From = 'same' | 'tm' | 'words';
interface FillRow { file: string; key: string; source: string; target: string; from: From; score: number; base?: string }
type Choice = { take: 'yes' } | { take: 'no' } | { take: 'custom'; text: string };
const FROMS: { id: From; label: string; dot: string; tip: string }[] = [
  { id: 'same', label: 'Однакові оригінали', dot: 'ok', tip: 'такий самий оригінал уже перекладено' },
  { id: 'tm', label: 'З пам’яті', dot: 'info', tip: 'збіг у пам’яті перекладів' },
  { id: 'words', label: 'За словами', dot: 'bad', tip: 'складено зі слів перекладених рядків' },
];
const RH = 52;
const idOf = (r: { file: string; key: string }): string => `${r.file}\u0001${r.key}`;
const store = (k: string, v?: string): string | null => { try { if (v !== undefined) localStorage.setItem(k, v); return localStorage.getItem(k); } catch { return null; } };

/** Open the screen; returns the function that closes it. `onClose` is told when it closed (the screen is redrawn then). */
export function openAutofillScreen(ctx: Ctx, onClose: () => void): () => void {
  const s = ctx.s;
  const main = document.querySelector<HTMLElement>('.main'), ide = $('#ide');
  if (!main) return () => {};

  let rows: FillRow[] = [], byId = new Map<string, FillRow>(), building = false, buildId = 0, found = 0;
  let drafts = store('transly.af.drafts') === '1';
  let threshold = Math.min(100, Math.max(50, Number(store('transly.af.min')) || 85));
  const choice = new Map<string, Choice>();
  const filters = new Set<From>();
  let query = '', file: string | null = null, words = true;
  const selected = new Set<string>();
  let active: string | null = null, anchor = -1, editing: string | null = null, editStart = '';
  let drag: { y: number } | null = null, moved = false, autoTimer = 0, autoDir = 0, autoSpeed = 0;

  const unitCache = new Map<string, Map<string, { u: Unit; n: number }>>();
  const unitOf = (f: string, key: string): { u: Unit; n: number } | undefined => {
    let m = unitCache.get(f);
    if (!m) { m = new Map(); (s.views.find(v => v.name === f)?.units ?? []).forEach((u, i) => m!.set(u.key, { u, n: i + 1 })); unitCache.set(f, m); }
    return m.get(key);
  };

  // ---------- the pieces of the screen ----------
  // a small popover under a button of the filters (closes on an outside click or Esc)
  let pop: HTMLElement | null = null;
  const closePop = (): void => { pop?.remove(); pop = null; };
  const popOver = (btn: HTMLElement, html: string): void => {
    const again = pop && pop.dataset.for === btn.id;
    closePop();
    if (again) return;
    pop = document.createElement('div');
    pop.className = 'pop af-pop'; pop.dataset.for = btn.id; pop.innerHTML = html;
    root.appendChild(pop);
    const r = btn.getBoundingClientRect();
    pop.style.left = `${Math.max(8, Math.min(window.innerWidth - pop.offsetWidth - 8, r.right - pop.offsetWidth))}px`; pop.style.top = `${r.bottom + 6}px`;
  };
  const onDocClick = (e: MouseEvent): void => { if (pop && !(e.target as HTMLElement).closest('.af-pop, #af-bt-min, #af-bt-src')) closePop(); };
  document.addEventListener('click', onDocClick);
  const root = document.createElement('div');
  root.className = 'mgx af';
  root.setAttribute('role', 'region');
  root.setAttribute('aria-label', 'Автозаповнення');
  root.innerHTML = `<div class="mg-shell"><div class="mg-row">
      <div class="mg-files"><div class="mg-card"><div class="mg-ph"><span class="ttl">Файли з пропозиціями</span></div><div class="mg-tree" id="mg-tree" role="tree" aria-label="Файли з пропозиціями"></div></div><div class="mg-sum" id="mg-sum" aria-live="polite"></div></div>
      <div class="mg-work"><div class="tabs"><span class="tabs-host" id="af-tabs" role="tablist" aria-label="Файли з пропозиціями"></span></div><div class="mg-tb" id="mg-tb"></div>
        <div class="grid mg-grid" role="grid" aria-label="Порожні рядки, які можна заповнити">
          <div class="gh" role="row"><div role="columnheader"></div><div role="columnheader" class="s" title="Джерело пропозиції"><span class="vh">Джерело</span></div><div class="s" role="columnheader">Ключ</div><div role="columnheader">Оригінал · EN</div><div class="s" role="columnheader">Переклад · UK</div><div class="s" role="columnheader">Знайдено</div><div class="s" role="columnheader" style="justify-content:flex-end;border-right:0">Рішення</div></div>
          <div class="mg-scroll" id="mg-scroll"><div class="mg-rows" id="mg-rows"></div></div>
          <div class="mg-edge" id="mg-edge" hidden>↓ таблиця прокручується, поки мишу притиснуто до краю</div>
        </div><div class="mg-bub" id="mg-bub" hidden></div></div></div>
      <div class="mg-band" id="mg-band"></div></div>`;
  main.appendChild(root);
  ide.classList.add('merging');
  const brBtn = document.getElementById('br-btn');
  const cap = document.createElement('span');
  cap.id = 'mcap'; cap.className = 'mg-cap';
  cap.innerHTML = `<span class="from">${ICON.wand}Автозаповнення</span><button type="button" class="mg-capx" id="mg-close" title="Закрити (Esc)" aria-label="Закрити автозаповнення">${ICON.x}</button>`;
  if (brBtn) { brBtn.hidden = true; brBtn.after(cap); } else document.querySelector('.topbar')?.appendChild(cap);

  const scroll = $('#mg-scroll', root), rowsEl = $('#mg-rows', root), bub = $('#mg-bub', root), edge = $('#mg-edge', root);

  // ---------- what is found ----------
  /** The decision for a row: the translator's, or by the slider (taken from `threshold` up, grey below). */
  const choiceOf = (r: FillRow): Choice | undefined => choice.get(idOf(r)) ?? (r.score >= threshold ? { take: 'yes' } : undefined);
  const textOf = (r: FillRow): string => { const c = choiceOf(r); return c?.take === 'custom' ? c.text : r.target; };
  const writes = (r: FillRow): boolean => { const c = choiceOf(r); return !!c && c.take !== 'no' && !!textOf(r).trim(); };
  const matches = (r: FillRow): boolean => {
    if (file && r.file !== file) return false;
    if (filters.size && !filters.has(r.from)) return false;
    if (!query) return true;
    return `${ctx.fileTitle(r.file)} ${r.key} ${r.source} ${r.target} ${r.base ?? ''}`.toLowerCase().includes(query);
  };
  let list: FillRow[] = [];
  const refilter = (): void => { list = rows.filter(matches); };
  const indexOfId = (id: string | null): number => (id ? list.findIndex(r => idOf(r) === id) : -1);
  const counts = (): { goes: number; no: number; pending: number } => {
    const c = { goes: 0, no: 0, pending: 0 };
    for (const r of rows) { const d = choiceOf(r); if (!d) c.pending++; else if (d.take === 'no') c.no++; else if (writes(r)) c.goes++; else c.no++; }
    return c;
  };

  /** Look for what can be written: the same originals and the words at once, the memory step by step (the page stays alive). */
  async function build(): Promise<void> {
    const me = ++buildId;
    building = true; rows = []; found = 0; byId = new Map();
    renderAll();
    const o = { drafts };
    const dict = learnWords(s.views, s.saved, o);
    const first = proposals(s.views, s.saved, dict, 5000, o);
    const have = new Set<string>();
    for (const p of first) { have.add(idOf(p)); rows.push({ file: p.file, key: p.key, source: p.source, target: p.target, from: p.from, score: p.from === 'same' ? 100 : 60, ...(p.from === 'same' ? { base: p.source } : {}) }); }
    const tm = ctx.tm();
    let last = performance.now();
    for (const v of s.views) {
      const ents = ctx.entries(v.name);
      for (const u of v.units) {
        if (have.has(idOf({ file: v.name, key: u.key })) || ents[u.key]?.target?.trim()) continue;
        const m = tm.find(u.source, { min: 70, limit: 1 })[0];
        if (m && plausible(u.source, m.t)) {
          // a word that was swapped for another one (not added, not dropped) means the memory's translation names the wrong thing («Red cat» for «Red cow»): it never passes as close
          const g = diffWords(m.s, u.source);
          const swapped = g.some(x => x.t === 'del') && g.some(x => x.t === 'add');
          rows.push({ file: v.name, key: u.key, source: u.source, target: m.t, from: 'tm', score: swapped ? Math.min(m.score, 69) : m.score, base: m.s });
        }
        if (performance.now() - last > 160) {
          found = rows.length; renderAll();
          await new Promise(r => setTimeout(r, 0));
          if (me !== buildId) return;
          last = performance.now();
        }
      }
    }
    if (me !== buildId) return;
    rows.sort((a, b) => (a.file === b.file ? 0 : a.file < b.file ? -1 : 1));
    byId = new Map(rows.map(r => [idOf(r), r]));
    building = false; found = rows.length;
    renderAll();
  }

  // ---------- drawing ----------
  const marks = (r: FillRow): string => {
    if (r.from === 'same') return '<span class="mg-pl">однаковий оригінал</span>';
    if (r.from === 'words') return '<span class="mg-pl">зібрано зі слів перекладених рядків</span>';
    const base = r.base ?? '';
    const body = words ? diffWords(base, r.source).filter(g => g.t !== 'add').map(g => (g.t === 'same' ? esc(g.text) : `<span class="w neu">${esc(g.text)}</span>`)).join('') : esc(oneLine(base, 400));
    return `<b class="af-sc">${r.score}%</b> ${body}`;
  };

  /** The original; for a match of the memory the words the memory's original does not have are marked. */
  const srcHtml = (r: FillRow): string => {
    if (r.from !== 'tm' || !r.base || !words) return esc(oneLine(r.source, 200));
    return diffWords(r.base, r.source).filter(g => g.t !== 'del').map(g => (g.t === 'same' ? esc(g.text) : `<span class="w neu">${esc(g.text)}</span>`)).join('');
  };

  const rowHtml = (r: FillRow, i: number): string => {
    const id = idOf(r), u = unitOf(r.file, r.key), d = choiceOf(r), kind = FROMS.find(f => f.id === r.from)!;
    const resCell = editing === id
      ? '<textarea class="cell-ed" rows="2" aria-label="Результат для рядка" spellcheck="false"></textarea>'
      : d?.take === 'no' ? '<span class="mg-pl">пропущено: рядок лишиться порожнім</span>'
      : !d ? `<span class="mg-pl">без рішення · ${esc(oneLine(r.target, 60))}</span>`
      : esc(oneLine(textOf(r), 400));
    const btn = (take: 'no' | 'yes'): string => {
      const on = take === 'no' ? d?.take === 'no' : !!d && d.take !== 'no';
      return `<button type="button" class="db ${take === 'no' ? 'm' : 'p'}${on ? ' on' : ''}" data-d="${take}" aria-pressed="${on}" aria-label="${take === 'no' ? 'Не заповнювати' : 'Вписати'}" title="${take === 'no' ? 'Не заповнювати' : 'Вписати'}">${take === 'no' ? ICON.minus : ICON.plus}</button>`;
    };
    return `<div class="gr${selected.has(id) ? ' sel' : ''}${active === id ? ' mg-act' : ''}${i % 2 ? ' z' : ''}${editing === id ? ' mg-ed' : ''}" role="row" data-id="${esc(id)}" data-i="${i}" style="top:${i * RH}px" aria-selected="${selected.has(id)}">
      <div class="ln" role="gridcell"><span class="num">${i + 1}</span></div>
      <div class="st" role="gridcell"><i class="dot ${kind.dot}" title="${esc(kind.tip)}"></i></div>
      <div role="gridcell"><span class="key" title="${esc(r.key)}">${esc(ctx.fileTitle(r.file))} · ${u?.n ?? '…'}</span></div>
      <div class="src" role="gridcell" lang="en">${srcHtml(r)}</div>
      <div class="tr res${editing === id ? ' edc' : ''}${d && d.take !== 'no' ? ' yes' : ''}${!d || d.take === 'no' ? ' empty' : ''}" role="gridcell" data-edit title="Клікніть, щоб писати прямо тут">${resCell}</div>
      <div class="tr fnd" role="gridcell">${marks(r)}</div>
      <div class="dec" role="gridcell">${btn('no')}${btn('yes')}</div></div>`;
  };

  const paintSel = (): void => {
    rowsEl.querySelectorAll<HTMLElement>('.gr').forEach(el => {
      const id = el.dataset.id!;
      el.classList.toggle('sel', selected.has(id)); el.classList.toggle('mg-act', active === id); el.setAttribute('aria-selected', String(selected.has(id)));
    });
  };

  const renderRows = (): void => {
    if (!list.length) { rowsEl.style.height = 'auto'; rowsEl.innerHTML = `<div class="grid-note">${building ? 'Шукаю, що можна заповнити…' : rows.length ? 'Немає рядків за цим фільтром' : 'Поки нічого заповнити не вдається: перекладіть і надішліть більше рядків, додайте терміни або дозвольте вчитися з чернеток'}</div>`; return; }
    rowsEl.style.height = `${list.length * RH}px`;
    const top = scroll.scrollTop, vh = scroll.clientHeight || 400;
    const from = Math.max(0, Math.floor(top / RH) - 8), to = Math.min(list.length, Math.ceil((top + vh) / RH) + 8);
    rowsEl.innerHTML = list.slice(from, to).map((r, k) => rowHtml(r, from + k)).join('');
    if (editing) {
      const ta = rowsEl.querySelector<HTMLTextAreaElement>('textarea.cell-ed');
      if (ta) { ta.value = editStart; ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
    }
  };

  const collapsed = new Set<string>();
  const renderTree = (): void => {
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r.file, (counts.get(r.file) ?? 0) + 1);
    $('#mg-tree', root).innerHTML = screenTreeHtml(ctx, counts, { file, collapsed, all: false });
  };

  const renderSum = (): void => {
    const c = counts();
    $('#mg-sum', root).innerHTML = `<div class="mg-fh" style="padding:0 0 4px">ПІДСУМОК</div><div class="sr"><span>Вписати</span><b>${c.goes.toLocaleString(uiLocale())}</b></div><div class="sr"><span>Пропустити</span><b>${c.no.toLocaleString(uiLocale())}</b></div><div class="sr"><span>Без рішення</span><b class="${c.pending ? 'bad' : ''}">${c.pending.toLocaleString(uiLocale())}</b></div>${building ? `<div class="sr"><span>Шукаю в пам’яті…</span><b>${found.toLocaleString(uiLocale())}</b></div>` : ''}`;
  };

  const renderTabs = (): void => {
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r.file, (counts.get(r.file) ?? 0) + 1);
    const tab = (on: boolean, f: string, ico: string, label: string, n: number): string => `<div class="tab ${on ? 'on' : ''}" role="tab" aria-selected="${on}"><button class="tb" type="button" data-f="${esc(f)}" aria-current="${on}" title="${esc(label)}: ${n.toLocaleString(uiLocale())}"><span class="tico ${ico === 'MAP' ? '' : ico === 'ALL' ? 'all' : 'j'}">${ico === 'ALL' ? ICON.all : ico}</span>${esc(label)}<span class="badge">${n.toLocaleString(uiLocale())}</span></button></div>`;
    $('#af-tabs', root).innerHTML = tab(file === null, '', 'ALL', 'Усі файли', rows.length) + [...counts].map(([f, n]) => tab(file === f, f, fileIcon(f)[1], ctx.fileTitle(f), n)).join('');
  };

  const renderToolbar = (): void => {
    const n = (f: From): number => rows.filter(r => r.from === f).length;
    const chips = FROMS.filter(f => n(f.id)).map(f => `<button type="button" class="chip${filters.has(f.id) ? ' on' : ''}" data-chip="${f.id}" aria-pressed="${filters.has(f.id)}"><i class="sd ${f.dot}"></i>${esc(f.label)} · ${n(f.id).toLocaleString(uiLocale())}</button>`).join('');
    const tb = $('#mg-tb', root);
    const had = document.activeElement?.id === 'mg-q';
    tb.innerHTML = `<div class="filters"><div class="fin">${ICON.search}<input class="qin" id="mg-q" placeholder="Фільтр у пропозиціях" aria-label="Фільтр у пропозиціях" value="${esc(query)}" autocomplete="off"></div><span class="chipsHost">${chips}</span>
      <div class="r"><button class="chip${threshold < 100 ? ' on' : ''}" type="button" id="af-bt-min" aria-haspopup="true" title="Точність, від якої пропозиція береться без питань">Від ${threshold}%<svg class="caret" viewBox="0 0 10 10"><path d="M2 3.6L5 6.6l3-3"/></svg></button><button class="chip${drafts ? ' on' : ''}" type="button" id="af-bt-src" aria-haspopup="true" title="З чого вчиться автозаповнення">Вчитися з: ${drafts ? 'надісланих і чернеток' : 'надісланих'}<svg class="caret" viewBox="0 0 10 10"><path d="M2 3.6L5 6.6l3-3"/></svg></button></div></div>`;
    if (had) { const q = $('#mg-q', tb) as HTMLInputElement; q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
  };

  const renderBand = (): void => {
    const c = counts(), sel = selected.size;
    $('#mg-band', root).innerHTML = `<div class="mg-hint"><span><kbd>${ICON.up}</kbd><kbd>${ICON.down}</kbd> рядок</span><span><kbd>${ICON.plus.replace(/ width="14" height="14"/, '')}</kbd> вписати</span><span><kbd>${ICON.minus.replace(/ width="14" height="14"/, '')}</kbd> пропустити</span><span><kbd>Enter</kbd> свій текст</span><span><kbd>Esc</kbd> вийти</span></div><span class="sp"></span>
      ${sel ? `<span>Обрано <b>${sel.toLocaleString(uiLocale())}</b>:</span><button type="button" class="b o" data-sel="no">${ICON.minus} Пропустити</button><button type="button" class="b o" data-sel="yes">${ICON.plus} Вписати</button><span style="width:8px"></span>` : ''}
      <button type="button" class="b p l" id="mg-go"${c.goes ? '' : ' disabled'}>Вписати як чернетки · ${c.goes.toLocaleString(uiLocale())}</button>`;
  };

  const renderAll = (): void => { refilter(); renderTabs(); renderToolbar(); renderTree(); renderSum(); renderRows(); renderBand(); };
  const afterDecision = (): void => { renderTree(); renderSum(); renderRows(); renderBand(); };

  // ---------- deciding ----------
  const decideRows = (ids: string[], take: 'yes' | 'no'): void => {
    for (const id of ids) choice.set(id, { take });
    afterDecision();
  };
  const targets = (id: string): string[] => (selected.has(id) && selected.size > 1 ? [...selected] : [id]);

  const startEdit = (id: string): void => {
    const r = byId.get(id);
    if (!r) return;
    editing = id; active = id; editStart = textOf(r);
    renderRows();
  };
  const endEdit = (save: boolean): void => {
    const id = editing;
    if (!id) return;
    const ta = rowsEl.querySelector<HTMLTextAreaElement>('textarea.cell-ed');
    const r = byId.get(id);
    editing = null;
    if (save && ta && r) {
      const v = ta.value;
      if (!v.trim()) choice.set(id, { take: 'no' });
      else if (v === r.target) choice.set(id, { take: 'yes' });
      else choice.set(id, { take: 'custom', text: v });
    }
    afterDecision();
  };

  // ---------- selecting rows: a click, shift/ctrl, or the mouse held down and dragged (the table scrolls at its edge) ----------
  const selectRange = (a: number, b: number): void => {
    selected.clear();
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) { const r = list[i]; if (r) selected.add(idOf(r)); }
  };
  const indexAt = (clientY: number): number => {
    const box = scroll.getBoundingClientRect();
    return Math.min(list.length - 1, Math.max(0, Math.floor((clientY - box.top + scroll.scrollTop) / RH)));
  };
  const showBub = (x: number, y: number): void => {
    const box = $('.mg-work', root).getBoundingClientRect();
    bub.hidden = selected.size < 2; bub.textContent = `Обрано ${selected.size} · тягніть далі, щоб додати рядки`;
    bub.style.left = `${Math.min(box.width - 300, Math.max(8, x - box.left + 14))}px`; bub.style.top = `${Math.max(8, y - box.top + 14)}px`;
  };
  const stopAuto = (): void => { if (autoTimer) { window.clearInterval(autoTimer); autoTimer = 0; } autoDir = 0; edge.hidden = true; };
  const onDrag = (y: number): void => {
    if (!drag || !list.length) return;
    drag.y = y;
    const i = indexAt(y);
    if (anchor >= 0) { selectRange(anchor, i); active = idOf(list[i]!); }
    const box = scroll.getBoundingClientRect(), zone = 40;
    const dir = y > box.bottom - zone ? 1 : y < box.top + zone ? -1 : 0;
    autoSpeed = dir > 0 ? Math.min(1, (y - (box.bottom - zone)) / zone) : dir < 0 ? Math.min(1, ((box.top + zone) - y) / zone) : 0;
    if (dir !== autoDir) { stopAuto(); autoDir = dir; if (dir) { edge.hidden = false; autoTimer = window.setInterval(() => { scroll.scrollTop += autoDir * (6 + 26 * autoSpeed); if (drag) { const k = indexAt(drag.y); selectRange(anchor, k); active = idOf(list[k]!); renderRows(); renderBand(); } }, 30); } }
    paintSel(); renderBand();
  };

  root.addEventListener('mousedown', e => {
    const t = e.target as HTMLElement;
    const row = t.closest<HTMLElement>('.gr');
    if (!row || e.button !== 0 || t.closest('button, textarea')) return;
    const i = Number(row.dataset.i), id = row.dataset.id!;
    moved = false;
    if (e.shiftKey && anchor >= 0) selectRange(anchor, i);
    else if (e.ctrlKey || e.metaKey) { if (selected.has(id)) selected.delete(id); else selected.add(id); anchor = i; }
    else { selected.clear(); selected.add(id); anchor = i; }
    active = id; drag = { y: e.clientY };
    paintSel(); renderBand();
    e.preventDefault();
  });
  const onMove = (e: MouseEvent): void => { if (!drag) return; if (Math.abs(e.clientY - drag.y) > 3) moved = true; if (moved) { onDrag(e.clientY); showBub(e.clientX, e.clientY); } };
  const onUp = (): void => { if (drag) { drag = null; stopAuto(); bub.hidden = true; } };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
  scroll.addEventListener('scroll', () => { if (!editing) window.requestAnimationFrame(renderRows); });
  const onResize = (): void => { if (!editing) renderRows(); };
  window.addEventListener('resize', onResize);

  root.addEventListener('click', e => {
    const t = e.target as HTMLElement;
    if (t.closest('#mg-close')) { close(); return; }
    const d = t.closest<HTMLButtonElement>('[data-d]');
    if (d && !d.disabled) { decideRows(targets(d.closest<HTMLElement>('.gr')!.dataset.id!), d.dataset.d as 'yes' | 'no'); return; }
    const sel = t.closest<HTMLElement>('[data-sel]');
    if (sel) { decideRows([...selected], sel.dataset.sel as 'yes' | 'no'); return; }
    const dir = t.closest<HTMLElement>('[data-dir]');
    if (dir) { const k = dir.dataset.dir!; if (collapsed.has(k)) collapsed.delete(k); else collapsed.add(k); renderTree(); return; }
    const f = t.closest<HTMLElement>('[data-f]');
    if (f) { file = f.dataset.f && f.dataset.f !== file ? f.dataset.f : null; selected.clear(); anchor = -1; scroll.scrollTop = 0; renderAll(); return; }
    const chip = t.closest<HTMLElement>('[data-chip]');
    if (chip) { const c = chip.dataset.chip as From; if (filters.has(c)) filters.delete(c); else filters.add(c); scroll.scrollTop = 0; renderAll(); return; }
    if (t.closest('#af-bt-min')) { popOver(t.closest<HTMLElement>('#af-bt-min')!, `<div class="af-sl">Вписувати без питань від <input type="range" id="af-min" min="50" max="100" step="1" value="${threshold}" aria-label="Точність, від якої пропозиція береться без питань"><b id="af-minv">${threshold}%</b></div><p class="hint">Однакові оригінали мають 100%, збіги пам’яті — свою точність, слова — 60%. Що нижче — лишається сірим, поки ви не вирішите.</p>`); return; }
    if (t.closest('#af-bt-src')) { popOver(t.closest<HTMLElement>('#af-bt-src')!, `<div class="group">Вчитися з</div><button type="button" data-src="sent" class="${drafts ? '' : 'on'}">Надісланих і вичитаних<span class="hint">надійніше</span></button><button type="button" data-src="drafts" class="${drafts ? 'on' : ''}">Надісланих і чернеток<span class="hint">більше пропозицій, але чернетка може бути недоробленою</span></button>`); return; }
    const src = t.closest<HTMLElement>('[data-src]');
    if (src) { closePop(); const d2 = src.dataset.src === 'drafts'; if (d2 !== drafts) { drafts = d2; store('transly.af.drafts', d2 ? '1' : '0'); choice.clear(); selected.clear(); void build(); } return; }
    if (t.closest('#mg-go')) { doFill(); return; }
    const res = t.closest<HTMLElement>('.res');
    if (res && !moved && !t.closest('textarea')) { const row = res.closest<HTMLElement>('.gr'); if (row) startEdit(row.dataset.id!); }
  });
  root.addEventListener('input', e => {
    const t = e.target as HTMLInputElement;
    if (t.id === 'mg-q') { query = t.value.trim().toLowerCase(); refilter(); scroll.scrollTop = 0; renderRows(); }
    else if (t.id === 'af-min') { threshold = Number(t.value); store('transly.af.min', String(threshold)); const b = document.getElementById('af-minv'); if (b) b.textContent = `${threshold}%`; renderSum(); renderRows(); renderBand(); }
  });
  root.addEventListener('focusout', e => { if ((e.target as HTMLElement).matches('textarea.cell-ed') && editing) window.setTimeout(() => { if (editing) endEdit(true); }, 0); });

  function reveal(i: number): void {
    const top = i * RH, vh = scroll.clientHeight;
    if (top < scroll.scrollTop) scroll.scrollTop = top; else if (top + RH > scroll.scrollTop + vh) scroll.scrollTop = top + RH - vh;
    renderRows(); renderBand();
  }

  // ---------- keys ----------
  const onKey = (e: KeyboardEvent): void => {
    if (document.querySelector('dialog[open]')) return;
    const inTa = (e.target as HTMLElement).matches?.('textarea.cell-ed');
    if (inTa) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); endEdit(true); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); endEdit(false); }
      return;
    }
    if ((e.target as HTMLElement).matches?.('input, textarea')) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); (e.target as HTMLElement).blur(); } return; }
    const eat = (): void => { e.preventDefault(); e.stopPropagation(); };
    const i = Math.max(0, indexOfId(active));
    if (e.key === 'Escape') { eat(); close(); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      eat();
      const k = Math.min(list.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)));
      if (!list[k]) return;
      if (e.shiftKey) { if (anchor < 0) anchor = i; selectRange(anchor, k); } else { selected.clear(); selected.add(idOf(list[k]!)); anchor = k; }
      active = idOf(list[k]!); reveal(k);
    } else if (e.key === '+' || e.key === '=' || e.key === 'ArrowRight') { eat(); if (active) decideRows(targets(active), 'yes'); }
    else if (e.key === '-' || e.key === '_' || e.key === 'ArrowLeft') { eat(); if (active) decideRows(targets(active), 'no'); }
    else if (e.key === 'Enter') { eat(); if (active) startEdit(active); }
    else if (e.key === ' ') { eat(); if (active) { if (selected.has(active)) selected.delete(active); else selected.add(active); anchor = i; renderRows(); renderBand(); } }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { eat(); selectRange(0, list.length - 1); renderRows(); renderBand(); }
  };
  document.addEventListener('keydown', onKey, true);

  // ---------- the fill ----------
  const WHAT: Record<From, (r: FillRow) => string> = { same: () => 'підставлено з однакового рядка', words: () => 'автозаповнено за словами', tm: r => `підставлено з пам’яті (${r.score}%)` };
  function doFill(): void {
    const now = Date.now(), changes: RowChange[] = [];
    let skipped = 0;
    for (const r of rows) {
      if (!writes(r)) continue;
      const u = unitOf(r.file, r.key)?.u, ents = ctx.entries(r.file);
      // a row that got a translation while the screen was open is left alone
      if (!u || ents[r.key]?.target?.trim()) { skipped++; continue; }
      const text = textOf(r);
      changes.push({ file: r.file, key: r.key, next: edit(ents[r.key], u, text, ctx.stage(), now), text, what: WHAT[r.from](r) });
    }
    if (!changes.length) { toast(skipped ? 'Ці рядки вже мають переклад' : 'Нічого вписувати: поставте «+» хоча б в одному рядку'); return; }
    const batch = ctx.commit(changes, 'autofill');
    ctx.invalidateTm(); ctx.persist();
    const n = changes.length;
    close();
    undoToast(ctx, `Автозаповнено ${plural(n, ['рядок', 'рядки', 'рядків'])} як чернетки з позначкою «авто»${skipped ? `. Ще ${skipped} вже мали переклад` : ''}`, batch);
  }

  function close(): void {
    if (!root.isConnected) return;
    buildId++; stopAuto();
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('click', onDocClick);
    closePop();
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    window.removeEventListener('resize', onResize);
    root.remove(); cap.remove();
    ide.classList.remove('merging');
    if (brBtn) brBtn.hidden = false;
    onClose();
  }

  void build();
  return close;
}
