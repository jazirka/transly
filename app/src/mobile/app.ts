import { canonicalRpgMakerName, claudeSync, formatOf, githubSync, isTextFormat, looksLikeProject, sceneLines, sceneUnits, speakerCandidates } from '../core';
import type { GameFile } from '../core';
import { artifactDb, describeClaude, loadClaudeConfig, saveClaudeConfig } from '../ui/claude';
import { describeGithub, githubApi, githubConfigured, loadGithubConfig, saveGithubConfig } from '../ui/github';
import { esc, plural } from '../ui/dom';
import { markup } from '../ui/markup';
import { androidBridge, publishWidget } from '../ui/android';
import { FILTERS, STATUS_LABEL, Store } from './store';
import type { Filter, Shown, Sort } from './store';
import { icon } from './icons';
import { canUpdate, checkUpdate, installUpdate, loadUpdateCfg, saveUpdateCfg } from './update';
import type { UpdateCheck } from './update';

type Tab = 'files' | 'rows' | 'edit' | 'more';
const TAB_LABEL: Record<Tab, string> = { files: 'Файли', rows: 'Рядки', edit: 'Переклад', more: 'Ще' };
const SHAPE: Record<Shown, string> = { new: 'sd-new', draft: 'sd-draft', done: 'sd-done', appr: 'sd-appr', qa: 'sd-qa' };

export async function start(root: HTMLElement): Promise<void> {
  const store = await Store.open();
  let tab: Tab = store.hasGame ? (store.key ? 'edit' : 'rows') : 'more';
  let sheet = false;
  let busy = '';
  type Sub = 'scene' | 'find' | 'speakers' | 'settings' | 'consistency';
  let sub: Sub | null = null;
  let scope: 'file' | 'all' = 'file';
  let layout: 'cards' | 'table' = (() => { try { return localStorage.getItem('transly-m-layout') === 'table' ? 'table' : 'cards'; } catch { return 'cards'; } })();
  const fr = { find: '', replace: '', word: false, cs: false, matches: [] as ReturnType<typeof store.find> };
  const sp = { q: '', draft: new Map<string, string>() };
  let upd: UpdateCheck | null = null;
  let updMsg = '';

  root.innerHTML = `<div class="m-app" id="m-app">
    <header class="m-bar" id="m-bar"></header>
    <main class="m-main" id="m-main"></main>
    <div class="m-sheet-wrap" id="m-sheet" hidden></div>
    <nav class="m-nav" id="m-nav" role="tablist" aria-label="Розділи"></nav>
    <div class="m-toasts" id="m-toasts" role="status"></div>
    <input type="file" id="m-file" multiple hidden>
  </div>`;
  const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

  const say = (text: string, bad = false): void => {
    const t = document.createElement('div'); t.className = 'm-toast' + (bad ? ' bad' : ''); t.textContent = text;
    $('m-toasts').appendChild(t); setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 220); }, bad ? 6000 : 3200);
  };
  const buzz = (ms = 10): void => { try { navigator.vibrate?.(ms); } catch { /* no vibrator */ } };
  const go = (t: Tab): void => { tab = t; sheet = false; sub = null; render(); };
  const SUB_TITLE: Record<Sub, string> = { scene: 'Сцена', find: 'Знайти й замінити', speakers: 'Хто говорить', settings: 'Налаштування', consistency: 'Узгодженість' };

  /* ---------- chrome ---------- */
  function renderChrome(): void {
    const tot = store.totals();
    const pct = tot.total ? Math.floor((100 * tot.translated) / tot.total) : 0;
    const title = tab === 'files' ? 'Файли гри' : tab === 'rows' ? (store.view()?.label ?? store.file ?? 'Рядки') : tab === 'edit' ? (store.file ?? 'Переклад') : 'Ще';
    const subline = tab === 'more' || !store.hasGame || sub ? '' : `Перекладено ${pct}% · ${store.saveOk ? 'збережено' : 'не збережено!'}`;
    $('m-bar').innerHTML = `${sub ? '<button class="m-back" data-subback aria-label="Назад">' + icon('prev') + '</button>' : ''}<div class="m-title"><b>${esc(sub ? SUB_TITLE[sub] : title)}</b>${subline ? `<small class="${store.saveOk ? '' : 'bad'}">${esc(subline)}</small>` : ''}</div>${busy ? `<span class="m-busy" role="status">${esc(busy)}</span>` : ''}`;
    $('m-nav').innerHTML = (Object.keys(TAB_LABEL) as Tab[]).map(t => `<button role="tab" data-go="${t}" aria-selected="${t === tab}" class="${t === tab ? 'on' : ''}" ${(t === 'rows' || t === 'edit') && !store.hasGame ? 'disabled' : ''}>${icon(t)}<span>${TAB_LABEL[t]}</span></button>`).join('');
    if (androidBridge()) {
      const cur = store.view();
      const next = cur?.units.find(u => !store.entry(cur.name, u.key)?.target && u.kind !== 'name' && u.kind !== 'term');
      publishWidget({ name: store.saved.name, file: store.file ?? '', total: tot.total, approved: tot.approved, done: tot.done, draft: Math.max(0, tot.translated - tot.approved - tot.done), ...(cur && next ? { next: { file: cur.name, key: next.key, text: next.source.replace(/\s+/g, ' ').slice(0, 160) } } : {}) });
    }
  }

  /* ---------- screens ---------- */
  function bar(done: number, total: number): string { const p = total ? Math.round((100 * done) / total) : 0; return `<span class="m-meter" aria-hidden="true"><i style="width:${p}%"></i></span>`; }

  function screenFiles(): string {
    if (!store.hasGame) return empty('Файлів ще немає', 'Відкрийте файли гри або проєкт у розділі «Ще».', 'more', 'Відкрити файли');
    return `<ul class="m-list">${store.views.map(v => {
      const st = store.stats(v.name), pc = st.total ? Math.round((100 * st.translated) / st.total) : 0;
      return `<li><button class="m-item ${v.name === store.file ? 'cur' : ''}" data-file="${esc(v.name)}"><span class="m-ico">${/^Map\d+\.json$/.test(v.name) ? 'MAP' : '{ }'}</span><span class="m-item-t"><b>${esc(v.label ?? v.name.replace(/\.json$/, ''))}</b><small>${esc(v.label ? v.name.replace(/\.json$/, '') : plural(st.total, ['рядок', 'рядки', 'рядків']))}</small>${bar(st.translated, st.total)}</span><span class="m-pc">${pc}%</span></button></li>`;
    }).join('')}</ul>`;
  }

  function screenRows(): string {
    const v = store.view();
    if (!v) return empty('Файл не вибрано', 'Оберіть файл у розділі «Файли».', 'files', 'До файлів');
    if (scope === 'all') return screenAll();
    const rows = store.rows(), shown = rows.slice(0, 400);
    const chips = FILTERS.map(([f, l]) => `<button class="m-chip ${store.filter === f ? 'on' : ''}" data-filter="${f}" aria-pressed="${store.filter === f}">${l}</button>`).join('');
    return `<div class="m-tools"><label class="m-search">${icon('search')}<input id="m-q" type="search" placeholder="Пошук у файлі" value="${esc(store.q)}" enterkeyhint="search" autocomplete="off"></label>
      <div class="m-scoperow"><div class="m-scope" role="group" aria-label="Де шукати"><button class="on" data-scope="file">Файл</button><button data-scope="all">Усі файли</button></div>
      <div class="m-scope" role="group" aria-label="Вигляд"><button class="${layout === 'cards' ? 'on' : ''}" data-layout="cards">Картки</button><button class="${layout === 'table' ? 'on' : ''}" data-layout="table">Таблиця</button></div></div>
      <div class="m-chips" role="group" aria-label="Фільтр">${chips}</div>
      <div class="m-sortrow"><span>${rows.length} з ${v.units.length}</span><select id="m-sort" aria-label="Порядок">${(['order', 'new', 'qa', 'long'] as Sort[]).map(s => `<option value="${s}" ${store.sort === s ? 'selected' : ''}>${{ order: 'За порядком', new: 'Спершу без перекладу', qa: 'Спершу проблеми', long: 'Спершу найдовші' }[s]}</option>`).join('')}</select></div></div>
      ${layout === 'table' ? tableHtml(v.name, shown, rows.length) : `<ul class="m-list rows">${shown.map((u, i) => {
        const e = store.entry(v.name, u.key), st = store.shown(u, e);
        return `<li><button class="m-row ${u.key === store.key ? 'cur' : ''}" data-key="${esc(u.key)}"><span class="sd ${SHAPE[st]}" title="${STATUS_LABEL[st]}"></span><span class="m-row-t"><small>${i + 1} · ${esc(store.speaker(u) || u.kind)}</small><span class="m-src">${esc(u.source.replace(/\s+/g, ' '))}</span><span class="m-tr ${e?.target ? '' : 'none'}">${e?.target ? esc(e.target.replace(/\s+/g, ' ')) : '—'}</span></span></button></li>`;
      }).join('') || '<li class="m-none">Нічого не знайдено</li>'}${rows.length > shown.length ? `<li class="m-none">Показано ${shown.length} з ${rows.length}: уточніть пошук</li>` : ''}</ul>`}`;
  }

  /** The table: columns scroll sideways, a tap on a translation writes right in the cell, a tap on a number opens the row. */
  function tableHtml(file: string, rows: ReturnType<typeof store.rows>, total: number): string {
    const v = store.view(file); const all = v?.units ?? [];
    const idx = new Map(all.map((u, i) => [u.key, i + 1]));
    return `<div class="m-twrap"><table class="m-table"><thead><tr><th class="c-n">№</th><th class="c-s"></th><th class="c-o">Оригінал</th><th class="c-t">Переклад</th><th class="c-l">Знаків</th></tr></thead><tbody>${rows.map(u => {
      const e = store.entry(file, u.key), st = store.shown(u, e), t = e?.target ?? '';
      return `<tr data-trkey="${esc(u.key)}"><td class="c-n" data-key="${esc(u.key)}" title="Відкрити в редакторі">${idx.get(u.key)}</td><td class="c-s"><span class="sd ${SHAPE[st]}" title="${STATUS_LABEL[st]}"></span></td><td class="c-o" data-key="${esc(u.key)}">${esc(u.source)}</td><td class="c-t ${t ? '' : 'none'}" data-cell="${esc(u.key)}">${t ? esc(t) : '—'}</td><td class="c-l">${t ? `${[...t].length}/${[...u.source].length}` : '—'}</td></tr>`;
    }).join('')}</tbody></table>${total > rows.length ? `<p class="m-none">Показано ${rows.length} з ${total}: уточніть пошук</p>` : ''}</div>`;
  }

  /** Start writing in a table cell. */
  function editCell(td: HTMLElement): void {
    if (td.querySelector('textarea')) return;
    const key = td.dataset.cell!, file = store.file!;
    const cur = store.entry(file, key)?.target ?? '';
    td.innerHTML = '<textarea class="m-cell" rows="2" spellcheck="false" aria-label="Переклад"></textarea>';
    const ta = td.querySelector('textarea') as HTMLTextAreaElement; ta.value = cur;
    const fit = (): void => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; };
    fit(); ta.focus(); ta.setSelectionRange(cur.length, cur.length);
    ta.addEventListener('input', fit);
    let cancelled = false;
    ta.addEventListener('keydown', ev => { if (ev.key === 'Escape') { cancelled = true; ta.blur(); } });
    ta.addEventListener('blur', () => {
      if (!cancelled && ta.value !== cur) store.writeAt(file, key, ta.value);
      const t = store.entry(file, key)?.target ?? '';
      td.className = 'c-t' + (t ? '' : ' none'); td.textContent = t || '—';
      const row = td.closest('tr'); const u = store.unit(file, key);
      const l = row?.querySelector('.c-l'); if (l && u) l.textContent = t ? `${[...t].length}/${[...u.source].length}` : '—';
      const sd = row?.querySelector('.sd'); if (sd && u) { const st = store.shown(u, store.entry(file, key)); sd.className = 'sd ' + SHAPE[st]; }
    });
  }

  function screenAll(): string {
    const hits = store.findAll(store.q);
    return `<div class="m-tools"><label class="m-search">${icon('search')}<input id="m-q" type="search" placeholder="Пошук у всіх файлах" value="${esc(store.q)}" enterkeyhint="search" autocomplete="off"></label>
      <div class="m-scope" role="group" aria-label="Де шукати"><button data-scope="file">Файл</button><button class="on" data-scope="all">Усі файли</button></div></div>
      <ul class="m-list rows">${hits.map(h => {
        const e = store.entry(h.file, h.unit.key), st = store.shown(h.unit, e);
        return `<li><button class="m-row" data-hit="${esc(h.file)}" data-hitkey="${esc(h.unit.key)}"><span class="sd ${SHAPE[st]}"></span><span class="m-row-t"><small>${esc(store.view(h.file)?.label ?? h.file)} · ${esc(h.unit.kind)}</small><span class="m-src">${esc(h.unit.source.replace(/\s+/g, ' '))}</span><span class="m-tr ${e?.target ? '' : 'none'}">${e?.target ? esc(e.target.replace(/\s+/g, ' ')) : '—'}</span></span></button></li>`;
      }).join('') || `<li class="m-none">${store.q.trim() ? 'Нічого не знайдено' : 'Введіть слово для пошуку'}</li>`}${hits.length >= 200 ? '<li class="m-none">Показано перші 200: уточніть пошук</li>' : ''}</ul>`;
  }

  /* ---------- sub-screens (opened from the editor or «Ще») ---------- */
  function screenScene(): string {
    const c = store.current, v = store.view();
    if (!c || !v) return empty('Рядок не вибрано', 'Спершу оберіть рядок.', 'rows', 'До рядків');
    const lines = sceneLines(sceneUnits(v.units, c.unit.key));
    const one = (u: (typeof v.units)[number]): string => {
      const e = store.entry(v.name, u.key), st = store.shown(u, e);
      return `<button class="m-bubble ${u.key === c.unit.key ? 'cur' : ''}" data-scenekey="${esc(u.key)}"><span class="sd ${SHAPE[st]}" title="${STATUS_LABEL[st]}"></span><span class="m-row-t">${store.speaker(u) ? `<small>${esc(store.speaker(u))}</small>` : ''}<span>${esc(u.source)}</span><span class="m-tr ${e?.target ? '' : 'none'}">${e?.target ? esc(e.target) : '—'}</span></span></button>`;
    };
    return `<div class="m-more"><p class="m-hint">Усі рядки цієї події поспіль, як їх побачить гравець. Торкніться рядка, щоб перейти до нього.</p>
      ${lines.map(l => l.kind === 'choice' ? `<div class="m-choice"><small>Вибір</small>${l.units.map(one).join('')}</div>` : one(l.unit)).join('')}
      <button class="m-primary wide" data-scenesend>${icon('check')}<span>${store.stage === 'translate' ? 'Надіслати всю сцену на вичитування' : 'Затвердити всю сцену'}</span></button></div>`;
  }

  function screenFind(): string {
    return `<div class="m-more"><section class="m-card"><label class="m-lbl" for="f-find">Що замінити</label><input id="f-find" class="m-input" value="${esc(fr.find)}" autocomplete="off" spellcheck="false">
      <label class="m-lbl" for="f-rep">На що</label><input id="f-rep" class="m-input" value="${esc(fr.replace)}" autocomplete="off" spellcheck="false">
      <label class="m-check"><input type="checkbox" id="f-word" ${fr.word ? 'checked' : ''}> Лише ціле слово</label><label class="m-check"><input type="checkbox" id="f-case" ${fr.cs ? 'checked' : ''}> З урахуванням регістру</label>
      <button class="m-secondary wide" data-dofind>Знайти в перекладах</button></section>
      ${fr.matches.length ? `<section class="m-card"><h3>Знайдено: ${fr.matches.length}</h3>${fr.matches.slice(0, 60).map(m => `<div class="m-diff"><small>${esc(m.file)}</small><s>${esc(m.before)}</s><span>${esc(m.after)}</span></div>`).join('')}${fr.matches.length > 60 ? `<p class="m-hint">Показано 60 із ${fr.matches.length}. Заміна торкнеться всіх.</p>` : ''}<button class="m-primary wide" data-doreplace>Замінити в усіх (${fr.matches.length})</button></section>` : ''}</div>`;
  }

  function screenSpeakers(): string {
    const cands = speakerCandidates(store.views), q = sp.q.trim().toLowerCase();
    const list = cands.filter(c => !q || (c.label + ' ' + c.sample).toLowerCase().includes(q));
    const val = (k: string): string => sp.draft.get(k) ?? store.saved.speakers?.[k]?.name ?? '';
    return `<div class="m-more"><p class="m-hint">У грі на RPG Maker MV імен мовців немає. Підказують обличчя персонажа, подія чи позначка розробників: назвіть кожен варіант один раз, і ім'я отримають усі репліки з ним.</p>
      <label class="m-search">${icon('search')}<input id="sp-q" type="search" placeholder="Обличчя, подія або текст" value="${esc(sp.q)}" autocomplete="off"></label>
      ${list.slice(0, 60).map(c => `<div class="m-sp"><small>${{ hdr: 'Напис у тексті', face: 'Обличчя', note: 'Позначка', event: 'Подія' }[c.kind]} · ${c.count}</small><b>${esc(c.label)}</b><span class="m-hint">${esc(c.sample)}</span><input class="m-input m-spin" data-k="${esc(c.key)}" value="${esc(val(c.key))}" placeholder="Хто це?" autocomplete="off"></div>`).join('') || '<p class="m-none">Нічого не знайдено</p>'}
      <button class="m-primary wide" data-spsave>Зберегти імена</button></div>`;
  }

  function screenConsistency(): string {
    const groups = store.inconsistent();
    if (!groups.length) return '<div class="m-more"><p class="m-none">Однакові оригінали перекладено однаково</p></div>';
    return `<div class="m-more"><p class="m-hint">Один оригінал перекладено по-різному. Оберіть варіант, і він з'явиться в усіх рядках.</p>${groups.map((g, gi) => `<section class="m-card"><b>${esc(g.source.slice(0, 120))}</b>${g.variants.map((v, vi) => `<div class="m-var"><span>${esc(v.target.slice(0, 160))}</span><small>${plural(v.where.length, ['рядок', 'рядки', 'рядків'])}</small><button class="m-mini" data-uni="${gi}|${vi}">Лишити цей</button><button class="m-mini ghost" data-hit="${esc(v.where[0]!.file)}" data-hitkey="${esc(v.where[0]!.key)}">Відкрити</button></div>`).join('')}</section>`).join('')}</div>`;
  }

  function screenSettings(): string {
    const st = store.saved.settings, lim = st.lineLimit;
    return `<div class="m-more"><section class="m-card"><label class="m-lbl" for="s-tol">Допуск довжини перекладу відносно оригіналу, %</label><input id="s-tol" class="m-input" type="number" min="5" max="100" step="5" value="${st.tolerancePct}">
      <label class="m-lbl" for="s-mode">Ширина рядка в повідомленні (вікно гри)</label><select id="s-mode" class="m-input"><option value="auto" ${lim === 0 ? 'selected' : ''}>За оригіналом гри (зараз ${store.lineLimit() || '—'})</option><option value="custom" ${lim > 0 ? 'selected' : ''}>Своє число</option><option value="off" ${lim < 0 ? 'selected' : ''}>Не перевіряти</option></select>
      <input id="s-lim" class="m-input" type="number" min="10" max="200" value="${lim > 0 ? lim : store.lineLimit() || 50}" ${lim > 0 ? '' : 'disabled'} aria-label="Символів у рядку">
      <label class="m-check"><input type="checkbox" id="s-block" ${st.blockErrors ? 'checked' : ''}> Не надсилати рядок із помилкою QA</label>
      <label class="m-check"><input type="checkbox" id="s-prop" ${st.propagate ? 'checked' : ''}> Переносити переклад в однакові рядки</label>
      <label class="m-lbl" for="s-who">Ваше ім’я в коментарях та історії</label><input id="s-who" class="m-input" value="${esc(st.who)}" maxlength="40" autocomplete="off"></section>
      <p class="m-hint">Довжина тексту не обмежується: застосунок лише попереджає, коли переклад дуже відрізняється від оригіналу або рядок ширший за вікно гри.</p></div>`;
  }

  function issuesHtml(): string {
    const c = store.current; if (!c) return '';
    return store.issues(c.unit, c.entry).map(i => `<div class="m-issue ${i.severity}"><div class="m-issue-t"><span class="sd ${i.severity === 'bad' ? 'sd-qa' : 'sd-draft'}"></span><span>${esc(i.message)}</span></div><div class="m-issue-a">${i.codes?.length ? `<button class="m-mini" data-ins="${esc(i.codes.join(''))}">Вставити</button>` : ''}${i.key === 'wrap' ? '<button class="m-mini" data-wrap>Перенести</button>' : ''}<button class="m-mini ghost" data-ign="${i.key}">Ігнорувати</button></div></div>`).join('');
  }

  function screenEdit(): string {
    const c = store.current;
    if (!c) return empty('Рядок не вибрано', 'Оберіть рядок зі списку.', 'rows', 'До рядків');
    const u = c.unit, e = c.entry, st = store.shown(u, e), v = store.view();
    const terms = store.terms(u), hasHints = terms.length + store.suggestions(u, e).length + (e?.comments?.length ?? 0) > 0;
    const list = store.rows(), pos = list.findIndex(x => x.key === u.key);
    const review = store.stage === 'review';
    return `<div class="m-edit" id="m-edit">
      <div class="m-ctx"><span class="m-tag">${esc(u.kind)}</span>${store.speaker(u) ? `<span class="m-tag who">${esc(store.speaker(u))}</span>` : ''}${v?.label ? `<span class="m-tag">${esc(v.label)}</span>` : ''}<span class="m-status"><span class="sd ${SHAPE[st]}"></span>${STATUS_LABEL[st]}</span></div>
      <section class="m-card"><h3>Оригінал</h3><div class="m-source" id="m-source">${markup(u.source, terms.map(t => t.en))}</div>${store.refs(c.file, u.key).map(r => `<div class="m-ref"><small>Довідка · ${esc(r.lang.toUpperCase())}</small>${esc(r.text)}</div>`).join('')}</section>
      <section class="m-card m-tr-card"><h3>${review ? 'Після вичитування' : 'Переклад'}<span class="m-count" id="m-count"></span></h3>
        <textarea id="m-tr" class="m-textarea" spellcheck="false" autocapitalize="sentences" placeholder="Напишіть переклад…" aria-label="Переклад">${esc(e?.target ?? '')}</textarea>
      </section>
      <div id="m-issues" class="m-issues">${issuesHtml()}</div>
      <div class="m-tools-row"><button class="m-mini" data-copy>${icon('copy')} Оригінал</button>${hasHints ? `<button class="m-mini" data-sheet>${icon('book')} Підказки</button>` : ''}<button class="m-mini" data-sub="scene">${icon('rows')} Сцена</button><button class="m-mini ghost" data-clear>Очистити</button></div>
      <div class="m-pos">${pos >= 0 ? `${pos + 1} / ${list.length}` : ''}</div>
    </div>
    <div class="m-actions" id="m-actions"><button class="m-ic" data-step="-1" aria-label="Попередній рядок" ${store.neighbour(-1) ? '' : 'disabled'}>${icon('prev')}</button><button class="m-ic" data-step="1" aria-label="Наступний рядок" ${store.neighbour(1) ? '' : 'disabled'}>${icon('next')}</button><button class="m-primary" data-send>${icon('check')}<span>${review ? 'Затвердити' : 'Надіслати'}</span></button></div>`;
  }

  function screenMore(): string {
    const gh = loadGithubConfig(), tot = store.totals();
    const pct = tot.total ? Math.floor((100 * tot.translated) / tot.total) : 0;
    return `<div class="m-more">
      ${store.hasGame ? `<section class="m-card"><h3>Прогрес</h3><div class="m-big">${pct}%</div>${bar(tot.translated, tot.total)}<p class="m-hint">Перекладено ${tot.translated} з ${tot.total} · на вичитуванні ${tot.done} · вичитано ${tot.approved}</p>
        <div class="m-seg" role="group" aria-label="Етап"><button data-stage="translate" class="${store.stage === 'translate' ? 'on' : ''}">Переклад</button><button data-stage="review" class="${store.stage === 'review' ? 'on' : ''}">Вичитування</button></div></section>` : ''}
      <section class="m-card"><h3>Відкрити</h3><p class="m-hint">На телефоні проєкт береться з комп’ютера або з GitHub. Можна також відкрити файли гри чи файл проєкту (<code>.transly.json</code>).</p>
        <button class="m-primary wide" data-pick>${icon('folder')}<span>Обрати файли…</span></button>
        <label class="m-lbl" for="m-paste">Або вставте вміст файлу</label><textarea id="m-paste" class="m-textarea sm" rows="3" spellcheck="false" placeholder='{"version":1,…}'></textarea>
        <div id="m-namebox" hidden><label class="m-lbl" for="m-pname">Назва файлу гри</label><input id="m-pname" class="m-input" placeholder="Map001.json" autocomplete="off"></div>
        <button class="m-secondary wide" data-paste>Імпортувати вставлене</button></section>
      <section class="m-card"><h3>Синхронізація через GitHub</h3>
        <label class="m-lbl" for="g-repo">Репозиторій</label><input id="g-repo" class="m-input" value="${esc(gh.repo)}" placeholder="власник/назва" autocomplete="off" spellcheck="false">
        <label class="m-lbl" for="g-token">Токен доступу</label><input id="g-token" class="m-input" type="password" value="${esc(gh.token)}" autocomplete="off" spellcheck="false">
        <details class="m-det"><summary>Додатково</summary><label class="m-lbl" for="g-branch">Гілка</label><input id="g-branch" class="m-input" value="${esc(gh.branch)}" placeholder="основна" autocomplete="off"><label class="m-lbl" for="g-dir">Папка в репозиторії</label><input id="g-dir" class="m-input" value="${esc(gh.dir)}" placeholder="корінь" autocomplete="off"></details>
        <button class="m-primary wide" data-ghsync ${busy ? 'disabled' : ''}>${icon('sync')}<span>Синхронізувати</span></button><p class="m-hint" id="m-ghstate">${gh.last ? 'Востаннє: ' + new Date(gh.last).toLocaleString('uk-UA') : 'Ще не синхронізовано'}</p></section>
      <section class="m-card" id="m-claude" hidden><h3>Синхронізація через Claude</h3><p class="m-hint">Спільна база артефакту: працює між вашими пристроями.</p><button class="m-secondary wide" data-clsync>${icon('sync')}<span>Синхронізувати через Claude</span></button></section>
      ${store.hasGame ? `<section class="m-card"><h3>Інструменти</h3><div class="m-links"><button data-sub="find">Знайти й замінити</button><button data-sub="speakers">Хто говорить</button><button data-sub="consistency">Узгодженість</button><button data-sub="settings">Налаштування</button></div></section>` : ''}
      ${canUpdate() ? updateSection() : ''}
      <section class="m-card"><h3>Проєкт</h3><label class="m-lbl" for="m-who">Ваше ім’я в коментарях</label><input id="m-who" class="m-input" value="${esc(store.who)}" maxlength="40" autocomplete="off">
        <button class="m-secondary wide" data-export>Зберегти проєкт у файл</button></section>
    </div>`;
  }

  function updateSection(): string {
    const cfg = loadUpdateCfg();
    return `<section class="m-card"><h3>Оновлення застосунку</h3>
      ${upd?.newer ? `<p class="m-hint ok">Доступна нова версія (${esc(upd.release.sha.slice(0, 7))}).</p>` : ''}
      <label class="m-lbl" for="u-token">Токен GitHub лише для читання</label><input id="u-token" class="m-input" type="password" value="${esc(cfg.token)}" autocomplete="off" spellcheck="false">
      <label class="m-check"><input type="checkbox" id="u-auto" ${cfg.auto ? 'checked' : ''}> Перевіряти при запуску</label>
      <button class="m-secondary wide" data-upcheck>Перевірити оновлення</button>
      ${upd?.newer && upd.asset ? '<button class="m-primary wide" data-upinstall>Оновити зараз</button>' : ''}
      <p class="m-hint" id="m-upmsg">${esc(updMsg)}</p></section>`;
  }

  function empty(title: string, text: string, to: Tab, label: string): string {
    return `<div class="m-empty"><h2>${esc(title)}</h2><p>${esc(text)}</p><button class="m-primary" data-go="${to}">${esc(label)}</button></div>`;
  }

  /* ---------- the hints sheet ---------- */
  function renderSheet(): void {
    const wrap = $('m-sheet'); wrap.hidden = !sheet;
    const c = store.current;
    if (!sheet || !c) { wrap.innerHTML = ''; return; }
    const terms = store.terms(c.unit), tm = store.suggestions(c.unit, c.entry), cm = c.entry?.comments ?? [];
    wrap.innerHTML = `<div class="m-scrim" data-close></div><div class="m-sheet" role="dialog" aria-label="Підказки"><div class="m-grab"></div>
      <h3>Глосарій</h3>${terms.length ? terms.map((t, i) => `<button class="m-hit" data-term="${i}"><b>${esc(t.en)}</b><span>→ ${esc(t.uk)}${t.alt?.length ? ` · ${esc(t.alt.join(', '))}` : ''}</span></button>`).join('') : '<p class="m-hint">Термінів немає</p>'}
      <h3>Пам’ять перекладів</h3>${tm.length ? tm.map((m, i) => `<button class="m-hit" data-tm="${i}"><b>${m.score}%</b><span>${esc(m.t)}</span></button>`).join('') : '<p class="m-hint">Збігів немає</p>'}
      ${cm.length ? `<h3>Коментарі</h3>${cm.map(x => `<p class="m-cm"><b>${esc(x.who)}</b> ${esc(x.text)}</p>`).join('')}` : ''}
      <button class="m-secondary wide" data-close>Закрити</button></div>`;
  }

  /* ---------- render ---------- */
  function render(): void {
    renderChrome();
    const main = $('m-main');
    main.className = 'm-main tab-' + tab;
    main.innerHTML = sub ? ({ scene: screenScene, find: screenFind, speakers: screenSpeakers, settings: screenSettings, consistency: screenConsistency }[sub])() : tab === 'files' ? screenFiles() : tab === 'rows' ? screenRows() : tab === 'edit' ? screenEdit() : screenMore();
    renderSheet();
    if (tab === 'edit' && !sub) { refreshMeta(); autosize(); }
    if (tab === 'more') void artifactDb().then(db => { const el = document.getElementById('m-claude'); if (db && el) el.hidden = false; });
  }
  store.onChange(() => { renderChrome(); });

  function autosize(): void { const t = document.getElementById('m-tr') as HTMLTextAreaElement | null; if (t) { t.style.height = 'auto'; t.style.height = Math.max(132, t.scrollHeight + 2) + 'px'; } }
  /** Typing changes the numbers and the QA messages, not the field itself. */
  function refreshMeta(): void {
    const c = store.current; if (!c) return;
    const n = document.getElementById('m-count'); const t = c.entry?.target ?? '';
    if (n) n.textContent = `${[...t].length} / ${[...c.unit.source].length}`;
    const box = document.getElementById('m-issues'); if (box) box.innerHTML = issuesHtml();
    const stEl = document.querySelector('.m-status'); if (stEl) { const st = store.shown(c.unit, c.entry); stEl.innerHTML = `<span class="sd ${SHAPE[st]}"></span>${STATUS_LABEL[st]}`; }
  }

  /* ---------- actions ---------- */
  function openRow(key: string): void { store.select(key); go('edit'); }
  function step(d: 1 | -1): void { const n = store.neighbour(d); if (n) { buzz(8); store.select(n.key); render(); window.scrollTo(0, 0); $('m-main').scrollTop = 0; } }
  function insert(text: string): void { const t = $('m-tr') as HTMLTextAreaElement; t.focus(); t.setRangeText(text, t.selectionStart, t.selectionEnd, 'end'); t.dispatchEvent(new Event('input', { bubbles: true })); }

  async function importFiles(files: File[]): Promise<void> {
    busy = `Читаю файлів: ${files.length}…`; renderChrome();
    const game: GameFile[] = []; let projects = 0, conflicts = 0; const unknown: string[] = [];
    try {
      for (const f of files) {
        const text = await f.text();
        if (looksLikeProject(text)) { conflicts += store.importProject(text); projects++; continue; }
        const name = canonicalRpgMakerName(f.name) ?? (formatOf({ name: f.name }) ? f.name : null);
        if (!name) { unknown.push(f.name); continue; }
        game.push(isTextFormat(formatOf({ name })) ? { name, json: null, text } : { name, json: JSON.parse(text) });
      }
      let reset = 0;
      if (game.length) reset = store.ingest(game);
      const parts = [projects ? `проєкт злито${conflicts ? ` (конфліктів: ${conflicts})` : ''}` : '', game.length ? `файлів гри: ${game.length}` : '', reset ? `оригінал змінився в ${reset} рядках` : ''].filter(Boolean);
      if (unknown.length) say(`Не впізнав: ${unknown.slice(0, 3).join(', ')}${unknown.length > 3 ? '…' : ''}`, true);
      if (parts.length) say(parts.join(' · '));
      if (store.hasGame) go(store.key ? 'edit' : 'files'); else render();
    } catch (e) { say(`Не вдалося прочитати: ${e instanceof Error ? e.message : 'помилка'}`, true); }
    finally { busy = ''; renderChrome(); }
  }

  function readGithubForm(): ReturnType<typeof loadGithubConfig> {
    const cfg = loadGithubConfig(); const v = (id: string): string => (document.getElementById(id) as HTMLInputElement | null)?.value.trim() ?? '';
    cfg.repo = v('g-repo') || cfg.repo; cfg.token = v('g-token') || cfg.token; cfg.branch = v('g-branch'); cfg.dir = v('g-dir');
    saveGithubConfig(cfg); return cfg;
  }
  async function syncGithub(): Promise<void> {
    const cfg = readGithubForm();
    if (!githubConfigured(cfg)) { say('Вкажіть репозиторій і токен', true); return; }
    busy = 'Синхронізація…'; render();
    try {
      await store.flush();
      const rep = await githubSync(githubApi(cfg), cfg, cfg.state, store.saved, { since: cfg.last });
      store.saved = rep.project; cfg.last = Date.now(); cfg.state = rep.state; saveGithubConfig(cfg); store.adopt();
      say(describeGithub(rep));
    } catch (e) { say(e instanceof Error ? e.message : 'Не вдалося синхронізувати', true); }
    finally { busy = ''; render(); }
  }
  async function syncClaude(): Promise<void> {
    const db = await artifactDb(); if (!db) { say('Спільна база доступна лише в артефакті Claude', true); return; }
    busy = 'Синхронізація…'; render();
    try {
      await store.flush();
      const cfg = loadClaudeConfig();
      const rep = await claudeSync(db, cfg.holder, cfg.state, store.saved, { since: cfg.last });
      store.saved = rep.project; cfg.last = Date.now(); cfg.state = rep.state; saveClaudeConfig(cfg); store.adopt();
      say(describeClaude(rep));
    } catch (e) { say(e instanceof Error ? e.message : 'Не вдалося синхронізувати', true); }
    finally { busy = ''; render(); }
  }

  /* ---------- events ---------- */
  root.addEventListener('click', e => {
    const t = e.target as HTMLElement;
    const q = <T extends HTMLElement>(sel: string): T | null => t.closest<T>(sel);
    let x: HTMLElement | null;
    if ((x = q('[data-go]'))) { go(x.dataset.go as Tab); return; }
    if ((x = q('[data-sub]'))) { sub = x.dataset.sub as Sub; sheet = false; render(); $('m-main').scrollTop = 0; return; }
    if (q('[data-subback]')) { sub = null; render(); return; }
    if ((x = q('[data-layout]'))) { layout = x.dataset.layout as 'cards' | 'table'; try { localStorage.setItem('transly-m-layout', layout); } catch { /* private mode */ } render(); return; }
    if ((x = q('[data-cell]'))) { editCell(x); return; }
    if ((x = q('[data-scope]'))) { scope = x.dataset.scope as 'file' | 'all'; render(); return; }
    if ((x = q('[data-hit]'))) { store.open(x.dataset.hit!, x.dataset.hitkey!); scope = 'file'; go('edit'); return; }
    if ((x = q('[data-scenekey]'))) { store.select(x.dataset.scenekey!); sub = null; render(); return; }
    if (q('[data-scenesend]')) { const v = store.view(), c = store.current; if (v && c) { const r = store.sendMany(v.name, sceneUnits(v.units, c.unit.key)); say(`Надіслано: ${r.sent}${r.skipped ? ` · пропущено: ${r.skipped}` : ''}`, r.sent === 0); buzz(14); render(); } return; }
    if (q('[data-dofind]')) { fr.matches = store.find({ find: fr.find, replace: fr.replace, caseSensitive: fr.cs, wholeWord: fr.word }); if (!fr.find) say('Вкажіть, що шукати', true); else if (!fr.matches.length) say('Нічого не знайдено'); render(); return; }
    if (q('[data-doreplace]')) { const n = store.replaceAll(fr.matches); fr.matches = []; say(`Замінено в рядках: ${n}`); buzz(14); render(); return; }
    if ((x = q('[data-uni]'))) { const [gi, vi] = x.dataset.uni!.split('|').map(Number); const g = store.inconsistent()[gi!]; const v = g?.variants[vi!]; if (g && v) { const n = store.unify(g.source, v.target); say(`Уніфіковано рядків: ${n}`); buzz(14); } render(); return; }
    if (q('[data-spsave]')) { const n = store.setSpeakers(sp.draft); sp.draft.clear(); say(n ? `Мовців оновлено: ${n}` : 'Змін немає'); render(); return; }
    if ((x = q('[data-file]'))) { store.open(x.dataset.file!); go('rows'); return; }
    if ((x = q('[data-filter]'))) { store.setFilter(x.dataset.filter as Filter); render(); return; }
    if ((x = q('[data-key]'))) { openRow(x.dataset.key!); return; }
    if ((x = q('[data-step]'))) { step(Number(x.dataset.step) as 1 | -1); return; }
    if (q('[data-send]')) {
      const why = store.send();
      if (why) { say(why, true); buzz(30); return; }
      buzz(14);
      const next = store.neighbour(1);
      if (next) { store.select(next.key); say(store.stage === 'translate' ? 'Надіслано на вичитування' : 'Вичитано'); render(); $('m-main').scrollTop = 0; } else { say('Це був останній рядок у списку'); render(); }
      return;
    }
    if (q('[data-copy]')) { const c = store.current; if (c) { ($('m-tr') as HTMLTextAreaElement).value = c.unit.source; store.write(c.unit.source); refreshMeta(); autosize(); } return; }
    if (q('[data-clear]')) { ($('m-tr') as HTMLTextAreaElement).value = ''; store.write(''); refreshMeta(); autosize(); return; }
    if ((x = q('[data-ins]'))) { insert(x.dataset.ins ?? ''); return; }
    if (q('[data-wrap]')) { if (store.wrap()) { render(); } else say('Рядки вже вміщаються'); return; }
    if ((x = q('[data-ign]'))) { store.mutate((_f, _u, en) => ({ ...(en as NonNullable<typeof en>), ign: [...new Set([...(en?.ign ?? []), x!.dataset.ign!])], mt: Date.now() })); refreshMeta(); return; }
    if (q('[data-sheet]')) { sheet = true; renderSheet(); return; }
    if (q('[data-close]')) { sheet = false; renderSheet(); return; }
    if ((x = q('[data-term]'))) { const c = store.current; const tm = c ? store.terms(c.unit)[Number(x.dataset.term)] : null; if (tm) { sheet = false; renderSheet(); insert(tm.uk); } return; }
    if ((x = q('[data-tm]'))) { const c = store.current; const m = c ? store.suggestions(c.unit, c.entry)[Number(x.dataset.tm)] : null; if (m) { sheet = false; renderSheet(); ($('m-tr') as HTMLTextAreaElement).value = m.t; store.write(m.t); refreshMeta(); autosize(); } return; }
    if ((x = q('[data-stage]'))) { store.setStage(x.dataset.stage as 'translate' | 'review'); render(); return; }
    if (q('[data-pick]')) { $<HTMLInputElement>('m-file').click(); return; }
    if (q('[data-paste]')) {
      const text = ($('m-paste') as HTMLTextAreaElement).value.trim(); if (!text) { say('Спершу вставте текст', true); return; }
      if (looksLikeProject(text)) { const n = store.importProject(text); say(n ? `Проєкт злито, конфліктів: ${n}` : 'Проєкт злито'); render(); return; }
      const nameBox = $('m-namebox'); const nm = ($('m-pname') as HTMLInputElement).value.trim();
      const name = nm ? canonicalRpgMakerName(nm) ?? nm : null;
      if (!name) { nameBox.hidden = false; say('Вкажіть назву файлу гри (як у папці data)', true); return; }
      void importFiles([new File([text], name, { type: 'application/json' })]); return;
    }
    if (q('[data-upcheck]')) {
      const cfg = loadUpdateCfg(); cfg.token = (document.getElementById('u-token') as HTMLInputElement).value.trim(); cfg.auto = (document.getElementById('u-auto') as HTMLInputElement).checked; saveUpdateCfg(cfg);
      updMsg = 'Перевіряю…'; render();
      checkUpdate(cfg).then(c => { upd = c; updMsg = c.newer ? '' : 'У вас остання версія'; }).catch(err => { updMsg = err instanceof Error ? err.message : 'Не вдалося перевірити'; }).finally(render);
      return;
    }
    if (q('[data-upinstall]')) { const cfg = loadUpdateCfg(); try { installUpdate(cfg, upd!, (_s, text) => { updMsg = text; const m = document.getElementById('m-upmsg'); if (m) m.textContent = text; }); updMsg = 'Завантажую…'; render(); } catch (err) { say(err instanceof Error ? err.message : 'Не вдалося оновити', true); } return; }
    if (q('[data-ghsync]')) { void syncGithub(); return; }
    if (q('[data-clsync]')) { void syncClaude(); return; }
    if (q('[data-export]')) {
      const blob = new Blob([JSON.stringify(store.saved)], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${store.saved.name || 'transly'}.transly.json`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
      return;
    }
  });
  root.addEventListener('input', e => {
    const t = e.target as HTMLElement;
    if (t.id === 'f-find') fr.find = (t as HTMLInputElement).value;
    else if (t.id === 'f-rep') fr.replace = (t as HTMLInputElement).value;
    else if (t.id === 'sp-q') { sp.q = (t as HTMLInputElement).value; const keep = (t as HTMLInputElement).selectionStart ?? 0; render(); const qi = document.getElementById('sp-q') as HTMLInputElement; qi.focus(); qi.setSelectionRange(keep, keep); }
    else if (t.classList.contains('m-spin')) sp.draft.set((t as HTMLInputElement).dataset.k!, (t as HTMLInputElement).value);
    else if (t.id === 's-tol') { const n = Number((t as HTMLInputElement).value); if (n >= 5 && n <= 100) { store.saved.settings.tolerancePct = n; store.saved.settingsAt = Date.now(); store.persist(); } }
    else if (t.id === 's-lim') { const n = Number((t as HTMLInputElement).value); if (n >= 10 && n <= 200) { store.saved.settings.lineLimit = Math.round(n); store.saved.settingsAt = Date.now(); store.persist(); } }
    else if (t.id === 's-who') { store.saved.settings.who = (t as HTMLInputElement).value.trim() || 'Ви'; store.saved.settingsAt = Date.now(); store.persist(); }
    else if (t.id === 'm-tr') { store.write((t as HTMLTextAreaElement).value); refreshMeta(); autosize(); }
    else if (t.id === 'm-q') { store.setQuery((t as HTMLInputElement).value); const ul = document.querySelector('.m-list.rows'); if (ul) { const keep = (t as HTMLInputElement).selectionStart; render(); const qi = document.getElementById('m-q') as HTMLInputElement; qi.focus(); qi.setSelectionRange(keep, keep); } }
    else if (t.id === 'm-who') { store.saved.settings.who = (t as HTMLInputElement).value.trim() || 'Ви'; store.persist(); }
  });
  root.addEventListener('change', e => {
    const t = e.target as HTMLElement;
    if (t.id === 'f-word') fr.word = (t as HTMLInputElement).checked;
    else if (t.id === 'f-case') fr.cs = (t as HTMLInputElement).checked;
    else if (t.id === 's-block' || t.id === 's-prop') { store.saved.settings[t.id === 's-block' ? 'blockErrors' : 'propagate'] = (t as HTMLInputElement).checked; store.saved.settingsAt = Date.now(); store.persist(); }
    else if (t.id === 's-mode') { const m = (t as HTMLSelectElement).value; store.saved.settings.lineLimit = m === 'off' ? -1 : m === 'custom' ? Math.round(Number((document.getElementById('s-lim') as HTMLInputElement).value)) || 50 : 0; store.saved.settingsAt = Date.now(); store.persist(); render(); }
    if (t.id === 'm-sort') { store.setSort((t as HTMLSelectElement).value as Sort); render(); }
    if (t.id === 'm-file') { const f = [...((t as HTMLInputElement).files ?? [])]; (t as HTMLInputElement).value = ''; if (f.length) void importFiles(f); }
  });
  // The keyboard takes the bottom navigation's place.
  document.addEventListener('focusin', e => { if ((e.target as HTMLElement).matches('textarea, input')) $('m-app').classList.add('kb'); });
  document.addEventListener('focusout', () => { setTimeout(() => { if (!document.activeElement?.matches('textarea, input')) $('m-app').classList.remove('kb'); }, 120); });
  // A swipe across the editor moves to the next / previous row.
  let sx = 0, sy = 0, st = 0, sw = false;
  root.addEventListener('touchstart', e => { sw = tab === 'edit' && e.touches.length === 1 && !(e.target as HTMLElement).closest('textarea, button, input, .m-sheet'); if (sw) { sx = e.touches[0]!.clientX; sy = e.touches[0]!.clientY; st = Date.now(); } }, { passive: true });
  root.addEventListener('touchend', e => { if (!sw) return; sw = false; const c = e.changedTouches[0]!, dx = c.clientX - sx, dy = c.clientY - sy; if (Date.now() - st < 700 && Math.abs(dx) > 80 && Math.abs(dy) < Math.abs(dx) / 2) step(dx < 0 ? 1 : -1); }, { passive: true });
  window.addEventListener('pagehide', () => void store.flush());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') void store.flush(); });
  // What the Android shell calls: the back button (close the sheet, then one screen up), saving on leaving, a row opened from the widget.
  Object.assign(window, {
    __back: (): boolean => { if (sub) { sub = null; render(); return true; } if (sheet) { sheet = false; renderSheet(); return true; } if (tab === 'edit') { go('rows'); return true; } if (tab === 'rows' || tab === 'more') { go('files'); return true; } return false; },
    __flush: (): Promise<void> => store.flush(),
    __open: (file: string, key: string): void => { if (store.view(file)) { store.open(file, key); go('edit'); } },
  });
  // Quietly look for a new version a few seconds after the start.
  if (canUpdate()) setTimeout(() => { const cfg = loadUpdateCfg(); if (!cfg.auto || !cfg.token) return; checkUpdate(cfg).then(c => { if (c.newer && c.release.sha !== cfg.skipped) { upd = c; say('Доступна нова версія: відкрийте «Ще» → «Оновлення»'); } }).catch(() => undefined); }, 4000);

  render();
}
