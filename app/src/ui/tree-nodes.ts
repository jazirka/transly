import { pct, statsOf, uiLocale } from '../core';
import type { FileView } from '../core';
import { esc } from './dom';
import type { Ctx } from './state';

/**
 * The tree of the files, as the project draws it in the left panel (the folders with their chevrons, the files with the badge of their kind,
 * the percent and its bar), for the screens that take the place of the work area (the merge and the autofill): there the tree lists only
 * the files that have something to settle, with how many rows that is, and a click on a file filters the table to it.
 */

export interface TreeNode { t: 'd' | 'f'; d: number; name: string; label: string }

export const baseName = (name: string): string => (name.split('/').pop() ?? name).replace(/\.json$/i, '');

export function fileIcon(name: string): [string, string] {
  if (/^Map\d+\.json$/.test(name)) return ['map', 'MAP'];
  if (name.endsWith('.json')) return ['json', '{}'];
  return ['gl', 'Aa'];
}

/** The folders and files of the project in the order the left panel has them. */
export function treeNodes(views: { name: string }[]): TreeNode[] {
  const out: TreeNode[] = [];
  const rpg = views.filter(v => !v.name.includes('/'));
  const others = views.filter(v => v.name.includes('/'));
  if (rpg.length) {
    out.push({ t: 'd', d: 0, name: 'data', label: 'data' });
    for (const v of rpg.filter(x => !/^Map\d+\.json$/.test(x.name))) out.push({ t: 'f', d: 1, name: v.name, label: baseName(v.name) });
    const maps = rpg.filter(x => /^Map\d+\.json$/.test(x.name));
    if (maps.length) { out.push({ t: 'd', d: 1, name: 'data/maps', label: 'maps' }); for (const v of maps) out.push({ t: 'f', d: 2, name: v.name, label: baseName(v.name) }); }
  }
  let prev: string[] = [];
  for (const v of others) {
    const parts = v.name.split('/');
    const dirs = parts.slice(0, -1);
    let i = 0;
    while (i < dirs.length && prev[i] === dirs[i]) i++;
    for (let k = i; k < dirs.length; k++) out.push({ t: 'd', d: k, name: dirs.slice(0, k + 1).join('/'), label: dirs[k]! });
    out.push({ t: 'f', d: dirs.length, name: v.name, label: baseName(v.name) });
    prev = dirs;
  }
  return out;
}

const CHEV = '<span class="chev"><svg viewBox="0 0 8 8" aria-hidden="true"><path d="M1.5 2.5L4 5.2l2.5-2.7"/></svg></span>';

/**
 * The markup of the tree for a screen. `counts` is how many rows each file has to settle (files not in it are left out, and so are the
 * folders with none); `flags` are the files that need a look (a dot); `file` is the one the table is filtered to; `collapsed` the folders closed.
 */
export function screenTreeHtml(ctx: Ctx, counts: Map<string, number>, o: { file: string | null; collapsed: Set<string>; flags?: Set<string> }): string {
  const views = ctx.s.views.filter(v => counts.has(v.name));
  const nodes = treeNodes(views);
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  const all = `<div class="node ${o.file === null ? 'cur' : ''}" style="--d:0" role="treeitem" tabindex="0" data-f="" aria-selected="${o.file === null}"><span class="ic all"><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M3 4.5h10M3 8h10M3 11.5h10"/></svg></span><span class="nm">Усі файли</span><span class="mem" title="Рядків: ${total}">${total.toLocaleString(uiLocale())}</span></div>`;
  let skip: number | null = null;
  const body = nodes.map(n => {
    if (skip !== null && n.d > skip) return '';
    skip = null;
    if (n.t === 'd') {
      const c = o.collapsed.has(n.name);
      if (c) skip = n.d;
      return `<div class="node dir" style="--d:${n.d + 0}" data-dir="${esc(n.name)}" role="treeitem" tabindex="-1" aria-level="${n.d + 1}" aria-expanded="${!c}">${CHEV}<span class="nm">${esc(n.label)}</span></div>`;
    }
    const v = views.find(x => x.name === n.name) as FileView;
    const st = statsOf(v.units, ctx.s.saved.files[v.name] ?? {});
    const p = pct(st.translated, st.total), cur = n.name === o.file, [ic, lab] = fileIcon(n.name);
    return `<div class="node ${cur ? 'cur' : ''}" style="--d:${n.d}" data-f="${esc(n.name)}" role="treeitem" tabindex="-1" aria-level="${n.d + 1}" aria-selected="${cur}" title="Перекладено ${p}%"><span class="ic ${ic}">${lab}</span><span class="nm">${v.label ? `${esc(v.label)}<span class="lc">${esc(n.label)}</span>` : esc(n.label)}${o.flags?.has(n.name) ? '<i class="rd"></i>' : ''}</span><span class="mem" title="Рядків: ${counts.get(n.name)}">${counts.get(n.name)!.toLocaleString(uiLocale())}</span><span class="pc">${p}%</span><span class="mini"><i style="width:${p}%"></i></span></div>`;
  }).join('');
  return all + body;
}
