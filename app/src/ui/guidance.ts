import { i18n, plugins, t } from '../core';
import { $, esc } from './dom';
import { ext } from './ext';
import { suggestForFiles } from './ext-catalog';
import { miniMarkdown } from './minimd';
import { dialog } from './settings';
import { tp } from './ext-dialog';

/**
 * What to say when a folder or a file cannot be read: not «nothing found», but what the application thinks it is, which plugin would read it (and whether it
 * is installed, switched off, or not there yet), what the application reads now, and the help the plugins bring for that kind of game.
 */
export interface Guidance {
  /** The paths of the files seen in the picked place (all of them when the browser lists them, otherwise only the ones it could read). */
  names: string[];
  /** Why we are here: nothing readable at all, or files that were read but had no text. */
  why: 'nothing' | 'empty';
  /** Open the manager of extensions: on the page that adds one, or (with the id of a plugin) on the catalog, looking for that plugin. */
  addExtension: (catalogQuery?: string) => void;
}

export function openGuidance(g: Guidance): HTMLDialogElement {
  const found = plugins.detect(g.names);
  const engines = plugins.engines().filter(e => e.state === 'enabled');
  const head = g.why === 'nothing' ? t('У вибраному місці немає файлів, які застосунок уміє перекладати') : t('У цих файлах немає тексту для перекладу');
  const matches = found.map(m => {
    const r = plugins.get(m.engine.plugin)!;
    const state = r.state === 'enabled' ? t('Розширення «{name}» увімкнено, але файлів із текстом у цьому місці не знайдено. Перевірте, чи обрано папку самої гри (не батьківську, не вкладену).', { name: tp(r, r.manifest.name) })
      : r.state === 'disabled' ? t('Це схоже на гру на «{engine}». Розширення «{name}» вимкнено: увімкніть його.', { engine: tp(r, m.engine.label as never), name: tp(r, r.manifest.name) })
      : r.reason ?? t('Розширення «{name}» не працює', { name: tp(r, r.manifest.name) });
    const helpRef = m.engine.help ? plugins.helpById(m.engine.help) : null;
    return `<div class="st-sub"><h3>${esc(tp(r, m.engine.label))}</h3><p>${esc(state)}</p>
      ${r.state === 'disabled' ? `<div class="acts l"><button class="btn p" type="button" data-g="enable" data-id="${esc(r.manifest.id)}">${esc(t('Увімкнути розширення'))}</button></div>` : ''}
      ${helpRef ? `<details open><summary>${esc(tp(r, helpRef.title))}</summary><div class="ex-md">${miniMarkdown(tp(r, helpRef.body))}</div></details>` : ''}</div>`;
  }).join('');
  const none = found.length ? '' : `<p>${esc(t('Застосунок не впізнав цю гру. Можливо, для її рушія потрібне окреме розширення.'))}</p>
    <div class="acts l"><button class="btn p" type="button" data-g="add">${esc(t('Знайти розширення…'))}</button></div>`;
  const dlg = dialog(`<form method="dialog"><h2 id="gd-t">${esc(head)}</h2>
    <div class="gd-body">${matches}<div id="gd-sug"></div>${none}
      <div class="st-sub"><h3>${esc(t('Що застосунок уміє читати зараз'))}</h3>
        <p>${esc(engines.map(e => tp(plugins.get(e.plugin)!, e.label)).join(', ') || '—')}</p>
        <p class="hint">${esc(t('Формати файлів'))}: ${esc(plugins.extensions().join(' '))}</p></div>
      ${g.names.length ? `<details><summary>${esc(t('Що знайдено в обраному місці ({n})', { n: g.names.length }))}</summary><p class="hint gd-files">${esc(g.names.slice(0, 40).join('\n')).replace(/\n/g, '<br>')}${g.names.length > 40 ? `<br>…` : ''}</p></details>` : ''}
    </div>
    <div class="acts"><button class="btn" type="button" data-g="manage">${esc(t('Розширення…'))}</button><button class="btn p" value="cancel">${esc(t('Зрозуміло'))}</button></div></form>`, 'gd-t');
  dlg.classList.add('gd-dlg');
  dlg.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-g]');
    if (!b) return;
    if (b.dataset.g === 'enable') void ext.setEnabled(b.dataset.id!, true).then(() => { dlg.close(); });
    else if (b.dataset.g === 'catalog') { dlg.close(); g.addExtension(b.dataset.id); }
    else { dlg.close(); g.addExtension(); }
  });
  // the catalog may know a plugin for this kind of folder (told from its files); the answer comes without the net
  if (!found.length) void suggestForFiles(g.names).then(list => {
    const box = dlg.querySelector('#gd-sug');
    if (!box || !list.length) return;
    box.innerHTML = `<div class="st-sub"><h3>${esc(t('Можливо, підійде з каталогу'))}</h3>${list.map(x => `<p><b>${esc(x.entry.name)}</b>${x.entry.description ? ` — ${esc(x.entry.description)}` : ''} <button class="btn s" type="button" data-g="catalog" data-id="${esc(x.entry.id)}">${esc(t('Показати в каталозі'))}</button></p>`).join('')}</div>`;
  });
  void i18n;
  void $;
  return dlg;
}
