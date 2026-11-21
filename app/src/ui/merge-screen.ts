import { applyPlan, branchOf, defaultDecision, diffBranches, diffWords, planMerge, planMessage, rowId, uiLocale } from '../core';
import type { Decision, DiffKind, DiffRow, Unit } from '../core';
import { $, esc, plural, toast } from './dom';
import { oneLine } from './hintcards';
import { undoToast } from './undo-toast';
import type { Ctx } from './state';

/**
 * The screen that merges one branch of the translation into the current one. It takes the place of the work area (the top bar, the
 * rail and the status bar stay). Every row where the other branch has a translation the current one does not is a line of a table;
 * the translator settles each with «−» (keep ours, drop theirs) or «+» (take theirs), or writes the row by hand in the «Результат»
 * cell, as in the table of the project. Green is what is kept, red what is dropped, grey what is not decided yet. Nothing is written
 * until «Злити»; then the rows are written as one action of the journal («merge»), with its «Скасувати».
 */

const sv = (p: string, s = 14): string => `<svg class="gi" viewBox="0 0 16 16" width="${s}" height="${s}" aria-hidden="true"><path d="${p}"/></svg>`;
const ICON = {
  plus: sv('M3 8h10M8 3v10'), minus: sv('M3 8h10'), lock: sv('M3.5 7h9v6.5h-9zM5.5 7V5.2a2.5 2.5 0 015 0V7', 13), x: sv('M4 4l8 8M12 4l-8 8', 12),
  up: sv('M8 13V3M4 7l4-4 4 4', 11), down: sv('M8 3v10M4 9l4 4 4-4', 11),
  search: '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/></svg>',
  caret: '<svg class="caret" viewBox="0 0 10 10"><path d="M2 3.6L5 6.6l3-3"/></svg>',
  branch: '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><circle cx="4.5" cy="3.5" r="1.7"/><circle cx="4.5" cy="12.5" r="1.7"/><circle cx="11.5" cy="5.5" r="1.7"/><path d="M4.5 5.2v5.6M11.5 7.2c0 2.4-3 2.4-7 4"/></svg>',
};

/** The height of a row; the table draws only the rows in view. */
const RH = 36;
type Chip = 'conflict' | 'new' | 'changed' | 'locked';
const CHIPS: { id: Chip; label: string }[] = [{ id: 'conflict', label: 'Конфлікти' }, { id: 'new', label: 'Нові' }, { id: 'changed', label: 'Змінені' }, { id: 'locked', label: '' }];
const chipOf = (r: DiffRow): Chip => (r.locked ? 'locked' : r.kind);

/** Open the screen; returns the function that closes it. `onClose` is told when it closed (the screen is redrawn then). */
export function openMergeScreen(ctx: Ctx, source: string, onClose: () => void): () => void {
  const s = ctx.s, cur = branchOf(s.saved);
  let rows: DiffRow[];
  try { rows = diffBranches(s.saved, source); } catch (e) { toast(e instanceof Error ? e.message : 'Не вдалося порівняти гілки'); return () => {}; }
  if (!rows.length) { toast(`Гілки «${cur}» і «${source}» не відрізняються: зливати нічого`); return () => {}; }
  const main = document.querySelector<HTMLElement>('.main'), ide = $('#ide');
  if (!main) return () => {};

  const byId = new Map(rows.map(r => [rowId(r), r]));
  const decision = new Map<string, Decision | undefined>(rows.map(r => [rowId(r), defaultDecision(r)]));
  const filters = new Set<Chip>(rows.some(r => !r.locked && r.kind === 'conflict') ? ['conflict'] : []);
  let query = '', file: string | null = null, words = true;
  const selected = new Set<string>();
  let active: string | null = null, anchor = -1, editing: string | null = null;
  let drag: { y: number } | null = null, moved = false, autoTimer = 0, autoDir = 0, autoSpeed = 0;

  const unitCache = new Map<string, Map<string, { u: Unit; n: number }>>();
  const unitOf = (f: string, key: string): { u: Unit; n: number } | undefined => {
    let m = unitCache.get(f);
    if (!m) { m = new Map(); (s.views.find(v => v.name === f)?.units ?? []).forEach((u, i) => m!.set(u.key, { u, n: i + 1 })); unitCache.set(f, m); }
    return m.get(key);
  };

  // ---------- the pieces of the screen ----------
  const root = document.createElement('div');
  root.className = 'mgx';
  root.setAttribute('role', 'region');
  root.setAttribute('aria-label', `Злиття гілки «${source}» у «${cur}»`);
  root.innerHTML = `<div class="mg-shell"><div class="mg-row">
      <div class="mg-files"><div class="mg-fh">ЗМІНЕНІ ФАЙЛИ</div><div class="mg-tree" id="mg-tree" role="tree" aria-label="Змінені файли"></div><div class="mg-sum" id="mg-sum" aria-live="polite"></div></div>
      <div class="mg-work"><div class="mg-tb" id="mg-tb"></div>
        <div class="grid mg-grid" role="grid" aria-label="Рядки, які відрізняються">
          <div class="gh" role="row"><div></div><div></div><div class="s">Файл · рядок</div><div>Оригінал · EN</div><div>${esc(cur)}</div><div>${esc(source)}</div><div>Результат · у ${esc(cur)}</div><div style="justify-content:flex-end;border-right:0">Рішення</div></div>
          <div class="mg-scroll" id="mg-scroll"><div class="mg-rows" id="mg-rows"></div></div>
          <div class="mg-edge" id="mg-edge" hidden>↓ таблиця прокручується, поки мишу притиснуто до краю</div>
        </div><div class="mg-bub" id="mg-bub" hidden></div></div></div>
      <div class="mg-band" id="mg-band"></div></div>`;
  main.appendChild(root);
  ide.classList.add('merging');
  // the top bar: the branch button gives way to the capsule that says what is merged into what, and closes the screen
  const brBtn = document.getElementById('br-btn');
  const cap = document.createElement('span');
  cap.id = 'mcap'; cap.className = 'mg-cap';
  cap.innerHTML = `<span class="from">${ICON.branch}${esc(source)}</span><span class="to-ar" aria-hidden="true">→</span><span>${ICON.branch}${esc(cur)}</span><button type="button" class="mg-capx" id="mg-close" title="Закрити злиття (Esc)" aria-label="Закрити злиття">${ICON.x}</button>`;
  if (brBtn) { brBtn.hidden = true; brBtn.after(cap); } else document.querySelector('.topbar')?.appendChild(cap);

  const scroll = $('#mg-scroll', root), rowsEl = $('#mg-rows', root), bub = $('#mg-bub', root), edge = $('#mg-edge', root);

  // ---------- what the rows are ----------
  const decisionOf = (r: DiffRow): Decision | undefined => decision.get(rowId(r));
  const matches = (r: DiffRow): boolean => {
    if (file && r.file !== file) return false;
    if (filters.size && !filters.has(chipOf(r))) return false;
    if (!query) return true;
    const u = unitOf(r.file, r.key)?.u;
    return `${ctx.fileTitle(r.file)} ${r.key} ${u?.source ?? ''} ${r.mine?.target ?? ''} ${r.theirs.target}`.toLowerCase().includes(query);
  };
  let list: DiffRow[] = rows.filter(matches);
  const refilter = (): void => { list = rows.filter(matches); };
  const indexOfId = (id: string | null): number => (id ? list.findIndex(r => rowId(r) === id) : -1);

  const goes = (r: DiffRow): boolean => { const d = decisionOf(r); return !r.locked && !!d && d.take !== 'mine'; };
  const counts = (): { goes: number; keeps: number; pending: number; locked: number } => {
    const c = { goes: 0, keeps: 0, pending: 0, locked: 0 };
    for (const r of rows) { if (r.locked) c.locked++; else { const d = decisionOf(r); if (!d) c.pending++; else if (d.take === 'mine') c.keeps++; else c.goes++; } }
    return c;
  };

  /** The text the row will have in the current branch, as the translator decided; undecided = as it is now. */
  const resultOf = (r: DiffRow): { text: string; decided: boolean } => {
    const d = decisionOf(r);
    if (d?.take === 'theirs') return { text: r.theirs.target, decided: true };
    if (d?.take === 'custom') return { text: d.text, decided: true };
    return { text: r.mine?.target ?? '', decided: d?.take === 'mine' };
  };

  // ---------- drawing ----------
  const marks = (a: string, b: string, side: 'mine' | 'theirs', r: DiffRow): string => {
    if (!a && !b) return '';
    const d = decisionOf(r);
    // green is what is kept, red what is dropped, grey what is not decided yet; a hand-written row drops both
    const cls = !d ? 'neu' : d.take === 'custom' ? 'rej' : side === 'mine' ? (d.take === 'mine' ? 'keep' : 'rej') : (d.take === 'theirs' ? 'keep' : 'rej');
    const text = side === 'mine' ? a : b;
    if (!words) return esc(oneLine(text, 400));
    const segs = diffWords(a, b).filter(g => g.t === 'same' || g.t === (side === 'mine' ? 'del' : 'add'));
    return segs.map(g => (g.t === 'same' ? esc(g.text) : `<span class="w ${cls}">${esc(g.text)}</span>`)).join('') || esc(text);
  };

  const rowHtml = (r: DiffRow, i: number): string => {
    const id = rowId(r), u = unitOf(r.file, r.key), d = decisionOf(r), res = resultOf(r);
    const mine = r.mine?.target ?? '', theirs = r.theirs.target;
    const dotCls = r.kind === 'conflict' ? 'bad' : r.kind === 'new' ? 'ok' : 'info';
    const resCell = editing === id
      ? `<textarea class="cell-ed" rows="2" aria-label="Результат для рядка" spellcheck="false"></textarea>`
      : r.locked ? `<span class="mg-pl">вичитано в «${esc(cur)}»: не чіпаємо</span>`
      : !d && r.kind === 'conflict' ? `<span class="mg-pl">без рішення · лишиться «${esc(oneLine(mine, 40))}»</span>`
      : esc(oneLine(res.text, 400));
    const btn = (take: 'mine' | 'theirs'): string => {
      const on = take === 'mine' ? d?.take === 'mine' : d?.take === 'theirs';
      const dis = r.locked ? ' disabled' : '';
      return `<button type="button" class="db ${take === 'mine' ? 'm' : 'p'}${on ? ' on' : ''}" data-d="${take}" aria-pressed="${on}" aria-label="${take === 'mine' ? `Відкинути зміну з «${esc(source)}»` : `Взяти зміну з «${esc(source)}»`}" title="${take === 'mine' ? 'Відкинути' : 'Взяти'}"${dis}>${take === 'mine' ? ICON.minus : ICON.plus}</button>`;
    };
    return `<div class="gr${selected.has(id) ? ' sel' : ''}${active === id ? ' mg-act' : ''}${i % 2 ? ' z' : ''}${r.locked ? ' lkd' : ''}${editing === id ? ' mg-ed' : ''}" role="row" data-id="${esc(id)}" data-i="${i}" style="top:${i * RH}px" aria-selected="${selected.has(id)}">
      <div class="ln"><span>${i + 1}</span></div>
      <div class="dot0"><i class="dot ${dotCls}" title="${r.kind === 'conflict' ? 'конфлікт' : r.kind === 'new' ? 'нове в гілці' : 'змінено в гілці'}"></i></div>
      <div class="key" title="${esc(r.key)}">${esc(ctx.fileTitle(r.file))} · ${u?.n ?? '…'}</div>
      <div class="src" lang="en">${esc(oneLine(u?.u.source ?? '', 200))}</div>
      <div class="tr">${mine ? marks(mine, theirs, 'mine', r) : '<span class="mg-pl">без перекладу</span>'}${r.locked ? ` <span class="mg-lock" title="Вичитано: не змінюється">${ICON.lock}</span>` : ''}</div>
      <div class="tr">${marks(mine, theirs, 'theirs', r)}</div>
      <div class="tr res${editing === id ? ' edc' : ''}" data-edit title="Клікніть, щоб писати прямо тут">${resCell}</div>
      <div class="dec">${btn('mine')}${btn('theirs')}</div></div>`;
  };

  /** Mark the selected and the active row on the rows in view, without drawing them again (a click that follows a press must find its row). */
  const paintSel = (): void => {
    rowsEl.querySelectorAll<HTMLElement>('.gr').forEach(el => {
      const id = el.dataset.id!;
      el.classList.toggle('sel', selected.has(id)); el.classList.toggle('mg-act', active === id); el.setAttribute('aria-selected', String(selected.has(id)));
    });
  };

  const renderRows = (): void => {
    if (!list.length) { rowsEl.style.height = 'auto'; rowsEl.innerHTML = '<div class="grid-note">Немає рядків за цим фільтром</div>'; return; }
    rowsEl.style.height = `${list.length * RH}px`;
    const top = scroll.scrollTop, vh = scroll.clientHeight || 400;
    const from = Math.max(0, Math.floor(top / RH) - 8), to = Math.min(list.length, Math.ceil((top + vh) / RH) + 8);
    rowsEl.innerHTML = list.slice(from, to).map((r, k) => rowHtml(r, from + k)).join('');
    if (editing) {
      const ta = rowsEl.querySelector<HTMLTextAreaElement>('textarea.cell-ed');
      if (ta) { ta.value = editStart; ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
    }
  };
  let editStart = '';

  const renderTree = (): void => {
    const byFile = new Map<string, { n: number; red: number }>();
    for (const r of rows) { const e = byFile.get(r.file) ?? { n: 0, red: 0 }; e.n++; if (!r.locked && r.kind === 'conflict' && !decisionOf(r)) e.red++; byFile.set(r.file, e); }
    const ic = (n: string): [string, string] => (/^Map\d+\.json$/.test(n) ? ['map', 'MAP'] : n.endsWith('.json') ? ['json', '{}'] : ['gl', 'Aa']);
    const total = rows.length, red = [...byFile.values()].reduce((a, v) => a + v.red, 0);
    $('#mg-tree', root).innerHTML = `<div class="node ${file === null ? 'cur' : ''}" style="--d:0" role="treeitem" tabindex="0" data-f="" aria-selected="${file === null}"><span class="chev"></span><span class="ic dir">▤</span><span class="nm">Усі файли</span>${red ? '<i class="rd"></i>' : ''}<span class="pc">${total.toLocaleString(uiLocale())}</span></div>`
      + [...byFile].sort((x, y) => (ctx.fileTitle(x[0]) < ctx.fileTitle(y[0]) ? -1 : 1)).map(([f, v]) => { const [k, t] = ic(f); return `<div class="node ${file === f ? 'cur' : ''}" style="--d:1" role="treeitem" tabindex="-1" data-f="${esc(f)}" aria-selected="${file === f}"><span class="chev"></span><span class="ic ${k}">${t}</span><span class="nm">${esc(ctx.fileTitle(f))}</span>${v.red ? '<i class="rd"></i>' : ''}<span class="pc">${v.n.toLocaleString(uiLocale())}</span></div>`; }).join('');
  };

  const renderSum = (): void => {
    const c = counts();
    $('#mg-sum', root).innerHTML = `<div class="mg-fh" style="padding:0 0 4px">ПІДСУМОК</div><div class="sr"><span>Піде в «${esc(cur)}»</span><b>${c.goes.toLocaleString(uiLocale())}</b></div><div class="sr"><span>Лишиться як є</span><b>${c.keeps.toLocaleString(uiLocale())}</b></div><div class="sr"><span>Без рішення</span><b class="${c.pending ? 'bad' : ''}">${c.pending.toLocaleString(uiLocale())}</b></div><div class="sr"><span>Вичитані — не чіпаємо</span><b>${c.locked.toLocaleString(uiLocale())}</b></div>`;
  };

  const renderToolbar = (): void => {
    const n = (c: Chip): number => rows.filter(r => chipOf(r) === c).length;
    const chips = CHIPS.filter(c => n(c.id)).map(c => `<button type="button" class="chip${filters.has(c.id) ? ' on' : ''}" data-chip="${c.id}" aria-pressed="${filters.has(c.id)}">${c.id === 'locked' ? ICON.lock : esc(c.label)} · ${n(c.id).toLocaleString(uiLocale())}</button>`).join('');
    const tb = $('#mg-tb', root);
    const had = document.activeElement?.id === 'mg-q';
    tb.innerHTML = `<div class="filters"><div class="fin">${ICON.search}<input class="qin" id="mg-q" placeholder="Фільтр у змінах" aria-label="Фільтр у змінах" value="${esc(query)}" autocomplete="off"></div>${chips}
      <span class="mg-leg"><i class="keep"></i>залишене</span><span class="mg-leg"><i class="rej"></i>відкинуте</span>
      <button type="button" class="chip${words ? ' on' : ''}" id="mg-words" aria-pressed="${words}">Слова${words ? ' ✓' : ''}</button></div>`;
    if (had) { const q = $('#mg-q', tb) as HTMLInputElement; q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
  };

  const renderBand = (): void => {
    const c = counts(), sel = selected.size;
    $('#mg-band', root).innerHTML = `<div class="mg-hint"><span><kbd>${ICON.up}</kbd><kbd>${ICON.down}</kbd> рядок</span><span><kbd>${ICON.plus.replace(/ width="14" height="14"/, '')}</kbd> взяти</span><span><kbd>${ICON.minus.replace(/ width="14" height="14"/, '')}</kbd> відкинути</span><span><kbd>Enter</kbd> свій</span><span><kbd>Esc</kbd> вийти</span></div><span class="sp"></span>
      ${sel ? `<span>Обрано <b>${sel.toLocaleString(uiLocale())}</b>:</span><button type="button" class="b o" data-sel="mine">${ICON.minus} Відкинути</button><button type="button" class="b o" data-sel="theirs">${ICON.plus} Взяти</button><span style="width:8px"></span>` : ''}
      <button type="button" class="b o l" id="mg-skip"${c.pending ? '' : ' disabled'}>Пропустити конфлікт</button>
      <button type="button" class="b p l" id="mg-go"${c.goes ? '' : ' disabled'}>Злити «${esc(source)}» у «${esc(cur)}» · ${c.goes.toLocaleString(uiLocale())}</button>`;
  };

  const renderAll = (): void => { refilter(); renderToolbar(); renderTree(); renderSum(); renderRows(); renderBand(); };
  const afterDecision = (): void => { renderTree(); renderSum(); renderRows(); renderBand(); };

  // ---------- deciding ----------
  const decideRows = (ids: string[], take: 'mine' | 'theirs'): void => {
    let kept = 0;
    for (const id of ids) { const r = byId.get(id); if (!r) continue; if (r.locked) { kept++; continue; } decision.set(id, { take }); }
    if (kept && ids.length === kept) toast(`Вичитані в «${cur}» рядки не змінюються`);
    afterDecision();
  };
  /** A button on a row settles the whole selection when the row is part of it, and only the row otherwise. */
  const targets = (id: string): string[] => (selected.has(id) && selected.size > 1 ? [...selected] : [id]);

  const startEdit = (id: string): void => {
    const r = byId.get(id);
    if (!r) return;
    if (r.locked) { toast(`Рядок вичитано в «${cur}»: його не змінюємо`); return; }
    editing = id; active = id;
    const d = decisionOf(r);
    editStart = d?.take === 'custom' ? d.text : d?.take === 'theirs' ? r.theirs.target : (r.mine?.target ?? '');
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
      if (v === r.theirs.target) decision.set(id, { take: 'theirs' });
      else if (v === (r.mine?.target ?? '') && r.mine) decision.set(id, { take: 'mine' });
      else decision.set(id, { take: 'custom', text: v });
    }
    afterDecision();
  };

  // ---------- selecting rows: a click, shift/ctrl, or the mouse held down and dragged (the table scrolls at its edge) ----------
  const selectRange = (a: number, b: number): void => {
    selected.clear();
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) { const r = list[i]; if (r) selected.add(rowId(r)); }
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
    if (!drag) return;
    drag.y = y;
    const i = indexAt(y);
    if (anchor >= 0) { selectRange(anchor, i); active = rowId(list[i]!); }
    const box = scroll.getBoundingClientRect(), zone = 40;
    const dir = y > box.bottom - zone ? 1 : y < box.top + zone ? -1 : 0;
    autoSpeed = dir > 0 ? Math.min(1, (y - (box.bottom - zone)) / zone) : dir < 0 ? Math.min(1, ((box.top + zone) - y) / zone) : 0;
    if (dir !== autoDir) { stopAuto(); autoDir = dir; if (dir) { edge.hidden = false; autoTimer = window.setInterval(() => { scroll.scrollTop += autoDir * (6 + 26 * autoSpeed); if (drag) { const k = indexAt(drag.y); selectRange(anchor, k); active = rowId(list[k]!); renderRows(); renderBand(); } }, 30); } }
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
    if (d && !d.disabled) { decideRows(targets(d.closest<HTMLElement>('.gr')!.dataset.id!), d.dataset.d as 'mine' | 'theirs'); return; }
    const sel = t.closest<HTMLElement>('[data-sel]');
    if (sel) { decideRows([...selected], sel.dataset.sel as 'mine' | 'theirs'); return; }
    const f = t.closest<HTMLElement>('[data-f]');
    if (f) { file = f.dataset.f || null; selected.clear(); anchor = -1; scroll.scrollTop = 0; renderAll(); return; }
    const chip = t.closest<HTMLElement>('[data-chip]');
    if (chip) { const c = chip.dataset.chip as Chip; if (filters.has(c)) filters.delete(c); else filters.add(c); scroll.scrollTop = 0; renderAll(); return; }
    if (t.closest('#mg-words')) { words = !words; renderToolbar(); renderRows(); return; }
    if (t.closest('#mg-skip')) { skipToConflict(); return; }
    if (t.closest('#mg-go')) { doMerge(); return; }
    const res = t.closest<HTMLElement>('.res');
    if (res && !moved && !t.closest('textarea')) { const row = res.closest<HTMLElement>('.gr'); if (row) startEdit(row.dataset.id!); }
  });
  root.addEventListener('input', e => { if ((e.target as HTMLElement).id === 'mg-q') { query = (e.target as HTMLInputElement).value.trim().toLowerCase(); refilter(); scroll.scrollTop = 0; renderRows(); } });
  root.addEventListener('focusout', e => { if ((e.target as HTMLElement).matches('textarea.cell-ed') && editing) window.setTimeout(() => { if (editing) endEdit(true); }, 0); });

  function skipToConflict(): void {
    const start = Math.max(0, indexOfId(active) + 1);
    for (let k = 0; k < list.length; k++) {
      const i = (start + k) % list.length, r = list[i]!;
      if (!r.locked && r.kind === 'conflict' && !decisionOf(r)) { active = rowId(r); selected.clear(); selected.add(active); anchor = i; reveal(i); return; }
    }
    toast('Рядків без рішення в цьому списку немає');
  }
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
      if (e.shiftKey) { if (anchor < 0) anchor = i; selectRange(anchor, k); } else { selected.clear(); selected.add(rowId(list[k]!)); anchor = k; }
      active = rowId(list[k]!); reveal(k);
    } else if (e.key === '+' || e.key === '=' || e.key === 'ArrowRight') { eat(); if (active) decideRows(targets(active), 'theirs'); }
    else if (e.key === '-' || e.key === '_' || e.key === 'ArrowLeft') { eat(); if (active) decideRows(targets(active), 'mine'); }
    else if (e.key === 'Enter') { eat(); if (active) startEdit(active); }
    else if (e.key === ' ') { eat(); if (active) { if (selected.has(active)) selected.delete(active); else selected.add(active); anchor = i; renderRows(); renderBand(); } }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { eat(); selectRange(0, list.length - 1); renderRows(); renderBand(); }
  };
  document.addEventListener('keydown', onKey, true);

  // ---------- the merge ----------
  function doMerge(): void {
    const plan = planMerge(s.saved, rows, r => decisionOf(r), Date.now());
    if (!plan.changes.length) { toast(plan.skipped.length ? `Вичитані в «${cur}» рядки не змінюються` : 'Нічого зливати: поставте «+» хоча б в одному рядку'); return; }
    const batch = applyPlan(ctx.commit, plan);
    ctx.persist(); ctx.invalidateTm();
    const n = plan.changes.length;
    close();
    undoToast(ctx, `Злито «${source}» у «${cur}»: ${plural(n, ['рядок', 'рядки', 'рядків'])}${plan.skipped.length ? `. ${planMessage(plan, n).split('. ').slice(1).join('. ')}` : ''}`, batch);
  }

  function close(): void {
    if (!root.isConnected) return;
    stopAuto();
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    window.removeEventListener('resize', onResize);
    root.remove(); cap.remove();
    ide.classList.remove('merging');
    if (brBtn) brBtn.hidden = false;
    onClose();
  }

  renderAll();
  return close;
}
