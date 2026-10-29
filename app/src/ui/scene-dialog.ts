import { describePage, displayLength, jumpTarget, limitFor, note, sceneLines, sceneUnits, submit } from '../core';
import type { SceneLine, Unit } from '../core';
import { isDesktop } from './desktop';
import { $, el, esc, plural, toast } from './dom';
import { gameHtml } from './gamehtml';
import { playInGame } from './play';
import { GROUP } from './state';
import type { Ctx } from './state';

export { gameHtml };

type Mode = 'both' | 'tr' | 'src';

export function openScene(ctx: Ctx, start: Unit): void {
  const { s } = ctx;
  const view = ctx.view();
  if (!view || !s.current) return;
  if (s.current === GROUP) { toast('Сцену видно у файлі, відкритому окремо: відкрийте його зі списку файлів'); return; }
  const file = s.current;
  const lines = sceneLines(sceneUnits(view.units, start.key));
  const entries = ctx.entries(file);
  const actors = s.views.find(v => v.name === 'Actors.json');
  const actorName = (n: number): string | undefined => {
    const u = actors?.units.find(x => x.key === `[${n}].name`);
    return u ? (s.saved.files['Actors.json']?.[u.key]?.target || u.source) : undefined;
  };

  let mode: Mode = 'both';
  let picked = start.key;
  let real = false;
  const review = s.mode === 'review';
  const measure = (() => { const c = document.createElement('canvas').getContext('2d'); if (c) c.font = '28px sans-serif'; return (t: string) => c?.measureText(t).width ?? t.length * 14; })();
  const plain = (l: string) => l.replace(/\\[A-Za-z]+\[\d+\]|\\[{}.|!><^$]/g, '');
  const limit = ctx.lineLimit();
  const desk = isDesktop() && !!ctx.gameDir();

  const opener = document.activeElement as HTMLElement | null;
  const dlg = el('dialog', 'adlg scn-dlg');
  dlg.setAttribute('aria-labelledby', 'sc-t');
  dlg.innerHTML = `<form method="dialog"><h2 id="sc-t">Сцена · ${esc(start.context)}</h2>
    <p class="hint" id="sc-info"></p>
    <p class="hint" id="sc-cond"></p>
    <label class="achk"><input type="checkbox" id="sc-real"> Вікно як у грі (816 px, шрифт 28 px): перевірка ширини в пікселях</label>
    <div class="seg scn-seg" role="group" aria-label="Що показувати"><button type="button" data-mode="both" class="on" aria-pressed="true">Переклад і оригінал</button><button type="button" data-mode="tr" aria-pressed="false">Переклад</button><button type="button" data-mode="src" aria-pressed="false">Оригінал</button></div>
    <div class="scn" id="sc-list"></div>
    <div class="scn-play" ${desk ? '' : 'hidden'}>
      <div class="grid"><label for="sc-slot">Почати з</label><select id="sc-slot"><option value="0">нової гри</option>${[1, 2, 3, 4, 5].map(n => `<option value="${n}">збереження ${n}</option>`).join('')}</select></div>
      <div class="acts l"><button class="btn p" type="button" id="sc-line">▶ Відтворити з вибраного рядка</button><button class="btn" type="button" id="sc-event">▶ З початку події</button></div>
      <p class="hint" id="sc-play-hint"></p>
    </div>
    <div class="acts l"><button class="btn" type="button" id="sc-all"></button></div>
    <div class="acts"><button class="btn" value="cancel">Закрити</button><button class="btn" type="button" id="sc-edit">Редагувати вибраний рядок</button></div></form>`;
  document.body.appendChild(dlg);
  dlg.addEventListener('close', () => { dlg.remove(); opener?.focus?.(); });

  const textOf = (u: Unit): { html: string; missing: boolean; over: boolean } => {
    const tr = entries[u.key]?.target ?? '';
    const missing = !tr;
    const shown = mode === 'src' || (missing && mode !== 'tr') ? u.source : tr || u.source;
    const max = u.kind === 'dialogue' || u.kind === 'scroll' ? limitFor(limit, u.face) : 0;
    const wide = (l: string): boolean => (real ? measure(plain(l)) > (u.face ? 612 : 780) : !!max && displayLength(l) > max);
    const checked = (u.kind === 'dialogue' || u.kind === 'scroll') && !missing;
    const over = checked && shown.split('\n').some(wide);
    const body = shown.split('\n').map(l => `<div class="scn-ln${checked && wide(l) ? ' scn-over' : ''}" ${checked && wide(l) ? 'title="Рядок задовгий для вікна гри"' : ''}>${gameHtml(l, actorName, n => s.saved.sysNames?.variables[n]) || '&nbsp;'}</div>`).join('');
    return { html: body, missing, over };
  };

  const box = (u: Unit, inner: string, cls = '') => `<div class="scn-box ${cls} ${u.key === picked ? 'scn-cur' : ''}" role="button" aria-pressed="${u.key === picked}" tabindex="0" data-key="${esc(u.key)}">${inner}</div>`;
  const renderLine = (l: SceneLine): string => {
    if (l.kind === 'choice') {
      return `<div class="scn-choice" role="group" aria-label="Варіанти відповіді">${l.units.map((u, i) => {
        const t = textOf(u);
        const orig = mode === 'both' && !t.missing ? `<div class="scn-orig">${esc(u.source)}</div>` : '';
        return box(u, `<span class="scn-n">${i + 1}</span><div>${t.html}${orig}${t.missing && mode !== 'src' ? '<span class="scn-tag">не перекладено</span>' : ''}</div>`, 'scn-opt');
      }).join('')}</div>`;
    }
    const u = l.unit;
    const t = textOf(u);
    const who = ctx.speaker(u);
    const orig = mode === 'both' && !t.missing ? `<div class="scn-orig">${u.source.split('\n').map(x => `<div>${esc(x)}</div>`).join('')}</div>` : '';
    return box(u, `${who ? `<div class="scn-who">${esc(who)}</div>` : ''}<div class="scn-win${l.kind === 'scroll' ? ' scn-scroll' : ''}">${t.html}</div>${orig}${t.missing && mode !== 'src' ? '<span class="scn-tag">не перекладено</span>' : ''}${t.over ? '<span class="scn-tag scn-warn">є задовгі рядки</span>' : ''}`);
  };

  const firstPage = sceneUnits(view.units, start.key)[0]?.page;
  const render = () => {
    $('#sc-list', dlg).innerHTML = lines.map(renderLine).join('') || '<p class="hint">У цій сцені немає текстових рядків.</p>';
    const all = lines.flatMap(l => (l.kind === 'choice' ? l.units : [l.unit]));
    const done = all.filter(u => entries[u.key]?.target).length;
    $('#sc-info', dlg).textContent = `${file}${view.label ? ' · ' + view.label : ''} · ${plural(all.length, ['рядок', 'рядки', 'рядків'])}, перекладено ${done}. Натисніть на рядок, щоб вибрати його.`;
    const sceneUnitsAll = all;
    const states = sceneUnitsAll.map(u => entries[u.key]?.status ?? 'new');
    const apprN = states.filter(x => x === 'appr').length, doneN = states.filter(x => x === 'done').length;
    $('#sc-info', dlg).textContent += ` Вичитано ${apprN}, чекає вичитування ${doneN}.`;
    const allBtn = $('#sc-all', dlg) as HTMLButtonElement;
    allBtn.textContent = review ? 'Затвердити всю сцену' : 'Надіслати всю сцену на вичитування';
    allBtn.disabled = !sceneUnitsAll.some(u => review ? entries[u.key]?.status === 'done' : (entries[u.key]?.status === 'draft'));
    $('#sc-cond', dlg).textContent = firstPage ? 'Умови: ' + describePage(firstPage, s.saved.sysNames).join('; ') : '';
    $('#sc-list', dlg).classList.toggle('scn-real', real);
    dlg.querySelectorAll<HTMLElement>('[data-mode]').forEach(b => { const on = b.dataset.mode === mode; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
    const target = (from: 'line' | 'event') => jumpTarget(file, picked, s.game, from, 0);
    const can = desk && !!target('line');
    dlg.querySelectorAll<HTMLButtonElement>('#sc-line,#sc-event').forEach(b => { b.disabled = !can; });
    if (desk) $('#sc-play-hint', dlg).textContent = can ? 'Гра запишеться з вашим перекладом (чернетки теж) і почнеться з цієї сцени. Деякі гілки залежать від стану гри: для них оберіть збереження.' : 'Для цього рядка запуск у грі недоступний (бої, база даних).';
  };

  const pick = (key: string) => { picked = key; render(); dlg.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`)?.focus(); };
  dlg.addEventListener('click', async e => {
    const t = e.target as HTMLElement;
    const m = t.closest<HTMLElement>('[data-mode]');
    if (m) { mode = m.dataset.mode as Mode; render(); return; }
    const b = t.closest<HTMLElement>('.scn-box');
    if (b) { pick(b.dataset.key!); return; }
    if (t.id === 'sc-real') { real = (t as HTMLInputElement).checked; render(); return; }
    if (t.id === 'sc-all') {
      const stage = review ? 'review' : 'translate';
      let ok = 0, skipped = 0;
      for (const l of lines) for (const u of l.kind === 'choice' ? l.units : [l.unit]) {
        const cur = entries[u.key];
        if (!cur || (review ? cur.status !== 'done' : cur.status !== 'draft')) continue;
        const r = submit(cur, u, stage, Date.now(), { blockErrors: s.saved.settings.blockErrors, qa: ctx.qaOpts() });
        if (r.ok) { entries[u.key] = note(r.entry, review ? 'вичитано (вся сцена)' : 'надіслано на вичитування (вся сцена)', r.entry.target, s.who, Date.now()); ok++; } else skipped++;
      }
      ctx.persist(); ctx.invalidateTm(); render();
      toast(`${review ? 'Затверджено' : 'Надіслано'}: ${ok}${skipped ? `. Пропущено через помилки QA: ${skipped}` : ''}`);
      return;
    }
    if (t.id === 'sc-edit') { const u = ctx.unit(picked); dlg.close(); if (u) ctx.select(picked); return; }
    if (t.id === 'sc-line' || t.id === 'sc-event') {
      const u = ctx.unit(picked);
      if (!u) return;
      const btn = t as HTMLButtonElement;
      btn.disabled = true;
      try { await playInGame(ctx, file, u, t.id === 'sc-line' ? 'line' : 'event', Number(($('#sc-slot', dlg) as HTMLSelectElement).value)); dlg.close(); }
      catch (err) { toast('Не вдалося запустити гру: ' + (err instanceof Error ? err.message : String(err))); btn.disabled = false; }
    }
  });
  dlg.addEventListener('dblclick', e => { if ((e.target as HTMLElement).closest('.scn-box')) { dlg.close(); ctx.select(picked); } });
  dlg.addEventListener('keydown', e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('.scn-box');
    if (b && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); pick(b.dataset.key!); }
  });
  render();
  dlg.showModal();
  dlg.querySelector<HTMLElement>('.scn-cur')?.scrollIntoView({ block: 'center' });
}
