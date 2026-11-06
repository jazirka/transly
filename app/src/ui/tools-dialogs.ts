import { edit, findReplace, inconsistencies } from '../core';
import type { FileView, RowChange, RowRef } from '../core';
import { dialog } from './settings';
import { $, esc, plural, toast } from './dom';
import type { Ctx } from './state';

/** The views reduced to the given rows. */
function scopedViews(views: FileView[], rows: RowRef[]): FileView[] {
  const by = new Map<string, Set<string>>();
  for (const r of rows) { let k = by.get(r.file); if (!k) by.set(r.file, k = new Set()); k.add(r.key); }
  return views.filter(v => by.has(v.name)).map(v => ({ ...v, units: v.units.filter(u => by.get(v.name)!.has(u.key)) }));
}

/** Find text in the translations of the whole project and replace it, after looking at every change. */
export function openFindReplace(ctx: Ctx, scope?: { title: string; rows: RowRef[] }): void {
  const { s } = ctx;
  // Limited to a set of rows (a group): only their files and rows are searched.
  const views = scope ? scopedViews(s.views, scope.rows) : s.views;
  const dlg = dialog(`<form method="dialog"><h2 id="fr-t">Знайти й замінити в перекладах${scope ? ` ${esc(scope.title)}` : ''}</h2>
    <div class="grid"><label for="fr-find">Знайти</label><input id="fr-find" autocomplete="off"><label for="fr-rep">Замінити на</label><input id="fr-rep" autocomplete="off"></div>
    <label class="achk"><input type="checkbox" id="fr-word"> Лише ціле слово</label>
    <label class="achk"><input type="checkbox" id="fr-case"> Враховувати регістр</label>
    <p class="sum" id="fr-sum" role="status"></p>
    <div class="sp-list" id="fr-list"></div>
    <div class="acts"><button class="btn" value="cancel">Закрити</button><button class="btn p" type="button" id="fr-go">Замінити вибрані</button></div></form>`, 'fr-t');
  const off = new Set<string>();
  let found: ReturnType<typeof findReplace> = [];
  const run = () => {
    found = findReplace(views, s.saved, { find: ($('#fr-find', dlg) as HTMLInputElement).value, replace: ($('#fr-rep', dlg) as HTMLInputElement).value, wholeWord: ($('#fr-word', dlg) as HTMLInputElement).checked, caseSensitive: ($('#fr-case', dlg) as HTMLInputElement).checked });
    $('#fr-sum', dlg).textContent = found.length ? `Знайдено: ${plural(found.length, ['переклад', 'переклади', 'перекладів'])}. Зніміть позначку з тих, які міняти не треба.` : ($('#fr-find', dlg) as HTMLInputElement).value ? 'Нічого не знайдено' : 'Введіть, що шукати';
    $('#fr-list', dlg).innerHTML = found.slice(0, 200).map((m, i) => `<label class="sp-row fr-row"><input type="checkbox" data-i="${i}" ${off.has(m.file + '\u0001' + m.key) ? '' : 'checked'} aria-label="Замінити в ${esc(m.file)}"><div class="sp-b"><span class="hint">${esc(m.file)} · ${esc(m.key.replace(/^.*list/, 'list'))}</span><div class="fr-b">${esc(m.before)}</div><div class="fr-a">${esc(m.after)}</div></div></label>`).join('');
    ($('#fr-go', dlg) as HTMLButtonElement).disabled = !found.length;
  };
  dlg.addEventListener('input', e => { if ((e.target as HTMLElement).closest('#fr-find,#fr-rep')) run(); });
  dlg.addEventListener('change', e => {
    const t = e.target as HTMLInputElement;
    if (t.dataset.i !== undefined) { const m = found[Number(t.dataset.i)]!; const k = m.file + '\u0001' + m.key; t.checked ? off.delete(k) : off.add(k); } else run();
  });
  $('#fr-go', dlg).addEventListener('click', () => {
    const changes: RowChange[] = [];
    for (const m of found) {
      if (off.has(m.file + '\u0001' + m.key)) continue;
      const u = s.views.find(v => v.name === m.file)?.units.find(x => x.key === m.key);
      const ents = ctx.entries(m.file);
      if (!u || !ents[m.key]) continue;
      changes.push({ file: m.file, key: m.key, next: edit(ents[m.key]!, u, m.after, ctx.stage(), Date.now()), text: m.after });
    }
    const n = changes.length;
    if (n) ctx.commit(changes, 'replace');
    ctx.persist(); ctx.invalidateTm(); ctx.render(); dlg.close();
    toast(`Замінено: ${plural(n, ['переклад', 'переклади', 'перекладів'])}`);
  });
  run();
}

/** Originals that are translated in different ways; pick one variant and apply it everywhere. */
export function openConsistency(ctx: Ctx): void {
  const { s } = ctx;
  const groups = inconsistencies(s.views, s.saved);
  const dlg = dialog(`<form method="dialog"><h2 id="cs-t">Узгодженість перекладів</h2>
    <p class="hint">Один і той самий оригінал перекладено по-різному. Іноді це правильно (різний контекст), іноді розбіжність. Оберіть варіант, який має бути всюди.</p>
    <p class="sum" id="cs-sum" role="status"></p><div class="sp-list" id="cs-list"></div>
    <div class="acts"><button class="btn" value="cancel">Закрити</button></div></form>`, 'cs-t');
  const draw = () => {
    $('#cs-sum', dlg).textContent = groups.length ? `Розбіжностей: ${groups.length}` : 'Розбіжностей немає: однакові оригінали перекладено однаково';
    $('#cs-list', dlg).innerHTML = groups.slice(0, 60).map((g, gi) => `<div class="sp-row cs-row"><div class="sp-b"><b>${esc(g.source.slice(0, 120))}</b>${g.variants.map((v, vi) => `<div class="cs-v"><span>${esc(v.target.slice(0, 120))} <span class="hint">× ${v.where.length}</span></span><button class="btn" type="button" data-g="${gi}" data-v="${vi}">Лише цей варіант</button></div>`).join('')}</div></div>`).join('');
  };
  dlg.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-g]');
    if (!b) return;
    const g = groups[Number(b.dataset.g)]!, keep = g.variants[Number(b.dataset.v)]!;
    const changes: RowChange[] = [];
    for (const v of g.variants) {
      if (v === keep) continue;
      for (const w of v.where) {
        const u = s.views.find(x => x.name === w.file)?.units.find(x => x.key === w.key);
        const ents = ctx.entries(w.file);
        if (!u || !ents[w.key]) continue;
        changes.push({ file: w.file, key: w.key, next: edit(ents[w.key]!, u, keep.target, ctx.stage(), Date.now()), text: keep.target });
      }
    }
    const n = changes.length;
    if (n) ctx.commit(changes, 'unify');
    groups.splice(groups.indexOf(g), 1);
    ctx.persist(); ctx.invalidateTm(); ctx.render(); draw();
    toast(`Узгоджено: ${plural(n, ['рядок', 'рядки', 'рядків'])}`);
  });
  draw();
}
