import { MAIN, branchNames, branchOf, createBranch, deleteBranch, nameProblem, renameBranch, rowsIn, switchBranch } from '../core';
import type { SavedProject } from '../core';
import { $, esc, plural } from './dom';
import { dialog } from './settings';

/** The branches of the translation in the top bar: the menu, the questions it asks, and what each one does to the project. */

export const BRANCH_ICON = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><circle cx="4.5" cy="3.5" r="1.7"/><circle cx="4.5" cy="12.5" r="1.7"/><circle cx="11.5" cy="5.5" r="1.7"/><path d="M4.5 5.2v5.6M11.5 7.2c0 2.4-3 2.4-7 4"/></svg>';

/** What the shell gives these dialogs to act on: a new project (the branch was made, switched, renamed or deleted) and the merge screen. */
export interface BranchActions {
  saved(): SavedProject;
  /** The project now stands as `next`: save it, redraw everything, say `note`. */
  apply(next: SavedProject, note: string): void;
  /** Open the screen that merges the branch `source` into the current one. */
  merge(source: string): void;
}

const rowsNote = (p: SavedProject, name: string): string => plural(rowsIn(p, name), ['рядок', 'рядки', 'рядків']);

/** The menu of the branch button. */
export function branchMenuHtml(p: SavedProject): string {
  const cur = branchOf(p), names = branchNames(p), others = names.filter(n => n !== cur);
  const row = (n: string): string => {
    const from = p.branches?.[n]?.from;
    const sub = `${n === MAIN ? 'основна' : from ? `від «${esc(from)}»` : 'гілка'} · ${rowsNote(p, n)}`;
    return `<button role="menuitem" data-br="${esc(n)}" class="${n === cur ? 'on' : ''}" ${n === cur ? 'aria-current="true"' : ''}><span class="cfg-t">${BRANCH_ICON}${esc(n)}${n === cur ? ' <span class="ok">✓</span>' : ''}</span><small>${sub}</small></button>`;
  };
  const deletable = others.filter(n => n !== MAIN);
  return `<div class="pj-h">Гілки перекладу</div>${names.map(row).join('')}<hr>
    <button role="menuitem" data-bra="new"><span class="cfg-t">＋ Нова гілка від «${esc(cur)}»…</span></button>
    <button role="menuitem" data-bra="merge" ${others.length ? '' : 'aria-disabled="true" data-why="Спершу створіть ще одну гілку"'}><span class="cfg-t">⇄ Злити гілку в «${esc(cur)}»…</span></button>
    ${cur === MAIN ? '' : `<button role="menuitem" data-bra="rename"><span class="cfg-t">Перейменувати «${esc(cur)}»…</span></button>`}
    <button role="menuitem" data-bra="delete" ${deletable.length ? '' : 'aria-disabled="true" data-why="Немає гілки, яку можна видалити"'}><span class="cfg-t">Видалити гілку…</span></button>`;
}

/** A click on an item of the menu. */
export function branchMenuClick(a: BranchActions, item: HTMLElement): void {
  const to = item.dataset.br;
  if (to !== undefined) {
    const p = a.saved();
    if (to !== branchOf(p)) a.apply(switchBranch(p, to), `Гілка «${to}»`);
    return;
  }
  const act = item.dataset.bra;
  if (act === 'new') askName(a, 'Нова гілка', 'Створити', '', name => createBranch(a.saved(), name, Date.now()), name => `Створено гілку «${name}» і перемкнуто на неї`);
  else if (act === 'rename') askName(a, `Перейменувати «${branchOf(a.saved())}»`, 'Перейменувати', branchOf(a.saved()), name => renameBranch(a.saved(), branchOf(a.saved()), name), name => `Гілку названо «${name}»`);
  else if (act === 'merge') chooseMerge(a);
  else if (act === 'delete') chooseDelete(a);
}

/** A question with one field: the name of a branch (checked as it is typed). */
export function askName(a: BranchActions, title: string, ok: string, start: string, make: (name: string) => SavedProject, note: (name: string) => string): void {
  const p = a.saved();
  const dlg = dialog(`<form method="dialog"><h2 id="br-t">${esc(title)}</h2>
    ${start ? '' : `<p class="hint">Гілка — окрема копія перекладу «${esc(branchOf(p))}»: у ній можна вичитувати чи пробувати інший стиль, не чіпаючи решти. Потім гілки порівнюють і зливають.</p>`}
    <label class="grid" style="grid-template-columns:1fr"><span>Назва</span><input id="br-name" maxlength="40" autocomplete="off" spellcheck="false" value="${esc(start)}" placeholder="наприклад, вичитка"></label>
    <p class="sum" id="br-err" role="alert" hidden></p>
    <div class="acts"><button class="btn" value="cancel">Скасувати</button><button class="btn p" type="button" id="br-ok">${esc(ok)}</button></div></form>`, 'br-t');
  const input = $('#br-name', dlg) as HTMLInputElement, err = $('#br-err', dlg), go = $('#br-ok', dlg) as HTMLButtonElement;
  const check = (): string | null => {
    const bad = nameProblem(a.saved(), input.value, start || undefined);
    err.hidden = !bad || !input.value.trim(); err.textContent = bad ?? '';
    go.disabled = !!bad;
    return bad;
  };
  const submit = (): void => {
    if (check()) return;
    const name = input.value.trim();
    try { a.apply(make(name), note(name)); dlg.close(); } catch (e) { err.hidden = false; err.textContent = e instanceof Error ? e.message : 'Не вдалося'; }
  };
  input.addEventListener('input', check);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
  go.addEventListener('click', submit);
  check(); input.focus(); input.select();
}

/** Which branch to bring into the current one: straight to the screen when there is only one choice. */
export function chooseMerge(a: BranchActions): void {
  const p = a.saved(), cur = branchOf(p), others = branchNames(p).filter(n => n !== cur);
  if (!others.length) return;
  if (others.length === 1) { a.merge(others[0]!); return; }
  const dlg = dialog(`<form method="dialog"><h2 id="br-t">Злити гілку в «${esc(cur)}»</h2><p class="hint">Яку гілку порівняти з «${esc(cur)}»?</p>
    <div class="sp-list">${others.map(n => `<button class="btn" type="button" data-src="${esc(n)}" style="display:flex;justify-content:space-between;width:100%;margin:0 0 6px"><span>${esc(n)}</span><small>${rowsNote(p, n)}</small></button>`).join('')}</div>
    <div class="acts"><button class="btn" value="cancel">Закрити</button></div></form>`, 'br-t');
  dlg.addEventListener('click', e => { const b = (e.target as HTMLElement).closest<HTMLElement>('[data-src]'); if (b) { dlg.close(); a.merge(b.dataset.src!); } });
}

/** Which branch to delete: the button asks once more before it deletes. */
function chooseDelete(a: BranchActions): void {
  const p = a.saved(), cur = branchOf(p), list = branchNames(p).filter(n => n !== cur && n !== MAIN);
  if (!list.length) return;
  const dlg = dialog(`<form method="dialog"><h2 id="br-t">Видалити гілку</h2><p class="hint">Переклади, які є лише в цій гілці й не злиті, буде втрачено. Гілку, на якій ви зараз, видалити не можна.</p>
    <div class="sp-list">${list.map(n => `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin:0 0 6px"><span>${esc(n)} <small>${rowsNote(p, n)}</small></span><button class="btn" type="button" data-del="${esc(n)}">Видалити</button></div>`).join('')}</div>
    <div class="acts"><button class="btn" value="cancel">Закрити</button></div></form>`, 'br-t');
  dlg.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-del]');
    if (!b) return;
    if (!b.dataset.sure) { b.dataset.sure = '1'; b.textContent = 'Так, видалити'; b.classList.add('p'); return; }
    const name = b.dataset.del!;
    a.apply(deleteBranch(a.saved(), name, Date.now()), `Гілку «${name}» видалено`);
    dlg.close();
  });
}
