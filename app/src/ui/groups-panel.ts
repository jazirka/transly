import { GROUP_COLORS, GroupIndex, createGroup, deleteGroup, findOrphans, groupRows, liveGroups, placeFile, recolorGroup, renameGroup, rowsProgress, submit } from '../core';
import type { Group, RowChange, RowRef } from '../core';
import { $, esc, plural, toast } from './dom';
import { openFindReplace } from './tools-dialogs';
import type { Ctx } from './state';

/**
 * Groups of files: the translator's own folders over the game's files ("the shop", "the prologue"). They stand above
 * the file tree with a colour and the progress of their files; a click on a group opens all its files as one table,
 * and the menu of a group renames and colours it, sends all its rows for review at once, or searches and replaces in
 * it. Files are put into a group from the menu (right click, or the button over the picked files) or by dragging.
 */

export const GROUPS_HTML = `<div class="grp" id="tree-groups">
  <div class="grp-head"><span class="grp-title">Групи файлів</span><span class="hint" id="gr-n"></span><button class="grp-add" id="gr-add" type="button" aria-label="Нова група" title="Нова група">＋</button></div>
  <form class="grp-form" id="gr-form" hidden autocomplete="off"><input id="gr-name" aria-label="Назва нової групи" placeholder="Назва групи" maxlength="60"><button class="btn p" type="submit">Створити</button></form>
  <div id="gr-list"></div>
</div>`;

/** What is put into a group: files of the game. */
export interface PlaceTarget { files: string[]; label: string }

/** What the block needs from the shell. */
export interface GroupsApi {
  /** Show a menu under an element (a second call on the same element closes it). */
  pop(anchor: HTMLElement, html: string): void;
  closePops(): void;
}

const FILES_MIME = 'application/x-transly-files';
let creating = false;
let renaming: string | null = null;
let confirmDel: string | null = null;
let showOrphans = false;
/** Groups unfolded to show their files. */
const unfolded = new Set<string>();
/** What the menu that is open now would put into a group. */
let pending: PlaceTarget | null = null;
let deleteTimer = 0;

export const rowsLabel = (n: number): string => plural(n, ['рядок', 'рядки', 'рядків']);
const filesLabel = (n: number): string => plural(n, ['файл', 'файли', 'файлів']);
const shortName = (f: string): string => f.replace(/\.json$/, '');

/** The group of a file (a member on the file itself; scenes and rows are not put in groups from the screen). */
function groupOfFile(idx: GroupIndex, file: string): string | null { return idx.groupOf(file, '\u0000'); }

/** Files of each group, in the order of the game's files. */
function filesByGroup(ctx: Ctx): Map<string, string[]> {
  const idx = new GroupIndex(ctx.s.saved), out = new Map<string, string[]>();
  if (idx.empty) return out;
  for (const v of ctx.s.views) { const g = groupOfFile(idx, v.name); if (g) { let l = out.get(g); if (!l) out.set(g, l = []); l.push(v.name); } }
  return out;
}

function progressBit(ctx: Ctx, rows: RowRef[]): string {
  const p = rowsProgress(rows, f => ctx.entries(f));
  const pc = p.total ? Math.round((100 * Math.max(p.translated, p.approved)) / p.total) : 0;
  return `<span class="grp-n" title="Перекладено ${p.translated} із ${p.total}, вичитано ${p.approved}">${p.translated}/${p.total}</span><span class="mini" aria-hidden="true"><i class="${p.total && p.approved === p.total ? 'f' : ''}" style="width:${pc}%"></i></span>`;
}

const rowsOf = (ctx: Ctx, files: string[]): RowRef[] => files.flatMap(f => (ctx.s.views.find(v => v.name === f)?.units ?? []).map(u => ({ file: f, key: u.key })));

function groupItem(ctx: Ctx, g: Group, files: string[]): string {
  if (renaming === g.id) return `<form class="grp-ren" data-gid="${esc(g.id)}" autocomplete="off"><input id="gr-ren" value="${esc(g.name)}" aria-label="Нова назва групи" maxlength="60"><button class="btn p" type="submit">Гаразд</button></form>`;
  const open = unfolded.has(g.id);
  const color = esc(g.color ?? '#8b72e8');
  return `<div class="grp-item" data-gid="${esc(g.id)}">
    <button class="grp-fold" type="button" data-gfold="${esc(g.id)}" aria-expanded="${open}" aria-label="${open ? 'Згорнути' : 'Розгорнути'} групу «${esc(g.name)}»">${open ? '▾' : '▸'}</button>
    <button class="grp-open" type="button" data-gopen="${esc(g.id)}" title="Відкрити «${esc(g.name)}» однією таблицею"><span class="grp-dot" style="background:${color}" aria-hidden="true"></span><span class="grp-name">${esc(g.name)}</span><span class="grp-c">${files.length}</span>${progressBit(ctx, rowsOf(ctx, files))}</button>
    <button class="grp-more" type="button" id="gm-${esc(g.id)}" data-gmenu="${esc(g.id)}" aria-haspopup="menu" aria-label="Дії групи «${esc(g.name)}»" title="Дії групи">⋯</button>
  </div>${open ? `<div class="grp-files">${files.length ? files.map(f => `<div class="grp-file"><button class="grp-fopen" type="button" data-gfile="${esc(f)}" title="${esc(f)}"><span class="grp-name">${esc(shortName(f))}${ctx.s.saved.labels?.[f] ? ` <small>${esc(ctx.s.saved.labels[f]!)}</small>` : ''}</span></button><button class="grp-x" type="button" data-gm="unplace" data-file="${esc(f)}" aria-label="Прибрати файл ${esc(f)} з групи" title="Прибрати з групи">✕</button></div>`).join('') : '<div class="hint grp-none">Файлів ще немає: Ctrl+клік по файлах і «У групу»</div>'}</div>` : ''}`;
}

/** Draw the block above the file tree. */
export function renderGroupsBlock(ctx: Ctx): void {
  const { s } = ctx;
  const root = document.getElementById('gr-list');
  if (!root) return;
  const groups = liveGroups(s.saved);
  const by = filesByGroup(ctx);
  $('#gr-n').textContent = groups.length ? String(groups.length) : '';
  ($('#gr-form') as HTMLElement).hidden = !creating;
  const orphans = Object.keys(s.saved.members ?? {}).length ? findOrphans(s.saved, s.views).filter(o => o.kind === 'file') : [];
  let h = '';
  if (!groups.length && !creating) h = '<div class="hint grp-none">Груп ще немає. Ctrl+клік по файлах, потім «У групу».</div>';
  h += groups.map(g => groupItem(ctx, g, by.get(g.id) ?? [])).join('');
  if (orphans.length) {
    h += `<div class="grp-warn" role="status"><b>${plural(orphans.length, ['файл', 'файли', 'файлів'])} груп немає в поточній версії гри.</b> Вони лишаються в проєкті. <button class="lnk" type="button" data-gm="orphans">${showOrphans ? 'Сховати' : 'Показати'}</button>${showOrphans ? `<div class="grp-orph">${orphans.map(o => `<div><span>${esc(groups.find(g => g.id === o.group)?.name ?? '')} · ${esc(o.file)}</span><button class="lnk" type="button" data-gm="drop-orphan" data-ref="${esc(o.ref)}">Прибрати</button></div>`).join('')}</div>` : ''}</div>`;
  }
  root.innerHTML = h;
  if (renaming) ($('#gr-ren') as HTMLInputElement | null)?.focus();
}

/** The menu of the files `target`: the groups to put them into, and a field for a new one. */
export function placeMenuHtml(ctx: Ctx, target: PlaceTarget): string {
  pending = target;
  const idx = new GroupIndex(ctx.s.saved);
  const now = new Set(target.files.map(f => groupOfFile(idx, f) ?? ''));
  const only = now.size === 1 ? [...now][0]! : null;
  return `<div class="group">У групу · ${esc(target.label)}</div>
    ${liveGroups(ctx.s.saved).map(g => `<button data-gm="place" data-gid="${esc(g.id)}" ${only === g.id ? 'class="on"' : ''}><span class="grp-dot" style="background:${esc(g.color ?? '#8b72e8')}" aria-hidden="true"></span>${esc(g.name)}${only === g.id ? ' <span class="hint">тут зараз</span>' : ''}</button>`).join('')}
    ${[...now].some(x => x) ? '<button data-gm="place-none">Прибрати з групи</button>' : ''}
    <div class="msep" role="separator"></div>
    <div class="gm-new"><input id="gm-new-name" placeholder="Нова група" aria-label="Назва нової групи" maxlength="60"><button data-gm="new-place" title="Створити групу й додати туди" aria-label="Створити групу">＋</button></div>`;
}

function groupMenuHtml(ctx: Ctx, g: Group, files: string[]): string {
  const has = files.length > 0;
  return `<div class="group">${esc(g.name)} · ${filesLabel(files.length)}</div>
    <button data-gm="open" data-gid="${esc(g.id)}" ${has ? '' : 'disabled'}>Відкрити однією таблицею</button>
    <button data-gm="send" data-gid="${esc(g.id)}" ${has ? '' : 'disabled'} title="Надіслати всі рядки групи, які можна надіслати, одним пакетом (його можна скасувати в «Активності»)">Надіслати</button>
    <button data-gm="replace" data-gid="${esc(g.id)}" ${has ? '' : 'disabled'}>Знайти й замінити в групі…</button>
    <button data-gm="rename" data-gid="${esc(g.id)}">Перейменувати</button>
    <div class="group">Колір</div>
    <div class="sw-row">${GROUP_COLORS.map(c => `<button class="sw ${g.color === c ? 'on' : ''}" data-gm="color" data-gid="${esc(g.id)}" data-v="${c}" style="background:${c}" aria-label="Колір ${c}" aria-pressed="${g.color === c}"></button>`).join('')}</div>
    <div class="msep" role="separator"></div>
    <button class="danger" data-gm="del" data-gid="${esc(g.id)}">${confirmDel === g.id ? 'Справді видалити? Файли лишаться' : 'Видалити групу'}</button>`;
}

/** Put the files in a group (or out of any), save, and redraw. */
export function applyPlace(ctx: Ctx, target: PlaceTarget, gid: string | null): void {
  const { s } = ctx, now = Date.now();
  for (const f of target.files) placeFile(s.saved, f, gid, now);
  ctx.persist();
  ctx.groupsChanged();
  toast(gid ? `${target.label} → «${s.saved.groups?.[gid]?.name ?? ''}»` : `${target.label}: прибрано з групи`);
}

/** Send every row of the group that can be sent, as one action of the journal. */
function sendGroup(ctx: Ctx, id: string): void {
  const { s } = ctx;
  const rows = groupRows(s.saved, s.views).get(id) ?? [];
  const units = new Map(s.views.map(v => [v.name, new Map(v.units.map(u => [u.key, u]))] as const));
  const changes: RowChange[] = [], skipped = new Map<string, number>();
  for (const r of rows) {
    const u = units.get(r.file)?.get(r.key);
    if (!u) continue;
    const res = submit(ctx.entries(r.file)[r.key], u, ctx.stage(), Date.now(), { blockErrors: s.saved.settings.blockErrors, qa: ctx.qaOpts() });
    if (res.ok) changes.push({ file: r.file, key: r.key, next: res.entry, text: res.entry.target });
    else skipped.set(res.reason.slice(0, 40), (skipped.get(res.reason.slice(0, 40)) ?? 0) + 1);
  }
  if (changes.length) ctx.commit(changes, 'send');
  ctx.persist(); ctx.invalidateTm(); ctx.render();
  const nSkip = [...skipped.values()].reduce((a, b) => a + b, 0);
  toast(`Надіслано: ${changes.length}${nSkip ? `. Пропущено: ${nSkip} (${[...skipped.keys()].slice(0, 2).join('; ')})` : ''}`, { sticky: nSkip > 0 });
}

/** The data to put on a drag of files out of the tree (the shell calls it when a file starts to be dragged). */
export const dragFiles = (files: string[]): string => JSON.stringify({ label: files.length === 1 ? shortName(files[0]!) : filesLabel(files.length), files });
export const FILES_DRAG = FILES_MIME;

function newAndPlace(ctx: Ctx, api: GroupsApi): void {
  const input = document.getElementById('gm-new-name') as HTMLInputElement | null;
  const g = createGroup(ctx.s.saved, input?.value ?? '', Date.now());
  if (!g) { toast('Напишіть назву групи'); return; }
  api.closePops();
  if (pending) applyPlace(ctx, pending, g.id);
  else { ctx.persist(); ctx.groupsChanged(); }
}

export function wireGroups(ctx: Ctx, api: GroupsApi): void {
  $('#gr-form').addEventListener('submit', e => {
    e.preventDefault();
    const g = createGroup(ctx.s.saved, ($('#gr-name') as HTMLInputElement).value, Date.now());
    if (!g) { toast('Напишіть назву групи'); return; }
    creating = false; ($('#gr-name') as HTMLInputElement).value = '';
    ctx.persist(); ctx.groupsChanged();
    toast(`Групу «${g.name}» створено`);
  });
  $('#gr-list').addEventListener('submit', e => {
    const f = (e.target as HTMLElement).closest<HTMLFormElement>('.grp-ren');
    if (!f) return;
    e.preventDefault();
    const r = renameGroup(ctx.s.saved, f.dataset.gid!, ($('#gr-ren') as HTMLInputElement).value, Date.now());
    if (r === 'exists') { toast('Група з такою назвою вже є'); return; }
    if (r === 'empty') { toast('Напишіть назву групи'); return; }
    renaming = null; ctx.persist(); ctx.groupsChanged();
  });
  $('#tree-groups').addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (renaming || creating) { e.preventDefault(); e.stopPropagation(); renaming = null; creating = false; renderGroupsBlock(ctx); }
  });
  // Enter in the field of the menu makes the new group.
  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.target as HTMLElement).id === 'gm-new-name') { e.preventDefault(); newAndPlace(ctx, api); }
  });
  // Drop files onto a group.
  const over = (e: DragEvent): HTMLElement | null => (e.dataTransfer?.types.includes(FILES_MIME) ? (e.target as HTMLElement).closest<HTMLElement>('.grp-item[data-gid]') : null);
  $('#tree-groups').addEventListener('dragover', e => { const it = over(e); if (it) { e.preventDefault(); it.classList.add('drop'); } });
  $('#tree-groups').addEventListener('dragleave', e => { (e.target as HTMLElement).closest('.grp-item')?.classList.remove('drop'); });
  $('#tree-groups').addEventListener('drop', e => {
    const it = over(e);
    document.querySelectorAll('.grp-item.drop').forEach(x => x.classList.remove('drop'));
    if (!it) return;
    e.preventDefault();
    try { const d = JSON.parse(e.dataTransfer!.getData(FILES_MIME)) as PlaceTarget; applyPlace(ctx, d, it.dataset.gid!); } catch { /* not ours */ }
  });
}

/** Clicks in the groups block and in the menus it opens. Returns true when handled. */
export function groupsClick(ctx: Ctx, t: HTMLElement, api: GroupsApi): boolean {
  const gm = t.closest<HTMLElement>('[data-gm]');
  if (gm) {
    const id = gm.dataset.gid ?? '', which = gm.dataset.gm;
    const g = ctx.s.saved.groups?.[id];
    if (which === 'place' && pending) { api.closePops(); applyPlace(ctx, pending, id); return true; }
    if (which === 'place-none' && pending) { api.closePops(); applyPlace(ctx, pending, null); return true; }
    if (which === 'new-place') { newAndPlace(ctx, api); return true; }
    if (which === 'orphans') { showOrphans = !showOrphans; renderGroupsBlock(ctx); return true; }
    if (which === 'unplace') { const f = gm.dataset.file ?? ''; applyPlace(ctx, { files: [f], label: shortName(f) }, null); return true; }
    if (which === 'drop-orphan') {
      const ref = gm.dataset.ref ?? '', m = ctx.s.saved.members?.[ref];
      if (m) { ctx.s.saved.members![ref] = { ...m, del: true, mt: Date.now() }; ctx.persist(); ctx.groupsChanged(); }
      return true;
    }
    if (!g || g.del) return true;
    const files = filesByGroup(ctx).get(id) ?? [];
    if (which === 'open') { api.closePops(); ctx.openRows(g.name, groupRows(ctx.s.saved, ctx.s.views).get(id) ?? [], id); return true; }
    if (which === 'send') { api.closePops(); sendGroup(ctx, id); return true; }
    if (which === 'replace') { api.closePops(); openFindReplace(ctx, { title: `у групі «${g.name}»`, rows: groupRows(ctx.s.saved, ctx.s.views).get(id) ?? [] }); return true; }
    if (which === 'rename') { api.closePops(); renaming = id; renderGroupsBlock(ctx); return true; }
    if (which === 'color') {
      recolorGroup(ctx.s.saved, id, gm.dataset.v ?? '#8b72e8', Date.now()); ctx.persist(); ctx.groupsChanged();
      const fresh = ctx.s.saved.groups?.[id], p = document.getElementById('fpop');
      if (fresh && p) p.innerHTML = groupMenuHtml(ctx, fresh, files);
      return true;
    }
    if (which === 'del') {
      if (confirmDel !== id) {
        confirmDel = id; window.clearTimeout(deleteTimer);
        deleteTimer = window.setTimeout(() => { confirmDel = null; }, 4000);
        const p = document.getElementById('fpop'); if (p) p.innerHTML = groupMenuHtml(ctx, g, files);
        return true;
      }
      window.clearTimeout(deleteTimer); confirmDel = null;
      api.closePops(); deleteGroup(ctx.s.saved, id, Date.now()); ctx.persist(); ctx.groupsChanged();
      toast(`Групу «${g.name}» видалено; її файли лишилися на місці`);
      return true;
    }
    return true;
  }
  if (!t.closest('#tree-groups')) return false;
  if (t.closest('#gr-add')) { creating = !creating; renderGroupsBlock(ctx); if (creating) ($('#gr-name') as HTMLInputElement).focus(); return true; }
  const menu = t.closest<HTMLElement>('[data-gmenu]');
  if (menu) { const g = ctx.s.saved.groups?.[menu.dataset.gmenu!]; if (g) { confirmDel = null; api.pop(menu, groupMenuHtml(ctx, g, filesByGroup(ctx).get(g.id) ?? [])); } return true; }
  const fold = t.closest<HTMLElement>('[data-gfold]');
  if (fold) { const id = fold.dataset.gfold!; unfolded.has(id) ? unfolded.delete(id) : unfolded.add(id); renderGroupsBlock(ctx); return true; }
  const op = t.closest<HTMLElement>('[data-gopen]');
  if (op) {
    const g = ctx.s.saved.groups?.[op.dataset.gopen!];
    if (g && !g.del) {
      const rows = groupRows(ctx.s.saved, ctx.s.views).get(g.id) ?? [];
      if (!rows.length) toast('У цій групі ще немає файлів: Ctrl+клік по файлах і «У групу»');
      else ctx.openRows(g.name, rows, g.id);
    }
    return true;
  }
  const file = t.closest<HTMLElement>('[data-gfile]');
  if (file) { const f = file.dataset.gfile!; ctx.openFile(f); return true; }
  return false;
}
