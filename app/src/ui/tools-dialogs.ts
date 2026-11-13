import { applyPlan, edit, findReplace, planMessage, planOf } from '../core';
import type { FileView, RowChange, RowRef } from '../core';
import { dialog } from './settings';
import { $, esc, plural, toast } from './dom';
import { undoToast } from './undo-toast';
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
    <label class="achk"><input type="checkbox" id="fr-appr"> Змінити й вичитані (вони стануть чернетками)</label>
    <p class="sum" id="fr-sum" role="status"></p>
    <div class="sp-list" id="fr-list"></div>
    <div class="acts"><button class="btn" value="cancel">Закрити</button><button class="btn p" type="button" id="fr-go">Замінити вибрані</button></div></form>`, 'fr-t');
  const off = new Set<string>();
  let found: ReturnType<typeof findReplace> = [];
  const run = () => {
    found = findReplace(views, s.saved, { find: ($('#fr-find', dlg) as HTMLInputElement).value, replace: ($('#fr-rep', dlg) as HTMLInputElement).value, wholeWord: ($('#fr-word', dlg) as HTMLInputElement).checked, caseSensitive: ($('#fr-case', dlg) as HTMLInputElement).checked });
    const includeAppr = ($('#fr-appr', dlg) as HTMLInputElement).checked;
    const statusOf = (m: { file: string; key: string }): string | undefined => ctx.entries(m.file)[m.key]?.status;
    const apprN = found.filter(m => statusOf(m) === 'appr').length, doneN = found.filter(m => statusOf(m) === 'done').length;
    const apprNote = apprN ? (includeAppr ? ` Вичитаних: ${apprN}, вони стануть чернетками.` : ` Вичитаних пропущено: ${apprN} (позначте «Змінити й вичитані», щоб їх включити).`) : '';
    const doneNote = doneN ? ` Надісланих, що стануть чернетками: ${doneN}.` : '';
    $('#fr-sum', dlg).textContent = found.length ? `Знайдено: ${plural(found.length, ['переклад', 'переклади', 'перекладів'])}. Зніміть позначку з тих, які міняти не треба.${apprNote}${doneNote}` : ($('#fr-find', dlg) as HTMLInputElement).value ? 'Нічого не знайдено' : 'Введіть, що шукати';
    $('#fr-list', dlg).innerHTML = found.slice(0, 200).map((m, i) => { const locked = statusOf(m) === 'appr' && !includeAppr; return `<label class="sp-row fr-row"><input type="checkbox" data-i="${i}" ${locked ? 'disabled' : off.has(m.file + '\u0001' + m.key) ? '' : 'checked'} aria-label="Замінити в ${esc(m.file)}"><div class="sp-b"><span class="hint">${esc(m.file)} · ${esc(m.key.replace(/^.*list/, 'list'))}${locked ? ' · вичитано, пропущено' : ''}</span><div class="fr-b">${esc(m.before)}</div><div class="fr-a">${esc(m.after)}</div></div></label>`; }).join('');
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
    // Proofread rows are left alone unless the translator ticked «Змінити й вичитані»; the message says what was left out and what fell back to a draft.
    const plan = planOf(ctx.entries, changes, 'replace', ($('#fr-appr', dlg) as HTMLInputElement).checked ? 'include' : 'skip');
    const batch = applyPlan(ctx.commit, plan);
    ctx.persist(); ctx.invalidateTm(); ctx.render(); dlg.close();
    undoToast(ctx, planMessage(plan, plan.changes.length), batch);
  });
  run();
}
