import { DEFAULT_LINE_LIMIT, DEFAULT_WRAP, autoLineLimit, flowText, isMessageUnit, linesShown, measureOf, tooWide, unitWord, widthOf, wrapMessage, wrapOf } from '../core';
import type { WrapSettings } from '../core';
import { $, esc, plural, toast } from './dom';
import { dialog } from './settings';
import type { Ctx } from './state';

const SAMPLE = 'Мандрівник дістався перекладацького містечка наприкінці осені, і там на нього чекав старий друг, якого він не бачив багато років.';

/**
 * The tool «Перенесення рядків»: when the lines of a message are broken (at build, in the text, never), how wide a line
 * is (characters or pixels of the game window), whether a word may be broken with a hyphen, whether the translator's
 * own line breaks are kept, and when to warn about too many lines. Every choice is applied at once and kept in the
 * project; the example shows what the game window will make of a text.
 */
export function openWrapTool(ctx: Ctx, actions: { wrapFile: () => void }): void {
  const { s } = ctx;
  const st = s.saved.settings;
  const w0 = wrapOf(st);
  const auto = autoLineLimit(s.views);
  const cur = s.cur ? ctx.unit(s.cur) : undefined;
  const curText = cur && isMessageUnit(cur) ? flowText(ctx.entries(s.current ?? '')[cur.key]?.target ?? '') : '';
  const opt = (v: string, label: string, on: boolean): string => `<option value="${v}" ${on ? 'selected' : ''}>${label}</option>`;
  const radio = (name: string, v: string, label: string, hint: string, on: boolean): string => `<label class="achk wp-opt"><input type="radio" name="${name}" value="${v}" ${on ? 'checked' : ''}><span>${label}<small class="hint">${hint}</small></span></label>`;
  const pxMode = w0.unit === 'px';
  const dlg = dialog(`<form method="dialog" class="wp"><h2 id="wp-t">Перенесення рядків</h2>
    <p class="hint">Вікно повідомлення в грі не переносить рядки саме. Тут обираєте, хто це робить і як. Зміни застосовуються одразу; довжина перекладу ніколи не обмежується, це лише рекомендації.</p>
    <fieldset class="wp-fs"><legend>Коли переносити</legend>
      ${radio('wp-mode', 'build', 'Під час збірки й запуску гри <b>(рекомендовано)</b>', 'Текст у проєкті лишається без розривів, розриви ставляться тільки у файлах гри.', w0.mode === 'build')}
      ${radio('wp-mode', 'text', 'У тексті, коли надсилаю рядок', 'Розриви стають частиною перекладу; пам’ять перекладів і пошук їх не помічають.', w0.mode === 'text')}
      ${radio('wp-mode', 'off', 'Не переносити', 'Лише попереджати про задовгі рядки; ставите розриви самі.', w0.mode === 'off')}</fieldset>
    <fieldset class="wp-fs"><legend>Ширина рядка</legend>
      <div class="grid"><label for="wp-unit">Рахувати в</label><select id="wp-unit">${opt('chars', 'символах', !pxMode)}${opt('px', 'пікселях вікна гри', pxMode)}</select></div>
      <div class="grid" id="wp-chars"><label for="wp-lim-mode">Ширина</label><select id="wp-lim-mode">${opt('auto', `за оригіналом${auto ? ` (зараз ${auto})` : ` (не визначено, діє ${DEFAULT_LINE_LIMIT})`}`, st.lineLimit === 0)}${opt('custom', 'своє число', st.lineLimit > 0)}${opt('off', 'не обмежувати', st.lineLimit < 0)}</select>
        <label for="wp-lim">Символів у рядку</label><input id="wp-lim" type="number" min="10" max="200" value="${st.lineLimit > 0 ? st.lineLimit : auto || DEFAULT_LINE_LIMIT}"></div>
      <div class="grid" id="wp-px"><label for="wp-pxw">Ширина вікна гри, px</label><input id="wp-pxw" type="number" min="320" max="4096" value="${w0.px.width}">
        <label for="wp-pxf">Шрифт гри, px</label><input id="wp-pxf" type="number" min="10" max="96" value="${w0.px.font}">
        <label class="achk wp-span"><input type="checkbox" id="wp-pxoff" ${st.lineLimit < 0 ? 'checked' : ''}> Не обмежувати ширину</label></div>
      <p class="hint">Символи однакові на всіх пристроях. Пікселі враховують справжню ширину літер, але шрифт гри невідомий, тож вимір приблизний. Поруч із портретом персонажа текст вужчий, це враховується.</p></fieldset>
    <fieldset class="wp-fs"><legend>Переніс слів</legend>
      <div class="grid"><label for="wp-hy">Слово по складах, з дефісом</label><select id="wp-hy">${opt('off', 'не переносити слова', w0.hyphen === 'off')}${opt('needed', 'лише коли треба', w0.hyphen === 'needed')}${opt('fill', 'коли краще заповнює рядок', w0.hyphen === 'fill')}</select>
        <label for="wp-hc">Знак переносу</label><input id="wp-hc" maxlength="2" size="2" value="${esc(w0.hyphenChar)}">
        <label for="wp-ml">Літер перед переносом, не менше</label><input id="wp-ml" type="number" min="1" max="6" value="${w0.minLeft}">
        <label for="wp-mr">Літер після переносу, не менше</label><input id="wp-mr" type="number" min="1" max="6" value="${w0.minRight}"></div>
      <p class="hint">Слова з латинкою, цифрами чи керівними кодами всередині, а також слова з дефісом не розбиваються. «Лише коли треба» (рекомендовано) означає: слово довше за рядок або рядок виходить надто коротким.</p></fieldset>
    <fieldset class="wp-fs"><legend>Розриви, які поставили ви</legend>
      ${radio('wp-keep', 'long', 'Зберігати, переносити лише задовгі повідомлення <b>(рекомендовано)</b>', 'Охайно розбитий текст не чіпається.', w0.keep === 'long')}
      ${radio('wp-keep', 'reflow', 'Збирати текст заново завжди', 'Старі розриви ігноруються.', w0.keep === 'reflow')}</fieldset>
    <div class="grid"><label for="wp-max">Попереджати, коли рядків у повідомленні більше, ніж</label><input id="wp-max" type="number" min="0" max="12" value="${w0.maxLines}"></div>
    <p class="hint">Вікно показує ${plural(w0.maxLines || 4, ['рядок', 'рядки', 'рядків'])}; довше повідомлення гра покаже на кількох сторінках. Нічого не обрізається, це лише попередження. 0 вимикає його.</p>
    <p class="sum err" id="wp-err" role="alert" hidden></p>
    <fieldset class="wp-fs"><legend>Приклад</legend>
      <label for="wp-ex" class="hint">Текст для перевірки</label><textarea id="wp-ex" rows="3">${esc(curText || SAMPLE)}</textarea>
      <label class="achk"><input type="checkbox" id="wp-face"> Поруч портрет персонажа</label>
      <div id="wp-view" class="wp-view" aria-live="polite"></div>
      <p class="sum" id="wp-stat" role="status"></p></fieldset>
    <p class="sum" id="wp-check" role="status"></p>
    <div class="acts"><button class="btn" value="cancel">Закрити</button><button class="btn" type="button" id="wp-scan">Перевірити файл</button><button class="btn" type="button" id="wp-file" title="Розриви стануть частиною тексту цього файлу; це можна скасувати">Записати розриви в текст файлу</button></div></form>`, 'wp-t');

  const num = (id: string): number => Number(($(id, dlg) as HTMLInputElement).value);
  const val = (id: string): string => ($(id, dlg) as HTMLInputElement | HTMLSelectElement).value;
  const checked = (name: string): string => dlg.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`)?.value ?? '';

  /** The form as settings, or the reason it cannot be saved yet (a number half typed). */
  const read = (): { wrap: WrapSettings; lineLimit: number } | string => {
    const unit = val('#wp-unit') === 'px' ? 'px' : 'chars';
    const inRange = (n: number, lo: number, hi: number): boolean => Number.isFinite(n) && n >= lo && n <= hi;
    let lineLimit = 0;
    if (unit === 'px') {
      if (!inRange(num('#wp-pxw'), 320, 4096)) return 'Ширина вікна має бути від 320 до 4096 пікселів';
      if (!inRange(num('#wp-pxf'), 10, 96)) return 'Шрифт має бути від 10 до 96 пікселів';
      lineLimit = ($('#wp-pxoff', dlg) as HTMLInputElement).checked ? -1 : st.lineLimit < 0 ? 0 : st.lineLimit;
    } else {
      const m = val('#wp-lim-mode');
      if (m === 'custom' && !inRange(num('#wp-lim'), 10, 200)) return 'Ширина рядка має бути від 10 до 200 символів';
      lineLimit = m === 'off' ? -1 : m === 'custom' ? Math.round(num('#wp-lim')) : 0;
    }
    if ([...val('#wp-hc')].length !== 1 || /\s/.test(val('#wp-hc'))) return 'Знак переносу це один видимий символ';
    if (!inRange(num('#wp-ml'), 1, 6) || !inRange(num('#wp-mr'), 1, 6)) return 'Літер при переносі має бути від 1 до 6';
    if (!inRange(num('#wp-max'), 0, 12)) return 'Кількість рядків має бути від 0 до 12';
    return {
      lineLimit,
      wrap: {
        ...DEFAULT_WRAP, mode: checked('wp-mode') as WrapSettings['mode'], unit, hyphen: val('#wp-hy') as WrapSettings['hyphen'], hyphenChar: val('#wp-hc'),
        minLeft: num('#wp-ml'), minRight: num('#wp-mr'), keep: checked('wp-keep') as WrapSettings['keep'], maxLines: num('#wp-max'),
        px: { width: unit === 'px' ? num('#wp-pxw') : w0.px.width, font: unit === 'px' ? num('#wp-pxf') : w0.px.font },
      },
    };
  };

  const layout = (): void => {
    const px = val('#wp-unit') === 'px';
    ($('#wp-chars', dlg)).hidden = px;
    ($('#wp-px', dlg)).hidden = !px;
    ($('#wp-lim', dlg) as HTMLInputElement).disabled = val('#wp-lim-mode') !== 'custom';
  };

  const preview = (): void => {
    const plan = ctx.wrapPlan();
    const unit = { kind: 'dialogue' as const, key: 'events[0].pages[0].list[0]', ...(($('#wp-face', dlg) as HTMLInputElement).checked ? { face: 'Actor1#0' } : {}) };
    const text = ($('#wp-ex', dlg) as HTMLTextAreaElement).value;
    const width = widthOf(plan, unit);
    const r = plan.settings.mode === 'off' || width <= 0 ? null : wrapMessage(plan, unit, text);
    const shown = r ? r.text : text;
    const max = plan.settings.maxLines;
    const measure = measureOf(plan);
    const lines = shown ? shown.split('\n') : [];
    $('#wp-view', dlg).innerHTML = lines.map((l, i) => {
      const m = Math.round(measure(l)), over = width > 0 && m > width;
      return `${max > 0 && i === max ? '<div class="wp-pg">Далі: наступна сторінка вікна (гра покаже її після натискання)</div>' : ''}<div class="wp-ln${over ? ' over' : ''}${max > 0 && i >= max ? ' next' : ''}"><span>${esc(l) || '&nbsp;'}</span>${width > 0 ? `<em title="Ширина рядка${over ? ': не вміщається' : ''}">${m}/${width}</em>` : ''}</div>`;
    }).join('') || '<div class="hint">Немає тексту</div>';
    const n = linesShown(plan, unit, text);
    const mode = plan.settings.mode;
    $('#wp-stat', dlg).textContent = [
      mode === 'build' ? 'Так гра покаже цей текст; у проєкті він лишається без розривів.' : mode === 'text' ? 'Так текст запишеться, коли ви надішлете рядок.' : 'Переносу немає: текст показано, як він написаний.',
      `Рядків: ${n}`,
      r?.hyphenated ? `слів із переносом: ${r.hyphenated}` : '',
      max > 0 && n > max ? `понад ${max}: гра покаже на кількох сторінках` : '',
      r?.over.length ? 'є слово, яке не вміщається в рядок' : '',
      width > 0 ? `ширина до ${width} ${unitWord(plan)}` : 'ширину вимкнено',
    ].filter(Boolean).join(' · ') + '.';
  };

  let err = '';
  const apply = (final: boolean): void => {
    const r = read();
    err = typeof r === 'string' ? r : '';
    const box = $('#wp-err', dlg);
    box.hidden = !err; box.textContent = err;
    if (typeof r === 'string') return;
    const same = JSON.stringify(wrapOf(st)) === JSON.stringify(r.wrap) && st.lineLimit === r.lineLimit;
    if (!same) {
      st.wrap = r.wrap; st.lineLimit = r.lineLimit;
      s.saved.settingsAt = Date.now();
      ctx.persist();
      if (final) ctx.render();
    }
    preview();
  };

  dlg.addEventListener('input', e => { if (!(e.target as HTMLElement).closest('#wp-ex')) apply(false); else preview(); });
  dlg.addEventListener('change', e => { layout(); if ((e.target as HTMLElement).closest('#wp-ex,#wp-face')) preview(); else apply(true); });
  $('#wp-scan', dlg).addEventListener('click', () => {
    const v = ctx.view();
    if (!v) { $('#wp-check', dlg).textContent = 'Спершу відкрийте файл.'; return; }
    const plan = ctx.wrapPlan(), ents = ctx.entries(v.name);
    let wide = 0, many = 0, stuck = 0, total = 0;
    for (const u of v.units) {
      const t = ents[u.key]?.target;
      if (!t || !isMessageUnit(u)) continue;
      total++;
      if (tooWide(plan, u, t).count) wide++;
      if (plan.settings.maxLines > 0 && u.kind === 'dialogue' && linesShown(plan, u, t) > plan.settings.maxLines) many++;
      if (wrapMessage(plan, u, t).over.length) stuck++;
    }
    const where = `У файлі «${ctx.fileTitle(v.name)}» (${plural(total, ['переклад повідомлення', 'переклади повідомлень', 'перекладів повідомлень'])})`;
    $('#wp-check', dlg).textContent = !total ? `${where}: немає чого перевіряти.` : `${where}: ширші за вікно ${wide}${plan.settings.mode === 'build' && wide ? ' (гра перенесе їх сама)' : ''}; понад ${plan.settings.maxLines ? plural(plan.settings.maxLines, ['рядок', 'рядки', 'рядків']) : '—'}: ${many}; слово не вміщається ${stuck}.`;
  });
  $('#wp-file', dlg).addEventListener('click', () => { if (err) { toast(err); return; } dlg.close(); actions.wrapFile(); });
  layout();
  preview();
}
