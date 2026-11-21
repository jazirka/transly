import { PERMISSIONS, authorOf, i18n, plugins, pluginTemplate, t } from '../core';
import type { InstallPlan, PluginPermission, PluginRecord, PluginState } from '../core';
import { InstallError } from '../core';
import { $, CRUMB, esc, toast } from './dom';
import { openLink } from './desktop';
import { ext, interfaceLanguage, setInterfaceLanguage } from './ext';
import { miniMarkdown } from './minimd';
import { saveFile } from './save';
import { dialog } from './settings';

/**
 * The manager of extensions (plugins): what is installed and what each one brings, adding one (from GitHub, an address or a file), the language of
 * the interface, and what games and formats the application reads now. Plugins can be switched on and off, updated and removed here; what a plugin
 * asks for is shown before it is installed, and nothing is written until the user agrees.
 */

type Page = 'installed' | 'add' | 'lang' | 'support';
const TITLES: Record<Page, string> = { installed: 'Встановлені', add: 'Додати', lang: 'Мова інтерфейсу', support: 'Підтримувані ігри й формати' };
const GROUPS: [string, Page[]][] = [['Розширення', ['installed', 'add']], ['Мова й підтримка', ['lang', 'support']]];

const STATE: Record<PluginState, [string, string]> = {
  enabled: ['Увімкнено', 'ok'], disabled: ['Вимкнено', 'off'], incompatible: ['Не підходить до цієї версії', 'bad'], 'missing-dependency': ['Потрібне інше розширення', 'warn'], error: ['Помилка', 'bad'],
};
const PERM: Record<PluginPermission, [string, string]> = {
  network: ['Мережа', 'Розширення може просити застосунок завантажити дані з указаних серверів (сам воно мережі не бачить).'],
  storage: ['Власне сховище', 'Може зберігати невеликі власні дані на цьому пристрої.'],
  notify: ['Повідомлення', 'Може показувати вам повідомлення в застосунку.'],
};

/** A string of a plugin in the language of the interface (the strings of a built-in plugin are the application's own). */
export const tp = (rec: Pick<PluginRecord, 'manifest' | 'builtin'>, text: string): string => i18n.t(text, undefined, rec.builtin ? 'core' : `plugin:${rec.manifest.id}`);

const initials = (name: string): string => { const w = name.split(/[^\p{L}\p{N}]+/u).filter(Boolean); return (w.length > 1 ? w[0]![0]! + w[1]![0]! : (w[0] ?? '?').slice(0, 2)).toUpperCase(); };
const tags = (r: PluginRecord): string[] => {
  const c = r.manifest.contributes ?? {};
  return [r.builtin ? 'Вбудоване' : '', c.engines?.length ? 'Рушій' : '', c.formats?.length ? 'Формати' : '', c.languages?.length ? 'Мова' : '', c.help?.length ? 'Довідка' : '', c.settings?.length ? 'Параметри' : '', r.manifest.main ? 'Код' : ''].filter(Boolean);
};
const sourceLine = (r: PluginRecord): string => {
  const s = r.source;
  return s.kind === 'builtin' ? t('Входить до застосунку') : s.kind === 'github' ? `GitHub: ${s.location ?? ''}${s.ref ? ` @ ${s.ref.slice(0, 7)}` : ''}` : s.kind === 'url' ? s.location ?? '' : t('З файлу');
};

/** The place where a plugin's values are kept: this device (`app`) or the project (`project`). */
export interface ExtensionActions { projectValues(): Record<string, Record<string, unknown>>; saveProjectValues(): void }

const SETTINGS_KEY = (id: string): string => `transly.ext.settings.${id}`;
const readApp = (id: string): Record<string, unknown> => { try { return JSON.parse(localStorage.getItem(SETTINGS_KEY(id)) ?? '{}') as Record<string, unknown>; } catch { return {}; } };

export function openExtensions(acts: ExtensionActions, first: Page = 'installed'): HTMLDialogElement {
  let page: Page = first;
  let detail: string | null = null;
  let plan: InstallPlan | null = null;
  let busy = '';
  let message: { kind: 'ok' | 'bad'; text: string } | null = null;
  let found: { full: string; desc: string; stars: number }[] | null = null;
  let updates = new Map<string, string | null>();
  let armed = '';

  const dlg = dialog(`<form method="dialog" class="st exd">
    <nav class="st-nav" id="st-nav" aria-label="Розділи розширень"><div class="st-tree" id="ex-tree"></div></nav>
    <div class="st-main" id="st-main"><h2 id="st-t" class="st-crumb"></h2><div class="st-content" id="ex-body"></div></div>
    <div class="st-bar"><span class="st-dirty" id="ex-note" role="status" hidden></span><button class="btn p" type="button" id="ex-done">Готово</button></div>
  </form>`, 'st-t');
  dlg.classList.add('st-dlg', 'exd-dlg');
  const body = $('#ex-body', dlg), tree = $('#ex-tree', dlg), crumb = $('#st-t', dlg);

  const note = (m: typeof message): void => { message = m; };
  const run = async (what: string, fn: () => Promise<void>): Promise<void> => {
    busy = what; render();
    try { await fn(); } catch (e) { note({ kind: 'bad', text: e instanceof InstallError ? e.errors.join('\n') : e instanceof Error ? e.message : String(e) }); }
    busy = ''; render();
  };

  // ---------- pieces ----------

  const stateChip = (r: PluginRecord): string => { const [label, cls] = STATE[r.state]; return `<span class="ex-st ${cls}">${esc(t(label))}</span>`; };
  const tagHtml = (r: PluginRecord): string => tags(r).map(x => `<span class="ex-tag">${esc(t(x))}</span>`).join('');

  const listHtml = (): string => {
    const recs = plugins.list();
    return `<p class="hint">${esc(t('Розширення додають підтримку інших ігор і форматів, мови інтерфейсу та довідку. Вбудовані можна вимкнути, але не видалити.'))}</p>
      <div class="ex-list">${recs.map(r => `<div class="ex-row ${r.state}" data-id="${esc(r.manifest.id)}">
        <span class="ex-ic" aria-hidden="true">${esc(initials(tp(r, r.manifest.name)))}</span>
        <div class="ex-info"><div class="ex-t"><b>${esc(tp(r, r.manifest.name))}</b><small>v${esc(r.manifest.version)}${authorOf(r.manifest) ? ` · ${esc(authorOf(r.manifest))}` : ''}</small></div>
          ${r.manifest.description ? `<p class="ex-d">${esc(tp(r, r.manifest.description))}</p>` : ''}
          <div class="ex-tags">${stateChip(r)}${tagHtml(r)}${updates.get(r.manifest.id) ? `<span class="ex-tag new">${esc(t('Є оновлення {v}', { v: updates.get(r.manifest.id)! }))}</span>` : ''}</div>
          ${r.reason ? `<p class="ex-why">${esc(r.reason)}</p>` : ''}</div>
        <div class="ex-act"><button class="btn s" type="button" data-act="open" data-id="${esc(r.manifest.id)}">${esc(t('Докладніше'))}</button>
          <label class="ex-sw"><input type="checkbox" role="switch" data-act="toggle" data-id="${esc(r.manifest.id)}" ${r.enabled ? 'checked' : ''} ${busy ? 'disabled' : ''} aria-label="${esc(t('Увімкнути «{name}»', { name: tp(r, r.manifest.name) }))}"><span>${esc(t(r.enabled ? 'Увімкнено' : 'Вимкнено'))}</span></label></div>
      </div>`).join('')}</div>`;
  };

  const fieldHtml = (r: PluginRecord, sid: string, f: NonNullable<PluginRecord['manifest']['contributes']>['settings'] extends (infer S)[] | undefined ? (S extends { fields: (infer F)[] } ? F : never) : never): string => {
    const scope = f.scope ?? 'app';
    const vals = scope === 'project' ? acts.projectValues()[r.manifest.id] ?? {} : readApp(r.manifest.id);
    const cur = vals[f.key] ?? f.default;
    const id = `exf-${sid}-${f.key}`, label = esc(tp(r, f.label)), attrs = `data-act="setting" data-id="${esc(r.manifest.id)}" data-key="${esc(f.key)}" data-scope="${scope}" data-type="${f.type}"`;
    const control = f.type === 'boolean' ? `<input id="${id}" type="checkbox" ${attrs} ${cur ? 'checked' : ''}>`
      : f.type === 'select' ? `<select id="${id}" ${attrs}>${(f.options ?? []).map(o => `<option value="${esc(o.value)}" ${String(cur) === o.value ? 'selected' : ''}>${esc(tp(r, o.label))}</option>`).join('')}</select>`
      : f.type === 'number' ? `<input id="${id}" type="number" ${f.min !== undefined ? `min="${f.min}"` : ''} ${f.max !== undefined ? `max="${f.max}"` : ''} value="${esc(String(cur ?? ''))}" ${attrs}>`
      : `<input id="${id}" type="text" maxlength="500" value="${esc(String(cur ?? ''))}" ${attrs}>`;
    return `<div class="grid"><label for="${id}">${label}</label>${control}</div>${f.description ? `<p class="hint">${esc(tp(r, f.description))}</p>` : ''}${scope === 'project' ? `<p class="hint">${esc(t('Зберігається в проєкті й однаково діє на всіх пристроях.'))}</p>` : ''}`;
  };

  const detailHtml = (r: PluginRecord): string => {
    const m = r.manifest, c = m.contributes ?? {};
    const row = (k: string, v: string): string => (v ? `<tr><th scope="row">${esc(t(k))}</th><td>${v}</td></tr>` : '');
    const link = (u?: string): string => (u ? `<a href="${esc(u)}" data-ext-link rel="noopener noreferrer">${esc(u)}</a>` : '');
    const deps = Object.entries(m.dependencies ?? {}).map(([id, range]) => { const d = plugins.get(id); return `${esc(d ? tp(d, d.manifest.name) : id)} ${esc(range)} — ${esc(d ? t(STATE[d.state][0]) : t('не встановлено'))}`; }).join('<br>');
    const perms = (m.permissions ?? []).map(p => `<b>${esc(t(PERM[p][0]))}</b>: ${esc(t(PERM[p][1]))}`).join('<br>') + (m.network ? `<br>${esc(t('Сервери'))}: ${esc(m.network.hosts.join(', '))}` : '');
    const stored = r.source.installedAt ? new Date(r.source.installedAt).toLocaleString('uk-UA') : '';
    const sets = (c.settings ?? []).map((s, i) => `<div class="st-sub"><h3>${esc(tp(r, s.title))}</h3>${s.description ? `<p class="hint">${esc(tp(r, s.description))}</p>` : ''}${s.fields.map(f => fieldHtml(r, String(i), f)).join('')}</div>`).join('');
    const upd = updates.get(m.id);
    return `<button class="btn s" type="button" data-act="back">‹ ${esc(t('Усі розширення'))}</button>
      <div class="ex-head"><span class="ex-ic lg" aria-hidden="true">${esc(initials(tp(r, m.name)))}</span><div><h3>${esc(tp(r, m.name))}</h3><small>v${esc(m.version)}${authorOf(m) ? ` · ${esc(authorOf(m))}` : ''}</small><div class="ex-tags">${stateChip(r)}${tagHtml(r)}</div></div>
        <label class="ex-sw"><input type="checkbox" role="switch" data-act="toggle" data-id="${esc(m.id)}" ${r.enabled ? 'checked' : ''} aria-label="${esc(t('Увімкнути «{name}»', { name: tp(r, m.name) }))}"><span>${esc(t(r.enabled ? 'Увімкнено' : 'Вимкнено'))}</span></label></div>
      ${r.reason ? `<div class="st-warn ${r.state === 'error' || r.state === 'incompatible' ? 'bad' : ''}" role="note"><span class="wi" aria-hidden="true">!</span><div><b>${esc(t(STATE[r.state][0]))}</b><span>${esc(r.reason)}</span></div></div>` : ''}
      ${m.description ? `<p>${esc(tp(r, m.description))}</p>` : ''}
      <table class="ex-meta"><tbody>${row('Ідентифікатор', `<code>${esc(m.id)}</code>`)}${row('Ліцензія', esc(m.license ?? ''))}${row('Сайт', link(m.homepage))}${row('Джерело', esc(sourceLine(r)))}${row('Встановлено', esc(stored))}${row('Потрібен Transly', esc(m.requires?.transly ?? ''))}${row('Залежності', deps)}${row('Дозволи', perms || esc(t('Не просить нічого')))}</tbody></table>
      ${c.engines?.length ? `<div class="st-sub"><h3>${esc(t('Ігрові рушії'))}</h3>${c.engines.map(e => `<p><b>${esc(tp(r, e.label))}</b>${e.description ? ` — ${esc(tp(r, e.description))}` : ''}${e.features?.length ? `<br><small>${esc(t('Можливості'))}: ${esc(e.features.join(', '))}</small>` : ''}</p>`).join('')}</div>` : ''}
      ${c.formats?.length ? `<div class="st-sub"><h3>${esc(t('Формати файлів'))}</h3>${c.formats.map(f => `<p><b>${esc(tp(r, f.label))}</b> <code>${esc(f.extensions.join(' '))}</code> <small>${esc(t(f.text ? 'текстовий файл' : 'JSON'))}${f.spec ? ` · ${esc(t('описано даними'))}` : ` · ${esc(t('код розширення'))}`}</small></p>`).join('')}</div>` : ''}
      ${c.languages?.length ? `<div class="st-sub"><h3>${esc(t('Мови інтерфейсу'))}</h3>${c.languages.map(l => `<p><b>${esc(l.nativeName ?? l.name)}</b> <code>${esc(l.code)}</code> <button class="btn s" type="button" data-act="use-lang" data-code="${esc(l.code)}">${esc(t('Використовувати'))}</button></p>`).join('')}</div>` : ''}
      ${c.help?.length ? `<div class="st-sub"><h3>${esc(t('Довідка'))}</h3>${c.help.map(h => { const text = h.body ?? (h.file ? r.files.get(h.file) : undefined) ?? ''; return `<details><summary>${esc(tp(r, h.title))}</summary><div class="ex-md">${miniMarkdown(tp(r, text))}</div></details>`; }).join('')}</div>` : ''}
      ${sets}
      ${r.errors.length ? `<div class="st-sub"><h3>${esc(t('Збої'))}</h3>${r.errors.slice(-5).map(e => `<p class="hint bad">${esc(new Date(e.at).toLocaleTimeString('uk-UA'))} — ${esc(e.what)}</p>`).join('')}</div>` : ''}
      <div class="acts l">
        ${r.builtin ? '' : `<button class="btn" type="button" data-act="check" data-id="${esc(m.id)}" ${busy ? 'disabled' : ''}>${esc(t('Перевірити оновлення'))}</button>${upd ? `<button class="btn p" type="button" data-act="update" data-id="${esc(m.id)}">${esc(t('Оновити до {v}', { v: upd }))}</button>` : ''}`}
        <button class="btn" type="button" data-act="pot" data-id="${esc(m.id)}">${esc(t('Рядки для перекладу (.pot)'))}</button>
        ${r.builtin ? '' : `<button class="btn bad" type="button" data-act="remove" data-id="${esc(m.id)}">${esc(armed === m.id ? t('Так, видалити') : t('Видалити…'))}</button>`}
      </div>`;
  };

  const planHtml = (p: InstallPlan): string => {
    const m = p.pkg.manifest, c = m.contributes ?? {};
    const rec = { manifest: m, builtin: false } as PluginRecord;
    const verb = p.action === 'update' ? t('Оновлення до {v}', { v: m.version }) : p.action === 'downgrade' ? t('Повернення до старішої версії {v}', { v: m.version }) : p.action === 'reinstall' ? t('Перевстановлення {v}', { v: m.version }) : t('Встановлення');
    const warn = (title: string, text: string, bad = false): string => `<div class="st-warn${bad ? ' bad' : ''}" role="note"><span class="wi" aria-hidden="true">!</span><div><b>${esc(title)}</b><span>${esc(text)}</span></div></div>`;
    return `<button class="btn s" type="button" data-act="cancel-plan">‹ ${esc(t('Назад'))}</button>
      <div class="ex-head"><span class="ex-ic lg" aria-hidden="true">${esc(initials(tp(rec, m.name)))}</span><div><h3>${esc(tp(rec, m.name))}</h3><small>v${esc(m.version)}${authorOf(m) ? ` · ${esc(authorOf(m))}` : ''} · ${esc(verb)}</small></div></div>
      ${m.description ? `<p>${esc(tp(rec, m.description))}</p>` : ''}
      ${!p.compat.ok ? warn(t('Не підходить до цієї версії'), p.compat.reason, true) : ''}
      ${p.sourceChanged ? warn(t('Інше джерело'), t('Це розширення вже встановлено з іншого місця ({old}). Переконайтеся, що воно від того самого автора.', { old: p.existing?.source.location ?? p.existing?.source.kind ?? '' }), true) : ''}
      ${p.hasCode ? warn(t('Розширення містить код'), t('Його код виконуватиметься у вашому застосунку. Встановлюйте лише від авторів, яким довіряєте.'), true) : `<p class="hint">${esc(t('Розширення без коду: воно лише описує формати, мови або довідку, а читає й пише файли сам застосунок.'))}</p>`}
      ${p.missing.length ? warn(t('Потрібні інші розширення'), t('Не встановлено: {list}. Без них це розширення не працюватиме.', { list: p.missing.join(', ') })) : ''}
      ${p.warnings.map(w => warn(t('Увага'), w)).join('')}
      <table class="ex-meta"><tbody><tr><th scope="row">${esc(t('Джерело'))}</th><td>${esc(p.source.kind === 'github' ? `GitHub: ${p.source.location}${p.source.ref ? ` @ ${p.source.ref.slice(0, 7)}` : ''}` : p.source.kind === 'url' ? p.source.location ?? '' : t('З файлу'))}</td></tr>
        <tr><th scope="row">${esc(t('Додає'))}</th><td>${esc([c.engines?.length ? t('рушії: {n}', { n: c.engines.length }) : '', c.formats?.length ? t('формати: {n}', { n: c.formats.length }) : '', c.languages?.length ? t('мови: {n}', { n: c.languages.length }) : '', c.help?.length ? t('довідка: {n}', { n: c.help.length }) : '', c.settings?.length ? t('параметри: {n}', { n: c.settings.length }) : ''].filter(Boolean).join(', ') || '—')}</td></tr>
        <tr><th scope="row">${esc(t('Дозволи'))}</th><td>${p.permissions.length ? p.permissions.map(x => `<label class="achk"><input type="checkbox" data-grant="${x}" ${p.existing?.grants.includes(x) ? 'checked' : ''}> <b>${esc(t(PERM[x][0]))}</b>: ${esc(t(PERM[x][1]))}</label>`).join('') : esc(t('Не просить нічого'))}${m.network ? `<br><small>${esc(t('Сервери'))}: ${esc(m.network.hosts.join(', '))}</small>` : ''}</td></tr></tbody></table>
      ${p.hasCode ? `<label class="achk"><input type="checkbox" id="ex-trust"> ${esc(t('Я довіряю автору й розумію, що код розширення виконуватиметься'))}</label>` : ''}
      <div class="acts l"><button class="btn p" type="button" data-act="do-install" ${!p.compat.ok || busy ? 'disabled' : ''}>${esc(p.action === 'update' ? t('Оновити') : t('Встановити'))}</button><button class="btn" type="button" data-act="cancel-plan">${esc(t('Скасувати'))}</button></div>`;
  };

  const addHtml = (): string => `<p class="hint">${esc(t('Розширення — це папка або архів із файлом transly-plugin.json. Спершу ви побачите, що воно додає й чого просить: нічого не записується без вашої згоди.'))}</p>
    <div class="st-sub"><h3>GitHub</h3><div class="grid"><label for="ex-gh">${esc(t('Репозиторій'))}</label><input id="ex-gh" placeholder="автор/репозиторій" autocomplete="off" spellcheck="false"></div>
      <p class="hint">${esc(t('Можна вказати версію й папку: автор/репозиторій@v1.2.0#папка. Без версії береться останній випуск.'))}</p>
      <div class="acts l"><button class="btn" type="button" data-act="from-gh" ${busy ? 'disabled' : ''}>${esc(t('Перевірити'))}</button></div></div>
    <div class="st-sub"><h3>${esc(t('За адресою'))}</h3><div class="grid"><label for="ex-url">${esc(t('Адреса (https)'))}</label><input id="ex-url" type="url" placeholder="https://example.com/plugin/transly-plugin.json" autocomplete="off" spellcheck="false"></div>
      <div class="acts l"><button class="btn" type="button" data-act="from-url" ${busy ? 'disabled' : ''}>${esc(t('Перевірити'))}</button></div></div>
    <div class="st-sub"><h3>${esc(t('З файлу'))}</h3><p class="hint">${esc(t('Архів .zip чи .transly-plugin, або всі файли розширення разом.'))}</p>
      <div class="acts l"><button class="btn" type="button" data-act="from-file" ${busy ? 'disabled' : ''}>${esc(t('Вибрати файли…'))}</button></div><input type="file" id="ex-file" multiple accept=".zip,.transly-plugin,.json,.po,.md,.txt,.js" hidden></div>
    <div class="st-sub"><h3>${esc(t('Пошук на GitHub'))}</h3><p class="hint">${esc(t('Шукає репозиторії з темою transly-plugin.'))}</p>
      <div class="grid"><label for="ex-q">${esc(t('Що шукати'))}</label><input id="ex-q" placeholder="wolf, renpy, polski…" autocomplete="off"></div>
      <div class="acts l"><button class="btn" type="button" data-act="search" ${busy ? 'disabled' : ''}>${esc(t('Шукати'))}</button></div>
      ${found ? (found.length ? `<div class="ex-list">${found.map(f => `<div class="ex-row"><div class="ex-info"><div class="ex-t"><b>${esc(f.full)}</b><small>★ ${f.stars}</small></div><p class="ex-d">${esc(f.desc)}</p></div><div class="ex-act"><button class="btn s" type="button" data-act="from-found" data-repo="${esc(f.full)}">${esc(t('Перевірити'))}</button></div></div>`).join('')}</div>` : `<p class="hint">${esc(t('Нічого не знайдено'))}</p>`) : ''}</div>`;

  const langHtml = (): string => {
    const langs = i18n.languages(), cur = interfaceLanguage(), miss = i18n.missing().length;
    return `<p class="hint">${esc(t('Мовні пакети встановлюються як розширення. Те, чого немає в пакеті, показується українською.'))}</p>
      <div class="ex-list" role="radiogroup" aria-label="${esc(t('Мова інтерфейсу'))}">${langs.map(l => `<label class="ex-row lang${l.code === cur ? ' on' : ''}"><input type="radio" name="ex-lang" value="${esc(l.code)}" ${l.code === cur ? 'checked' : ''}><div class="ex-info"><div class="ex-t"><b>${esc(l.name)}</b><small>${esc(l.code)}</small></div></div></label>`).join('')}</div>
      <div class="acts l"><button class="btn" type="button" data-act="go-add">${esc(t('Додати мову…'))}</button></div>
      <div class="st-sub"><h3>${esc(t('Для перекладачів'))}</h3><p class="hint">${esc(t('Оберіть мову, пройдіться застосунком і збережіть шаблон: у ньому всі рядки, яких ще немає в пакеті. Його можна перекласти в Poedit, Weblate чи самому Transly.'))}</p>
        <p class="hint">${esc(t('Рядків без перекладу: {n}', { n: miss }))}</p>
        <div class="acts l"><button class="btn" type="button" data-act="lang-pot" ${cur === i18n.source ? 'disabled' : ''}>${esc(t('Зберегти шаблон (.pot)'))}</button></div></div>`;
  };

  const supportHtml = (): string => {
    const engines = plugins.engines(), formats = plugins.formats();
    return `<p class="hint">${esc(t('Ось що застосунок уміє відкривати зараз. Не знайшли свою гру? Додайте розширення для неї.'))}</p>
      <div class="st-sub"><h3>${esc(t('Ігрові рушії'))}</h3><table class="ex-meta"><tbody>${engines.map(e => { const r = plugins.get(e.plugin)!; return `<tr><th scope="row">${esc(tp(r, e.label))}</th><td>${esc(t(STATE[e.state][0]))} · <small>${esc(tp(r, r.manifest.name))}</small></td></tr>`; }).join('')}</tbody></table></div>
      <div class="st-sub"><h3>${esc(t('Формати файлів'))}</h3><table class="ex-meta"><tbody>${formats.map(f => { const r = plugins.get(f.plugin)!; return `<tr><th scope="row">${esc(tp(r, f.label))}</th><td><code>${esc(f.extensions.join(' '))}</code></td></tr>`; }).join('')}</tbody></table></div>
      <div class="acts l"><button class="btn" type="button" data-act="go-add">${esc(t('Додати розширення…'))}</button></div>`;
  };

  // ---------- drawing ----------

  function render(): void {
    const crumbT = page === 'installed' && detail && plugins.get(detail) ? tp(plugins.get(detail)!, plugins.get(detail)!.manifest.name) : plan ? tp({ manifest: plan.pkg.manifest, builtin: false } as PluginRecord, plan.pkg.manifest.name) : t(TITLES[page]);
    crumb.innerHTML = `<span class="vh">${esc(t('Розширення'))}: </span><span>${esc(t('Розширення'))}</span>${CRUMB}<span>${esc(crumbT)}</span>`;
    tree.innerHTML = GROUPS.map(([g, ids]) => `<p class="st-gl">${esc(t(g))}</p>${ids.map(id => `<button type="button" class="st-ti flat" data-p="${id}"${id === page ? ' aria-current="page"' : ''}>${esc(t(TITLES[id]))}</button>`).join('')}`).join('');
    const msg = message ? `<div class="st-warn${message.kind === 'bad' ? ' bad' : ''}" role="${message.kind === 'bad' ? 'alert' : 'status'}"><span class="wi" aria-hidden="true">${message.kind === 'bad' ? '!' : '✓'}</span><div><span>${esc(message.text).replace(/\n/g, '<br>')}</span></div></div>` : '';
    const spin = busy ? `<p class="hint" role="status">${esc(busy)}…</p>` : '';
    const content = plan ? planHtml(plan) : page === 'installed' ? (detail && plugins.get(detail) ? detailHtml(plugins.get(detail)!) : listHtml()) : page === 'add' ? addHtml() : page === 'lang' ? langHtml() : supportHtml();
    const val = (sel: string): string | undefined => dlg.querySelector<HTMLInputElement>(sel)?.value;
    const keep = { gh: val('#ex-gh'), url: val('#ex-url'), q: val('#ex-q') };
    body.innerHTML = msg + spin + content;
    for (const [id, v] of [['#ex-gh', keep.gh], ['#ex-url', keep.url], ['#ex-q', keep.q]] as const) { const i = body.querySelector<HTMLInputElement>(id); if (i && v) i.value = v; }
  }

  // ---------- doing ----------

  const toPlan = (what: string, input: Parameters<typeof ext.plan>[0]): Promise<void> => run(what, async () => { plan = await ext.plan(input); message = null; });

  const doInstall = (): Promise<void> => run(t('Встановлюю'), async () => {
    if (!plan) return;
    const grants = [...body.querySelectorAll<HTMLInputElement>('[data-grant]')].filter(i => i.checked).map(i => i.dataset.grant as PluginPermission).filter(g => PERMISSIONS.includes(g));
    if (plan.hasCode && !body.querySelector<HTMLInputElement>('#ex-trust')?.checked) throw new Error(t('Підтвердьте, що довіряєте автору'));
    const rec = await ext.install(plan, { enable: plan.hasCode ? true : undefined, grants });
    const name = tp(rec, rec.manifest.name);
    plan = null; page = 'installed'; detail = rec.manifest.id;
    note({ kind: 'ok', text: t('«{name}» встановлено', { name }) });
    toast(t('Розширення «{name}» встановлено', { name }));
  });

  dlg.addEventListener('click', e => {
    const tgt = e.target as HTMLElement;
    const link = tgt.closest<HTMLAnchorElement>('a[data-ext-link]');
    if (link) { e.preventDefault(); openLink(link.getAttribute('href') ?? ''); return; }
    const nav = tgt.closest<HTMLElement>('#ex-tree [data-p]');
    if (nav) { page = nav.dataset.p as Page; detail = null; plan = null; message = null; armed = ''; render(); return; }
    const b = tgt.closest<HTMLElement>('[data-act]');
    if (!b || b.tagName === 'INPUT' || b.tagName === 'SELECT') return;
    const id = b.dataset.id ?? '';
    switch (b.dataset.act) {
      case 'open': detail = id; message = null; armed = ''; render(); break;
      case 'back': detail = null; message = null; armed = ''; render(); break;
      case 'cancel-plan': plan = null; message = null; render(); break;
      case 'go-add': page = 'add'; message = null; render(); break;
      case 'from-gh': { const v = ($('#ex-gh', body) as HTMLInputElement).value.trim(); if (!v) { note({ kind: 'bad', text: t('Напишіть автор/репозиторій') }); render(); break; } void toPlan(t('Перевіряю репозиторій'), { kind: 'github', ref: v }); break; }
      case 'from-url': { const v = ($('#ex-url', body) as HTMLInputElement).value.trim(); if (!v) { note({ kind: 'bad', text: t('Вставте адресу') }); render(); break; } void toPlan(t('Завантажую'), { kind: 'url', url: v }); break; }
      case 'from-file': ($('#ex-file', body) as HTMLInputElement).click(); break;
      case 'from-found': void toPlan(t('Перевіряю репозиторій'), { kind: 'github', ref: b.dataset.repo ?? '' }); break;
      case 'search': void run(t('Шукаю'), async () => {
        const q = ($('#ex-q', body) as HTMLInputElement).value.trim();
        const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(`topic:transly-plugin ${q}`.trim())}&sort=stars&per_page=20`;
        const res = await ext.fetcher(url, { headers: { Accept: 'application/vnd.github+json' } });
        if (!res.ok) throw new Error(t('GitHub відповів {n}: спробуйте за хвилину', { n: res.status }));
        const j = await res.json() as { items?: { full_name?: string; description?: string | null; stargazers_count?: number }[] };
        found = (j.items ?? []).filter(i => typeof i.full_name === 'string').map(i => ({ full: i.full_name!, desc: String(i.description ?? ''), stars: Number(i.stargazers_count ?? 0) }));
      }); break;
      case 'do-install': void doInstall(); break;
      case 'check': void run(t('Перевіряю оновлення'), async () => { const r = await ext.checkUpdate(id); if (r.error) throw new Error(r.error); updates.set(id, r.available); note({ kind: 'ok', text: r.available ? t('Є нова версія {v}', { v: r.available }) : t('Це остання версія') }); }); break;
      case 'update': void run(t('Завантажую оновлення'), async () => { plan = await ext.planUpdate(id); message = null; }); break;
      case 'remove':
        if (armed !== id) { armed = id; render(); setTimeout(() => { if (armed === id) { armed = ''; render(); } }, 6000); break; }
        { const deps = ext.dependents(id); void run(t('Видаляю'), async () => { await ext.uninstall(id); armed = ''; detail = null; note({ kind: 'ok', text: deps.length ? t('Видалено. Від нього залежали: {list}', { list: deps.map(d => d.name).join(', ') }) : t('Видалено') }); }); }
        break;
      case 'pot': { const r = plugins.get(id); if (r) { const lang = i18n.language !== i18n.source ? i18n.language : 'en'; void saveFile(`${id}.pot`, pluginTemplate(r.manifest, lang, p => r.files.get(p)), 'text/plain'); } break; }
      case 'lang-pot': void saveFile(`transly-${interfaceLanguage()}.pot`, i18n.template(interfaceLanguage()), 'text/plain'); break;
      case 'use-lang': setInterfaceLanguage(b.dataset.code ?? ''); render(); break;
    }
  });

  dlg.addEventListener('change', e => {
    const x = e.target as HTMLInputElement | HTMLSelectElement;
    if (x.matches('input[name=ex-lang]')) { setInterfaceLanguage(x.value); render(); return; }
    if (x.dataset.act === 'toggle') {
      const id = x.dataset.id!, on = (x as HTMLInputElement).checked, rec = plugins.get(id);
      if (on && rec?.manifest.main && !rec.builtin) { (x as HTMLInputElement).checked = false; note({ kind: 'bad', text: t('Розширення з кодом вмикається лише через встановлення: так ви бачите, чого воно просить') }); render(); return; }
      void run(t('Зберігаю'), async () => { await ext.setEnabled(id, on); });
      return;
    }
    if (x.dataset.act === 'setting') {
      const { id, key, scope, type } = x.dataset as Record<string, string>;
      const v: string | number | boolean = type === 'boolean' ? (x as HTMLInputElement).checked : type === 'number' ? Number(x.value) : x.value;
      if (scope === 'project') { const all = acts.projectValues(); all[id!] = { ...(all[id!] ?? {}), [key!]: v }; acts.saveProjectValues(); }
      else { try { localStorage.setItem(SETTINGS_KEY(id!), JSON.stringify({ ...readApp(id!), [key!]: v })); } catch { /* not kept */ } }
      return;
    }
    if (x.id === 'ex-file') {
      const input = x as HTMLInputElement, files = [...(input.files ?? [])];
      input.value = '';
      if (!files.length) return;
      void run(t('Читаю файли'), async () => {
        const read = await Promise.all(files.map(async f => ({ name: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name, data: new Uint8Array(await f.arrayBuffer()) })));
        plan = await ext.plan({ kind: 'files', files: read }); message = null;
      });
    }
  });

  $('#ex-done', dlg).addEventListener('click', () => dlg.close());
  const unsub = plugins.subscribe(() => { if (dlg.open && !busy) render(); });
  const unlang = i18n.onChange(() => { if (dlg.open) render(); });
  dlg.addEventListener('close', () => { unsub(); unlang(); });
  render();
  return dlg;
}
