import { applyGlossaryImport, applyPlan, edit, glossaryTerms, planGlossaryImport, planMessage, planOf, planSteps, plugins, pluginCommands, t } from '../core';
import type { PluginCommand, PluginRecord, RowChange } from '../core';
import { $, esc, plural, toast } from './dom';
import { openLink } from './desktop';
import { miniMarkdown } from './minimd';
import { dialog } from './settings';
import type { Ctx } from './state';
import { undoToast } from './undo-toast';

/**
 * What the commands, the help and the glossaries that plugins bring do in the application. A plugin only describes them as data: the steps of a
 * replacement are plain text, a link is an https address, a glossary is a list of terms. Whatever changes the translation first shows what it would
 * change and can be undone like every other mass action; the translator's proofread rows are left alone unless asked.
 */

/** The commands of the plugins that work, for the menu. */
export const extCommands = (): PluginCommand[] => pluginCommands(plugins.list());

export function runExtCommand(ctx: Ctx, cmd: PluginCommand): void {
  if (cmd.action === 'link' && cmd.url) { openLink(cmd.url); return; }
  if (cmd.action === 'help' && cmd.help) {
    const topic = plugins.helpById(cmd.help);
    if (!topic) { toast(t('Довідки немає')); return; }
    const rec = plugins.get(topic.plugin);
    const tr = (s: string): string => t(s, undefined, rec?.builtin ? 'core' : `plugin:${topic.plugin}`);
    const dlg = dialog(`<form method="dialog"><h2 id="xh-t">${esc(tr(topic.title))}</h2><div class="ex-md">${miniMarkdown(tr(topic.body))}</div><div class="acts"><button class="btn p" value="ok">${esc(t('Зрозуміло'))}</button></div></form>`, 'xh-t');
    void dlg;
    return;
  }
  if (cmd.action === 'replace' && cmd.steps) openReplacePreview(ctx, cmd);
}

function openReplacePreview(ctx: Ctx, cmd: PluginCommand): void {
  const { s } = ctx;
  const found = planSteps(s.views, s.saved, cmd.steps!);
  const off = new Set<string>();
  const dlg = dialog(`<form method="dialog"><h2 id="xr-t">${esc(cmd.title)}</h2>
    ${cmd.description ? `<p class="hint">${esc(cmd.description)}</p>` : ''}
    <p class="hint">${esc(t('Розширення «{name}»: кроки замін описані текстом, без коду.', { name: cmd.pluginName }))}</p>
    <label class="achk"><input type="checkbox" id="xr-appr"> ${esc(t('Змінити й вичитані (вони стануть чернетками)'))}</label>
    <p class="sum" id="xr-sum" role="status"></p><div class="sp-list" id="xr-list"></div>
    <div class="acts"><button class="btn" value="cancel">${esc(t('Закрити'))}</button><button class="btn p" type="button" id="xr-go">${esc(t('Замінити вибрані'))}</button></div></form>`, 'xr-t');
  const render = (): void => {
    const includeAppr = ($('#xr-appr', dlg) as HTMLInputElement).checked;
    const statusOf = (m: { file: string; key: string }): string | undefined => ctx.entries(m.file)[m.key]?.status;
    const apprN = found.filter(m => statusOf(m) === 'appr').length;
    $('#xr-sum', dlg).textContent = found.length
      ? `${t('Знайдено: {n}. Зніміть позначку з тих, які міняти не треба.', { n: plural(found.length, ['переклад', 'переклади', 'перекладів']) })}${apprN ? (includeAppr ? ' ' + t('Вичитаних: {n}, вони стануть чернетками.', { n: apprN }) : ' ' + t('Вичитаних пропущено: {n}.', { n: apprN })) : ''}`
      : t('Нічого не знайдено');
    $('#xr-list', dlg).innerHTML = found.slice(0, 200).map((m, i) => { const locked = statusOf(m) === 'appr' && !includeAppr; return `<label class="sp-row fr-row"><input type="checkbox" data-i="${i}" ${locked ? 'disabled' : off.has(m.file + '\u0001' + m.key) ? '' : 'checked'}><div class="sp-b"><span class="hint">${esc(m.file)}${locked ? ' · ' + esc(t('вичитано, пропущено')) : ''}</span><div class="fr-b">${esc(m.before)}</div><div class="fr-a">${esc(m.after)}</div></div></label>`; }).join('');
    ($('#xr-go', dlg) as HTMLButtonElement).disabled = !found.length;
  };
  render();
  dlg.addEventListener('change', e => {
    const x = e.target as HTMLInputElement;
    if (x.dataset.i !== undefined) { const m = found[Number(x.dataset.i)]!; const k = m.file + '\u0001' + m.key; x.checked ? off.delete(k) : off.add(k); } else render();
  });
  $('#xr-go', dlg).addEventListener('click', () => {
    const changes: RowChange[] = [];
    for (const m of found) {
      if (off.has(m.file + '\u0001' + m.key)) continue;
      const u = s.views.find(v => v.name === m.file)?.units.find(x => x.key === m.key);
      const ents = ctx.entries(m.file);
      if (!u || !ents[m.key]) continue;
      changes.push({ file: m.file, key: m.key, next: edit(ents[m.key]!, u, m.after, ctx.stage(), Date.now()), text: m.after });
    }
    const plan = planOf(ctx.entries, changes, 'replace', ($('#xr-appr', dlg) as HTMLInputElement).checked ? 'include' : 'skip');
    const batch = applyPlan(ctx.commit, plan);
    ctx.persist(); ctx.invalidateTm(); ctx.render(); dlg.close();
    undoToast(ctx, planMessage(plan, plan.changes.length), batch);
  });
}

/** Look at a glossary of a plugin before it is added: what is new, what the project already has the same way, and what it translates differently (kept). */
export function openGlossaryImport(ctx: Ctx, rec: PluginRecord, glossaryId: string, then?: () => void): void {
  const g = rec.manifest.contributes?.glossaries?.find(x => x.id === glossaryId);
  if (!g) return;
  const tr = (s: string): string => t(s, undefined, rec.builtin ? 'core' : `plugin:${rec.manifest.id}`);
  const { terms, skipped } = glossaryTerms(rec, g);
  const plan = planGlossaryImport(ctx.s.saved, terms);
  const dlg = dialog(`<form method="dialog"><h2 id="xg-t">${esc(tr(g.title))}</h2>
    ${g.description ? `<p class="hint">${esc(tr(g.description))}</p>` : ''}
    <p class="sum" role="status">${esc(t('Нових термінів: {a}. Уже є так само: {b}. У вашому глосарії інакше (лишаються як є): {c}.', { a: plan.add.length, b: plan.same.length, c: plan.differ.length }))}${skipped ? ' ' + esc(t('Пропущено нечитабельних: {n}.', { n: skipped })) : ''}</p>
    <div class="sp-list">${plan.add.slice(0, 100).map(x => `<div class="sp-row"><div class="sp-b"><b>${esc(x.en)}</b> → ${esc(x.uk)}${x.alt?.length ? ` <span class="hint">(${esc(x.alt.join('; '))})</span>` : ''}</div></div>`).join('')}${plan.add.length > 100 ? `<p class="hint">${esc(t('… і ще {n}', { n: plan.add.length - 100 }))}</p>` : ''}</div>
    <div class="acts"><button class="btn" value="cancel">${esc(t('Скасувати'))}</button><button class="btn p" type="button" id="xg-go" ${plan.add.length ? '' : 'disabled'}>${esc(t('Додати до проєкту'))}</button></div></form>`, 'xg-t');
  $('#xg-go', dlg).addEventListener('click', () => {
    const now = Date.now();
    const n = applyGlossaryImport(ctx.s.saved, plan, now);
    ctx.persist(); ctx.invalidateTm(); ctx.render(); dlg.close();
    toast(t('Додано термінів: {n}', { n }));
    then?.();
  });
}
