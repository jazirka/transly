import { QA_RULES, APOSTROPHES, applyPlan, fixRule, keepFromText, planOf, keepToText, qaOf, ruleStats, withRuleLevel } from '../core';
import type { QaSettings, RuleSeverity, SavedProject } from '../core';
import { $, esc, plural } from './dom';
import { dialog } from './settings';
import { undoBatch } from './undo-toast';
import type { Ctx } from './state';

const LEVELS: [RuleSeverity, string][] = [['off', 'Вимкнено'], ['warn', 'Порада'], ['bad', 'Помилка']];
const APOS_LABEL: Record<string, string> = { any: 'Приймати всі правильні (’ ʼ \')', '’': 'Лише ’ (U+2019)', 'ʼ': 'Лише ʼ (U+02BC)', "'": "Лише ' з клавіатури" };

/**
 * The tool «Правила QA»: the rules about the form of a translation (letters of the wrong alphabet, hidden signs, spaces,
 * the apostrophe, damaged control codes). Each rule is off, an advice (it shows and can be mended with one click, and
 * blocks nothing) or an error (the row cannot be sent or built until it is mended). The choice is kept in the project
 * and applied at once; for the open file the dialog shows how many rows each rule has found and mends them in one
 * action that can be taken back.
 */
export function openQaRules(ctx: Ctx): void {
  const { s } = ctx;
  const st = s.saved.settings;
  const rules = qaOf(st);
  const dlg = dialog(`<form method="dialog" class="qr"><h2 id="qr-t">Правила QA</h2>
    <p class="hint">Правила дивляться на форму тексту: літери не з того алфавіту, невидимі символи, пробіли, апостроф, пошкоджені керівні коди. «Порада» нічого не блокує, а «Помилка» не дає надіслати й зібрати рядок, доки його не виправлено. Зміни застосовуються одразу.</p>
    <p class="sum" id="qr-file" role="status"></p>
    <p class="sum qr-msg" id="qr-msg" role="status" aria-live="polite" hidden></p>
    <div id="qr-list" class="qr-list"></div>
    <fieldset class="wp-fs"><legend>Латинські слова, які можна лишати в українському тексті</legend>
      <label for="qr-keep" class="hint">По одному слову на рядок. Слова з оригіналу, HP, MP, NPC, одиниці виміру й римські цифри дозволені завжди.</label>
      <textarea id="qr-keep" rows="3" spellcheck="false">${esc(keepToText(st.qa?.keep))}</textarea></fieldset>
    <div class="grid"><label for="qr-apos">Апостроф у проєкті</label><select id="qr-apos">${APOSTROPHES.map(a => `<option value="${esc(a)}" ${rules.apostrophe === a ? 'selected' : ''}>${esc(APOS_LABEL[a] ?? a)}</option>`).join('')}</select></div>
    <div class="acts"><button class="btn" value="cancel">Закрити</button></div></form>`, 'qr-t');

  /** The open file (or group) with its rows, as a project that holds only it, so the same code mends either. */
  const scope = (): { views: NonNullable<ReturnType<Ctx['view']>>[]; saved: SavedProject } | null => {
    const v = ctx.view();
    return v ? { views: [v], saved: { ...s.saved, files: { [v.name]: ctx.entries(v.name) } } } : null;
  };
  const write = (q: QaSettings): void => {
    const keep = q.keep?.length ? q.keep : undefined, apos = q.apostrophe && q.apostrophe !== 'any' ? q.apostrophe : undefined;
    const out: QaSettings = { ...(q.rules ? { rules: q.rules } : {}), ...(keep ? { keep } : {}), ...(apos ? { apostrophe: apos } : {}) };
    if (Object.keys(out).length) st.qa = out; else delete st.qa;
    s.saved.settingsAt = Date.now();
    ctx.persist();
    ctx.render();
    draw();
  };
  let lastBatch: string | undefined;
  const say = (text: string, undo?: string): void => {
    const box = $('#qr-msg', dlg);
    // the result is at the top of the dialog and stays in view (it used to sit below a long list, out of sight of the button that was pressed)
    box.hidden = !text;
    box.innerHTML = esc(text) + (undo ? ` <button type="button" class="btn" id="qr-undo">Скасувати</button>` : '');
    lastBatch = undo;
  };

  function draw(): void {
    const q = qaOf(s.saved.settings), sc = scope();
    const stats = sc ? new Map(ruleStats(sc.views[0]!, sc.saved, ctx.qaOpts()).map(r => [r.id, r])) : new Map();
    $('#qr-file', dlg).textContent = sc ? `Лічильники: у файлі «${ctx.fileTitle(sc.views[0]!.name)}».` : 'Відкрийте файл, щоб побачити, скільки рядків знайшло кожне правило.';
    $('#qr-list', dlg).innerHTML = QA_RULES.map(r => {
      const lvl = q.sev[r.id] ?? r.def, stat = stats.get(r.id);
      const n = stat?.rows ?? 0, fix = stat?.fixable ?? 0;
      return `<div class="qr-row" data-rule="${esc(r.id)}"><div class="qr-main"><b id="qr-n-${esc(r.id)}">${esc(r.title)}</b><small class="hint">${esc(r.explain)}</small></div>
        <div class="qr-side"><select data-lvl="${esc(r.id)}" aria-labelledby="qr-n-${esc(r.id)}">${LEVELS.map(([v, l]) => `<option value="${v}" ${v === lvl ? 'selected' : ''}>${l}${v === r.def ? ' (типово)' : ''}</option>`).join('')}</select>
        <span class="qr-cnt" title="Рядків у відкритому файлі, де правило щось знайшло">${sc ? (n ? plural(n, ['рядок', 'рядки', 'рядків']) : 'немає') : '—'}</span>
        ${fix ? `<button type="button" class="btn" data-fixall="${esc(r.id)}" title="Виправити всі ${fix} знайдених місць одним кроком; це можна скасувати">Виправити в файлі (${fix})</button>` : ''}</div></div>`;
    }).join('');
  }

  dlg.addEventListener('change', e => {
    const t = e.target as HTMLElement;
    if (t instanceof HTMLSelectElement && t.dataset.lvl) { write(withRuleLevel(st.qa, t.dataset.lvl, t.value as RuleSeverity)); return; }
    if (t.id === 'qr-apos') write({ ...(st.qa ?? {}), apostrophe: (t as HTMLSelectElement).value as QaSettings['apostrophe'] });
    if (t.id === 'qr-keep') write({ ...(st.qa ?? {}), keep: keepFromText((t as HTMLTextAreaElement).value) });
  });
  dlg.addEventListener('click', e => {
    const t = e.target as HTMLElement;
    if (t.closest('#qr-undo') && lastBatch) {
      const r = undoBatch(ctx, lastBatch);
      say(r.done ? `Скасовано: ${plural(r.done, ['рядок', 'рядки', 'рядків'])}.` : 'Нічого скасовувати: рядки вже змінені.');
      draw();
      return;
    }
    const b = t.closest<HTMLElement>('[data-fixall]');
    if (!b) return;
    e.preventDefault();
    const sc = scope();
    const rule = QA_RULES.find(r => r.id === b.dataset.fixall);
    if (!sc || !rule) return;
    const changes = fixRule(sc.views, sc.saved, rule.id, ctx.qaOpts(), Date.now());
    if (!changes.length) { say('Нічого виправляти: правило не має готового виправлення.'); return; }
    // Proofread rows are not rewritten by a bulk tool: the message says how many were left alone.
    const plan = planOf(ctx.entries, changes, 'fix');
    const batch = applyPlan(ctx.commit, plan);
    ctx.persist(); ctx.invalidateTm(); ctx.render();
    const left = plan.skipped.length ? ` Вичитаних пропущено: ${plan.skipped.length}.` : '';
    say(`Виправлено «${rule.title}»: ${plural(plan.changes.length, ['рядок', 'рядки', 'рядків'])}.${left}`, batch);
    draw();
  });
  draw();
}
