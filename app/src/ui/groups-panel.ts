import { GROUP_COLORS, GroupIndex, createGroup, deleteGroup, findOrphans, groupByScene, groupBySpeaker, groupRows, liveGroups, placeFile, placeRows, placeScene, recolorGroup, renameGroup, rowsProgress, submit } from '../core';
import type { AutoGroup, Group, RowChange, RowRef } from '../core';
import { $, esc, plural, toast } from './dom';
import { openFindReplace } from './tools-dialogs';
import type { Ctx } from './state';

/**
 * The translator's groups of rows as a section of the left panel: the list with progress, a way to open a group as a
 * table, to rename and colour it, to send all its rows for review at once, and the sets the app makes by itself (by
 * speaker, by scene). Rows, scenes and files are put into a group from menus (`placeMenuHtml`) or by dragging rows here.
 */

const SEARCH = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/></svg>';

export const GROUPS_HTML = `<div class="slist grpanel" id="lp-gr" hidden>
  <div class="ph card-ph" data-card="groups"><span class="grow">Групи</span><span class="ico" data-hide-left="groups" role="button" tabindex="0" aria-label="Сховати панель «Групи»" title="Сховати">—</span></div>
  <div class="fh">
    <div class="fin">${SEARCH}<input class="qin" id="gr-q" placeholder="Пошук групи" aria-label="Пошук групи" autocomplete="off" spellcheck="false"></div>
    <div class="gl-bar"><span class="hint" id="gr-n"></span><button class="btn p" id="gr-new" type="button">＋ Нова група</button></div>
  </div>
  <form class="gl-form" id="gr-form" hidden autocomplete="off">
    <label class="gl-f"><span>Назва групи</span><input id="gr-name" aria-label="Назва групи" maxlength="60"></label>
    <div class="gl-acts"><button class="btn p" type="submit">Створити</button><button class="btn" id="gr-cancel" type="button">Скасувати</button></div>
  </form>
  <div class="sl-body" id="gr-list"></div>
</div>`;

/** What is put into a group: some rows, one scene, or one whole file. */
export type PlaceTarget =
  | { kind: 'rows'; rows: RowRef[]; label: string }
  | { kind: 'scene'; file: string; scene: string; label: string }
  | { kind: 'file'; file: string; label: string }
  | { kind: 'files'; files: string[]; label: string };

/** What the panel needs from the shell. */
export interface GroupsApi {
  /** Show a menu under an element (a second call on the same element closes it). */
  pop(anchor: HTMLElement, html: string): void;
  closePops(): void;
}

let query = '';
let creating = false;
let renaming: string | null = null;
let confirmDel: string | null = null;
let showOrphans = false;
const autoOpen = new Set<string>(['speaker']);
/** What the menu that is open now would put into a group. */
let pending: PlaceTarget | null = null;
let deleteTimer = 0;

const norm = (s: string): string => s.trim().toLowerCase();
const SHOWN = 120;

export const rowsLabel = (n: number): string => plural(n, ['рядок', 'рядки', 'рядків']);

/** Automatic sets are rebuilt only when the game's rows or the speakers change. */
let autoCache: { views: Ctx['s']['views']; speakers: unknown; speaker: AutoGroup[]; scene: AutoGroup[] | null } | null = null;
function autos(ctx: Ctx): NonNullable<typeof autoCache> {
  const { s } = ctx;
  if (!autoCache || autoCache.views !== s.views || autoCache.speakers !== s.saved.speakers) autoCache = { views: s.views, speakers: s.saved.speakers, speaker: groupBySpeaker(s.views, s.saved.speakers), scene: null };
  return autoCache;
}

function progressBit(ctx: Ctx, rows: RowRef[]): string {
  const p = rowsProgress(rows, f => ctx.entries(f));
  const pc = p.total ? Math.round((100 * Math.max(p.translated, p.approved)) / p.total) : 0;
  return `<span class="grp-n" title="Перекладено ${p.translated} із ${p.total}, вичитано ${p.approved}">${p.translated}/${p.total}</span><span class="mini" aria-hidden="true"><i class="${p.total && p.approved === p.total ? 'f' : ''}" style="width:${pc}%"></i></span>`;
}

function groupItem(ctx: Ctx, g: Group, rows: RowRef[]): string {
  if (renaming === g.id) return `<form class="grp-ren" data-gid="${esc(g.id)}" autocomplete="off"><input id="gr-ren" value="${esc(g.name)}" aria-label="Нова назва групи" maxlength="60"><button class="btn p" type="submit">Гаразд</button></form>`;
  return `<div class="grp-item" data-gid="${esc(g.id)}">
    <button class="grp-open" type="button" data-gopen="${esc(g.id)}" title="Відкрити «${esc(g.name)}» як таблицю"><span class="grp-dot" style="background:${esc(g.color ?? '#8b72e8')}" aria-hidden="true"></span><span class="grp-name">${esc(g.name)}</span>${progressBit(ctx, rows)}</button>
    <button class="grp-more" type="button" id="gm-${esc(g.id)}" data-gmenu="${esc(g.id)}" aria-haspopup="menu" aria-label="Дії групи «${esc(g.name)}»" title="Дії групи">⋯</button>
  </div>`;
}

function autoItem(ctx: Ctx, a: AutoGroup): string {
  return `<button class="grp-open grp-auto" type="button" draggable="true" data-gauto="${esc(a.id)}" title="Відкрити як таблицю: ${esc(a.name)}"><span class="grp-name">${esc(a.name)}${a.sub ? ` <small>${esc(a.sub)}</small>` : ''}</span>${progressBit(ctx, a.rows)}</button>`;
}

/** Draw the list. */
export function renderGroupsPanel(ctx: Ctx): void {
  const { s } = ctx;
  const q = norm(query);
  const groups = liveGroups(s.saved);
  const byGroup = groupRows(s.saved, s.views);
  const shown = groups.filter(g => !q || norm(g.name).includes(q));
  const a = autos(ctx);
  const orphans = Object.keys(s.saved.members ?? {}).length ? findOrphans(s.saved, s.views) : [];
  $('#gr-n').textContent = groups.length ? `${plural(groups.length, ['група', 'групи', 'груп'])}${q ? ` · знайдено ${shown.length}` : ''}` : 'Груп ще немає';
  $('#gr-form').hidden = !creating;

  let h = '';
  if (orphans.length) {
    h += `<div class="grp-warn" role="status"><b>${plural(orphans.length, ['елемент', 'елементи', 'елементів'])} груп не знайдено в поточній версії гри.</b> Вони лишаються в проєкті. <button class="lnk" type="button" data-gm="orphans">${showOrphans ? 'Сховати' : 'Показати'}</button>${showOrphans ? `<div class="grp-orph">${orphans.slice(0, 30).map(o => `<div><span>${esc(groups.find(g => g.id === o.group)?.name ?? '')} · ${esc(o.file.replace(/\.json$/, ''))}${o.key ? ` · ${esc(o.key)}` : ''} <small>${o.why === 'gone' ? 'немає в грі' : 'оригінал змінився'}</small></span><button class="lnk" type="button" data-gm="drop-orphan" data-ref="${esc(o.ref)}">Прибрати</button></div>`).join('')}</div>` : ''}</div>`;
  }
  h += `<div class="grp-sec">Мої групи</div>`;
  h += shown.length ? shown.map(g => groupItem(ctx, g, byGroup.get(g.id) ?? [])).join('') : `<div class="empty-state"><b>${groups.length ? 'Нічого не знайдено' : 'Груп ще немає'}</b><span>${groups.length ? 'Спробуйте іншу назву.' : 'Створіть групу кнопкою вище, а потім додайте в неї рядки, сцени або файли з меню «У групу» (правою кнопкою миші) або перетягніть рядки таблиці сюди.'}</span></div>`;

  const sec = (id: 'speaker' | 'scene', title: string, list: AutoGroup[]): string => {
    const open = autoOpen.has(id);
    const f = q ? list.filter(x => norm(x.name).includes(q) || norm(x.sub ?? '').includes(q)) : list;
    return `<button class="grp-sec grp-sec-b" type="button" data-gsec="${id}" aria-expanded="${open}">${open ? '▾' : '▸'} ${title} <span class="hint">${list.length}</span></button>${open ? (f.length ? f.slice(0, SHOWN).map(x => autoItem(ctx, x)).join('') + (f.length > SHOWN ? `<div class="grid-note">Показано ${SHOWN} із ${f.length}. Уточніть пошук.</div>` : '') : '<div class="hint grp-none">Нічого немає</div>') : ''}`;
  };
  h += `<div class="grp-sec-note">Створюються самі, не зберігаються</div>`;
  h += sec('speaker', 'За мовцями', a.speaker);
  if (autoOpen.has('scene') && !a.scene) a.scene = groupByScene(s.views);
  h += sec('scene', 'За сценами', a.scene ?? []);
  $('#gr-list').innerHTML = h;
  if (renaming) ($('#gr-ren') as HTMLInputElement | null)?.focus();
}

/** The menu of the rows, scene or file `target`: the groups to put them into, and a field for a new one. */
export function placeMenuHtml(ctx: Ctx, target: PlaceTarget): string {
  pending = target;
  const { s } = ctx;
  const idx = new GroupIndex(s.saved);
  const now = target.kind === 'rows' ? new Set(target.rows.map(r => idx.groupOf(r.file, r.key) ?? '')) : target.kind === 'scene' ? new Set([idx.groupOf(target.file, target.scene + '[0]') ?? '']) : target.kind === 'files' ? new Set(target.files.map(f => idx.groupOf(f, '\u0000') ?? '')) : new Set([idx.groupOf(target.file, '\u0000') ?? '']);
  const only = now.size === 1 ? [...now][0]! : null;
  const groups = liveGroups(s.saved);
  return `<div class="group">У групу · ${esc(target.label)}</div>
    ${groups.map(g => `<button data-gm="place" data-gid="${esc(g.id)}" ${only === g.id ? 'class="on"' : ''}><span class="grp-dot" style="background:${esc(g.color ?? '#8b72e8')}" aria-hidden="true"></span>${esc(g.name)}${only === g.id ? ' <span class="hint">тут зараз</span>' : ''}</button>`).join('')}
    ${[...now].some(x => x) ? '<button data-gm="place-none">Прибрати з групи</button>' : ''}
    <div class="msep" role="separator"></div>
    <div class="gm-new"><input id="gm-new-name" placeholder="Нова група" aria-label="Назва нової групи" maxlength="60"><button data-gm="new-place" title="Створити групу й додати туди">＋</button></div>`;
}

function groupMenuHtml(ctx: Ctx, g: Group): string {
  const rows = groupRows(ctx.s.saved, ctx.s.views).get(g.id) ?? [];
  return `<div class="group">${esc(g.name)} · ${rowsLabel(rows.length)}</div>
    <button data-gm="open" data-gid="${esc(g.id)}" ${rows.length ? '' : 'disabled'}>Відкрити як таблицю</button>
    <button data-gm="send" data-gid="${esc(g.id)}" ${rows.length ? '' : 'disabled'} title="Надіслати всі рядки групи, які можна надіслати, одним пакетом (його можна скасувати в «Активності»)">${ctx.stage() === 'review' ? 'Затвердити всі рядки групи' : 'Надіслати на вичитування'}</button>
    <button data-gm="replace" data-gid="${esc(g.id)}" ${rows.length ? '' : 'disabled'}>Знайти й замінити в групі…</button>
    <button data-gm="rename" data-gid="${esc(g.id)}">Перейменувати</button>
    <div class="group">Колір</div>
    <div class="sw-row">${GROUP_COLORS.map(c => `<button class="sw ${g.color === c ? 'on' : ''}" data-gm="color" data-gid="${esc(g.id)}" data-v="${c}" style="background:${c}" aria-label="Колір ${c}" aria-pressed="${g.color === c}"></button>`).join('')}</div>
    <div class="msep" role="separator"></div>
    <button class="danger" data-gm="del" data-gid="${esc(g.id)}">${confirmDel === g.id ? 'Справді видалити? Рядки лишаться' : 'Видалити групу'}</button>`;
}

/** Put the target in a group (or out of any), save, and redraw. */
export function applyPlace(ctx: Ctx, target: PlaceTarget, gid: string | null): void {
  const { s } = ctx, now = Date.now();
  let n = 0;
  if (target.kind === 'rows') n = placeRows(s.saved, s.views, target.rows, gid, now);
  else if (target.kind === 'scene') { placeScene(s.saved, target.file, target.scene, gid, now); n = 1; }
  else if (target.kind === 'files') { for (const f of target.files) placeFile(s.saved, f, gid, now); n = target.files.length; }
  else { placeFile(s.saved, target.file, gid, now); n = 1; }
  const name = gid ? s.saved.groups?.[gid]?.name ?? '' : '';
  ctx.persist();
  ctx.groupsChanged();
  toast(!n ? 'Нічого не змінилося: усе вже там' : gid ? `${target.label} → «${name}»` : `${target.label}: прибрано з групи`);
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
  if (changes.length) ctx.commit(changes, ctx.stage() === 'translate' ? 'send' : 'approve');
  ctx.persist(); ctx.invalidateTm(); ctx.render();
  const nSkip = [...skipped.values()].reduce((a, b) => a + b, 0);
  toast(`${ctx.stage() === 'translate' ? 'Надіслано на вичитування' : 'Затверджено'}: ${changes.length}${nSkip ? `. Пропущено: ${nSkip} (${[...skipped.keys()].slice(0, 2).join('; ')})` : ''}`, { sticky: nSkip > 0 });
}

const MIME = 'application/x-transly-rows';

export function wireGroups(ctx: Ctx, api: GroupsApi): void {
  $('#gr-q').addEventListener('input', () => { query = ($('#gr-q') as HTMLInputElement).value; renderGroupsPanel(ctx); });
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
  $('#lp-gr').addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (renaming || creating) { e.preventDefault(); e.stopPropagation(); renaming = null; creating = false; renderGroupsPanel(ctx); }
  });
  // Enter in the field of the menu makes the new group.
  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.target as HTMLElement).id === 'gm-new-name') { e.preventDefault(); newAndPlace(ctx, api); }
  });

  // Drag rows (or an automatic set) onto a group of the list.
  document.addEventListener('dragstart', e => {
    const t = e.target as HTMLElement;
    const auto = t.closest?.('[data-gauto]') as HTMLElement | null | undefined;
    if (auto && e.dataTransfer) {
      const a = [...(autoCache?.speaker ?? []), ...(autoCache?.scene ?? [])].find(x => x.id === auto.dataset.gauto);
      if (a) { e.dataTransfer.setData(MIME, JSON.stringify({ label: a.name, rows: a.rows })); e.dataTransfer.effectAllowed = 'copy'; }
    }
  });
  const over = (e: DragEvent): HTMLElement | null => {
    if (!e.dataTransfer?.types.includes(MIME)) return null;
    return (e.target as HTMLElement).closest<HTMLElement>('.grp-item[data-gid]');
  };
  $('#gr-list').addEventListener('dragover', e => { const it = over(e); if (it) { e.preventDefault(); it.classList.add('drop'); } });
  $('#gr-list').addEventListener('dragleave', e => { (e.target as HTMLElement).closest('.grp-item')?.classList.remove('drop'); });
  $('#gr-list').addEventListener('drop', e => {
    const it = over(e);
    document.querySelectorAll('.grp-item.drop').forEach(x => x.classList.remove('drop'));
    if (!it) return;
    e.preventDefault();
    try {
      const d = JSON.parse(e.dataTransfer!.getData(MIME)) as { label: string; rows: RowRef[] };
      applyPlace(ctx, { kind: 'rows', rows: d.rows, label: d.label || rowsLabel(d.rows.length) }, it.dataset.gid!);
    } catch { /* not ours */ }
  });
}

/** Rows being dragged: the data to put on the drag (called by the shell when a row of the table or list starts to be dragged). */
export const dragPayload = (rows: RowRef[]): string => JSON.stringify({ label: rowsLabel(rows.length), rows });
export const ROWS_MIME = MIME;

function newAndPlace(ctx: Ctx, api: GroupsApi): void {
  const input = document.getElementById('gm-new-name') as HTMLInputElement | null;
  const g = createGroup(ctx.s.saved, input?.value ?? '', Date.now());
  if (!g) { toast('Напишіть назву групи'); return; }
  api.closePops();
  if (pending) applyPlace(ctx, pending, g.id);
  else { ctx.persist(); ctx.groupsChanged(); }
}

/** Clicks in the groups section and in the menus it opens. Returns true when handled. */
export function groupsClick(ctx: Ctx, t: HTMLElement, api: GroupsApi): boolean {
  const gm = t.closest<HTMLElement>('[data-gm]');
  if (gm) {
    const id = gm.dataset.gid ?? '', which = gm.dataset.gm;
    const g = ctx.s.saved.groups?.[id];
    if (which === 'place' && pending) { api.closePops(); applyPlace(ctx, pending, id); return true; }
    if (which === 'place-none' && pending) { api.closePops(); applyPlace(ctx, pending, null); return true; }
    if (which === 'new-place') { newAndPlace(ctx, api); return true; }
    if (which === 'orphans') { showOrphans = !showOrphans; renderGroupsPanel(ctx); return true; }
    if (which === 'drop-orphan') {
      const ref = gm.dataset.ref ?? '', m = ctx.s.saved.members?.[ref];
      if (m) { ctx.s.saved.members![ref] = { ...m, del: true, mt: Date.now() }; ctx.persist(); ctx.groupsChanged(); }
      return true;
    }
    if (!g || g.del) return true;
    if (which === 'open') { api.closePops(); ctx.openRows(g.name, groupRows(ctx.s.saved, ctx.s.views).get(id) ?? [], id); return true; }
    if (which === 'send') { api.closePops(); sendGroup(ctx, id); return true; }
    if (which === 'replace') {
      api.closePops();
      openFindReplace(ctx, { title: `у групі «${g.name}»`, rows: groupRows(ctx.s.saved, ctx.s.views).get(id) ?? [] });
      return true;
    }
    if (which === 'rename') { api.closePops(); renaming = id; renderGroupsPanel(ctx); return true; }
    if (which === 'color') { recolorGroup(ctx.s.saved, id, gm.dataset.v ?? '#8b72e8', Date.now()); ctx.persist(); ctx.groupsChanged(); const fresh = ctx.s.saved.groups?.[id]; if (fresh) { const p = document.getElementById('fpop'); if (p) p.innerHTML = groupMenuHtml(ctx, fresh); } return true; }
    if (which === 'del') {
      if (confirmDel !== id) {
        confirmDel = id; window.clearTimeout(deleteTimer);
        deleteTimer = window.setTimeout(() => { confirmDel = null; }, 4000);
        const p = document.getElementById('fpop'); if (p) p.innerHTML = groupMenuHtml(ctx, g);
        return true;
      }
      window.clearTimeout(deleteTimer); confirmDel = null;
      api.closePops(); deleteGroup(ctx.s.saved, id, Date.now()); ctx.persist(); ctx.groupsChanged();
      toast(`Групу «${g.name}» видалено; її рядки лишилися на місці`);
      return true;
    }
    return true;
  }
  if (!t.closest('#lp-gr')) return false;
  if (t.closest('#gr-new')) { creating = true; renderGroupsPanel(ctx); ($('#gr-name') as HTMLInputElement).focus(); return true; }
  if (t.closest('#gr-cancel')) { creating = false; renderGroupsPanel(ctx); return true; }
  const menu = t.closest<HTMLElement>('[data-gmenu]');
  if (menu) { const g = ctx.s.saved.groups?.[menu.dataset.gmenu!]; if (g) { confirmDel = null; api.pop(menu, groupMenuHtml(ctx, g)); } return true; }
  const sec = t.closest<HTMLElement>('[data-gsec]');
  if (sec) { const id = sec.dataset.gsec!; autoOpen.has(id) ? autoOpen.delete(id) : autoOpen.add(id); renderGroupsPanel(ctx); return true; }
  const op = t.closest<HTMLElement>('[data-gopen]');
  if (op) {
    const g = ctx.s.saved.groups?.[op.dataset.gopen!];
    if (g && !g.del) {
      const rows = groupRows(ctx.s.saved, ctx.s.views).get(g.id) ?? [];
      if (!rows.length) toast('У цій групі ще немає рядків: додайте їх із меню «У групу»');
      else ctx.openRows(g.name, rows, g.id);
    }
    return true;
  }
  const au = t.closest<HTMLElement>('[data-gauto]');
  if (au) {
    const a = [...(autoCache?.speaker ?? []), ...(autoCache?.scene ?? [])].find(x => x.id === au.dataset.gauto);
    if (a) ctx.openRows(a.sub ? `${a.name} · ${a.sub}` : a.name, a.rows);
    return true;
  }
  return false;
}
