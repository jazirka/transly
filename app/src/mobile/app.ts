import { canonicalRpgMakerName, claudeSync, formatOf, githubSync, isTextFormat, looksLikeProject, sceneLines, sceneUnits, speakerCandidates, describePage, displayLength, limitFor, wordsOf, gorohUrl, multitranUrl } from '../core';
import type { GameFile } from '../core';
import { artifactDb, describeClaude, loadClaudeConfig, saveClaudeConfig } from '../ui/claude';
import { describeGithub, githubApi, githubConfigured, loadGithubConfig, saveGithubConfig } from '../ui/github';
import { esc, plural } from '../ui/dom';
import { gameHtml } from '../ui/gamehtml';
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
  let menu = false;
  /** Fields the keyboard opens for: only these switch the app into keyboard mode (a checkbox does not). */
  const TEXTY = 'textarea, input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=range]):not([type=file])';
  let sheet = false; let sheetTab: 'terms' | 'tm' | 'cm' | 'hist' | 'dict' | null = null; let gk: 'Тлумачення' | 'Синоніми' = 'Тлумачення';
  let busy = '';
  type Sub = 'scene' | 'find' | 'speakers' | 'settings' | 'consistency' | 'glossary' | 'autofill' | 'sendlog';
  let sub: Sub | null = null;
  let scope: 'file' | 'all' = 'file';
  let layout: 'cards' | 'table' = (() => { try { return localStorage.getItem('transly-m-layout') === 'table' ? 'table' : 'cards'; } catch { return 'cards'; } })();
  const fr = { find: '', replace: '', word: false, cs: false, matches: [] as ReturnType<typeof store.find> };
  const PAGE = 100; let page = 1, pageSig = '';
  let refLang = ''; let fq = '';
  let selecting = false; const picked = new Set<string>();
  const scn: { mode: 'both' | 'tr' | 'src'; real: boolean; picked: string; ctx: CanvasRenderingContext2D | null } = { mode: 'both', real: false, picked: '', ctx: null };
  const act = { open: new Set<string>() };
  const gl = { q: '', en: '', uk: '', alt: '', qa: true, edit: false };
  const af = { off: new Set<string>() };
  const sp = { q: '', draft: new Map<string, string>() };
  let upd: UpdateCheck | null = null;
  let updMsg = '';
  let updBusy = false;
  let viewKey = '';
  const ready = new Set<string>();
  let tabX: { from: number; w: number } | null = null; let prevTabIdx = 0;

  root.innerHTML = `<div class="m-app" id="m-app">
    <header class="m-bar" id="m-bar"></header>
    <main class="m-main" id="m-main"></main>
    <div class="m-sheet-wrap" id="m-sheet" hidden></div>
    <button class="m-top" id="m-top" hidden aria-label="Нагору">${icon('up')}</button>
    <nav class="m-nav" id="m-nav" role="tablist" aria-label="Розділи"></nav>
    <div class="m-toasts" id="m-toasts" role="status"></div>
    <input type="file" id="m-file" multiple hidden>
    <input type="file" id="m-reffile" multiple hidden>
  </div>`;
  const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

  const say = (text: string, bad = false): void => {
    const t = document.createElement('div'); t.className = 'm-toast' + (bad ? ' bad' : ''); t.textContent = text;
    $('m-toasts').appendChild(t); setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 220); }, bad ? 6000 : 3200);
  };
  const buzz = (ms = 10): void => { try { navigator.vibrate?.(ms); } catch { /* no vibrator */ } };
  /** A destructive button asks twice: the first tap turns it into «Точно очистити?» for 4 seconds. */
  const confirmTap = (btn: HTMLElement, label = 'Точно очистити?'): boolean => {
    if (btn.dataset.armed) { delete btn.dataset.armed; btn.classList.remove('armed'); return true; }
    const was = btn.innerHTML; btn.dataset.armed = '1'; btn.classList.add('armed'); btn.textContent = label;
    setTimeout(() => { if (btn.dataset.armed) { delete btn.dataset.armed; btn.classList.remove('armed'); btn.innerHTML = was; } }, 4000);
    return false;
  };
  /** A big send (20+ rows) needs a second tap within 4 seconds, so it cannot happen by accident. */
  let arm: { key: string; until: number } | null = null;
  const armed = (n: number, key: string): boolean => {
    if (n < 20) return true;
    if (arm && arm.key === key && Date.now() < arm.until) { arm = null; return true; }
    arm = { key, until: Date.now() + 4000 };
    say(`Надіслати ${plural(n, ['рядок', 'рядки', 'рядків'])}? Торкніться ще раз, щоб підтвердити`);
    return false;
  };
  /** What each tab was showing when it was left: the sub-screen and the scroll position. */
  const mem: Record<Tab, { sub: Sub | null; scroll: number }> = { files: { sub: null, scroll: 0 }, rows: { sub: null, scroll: 0 }, edit: { sub: null, scroll: 0 }, more: { sub: null, scroll: 0 } };
  const go = (t: Tab): void => { tab = t; sheet = false; menu = false; sub = null; mem[t] = { sub: null, scroll: 0 }; render(); };
  /** A tap on a tab icon: another tab opens as it was left; the tab you are on returns to its standard screen. */
  function switchTab(t: Tab): void {
    const main = $('m-main');
    if (t === tab) {
      sheet = false; menu = false; sub = null; selecting = false; picked.clear(); mem[t] = { sub: null, scroll: 0 };
      render();
      if (t === 'rows' || t === 'files') requestAnimationFrame(() => { const cur = document.querySelector('.m-row.cur, .m-table tr.cur, .m-item.cur'); if (cur) cur.scrollIntoView({ block: 'center', behavior: 'smooth' }); else main.scrollTo({ top: 0, behavior: 'smooth' }); });
      else main.scrollTo({ top: 0 });
      return;
    }
    mem[tab] = { sub, scroll: main.scrollTop };
    tab = t; sheet = false; menu = false; sub = mem[t].sub;
    render();
    main.scrollTop = mem[t].scroll;
  }
  /** Something other than the standard screen is waiting in a tab: an open sub-screen, a search, a filter, a selection. */
  function tabMark(t: Tab): string {
    if (t === 'more') return '';
    const s = t === tab ? sub : mem[t].sub;
    if (t === 'rows') { if (selecting && picked.size) return String(picked.size); return s || store.q.trim() || store.filter !== 'all' ? '•' : ''; }
    if (t === 'files') return s || fq.trim() ? '•' : '';
    return s ? '•' : '';
  }
  const SUB_TITLE: Record<Sub, string> = { scene: 'Сцена', find: 'Знайти й замінити', speakers: 'Хто говорить', settings: 'Налаштування', consistency: 'Узгодженість', glossary: 'Глосарій', autofill: 'Автозаповнення', sendlog: 'Активність' };

  /* ---------- chrome ---------- */
  /** The tools (find and replace, speakers, activity, glossary, autofill, consistency, settings): one menu pinned to the top bar of every screen. */
  const TOOLS: [Sub, string, string][] = [['find', 'Знайти й замінити', 'search'], ['speakers', 'Хто говорить', 'rows'], ['sendlog', 'Активність', 'send'], ['glossary', 'Глосарій', 'book'], ['autofill', 'Автозаповнення', 'edit'], ['consistency', 'Узгодженість', 'check'], ['settings', 'Налаштування', 'more']];
  function toolsBtn(): string {
    if (sub || !store.hasGame) return '';
    return `<button class="m-hdr ${menu ? 'on' : ''}" data-menu aria-pressed="${menu}" aria-label="Інструменти" aria-expanded="${menu}">${icon('down')}</button>`;
  }
  /** Top-bar button of the editor: glossary, memory, comments and history of the open row. */
  function helpBtn(): string {
    const c = store.current; if (tab !== 'edit' || sub || !c) return '';
    const n = store.terms(c.unit).length + store.suggestions(c.unit, c.entry).length + (c.entry?.comments?.length ?? 0);
    return `<button class="m-hdr ${sheet ? 'on' : ''}" data-sheet aria-pressed="${sheet}" aria-label="Глосарій, пам’ять перекладів, коментарі, історія">${icon('book')}${n ? `<span class="m-badge">${n > 9 ? '9+' : n}</span>` : ''}</button>`;
  }
  function renderChrome(): void {
    const tot = store.totals();
    const pct = tot.total ? Math.floor((100 * tot.translated) / tot.total) : 0;
    const title = tab === 'files' ? 'Файли гри' : tab === 'rows' ? (store.view()?.label ?? store.file ?? 'Рядки') : tab === 'edit' ? (store.file ?? 'Переклад') : 'Ще';
    let where = '';
    if (tab === 'edit' && !sub && store.current) { const list = store.rows(), pos = list.findIndex(x => x.key === store.current!.unit.key); if (pos >= 0) where = `Рядок ${pos + 1} з ${list.length} · `; }
    const subline = tab === 'more' || !store.hasGame || sub ? '' : `${where}${pct}% · ${store.saveOk ? 'збережено' : 'не збережено!'}`;
    $('m-bar').innerHTML = `${sub ? '<button class="m-back" data-subback aria-label="Назад">' + icon('prev') + '</button>' : ''}<div class="m-title"><b>${esc(sub ? SUB_TITLE[sub] : title)}</b>${subline ? `<small class="${store.saveOk ? '' : 'bad'}">${esc(subline)}</small>` : ''}</div>${busy || updBusy ? `<span class="m-busy" role="status"><i class="m-spin"></i>${esc(busy || 'Перевіряю…')}</span>` : ''}${helpBtn()}${toolsBtn()}`;
    $('m-bar').classList.toggle('loading', !!(busy || updBusy));
    document.documentElement.style.setProperty('--bar-h', $('m-bar').offsetHeight + 'px');
    $('m-nav').innerHTML = (Object.keys(TAB_LABEL) as Tab[]).map(t => `<button role="tab" data-go="${t}" aria-selected="${t === tab}" class="${t === tab ? 'on' : ''}" ${(t === 'rows' || t === 'edit') && !store.hasGame ? 'disabled' : ''}>${icon(t)}<span>${TAB_LABEL[t]}</span>${tabMark(t) ? `<i class="m-mark">${tabMark(t)}</i>` : ''}</button>`).join('');
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
    return `<div class="m-searchbar"><label class="m-search">${icon('search')}<input id="m-fq" type="search" placeholder="Пошук файлу" value="${esc(fq)}" enterkeyhint="search" autocomplete="off"></label></div><div id="m-flist">${filesList()}</div>`;
  }
  /** The files whose name or title contains the search words. */
  function filesList(): string {
    const q = fq.trim().toLowerCase();
    const views = store.views.filter(v => !q || (v.name + ' ' + (v.label ?? '')).toLowerCase().includes(q));
    if (!views.length) return '<p class="m-none">Файлів за цим пошуком немає</p>';
    return `<ul class="m-list">${views.map(v => {
      const st = store.stats(v.name), pc = st.total ? Math.round((100 * st.translated) / st.total) : 0;
      return `<li><button class="m-item ${v.name === store.file ? 'cur' : ''}" data-file="${esc(v.name)}"><span class="m-ico">${/^Map\d+\.json$/.test(v.name) ? 'MAP' : '{ }'}</span><span class="m-item-t"><b>${esc(v.label ?? v.name.replace(/\.json$/, ''))}</b><small>${esc(v.label ? v.name.replace(/\.json$/, '') : plural(st.total, ['рядок', 'рядки', 'рядків']))}</small>${bar(st.translated, st.total)}</span><span class="m-pc">${pc}%</span></button></li>`;
    }).join('')}</ul>`;
  }

  function screenRows(): string {
    const v = store.view();
    if (!v) return empty('Файл не вибрано', 'Оберіть файл у розділі «Файли».', 'files', 'До файлів');
    if (scope === 'all') return screenAll();
    const sig = `${store.file}|${store.filter}|${store.q}|${store.sort}`;
    const rows = store.rows();
    if (sig !== pageSig) { pageSig = sig; page = 1; const at = store.key ? rows.findIndex(u => u.key === store.key) : -1; if (at >= PAGE) page = Math.ceil((at + 1) / PAGE); }
    const shown = rows.slice(0, PAGE * page);
    const chips = FILTERS.map(([f, l]) => `<button class="m-chip ${store.filter === f ? 'on' : ''}" data-filter="${f}" aria-pressed="${store.filter === f}">${l}</button>`).join('');
    return `<div class="m-searchbar"><label class="m-search">${icon('search')}<input id="m-q" type="search" placeholder="Пошук у файлі" value="${esc(store.q)}" enterkeyhint="search" autocomplete="off"></label></div>
      <div class="m-tools">
      <div class="m-scoperow"><div class="m-scope" role="group" aria-label="Де шукати"><button class="on" data-scope="file">Файл</button><button data-scope="all">Усі файли</button></div>
      <div class="m-scope" role="group" aria-label="Вигляд"><button class="${layout === 'cards' ? 'on' : ''}" data-layout="cards">Картки</button><button class="${layout === 'table' ? 'on' : ''}" data-layout="table">Таблиця</button></div></div>
      <div class="m-chips" role="group" aria-label="Фільтр">${chips}</div>
      <div class="m-sortrow"><span>${rows.length} з ${v.units.length}</span>${layout === 'cards' ? `<button class="m-mini ${selecting ? 'on' : ''}" data-select aria-pressed="${selecting}">${selecting ? 'Готово' : 'Вибрати'}</button>` : ''}<select id="m-sort" aria-label="Порядок">${(['order', 'new', 'qa', 'long'] as Sort[]).map(s => `<option value="${s}" ${store.sort === s ? 'selected' : ''}>${{ order: 'За порядком', new: 'Спершу без перекладу', qa: 'Спершу проблеми', long: 'Спершу найдовші' }[s]}</option>`).join('')}</select></div></div>
      ${layout === 'table' ? tableHtml(v.name, shown, rows.length) : `<ul class="m-list rows">${shown.map((u, i) => {
        const e = store.entry(v.name, u.key), st = store.shown(u, e);
        return `<li><button class="m-row ${u.key === store.key && !selecting ? 'cur' : ''} ${selecting && picked.has(u.key) ? 'picked' : ''}" ${selecting ? `data-pickkey="${esc(u.key)}" aria-pressed="${picked.has(u.key)}"` : `data-key="${esc(u.key)}"`}>${selecting ? `<span class="m-chk ${picked.has(u.key) ? 'on' : ''}" aria-hidden="true"></span>` : `<span class="sd ${SHAPE[st]}" title="${STATUS_LABEL[st]}"></span>`}<span class="m-row-t"><small>${selecting ? `<span class="sd ${SHAPE[st]}" title="${STATUS_LABEL[st]}"></span>` : ''}${i + 1} · ${esc(store.speaker(u) || u.kind)}</small><span class="m-src">${esc(u.source.replace(/\s+/g, ' '))}</span><span class="m-tr ${e?.target ? '' : 'none'}">${e?.target ? esc(e.target.replace(/\s+/g, ' ')) : '—'}</span></span></button></li>`;
      }).join('') || '<li class="m-none">Нічого не знайдено</li>'}${rows.length > shown.length ? `<li class="m-more-li"><button class="m-mini" data-more>Показати ще ${Math.min(PAGE, rows.length - shown.length)} · ${shown.length} з ${rows.length}</button></li>` : ''}</ul>`}${selecting && layout === 'cards' ? selBar(picked.size, rows.length, picked.size === rows.length && rows.length > 0, 'data-selall', `<button class="m-mini" data-selcopy ${picked.size ? '' : 'disabled'}>Оригінал</button><button class="m-mini danger" data-selclear ${picked.size ? '' : 'disabled'}>Очистити</button>`, `<button class="m-primary" data-selsend ${picked.size ? '' : 'disabled'}>${icon('check')}<span>Надіслати</span></button>`, 'data-select') : ''}`;
  }

  /** The table: columns scroll sideways, a tap on a translation writes right in the cell, a tap on a number opens the row. */
  function tableHtml(file: string, rows: ReturnType<typeof store.rows>, total: number): string {
    const v = store.view(file); const all = v?.units ?? [];
    const idx = new Map(all.map((u, i) => [u.key, i + 1]));
    return `<div class="m-twrap"><table class="m-table"><thead><tr><th class="c-n">№</th><th class="c-s"></th><th class="c-o">Оригінал</th><th class="c-t">Переклад</th><th class="c-l">Знаків</th></tr></thead><tbody>${rows.map(u => {
      const e = store.entry(file, u.key), st = store.shown(u, e), t = e?.target ?? '';
      return `<tr class="${u.key === store.key ? 'cur' : ''}" data-trkey="${esc(u.key)}"><td class="c-n" data-key="${esc(u.key)}" title="Відкрити в редакторі">${idx.get(u.key)}</td><td class="c-s"><span class="sd ${SHAPE[st]}" title="${STATUS_LABEL[st]}"></span></td><td class="c-o" data-key="${esc(u.key)}">${esc(u.source)}</td><td class="c-t ${t ? '' : 'none'}" data-cell="${esc(u.key)}">${t ? esc(t) : '—'}</td><td class="c-l">${t ? `${[...t].length}/${[...u.source].length}` : '—'}</td></tr>`;
    }).join('')}</tbody></table>${total > rows.length ? `<p class="m-none"><button class="m-mini" data-more>Показати ще · ${rows.length} з ${total}</button></p>` : ''}</div>`;
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
  /** The scene as the message windows of the game: colours, names, choices, width check; a tap picks a line, the bar below acts on it. */
  function screenScene(): string {
    const c = store.current, v = store.view();
    if (!c || !v) return empty('Рядок не вибрано', 'Спершу оберіть рядок.', 'rows', 'До рядків');
    if (!scn.picked || !v.units.some(u => u.key === scn.picked)) scn.picked = c.unit.key;
    const around = sceneUnits(v.units, c.unit.key), lines = sceneLines(around);
    const actors = store.views.find(x => x.name === 'Actors.json');
    const actorName = (n: number): string | undefined => { const u = actors?.units.find(x => x.key === `[${n}].name`); return u ? (store.saved.files['Actors.json']?.[u.key]?.target || u.source) : undefined; };
    const limit = store.lineLimit();
    const measure = (t: string): number => { scn.ctx ??= document.createElement('canvas').getContext('2d'); if (scn.ctx) scn.ctx.font = '28px sans-serif'; return scn.ctx?.measureText(t).width ?? t.length * 14; };
    const plain = (l: string): string => l.replace(/\\[A-Za-z]+\[\d+\]|\\[{}.|!><^$]/g, '');
    const body = (u: (typeof v.units)[number]): { html: string; missing: boolean; over: boolean } => {
      const tr = store.entry(v.name, u.key)?.target ?? '', missing = !tr;
      const shown = scn.mode === 'src' || (missing && scn.mode !== 'tr') ? u.source : tr || u.source;
      const checked = (u.kind === 'dialogue' || u.kind === 'scroll') && !missing, max = checked ? limitFor(limit, u.face) : 0;
      const wide = (l: string): boolean => (scn.real ? measure(plain(l)) > (u.face ? 612 : 780) : !!max && displayLength(l) > max);
      const rows = shown.split('\n');
      return { missing, over: checked && rows.some(wide), html: rows.map(l => `<div class="scn-ln${checked && wide(l) ? ' over' : ''}">${gameHtml(l, actorName, n => store.saved.sysNames?.variables[n]) || '&nbsp;'}</div>`).join('') };
    };
    const box = (u: (typeof v.units)[number], inner: string, cls = ''): string => {
      const st = store.shown(u, store.entry(v.name, u.key));
      return `<button class="scn-box ${cls} ${u.key === scn.picked ? 'cur' : ''}" data-scpick="${esc(u.key)}" aria-pressed="${u.key === scn.picked}"><span class="sd ${SHAPE[st]}" title="${STATUS_LABEL[st]}"></span><span class="scn-in">${inner}</span></button>`;
    };
    const orig = (u: (typeof v.units)[number], missing: boolean): string => (scn.mode === 'both' && !missing ? `<div class="scn-orig">${u.source.split('\n').map(x => `<div>${esc(x)}</div>`).join('')}</div>` : '');
    const tag = (missing: boolean, over: boolean): string => `${missing && scn.mode !== 'src' ? '<span class="scn-tag">не перекладено</span>' : ''}${over ? '<span class="scn-tag bad">рядок задовгий для вікна гри</span>' : ''}`;
    const one = (l: ReturnType<typeof sceneLines>[number]): string => {
      if (l.kind === 'choice') return `<div class="scn-choice" role="group" aria-label="Варіанти відповіді"><small>Вибір гравця</small>${l.units.map((u, i) => { const t = body(u); return box(u, `<span class="scn-n">${i + 1}</span><span>${t.html}${orig(u, t.missing)}${tag(t.missing, t.over)}</span>`, 'opt'); }).join('')}</div>`;
      const u = l.unit, t = body(u), who = store.speaker(u);
      return box(u, `${who ? `<span class="scn-who">${esc(who)}</span>` : ''}<span class="scn-win${l.kind === 'scroll' ? ' scroll' : ''}">${t.html}</span>${orig(u, t.missing)}${tag(t.missing, t.over)}`);
    };
    const all = lines.flatMap(l => (l.kind === 'choice' ? l.units : [l.unit]));
    const st = all.map(u => store.entry(v.name, u.key)?.status ?? 'new');
    const done = all.filter(u => store.entry(v.name, u.key)?.target).length, appr = st.filter(x => x === 'appr').length, wait = st.filter(x => x === 'done').length;
    const page = around[0]?.page, cond = page ? describePage(page, store.saved.sysNames).join('; ') : '';
    const review = store.stage === 'review';
    const canSend = all.some(u => review ? store.entry(v.name, u.key)?.status === 'done' : store.entry(v.name, u.key)?.status === 'draft');
    const modes: ['both' | 'tr' | 'src', string][] = [['both', 'Обидва'], ['tr', 'Переклад'], ['src', 'Оригінал']];
    return `<div class="m-scene"><div class="scn-head"><b>${esc(v.label ?? v.name)}</b><small>${plural(all.length, ['рядок', 'рядки', 'рядків'])} · перекладено ${done} · вичитано ${appr} · чекає ${wait}</small>${cond ? `<small class="scn-cond">Умови: ${esc(cond)}</small>` : ''}</div>
      <div class="m-dseg scn-modes" role="group" aria-label="Що показувати">${modes.map(([k, l]) => `<button data-scmode="${k}" class="${scn.mode === k ? 'on' : ''}" aria-pressed="${scn.mode === k}">${l}</button>`).join('')}</div>
      <label class="m-check"><input type="checkbox" id="scn-real" ${scn.real ? 'checked' : ''}> Вікно як у грі: ширина в пікселях (816 px, шрифт 28)</label>
      <div class="scn-list">${lines.map(one).join('') || '<p class="m-none">У цій сцені немає текстових рядків</p>'}</div></div>
      <div class="scn-bar"><button class="m-secondary" data-scedit>${icon('edit')}<span>Редагувати</span></button><button class="m-primary" data-scenesend ${canSend ? '' : 'disabled'}>${icon('check')}<span>${review ? 'Затвердити сцену' : 'Надіслати сцену'}</span></button></div>`;
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

  /** Activity: what was sent for review, approved or taken back, by day; a send can be undone while its rows are untouched. */
  function screenSendLog(): string {
    type Ev = { id: string; at: number; icon: string; text: string; sub?: string; rows?: { source: string; target: string }[]; undo?: string; undoLabel?: string; undoAttr?: string };
    const n = (c: number): string => plural(c, ['рядок', 'рядки', 'рядків']);
    const evs: Ev[] = [
      ...store.sends().map((b): Ev => ({ id: `s${b.at}${b.kind}${b.guessed ? 'g' : ''}`, at: b.at, icon: b.kind === 'send' ? 'send' : 'check',
        text: b.kind === 'send' ? `Ви надіслали ${n(b.items.length)} на вичитування` : `Ви затвердили ${n(b.items.length)}`,
        ...(b.guessed ? { sub: 'Запису про відправлення немає, знайдено за часом зміни' } : {}), rows: b.items.slice(0, 12), undo: `${b.at}|${b.kind}|${b.guessed ? 1 : 0}` })),
      ...store.autos().map((b): Ev => ({ id: `a${b.at}${b.kind}`, at: b.at, icon: 'edit',
        text: b.kind === 'words' ? `Автозаповнення за словами: ${n(b.items.length)}` : `Підставлено з однакових рядків: ${n(b.items.length)}`,
        sub: b.kind === 'words' ? 'Чернетки, їх варто переглянути' : 'Чекають вичитування без вашого перегляду', rows: b.items.slice(0, 12), undo: `${b.at}|${b.kind}`, undoLabel: 'Скасувати заповнення', undoAttr: 'data-undoauto' })),
      ...store.autosUndone().map((u): Ev => ({ id: `au${u.at}${u.kind}`, at: u.at, icon: 'prev', text: `Ви скасували ${u.kind === 'words' ? 'автозаповнення' : 'підстановку'}: ${n(u.count)}` })),
      ...store.undone().map((u): Ev => ({ id: `u${u.at}${u.kind}`, at: u.at, icon: 'prev', text: u.kind === 'send' ? `Ви скасували відправлення: ${n(u.count)}` : `Ви скасували затвердження: ${n(u.count)}` })),
    ].sort((x, y) => y.at - x.at);
    const dayKey = (t: number): string => new Date(t).toDateString();
    const today = dayKey(Date.now()), yest = dayKey(Date.now() - 86400000);
    const dayName = (t: number): string => (dayKey(t) === today ? 'Сьогодні' : dayKey(t) === yest ? 'Вчора' : new Date(t).toLocaleDateString('uk-UA', { day: 'numeric', month: 'long' }));
    const time = (t: number): string => new Date(t).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
    let last = '';
    const html = evs.map(e => {
      const head = dayKey(e.at) !== last ? `<h3 class="act-day">${dayName(e.at)}</h3>` : ''; last = dayKey(e.at);
      const open = act.open.has(e.id);
      return `${head}<div class="act-ev ${open ? 'open' : ''}"><span class="act-ic">${icon(e.icon)}</span>
        <div class="act-t"><span>${esc(e.text)}</span><small>${time(e.at)}${e.sub ? ' · ' + esc(e.sub) : ''}</small>${e.undo ? `<button class="act-undo" ${e.undoAttr ?? 'data-undosend'}="${e.undo}">${icon('prev')} ${e.undoLabel ?? 'Скасувати відправлення'}</button>` : ''}</div>
        ${e.rows ? `<button class="act-chev" data-actopen="${e.id}" aria-expanded="${open}" aria-label="Показати рядки">${icon('next')}</button>` : ''}
        ${open && e.rows ? `<ul class="act-rows">${e.rows.map(r => `<li><small>${esc(r.source.replace(/\s+/g, ' ').slice(0, 70))}</small><span>${esc(r.target.replace(/\s+/g, ' ').slice(0, 90))}</span></li>`).join('')}</ul>` : ''}</div>`;
    }).join('');
    return `<div class="m-more act">${html || '<p class="m-none">Активності ще немає</p>'}<p class="m-hint">Відправлення можна скасувати, поки рядки не змінено. Якщо відправляли на іншому пристрої (наприклад, на ПК), спершу синхронізуйте проєкт у «Ще».</p></div>`;
  }

  /** The glossary: add a term, tap one to change it. */
  function screenGlossary(): string {
    const q = gl.q.trim().toLowerCase();
    const list = store.saved.terms.filter(t => !q || (t.en + ' ' + t.uk).toLowerCase().includes(q)).sort((x, y) => x.en.localeCompare(y.en, 'en')).slice(0, 80);
    return `<div class="m-more"><section class="m-card"><h3>${gl.edit ? 'Змінити термін' : 'Новий термін'}</h3>
      <label class="m-lbl" for="g-en">Оригінал</label><input id="g-en" class="m-input" value="${esc(gl.en)}" autocomplete="off" autocapitalize="none">
      <label class="m-lbl" for="g-uk">Переклад</label><input id="g-uk" class="m-input" value="${esc(gl.uk)}" autocomplete="off">
      <label class="m-lbl" for="g-alt">Інші дозволені переклади (через кому)</label><input id="g-alt" class="m-input" value="${esc(gl.alt)}" autocomplete="off">
      <label class="m-check"><input type="checkbox" id="g-qa" ${gl.qa ? 'checked' : ''}> Перевіряти в QA</label>
      <div class="m-btnrow"><button class="m-primary" data-gsave>${gl.edit ? 'Зберегти' : 'Додати термін'}</button>${gl.edit ? '<button class="m-secondary" data-gcancel>Скасувати</button>' : ''}</div></section>
      <label class="m-search">${icon('search')}<input id="g-q" type="search" placeholder="Пошук серед ${store.saved.terms.length} термінів" value="${esc(gl.q)}" autocomplete="off"></label>
      ${list.map(t => `<div class="m-term"><button class="m-term-t" data-gedit="${esc(t.en)}"><b>${esc(t.en)}</b><span>→ ${esc(t.uk)}${t.alt?.length ? ` · ${esc(t.alt.join(', '))}` : ''}</span></button><button class="m-mini ghost" data-gdel="${esc(t.en)}" aria-label="Видалити термін ${esc(t.en)}">Видалити</button></div>`).join('') || '<p class="m-none">Термінів ще немає</p>'}</div>`;
  }

  /** Lines made only of words that are already known: shown first, written only after the tap. */
  /** The bar both selection screens share, built like the editor's action bar: pills above, square buttons and the main action below. */
  function selBar(n: number, total: number, allOn: boolean, allAttr: string, pills: string, primary: string, exitAttr: string): string {
    return `<div class="m-afbar" role="toolbar" aria-label="Дії з вибраним"><div class="m-act2"><button class="m-mini" ${allAttr}>${allOn ? 'Зняти вибір' : 'Вибрати всі'}</button>${pills}</div>
      <div class="m-act1"><button class="m-ic" ${exitAttr} aria-label="Вийти з вибору">${icon('x')}</button><span class="m-ic cnt" aria-label="Вибрано ${n} з ${total}">${n}/${total}</span>${primary}</div></div>`;
  }
  function screenAutofill(): string {
    const list = store.autofill(), shown = list.slice(0, 80), on = list.filter(p => !af.off.has(p.file + '|' + p.key));
    const allOn = on.length === list.length;
    return `<div class="m-more m-afwrap"><p class="m-hint">Знаю слів: ${store.wordCount()} · рядків для автозаповнення: ${list.length}</p>
      ${shown.map(p => { const k = p.file + '|' + p.key, sel = !af.off.has(k); return `<div class="m-af ${sel ? 'sel' : ''}" role="checkbox" aria-checked="${sel}" data-aflp="${esc(k)}" data-afk="${esc(k)}"><span class="m-chk ${sel ? 'on' : ''}" aria-hidden="true"></span><span class="m-af-t"><small>${esc(store.view(p.file)?.label ?? p.file)}</small><b>${esc(p.source)}</b><i>→ ${esc(p.target)}</i></span></div>`; }).join('') || '<p class="m-none">Немає рядків, які можна скласти зі знайомих слів</p>'}
      ${list.length > 80 ? `<p class="m-hint">Показано 80 із ${list.length}: після запису решта з'явиться тут.</p>` : ''}
      ${almostHtml()}</div>
      ${list.length ? selBar(on.length, list.length, allOn, 'data-afall', '', `<button class="m-primary" data-afapply ${on.length ? '' : 'disabled'}>${icon('check')}<span>Вписати вибрані</span></button>`, 'data-subback') : ''}`;
  }
  /** Lines that are one or two words short: what blocks them, and a tap to settle it. */
  function almostHtml(): string {
    const list = store.almost().slice(0, 30);
    if (!list.length) return '';
    const amb = (w: string, vs: string[]): string => `<div class="m-bl"><small>«${esc(w)}» неоднозначне:</small>${vs.map(v => `<button class="m-mini" data-afterm="${esc(w)}|${esc(v)}">${esc(v)}</button>`).join('')}</div>`;
    const unk = (w: string): string => `<div class="m-bl"><small>«${esc(w)}» невідоме:</small><button class="m-mini ghost" data-afnew="${esc(w)}">Додати переклад</button></div>`;
    return `<h3 class="m-h3">Майже готові: не вистачає слів</h3><p class="m-hint">Слово неоднозначне, коли в перекладених рядках воно перекладене по-різному: оберіть потрібний варіант, і він стане терміном. Невідоме слово ще не зустрічалось у перекладених рядках: додайте переклад.</p>
      ${list.map(a => `<div class="m-af2"><b>${esc(a.source)}</b>${a.blockers.map(b => (b.reason === 'ambiguous' ? amb(b.word, b.variants) : unk(b.word))).join('')}</div>`).join('')}`;
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
      <section class="m-card"><h3>Довідкові мови</h3><p class="m-hint">Копія тієї ж гри іншою мовою: її рядки показуються під оригіналом як підказка.</p>
        ${store.refLangs().map(l => `<div class="m-var"><span>${esc(l.toUpperCase())}</span><small></small><button class="m-mini ghost" data-refdel="${esc(l)}">Прибрати</button></div>`).join('')}
        <label class="m-lbl" for="rf-lang">Код мови (ru, pl, en…)</label><input id="rf-lang" class="m-input" maxlength="8" value="${esc(refLang)}" autocomplete="off">
        <button class="m-primary wide" data-refpick>Обрати файли гри цією мовою</button></section>
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
    const terms = store.terms(u);
    const review = store.stage === 'review';
    return `<div class="m-edit" id="m-edit">
      <div class="m-ctx"><span class="m-tag">${esc(u.kind)}</span>${store.speaker(u) ? `<span class="m-tag who">${esc(store.speaker(u))}</span>` : ''}${v?.label ? `<span class="m-tag">${esc(v.label)}</span>` : ''}<span class="m-status"><span class="sd ${SHAPE[st]}"></span>${STATUS_LABEL[st]}</span></div>
      <section class="m-card"><h3>Оригінал</h3><div class="m-source" id="m-source">${markup(u.source, terms.map(t => t.en))}</div>${store.refs(c.file, u.key).map(r => `<div class="m-ref"><small>Довідка · ${esc(r.lang.toUpperCase())}</small>${esc(r.text)}</div>`).join('')}</section>
      <section class="m-card m-tr-card"><h3>${review ? 'Після вичитування' : 'Переклад'}<span class="m-count" id="m-count"></span></h3>
        <textarea id="m-tr" class="m-textarea" spellcheck="false" autocapitalize="sentences" placeholder="Напишіть переклад…" aria-label="Переклад">${esc(e?.target ?? '')}</textarea>
      </section>
      <div id="m-prev" class="m-prev"></div>
      <div id="m-issues" class="m-issues">${issuesHtml()}</div>
    </div>
    <div class="m-actions" id="m-actions"><div class="m-act2"><button class="m-mini" data-sub="scene">${icon('rows')} Сцена</button><button class="m-mini danger" data-clear>Очистити</button></div><div class="m-act1"><button class="m-ic" data-step="-1" aria-label="Попередній рядок" ${store.neighbour(-1) ? '' : 'disabled'}>${icon('prev')}</button><button class="m-ic" data-step="1" aria-label="Наступний рядок" ${store.neighbour(1) ? '' : 'disabled'}>${icon('next')}</button><button class="m-primary" data-send>${icon('check')}<span>${review ? 'Затвердити' : 'Надіслати'}</span></button></div></div>`;
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
        <label class="m-check"><input type="checkbox" id="gh-auto" ${gh.everyMin ? 'checked' : ''}> Синхронізувати автоматично (при запуску, після правок, при згортанні, кожні 5 хв)</label>
        <button class="m-primary wide ${busy ? 'is-loading' : ''}" data-ghsync ${busy ? 'disabled' : ''}>${icon('sync')}<span>Синхронізувати</span></button><p class="m-hint" id="m-ghstate">${gh.last ? 'Востаннє: ' + new Date(gh.last).toLocaleString('uk-UA') : 'Ще не синхронізовано'}</p></section>
      <section class="m-card" id="m-claude" hidden><h3>Синхронізація через Claude</h3><p class="m-hint">Спільна база артефакту: працює між вашими пристроями.</p><button class="m-secondary wide ${busy ? 'is-loading' : ''}" data-clsync ${busy ? 'disabled' : ''}>${icon('sync')}<span>Синхронізувати через Claude</span></button></section>
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
      <button class="m-secondary wide ${updBusy ? 'is-loading' : ''}" data-upcheck ${updBusy ? 'disabled' : ''}>${updBusy ? '<i class="m-spin"></i>' : ''}<span>${updBusy ? 'Перевіряю…' : 'Перевірити оновлення'}</span></button>
      ${upd?.newer && upd.asset ? '<button class="m-primary wide" data-upinstall>Оновити зараз</button>' : ''}
      <p class="m-hint" id="m-upmsg">${esc(updMsg)}</p></section>`;
  }

  function empty(title: string, text: string, to: Tab, label: string): string {
    return `<div class="m-empty"><h2>${esc(title)}</h2><p>${esc(text)}</p><button class="m-primary" data-go="${to}">${esc(label)}</button></div>`;
  }

  /* ---------- the hints sheet ---------- */
  const fmtTime = (t: number): string => new Date(t).toLocaleString('uk-UA', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  /** Words of the original (Multitran) and of the translation (Goroh): each opens its dictionary page in the browser. */
  function dictPanel(source: string, target: string): string {
    const chip = (w: string, url: string): string => `<a class="m-w" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(w)}</a>`;
    const en = wordsOf(source), uk = wordsOf(target);
    return `<div class="m-dict"><h4>Оригінал · Multitran</h4><div class="m-wchips">${en.map(w => chip(w, multitranUrl(w))).join('') || '<span class="m-hint">Слів немає</span>'}</div>
      <h4>Переклад · Горох</h4><div class="m-dseg" role="group" aria-label="Сторінка Гороху">${(['Тлумачення', 'Синоніми'] as const).map(k => `<button data-gk="${k}" class="${k === gk ? 'on' : ''}" aria-pressed="${k === gk}">${k}</button>`).join('')}</div>
      <div class="m-wchips">${uk.map(w => chip(w, gorohUrl(w, gk))).join('') || '<span class="m-hint">Спершу напишіть переклад</span>'}</div></div>`;
  }
  /** Side panel under the top bar: one topic at a time (glossary, memory, comments, history); the top-bar button that opened it closes it. */
  function renderSheet(): void {
    const wrap = $('m-sheet'); wrap.hidden = !sheet && !menu;
    if (menu) {
      wrap.dataset.open = '';
      const badge: Partial<Record<Sub, number>> = { autofill: store.autofill().length, consistency: store.inconsistent().length, sendlog: store.sends().length + store.autos().length };
      const short: Partial<Record<Sub, string>> = { find: 'Заміна', autofill: 'Авто', speakers: 'Мовці' };
      const item = (k: Sub): string => { const [, l, ic] = TOOLS.find(t => t[0] === k)!; return `<button class="m-mi" data-sub="${k}">${icon(ic)}<span>${short[k] ?? l}</span>${badge[k] ? `<i>${badge[k]! > 99 ? '99+' : badge[k]}</i>` : ''}</button>`; };
      wrap.innerHTML = `<div class="m-scrim" data-close></div><nav class="m-menu" aria-label="Інструменти"><div class="m-mgrid">${(['find', 'autofill', 'consistency', 'speakers', 'glossary', 'sendlog'] as Sub[]).map(item).join('')}</div>
        <div class="m-msep"></div><button class="m-mi wide" data-sub="settings">${icon('more')}<span>Налаштування</span></button></nav>`;
      return;
    }
    const c = store.current;
    if (!sheet || !c) { wrap.innerHTML = ''; delete wrap.dataset.open; return; }
    const fresh = wrap.dataset.open !== '1'; wrap.dataset.open = '1';
    const terms = store.terms(c.unit), tm = store.suggestions(c.unit, c.entry), cm = c.entry?.comments ?? [], hist = [...(c.entry?.history ?? [])].reverse().slice(0, 20);
    const counts = { terms: terms.length, tm: tm.length, cm: cm.length, hist: hist.length, dict: 0 };
    const tabs: ['terms' | 'tm' | 'cm' | 'hist' | 'dict', string][] = [['terms', 'Глосарій'], ['tm', 'Пам’ять'], ['dict', 'Слова'], ['cm', 'Коментарі'], ['hist', 'Історія']];
    const cur = sheetTab ?? (counts.terms ? 'terms' : counts.tm ? 'tm' : counts.cm ? 'cm' : 'terms');
    const idx = tabs.findIndex(t => t[0] === cur), dir = fresh ? '' : idx > prevTabIdx ? 'from-r' : idx < prevTabIdx ? 'from-l' : '';
    prevTabIdx = idx;
    const panel = cur === 'terms' ? (terms.length ? terms.map((t, i) => `<button class="m-hit" data-term="${i}"><b>${esc(t.en)}</b><span>→ ${esc(t.uk)}${t.alt?.length ? ` · ${esc(t.alt.join(', '))}` : ''}</span></button>`).join('') : '<p class="m-none">У цьому рядку термінів немає</p>') + '<button class="m-mini" data-gadd>Додати термін</button>'
      : cur === 'tm' ? (tm.length ? tm.map((m, i) => `<button class="m-hit" data-tm="${i}"><b class="m-score">${m.score}%</b><span>${esc(m.t)}</span></button>`).join('') : '<p class="m-none">Схожих перекладів немає</p>')
      : cur === 'cm' ? (cm.length ? cm.map(x => `<div class="m-cmc"><small><b>${esc(x.who)}</b> · ${fmtTime(x.at)}</small><p>${esc(x.text)}</p></div>`).join('') : '<p class="m-none">Коментарів ще немає</p>')
      : cur === 'dict' ? dictPanel(c.unit.source, c.entry?.target ?? '')
      : (hist.length ? `<ol class="m-time">${hist.map(h => `<li><small>${fmtTime(h.at)} · ${esc(h.who)}</small><span class="m-chipx">${esc(h.what)}</span><p>${esc(h.text.slice(0, 200))}</p></li>`).join('')}</ol>` : '<p class="m-none">Історії ще немає</p>');
    wrap.innerHTML = `<div class="m-scrim ${fresh ? 'in' : ''}" data-close></div><aside class="m-sheet ${fresh ? 'in' : ''} ${cur === 'cm' ? 'tall' : ''}" role="dialog" aria-label="Допомога до рядка">
      <div class="m-stabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" data-stab="${k}" aria-selected="${k === cur}" class="${k === cur ? 'on' : ''}">${l}${counts[k] ? `<i>${counts[k]}</i>` : ''}</button>`).join('')}<span class="m-stab-ind" id="m-stab-ind"></span></div>
      <div class="m-spanel ${dir}" id="m-spanel">${panel}</div>
      ${cur === 'cm' ? `<form class="m-composer" data-cmform><textarea id="m-cm" rows="2" maxlength="400" placeholder="Написати коментар…" aria-label="Новий коментар"></textarea><button type="submit" class="m-send" aria-label="Надіслати коментар" disabled>${icon('send')}</button></form>` : ''}
    </aside>`;
    const sp = document.getElementById('m-spanel'); if (sp && cur === 'cm') sp.scrollTop = sp.scrollHeight;
    const on = wrap.querySelector<HTMLElement>('.m-stabs button.on'), ind = document.getElementById('m-stab-ind');
    if (on && ind) {
      const to = on.offsetLeft, w = on.offsetWidth;
      ind.style.width = w + 'px';
      if (tabX && !fresh) { ind.style.transition = 'none'; ind.style.transform = `translateX(${tabX.from}px)`; ind.style.width = tabX.w + 'px'; void ind.offsetWidth; ind.style.transition = ''; }
      ind.style.transform = `translateX(${to}px)`; ind.style.width = w + 'px';
      tabX = { from: to, w };
    }
  }

  /* ---------- render ---------- */
  const HEAVY: Sub[] = ['autofill', 'consistency', 'sendlog'];
  function render(): void {
    renderChrome();
    const main = $('m-main');
    main.className = 'm-main tab-' + tab;
    const vk = tab + '|' + (sub ?? '');
    if (!sub) ready.clear();
    if (sub && HEAVY.includes(sub) && !ready.has(sub)) {
      main.innerHTML = '<div class="m-skel" role="status" aria-label="Перевіряю"><div class="m-skel-h"><i class="m-spin"></i><span>Перевіряю рядки…</span></div><b></b><b></b><b></b><b></b></div>';
      main.classList.add('enter'); viewKey = vk; renderSheet();
      const want = sub;
      requestAnimationFrame(() => setTimeout(() => { if (sub === want) { ready.add(want); render(); } }, 30));
      return;
    }
    const entered = vk !== viewKey;
    if (entered) { viewKey = vk; main.classList.add('enter'); }
    main.innerHTML = sub ? ({ scene: screenScene, find: screenFind, speakers: screenSpeakers, settings: screenSettings, consistency: screenConsistency, glossary: screenGlossary, autofill: screenAutofill, sendlog: screenSendLog }[sub])() : tab === 'files' ? screenFiles() : tab === 'rows' ? screenRows() : tab === 'edit' ? screenEdit() : screenMore();
    renderSheet();
    // a field that was removed by this redraw cannot report that it lost the focus
    if (!document.activeElement?.matches(TEXTY)) $('m-app').classList.remove('kb');
    if (entered && tab === 'rows' && !sub) requestAnimationFrame(() => document.querySelector('.m-row.cur, .m-table tr.cur')?.scrollIntoView({ block: 'center' }));
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
    const pv = document.getElementById('m-prev');
    if (pv) {
      const lim = limitFor(store.lineLimit(), c.unit.face);
      const lines = t.split('\n');
      pv.hidden = !lim || !t.trim();
      pv.style.setProperty('--lim', String(lim || 0));
      pv.innerHTML = lim ? `<small>Вікно гри: ${lim} зн. у рядку</small><div class="m-prevbox">${lines.map(l => { const plain = [...l.replace(/\\[A-Za-z]+(\[[^\]]*\])?|\\[.|!<>^{}$]/g, '')]; const over = plain.length - lim; return `<div class="${over > 0 ? 'over' : ''}">${esc(l) || '&nbsp;'}${over > 0 ? `<em>+${over}</em>` : ''}</div>`; }).join('')}</div>` : '';
    }
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

  async function importRef(files: File[]): Promise<void> {
    refLang = (document.getElementById('rf-lang') as HTMLInputElement | null)?.value.trim().toLowerCase() || refLang;
    if (!refLang) { say('Вкажіть код мови, наприклад ru або pl', true); return; }
    busy = 'Читаю довідку…'; renderChrome();
    try {
      const game: GameFile[] = [];
      for (const f of files) { const name = canonicalRpgMakerName(f.name) ?? (formatOf({ name: f.name }) ? f.name : null); if (!name) continue; const text = await f.text(); game.push(isTextFormat(formatOf({ name })) ? { name, json: null, text } : { name, json: JSON.parse(text) }); }
      const r = store.importReference(refLang, game);
      if (!r.paired) say('Не знайдено спільних файлів: оберіть файли тієї ж гри іншою мовою', true);
      else say(`Довідку (${refLang.toUpperCase()}) додано: ${r.paired} із ${r.total} рядків знайшли пару`);
    } catch (e) { say(`Не вдалося прочитати: ${e instanceof Error ? e.message : 'помилка'}`, true); }
    finally { busy = ''; renderChrome(); render(); }
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
  /** Quiet background sync of the translation with GitHub: starts only when set up, online, not typing, not already syncing. */
  let autoBusy = false, autoFails = 0, autoTimer = 0, autoEnd = 0;
  async function autoSync(why: string): Promise<void> {
    const cfg = loadGithubConfig();
    if (!cfg.everyMin || !githubConfigured(cfg) || busy || autoBusy || !navigator.onLine) return;
    if ($('m-app').classList.contains('kb') && why !== 'hide') { autoSyncLater(8000); return; }
    autoBusy = true; busy = 'Синхронізація…'; renderChrome();
    try {
      await store.flush();
      const rep = await githubSync(githubApi(cfg), cfg, cfg.state, store.saved, { since: cfg.last });
      store.saved = rep.project; cfg.last = Date.now(); cfg.state = rep.state; saveGithubConfig(cfg); store.adopt();
      autoFails = 0;
      if (rep.pulled || rep.conflicts) { say(describeGithub(rep)); if (!$('m-app').classList.contains('kb')) render(); }
    } catch (e) { if (autoFails++ === 0) say('Автосинхронізація не вдалася: ' + (e instanceof Error ? e.message : 'помилка'), true); }
    finally { autoBusy = false; autoEnd = Date.now(); busy = ''; renderChrome(); }
  }
  /** After edits: wait until the typing stops, then sync. */
  function autoSyncLater(ms = 45000): void { clearTimeout(autoTimer); autoTimer = window.setTimeout(() => void autoSync('edit'), ms); }
  store.onChange(() => { if (!autoBusy && Date.now() - autoEnd > 5000 && loadGithubConfig().everyMin) autoSyncLater(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') void autoSync('hide'); else if (Date.now() - loadGithubConfig().last > 120000) void autoSync('show'); });
  window.addEventListener('online', () => void autoSync('online'));
  setInterval(() => { const c = loadGithubConfig(); if (c.everyMin && document.visibilityState === 'visible' && Date.now() - c.last >= c.everyMin * 60000) void autoSync('timer'); }, 60000);
  setTimeout(() => void autoSync('start'), 2500);
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
    if ((x = q('[data-go]'))) { if (x.closest('#m-nav')) switchTab(x.dataset.go as Tab); else go(x.dataset.go as Tab); return; }
    if ((x = q('[data-sub]'))) { sub = x.dataset.sub as Sub; sheet = false; menu = false; render(); $('m-main').scrollTop = 0; return; }
    if (q('[data-subback]')) { sub = null; render(); return; }
    if ((x = q('[data-layout]'))) { layout = x.dataset.layout as 'cards' | 'table'; try { localStorage.setItem('transly-m-layout', layout); } catch { /* private mode */ } render(); return; }
    if ((x = q('[data-cell]'))) { editCell(x); return; }
    if ((x = q('[data-scope]'))) { scope = x.dataset.scope as 'file' | 'all'; render(); return; }
    if ((x = q('[data-hit]'))) { store.open(x.dataset.hit!, x.dataset.hitkey!); scope = 'file'; go('edit'); return; }
    if ((x = q('[data-scpick]'))) { scn.picked = x.dataset.scpick!; const y = $('m-main').scrollTop; render(); $('m-main').scrollTop = y; return; }
    if ((x = q('[data-scmode]'))) { scn.mode = x.dataset.scmode as typeof scn.mode; const y = $('m-main').scrollTop; render(); $('m-main').scrollTop = y; return; }
    if (q('[data-scedit]')) { store.select(scn.picked); sub = null; go('edit'); return; }
    if (q('[data-scenesend]')) { const v = store.view(), c = store.current; if (v && c) { if (!armed(sceneUnits(v.units, c.unit.key).length, 'scene')) return; const r = store.sendMany(v.name, sceneUnits(v.units, c.unit.key)); say(`Надіслано: ${r.sent}${r.skipped ? ` · пропущено: ${r.skipped}` : ''}`, r.sent === 0); buzz(14); render(); } return; }
    if (q('[data-dofind]')) { fr.matches = store.find({ find: fr.find, replace: fr.replace, caseSensitive: fr.cs, wholeWord: fr.word }); if (!fr.find) say('Вкажіть, що шукати', true); else if (!fr.matches.length) say('Нічого не знайдено'); render(); return; }
    if (q('[data-doreplace]')) { const n = store.replaceAll(fr.matches); fr.matches = []; say(`Замінено в рядках: ${n}`); buzz(14); render(); return; }
    if ((x = q('[data-uni]'))) { const [gi, vi] = x.dataset.uni!.split('|').map(Number); const g = store.inconsistent()[gi!]; const v = g?.variants[vi!]; if (g && v) { const n = store.unify(g.source, v.target); say(`Уніфіковано рядків: ${n}`); buzz(14); } render(); return; }
    if (q('[data-refpick]')) { refLang = ($<HTMLInputElement>('rf-lang').value || '').trim().toLowerCase(); if (!refLang) { say('Вкажіть код мови, наприклад ru або pl', true); return; } $<HTMLInputElement>('m-reffile').click(); return; }
    if ((x = q('[data-refdel]'))) { store.removeReference(x.dataset.refdel!); say(`Довідку ${x.dataset.refdel!.toUpperCase()} прибрано`); render(); return; }
    if (q('[data-spsave]')) { const n = store.setSpeakers(sp.draft); sp.draft.clear(); say(n ? `Мовців оновлено: ${n}` : 'Змін немає'); render(); return; }
    if ((x = q('[data-file]'))) { store.open(x.dataset.file!); go('rows'); return; }
    if ((x = q('[data-filter]'))) { store.setFilter(x.dataset.filter as Filter); render(); return; }
    if (q('[data-more]')) { page++; const y = $('m-main').scrollTop; render(); $('m-main').scrollTop = y; return; }
    if (q('[data-select]')) { selecting = !selecting; picked.clear(); if (selecting) hintOnce(); render(); return; }
    if ((x = q('[data-pickkey]'))) { const k = x.dataset.pickkey!; if (picked.has(k)) picked.delete(k); else picked.add(k); render(); return; }
    if (q('[data-selall]')) { const all = store.rows(); if (picked.size === all.length) picked.clear(); else all.forEach(u => picked.add(u.key)); render(); return; }
    if (q('[data-selsend]') || q('[data-selclear]') || q('[data-selcopy]')) {
      const v = store.view(); if (!v) return; const us = v.units.filter(u => picked.has(u.key));
      if (q('[data-selsend]')) { if (!armed(us.length, 'sel')) return; const r = store.sendMany(v.name, us); say(`Надіслано: ${r.sent}${r.skipped ? ` · пропущено: ${r.skipped}` : ''}`, r.sent === 0); }
      else if (q('[data-selclear]')) { if (!confirmTap(q('[data-selclear]')!, `Очистити ${us.length}?`)) return; say(`Очищено: ${store.clearMany(v.name, us)}`); }
      else { const n = us.filter(u => store.writeAtCopy(v.name, u)).length; say(`Скопійовано оригінал: ${n}`); }
      buzz(14); picked.clear(); render(); return;
    }
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
    if ((x = q('[data-clear]'))) { if (!confirmTap(x)) return; ($('m-tr') as HTMLTextAreaElement).value = ''; store.write(''); refreshMeta(); autosize(); return; }
    if ((x = q('[data-ins]'))) { insert(x.dataset.ins ?? ''); return; }
    if (q('[data-wrap]')) { if (store.wrap()) { render(); } else say('Рядки вже вміщаються'); return; }
    if ((x = q('[data-ign]'))) { store.mutate((_f, _u, en) => ({ ...(en as NonNullable<typeof en>), ign: [...new Set([...(en?.ign ?? []), x!.dataset.ign!])], mt: Date.now() })); refreshMeta(); return; }
    if (q('[data-gsave]')) {
      const v = (id: string): string => $<HTMLInputElement>(id).value;
      if (!store.saveTerm(v('g-en'), v('g-uk'), v('g-alt'), $<HTMLInputElement>('g-qa').checked)) { say('Заповніть оригінал і переклад', true); return; }
      say(gl.edit ? 'Термін змінено' : 'Термін додано'); buzz(10); Object.assign(gl, { en: '', uk: '', alt: '', qa: true, edit: false }); render(); return;
    }
    if (q('[data-gcancel]')) { Object.assign(gl, { en: '', uk: '', alt: '', qa: true, edit: false }); render(); return; }
    if ((x = q('[data-gedit]'))) { const t = store.saved.terms.find(y => y.en === x!.dataset.gedit); if (t) { Object.assign(gl, { en: t.en, uk: t.uk, alt: (t.alt ?? []).join(', '), qa: t.qa !== false, edit: true }); render(); $('m-main').scrollTop = 0; } return; }
    if ((x = q('[data-gdel]'))) { store.removeTerm(x.dataset.gdel!); say('Термін видалено'); render(); return; }
    if ((x = q('[data-actopen]'))) { const k = x.dataset.actopen!; if (act.open.has(k)) act.open.delete(k); else act.open.add(k); const y = $('m-main').scrollTop; render(); $('m-main').scrollTop = y; return; }
    if ((x = q('[data-undoauto]'))) { const [at, kind] = x.dataset.undoauto!.split('|'); const n = store.undoAutoFill(Number(at), kind!); say(n ? `Скасовано: ${plural(n, ['рядок', 'рядки', 'рядків'])}` : 'Нічого скасовувати', !n); buzz(14); render(); return; }
    if ((x = q('[data-undosend]'))) { const [at, kind, g] = x.dataset.undosend!.split('|'); const n = store.undoSend(Number(at), kind!, g === '1'); say(n ? `Скасовано: ${plural(n, ['рядок', 'рядки', 'рядків'])}` : 'Нічого скасовувати', !n); buzz(14); render(); return; }
    if ((x = q('[data-afterm]'))) { const [w, v] = x.dataset.afterm!.split('|'); if (store.saveTerm(w!, v!, '', true)) { say('Термін додано: ' + w + ' - ' + v); buzz(10); } render(); return; }
    if ((x = q('[data-afnew]'))) { Object.assign(gl, { en: x.dataset.afnew!, uk: '', alt: '', qa: true, edit: false }); sub = 'glossary'; render(); $('m-main').scrollTop = 0; return; }
    if (q('[data-afall]')) { const list = store.autofill(); const allOn = list.every(p => !af.off.has(p.file + '|' + p.key)); if (allOn) list.forEach(p => af.off.add(p.file + '|' + p.key)); else af.off.clear(); const y = $('m-main').scrollTop; render(); $('m-main').scrollTop = y; return; }
    if ((x = q('[data-afk]'))) { const k = x.dataset.afk!; if (af.off.has(k)) af.off.delete(k); else af.off.add(k); const y = $('m-main').scrollTop; render(); $('m-main').scrollTop = y; return; }
    if (q('[data-afapply]')) { const n = store.applyAutofill(store.autofill().filter(p => !af.off.has(p.file + '|' + p.key))); af.off.clear(); say(`Вписано рядків: ${n}`); buzz(14); render(); return; }
    if (q('[data-gadd]')) { const c = store.current; gl.en = c && c.unit.source.length <= 40 ? c.unit.source : ''; gl.uk = ''; gl.edit = false; sheet = false; sub = 'glossary'; render(); return; }
    if ((x = q('[data-gk]'))) { gk = x.dataset.gk as typeof gk; renderSheet(); return; }
    if ((x = q('[data-stab]'))) { sheetTab = x.dataset.stab as typeof sheetTab; renderSheet(); return; }
    if (q('[data-menu]')) { menu = !menu; sheet = false; renderSheet(); renderChrome(); return; }
    if (q('[data-sheet]')) { sheet = !sheet; menu = false; renderSheet(); renderChrome(); return; }
    if (q('[data-close]')) { sheet = false; menu = false; renderSheet(); renderChrome(); return; }
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
      updMsg = ''; updBusy = true; render();
      checkUpdate(cfg).then(c => { upd = c; updMsg = c.newer ? '' : 'У вас остання версія'; }).catch(err => { updMsg = err instanceof Error ? err.message : 'Не вдалося перевірити'; }).finally(() => { updBusy = false; render(); });
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
  root.addEventListener('submit', e => {
    const f = e.target as HTMLElement; if (!f.matches('[data-cmform]')) return; e.preventDefault();
    const ta = $<HTMLTextAreaElement>('m-cm'); const text = ta.value.trim(); if (!text) return;
    store.comment(text); buzz(8); renderSheet(); renderChrome();
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
    else if (t.id === 'g-q') { gl.q = (t as HTMLInputElement).value; const p = (t as HTMLInputElement).selectionStart; render(); const i = $<HTMLInputElement>('g-q'); i.focus(); if (p !== null) i.setSelectionRange(p, p); }
    else if (t.id === 'm-cm') { const ta = t as HTMLTextAreaElement; ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 140) + 'px'; const b = ta.form?.querySelector<HTMLButtonElement>('.m-send'); if (b) b.disabled = !ta.value.trim(); }
    else if (t.id === 'm-tr') { store.write((t as HTMLTextAreaElement).value); refreshMeta(); autosize(); }
    else if (t.id === 'm-fq') { fq = (t as HTMLInputElement).value; const l = document.getElementById('m-flist'); if (l) l.innerHTML = filesList(); }
    else if (t.id === 'm-q') { store.setQuery((t as HTMLInputElement).value); const ul = document.querySelector('.m-list.rows'); if (ul) { const keep = (t as HTMLInputElement).selectionStart; render(); const qi = document.getElementById('m-q') as HTMLInputElement; qi.focus(); qi.setSelectionRange(keep, keep); } }
    else if (t.id === 'm-who') { store.saved.settings.who = (t as HTMLInputElement).value.trim() || 'Ви'; store.persist(); }
  });
  root.addEventListener('change', e => {
    const t = e.target as HTMLElement;
    if (t.id === 'gh-auto') { const cfg = loadGithubConfig(); cfg.everyMin = (t as HTMLInputElement).checked ? 5 : 0; saveGithubConfig(cfg); say(cfg.everyMin ? 'Автосинхронізація ввімкнена' : 'Автосинхронізацію вимкнено'); if (cfg.everyMin) void autoSync('on'); return; }
    if (t.id === 'scn-real') { scn.real = (t as HTMLInputElement).checked; const y = $('m-main').scrollTop; render(); $('m-main').scrollTop = y; return; }
    if (t.id === 'f-word') fr.word = (t as HTMLInputElement).checked;
    else if (t.id === 'f-case') fr.cs = (t as HTMLInputElement).checked;
    else if (t.id === 's-block' || t.id === 's-prop') { store.saved.settings[t.id === 's-block' ? 'blockErrors' : 'propagate'] = (t as HTMLInputElement).checked; store.saved.settingsAt = Date.now(); store.persist(); }
    else if (t.id === 's-mode') { const m = (t as HTMLSelectElement).value; store.saved.settings.lineLimit = m === 'off' ? -1 : m === 'custom' ? Math.round(Number((document.getElementById('s-lim') as HTMLInputElement).value)) || 50 : 0; store.saved.settingsAt = Date.now(); store.persist(); render(); }
    if (t.id === 'm-sort') { store.setSort((t as HTMLSelectElement).value as Sort); render(); }
    if (t.id === 'm-reffile') { const f = [...((t as HTMLInputElement).files ?? [])]; (t as HTMLInputElement).value = ''; if (f.length) void importRef(f); return; }
    if (t.id === 'm-file') { const f = [...((t as HTMLInputElement).files ?? [])]; (t as HTMLInputElement).value = ''; if (f.length) void importFiles(f); }
  });
  // The keyboard takes the bottom navigation's place.
  /**
   * Long-press on a card toggles it; keep the finger down and drag over other cards to give them the same state
   * (select or unselect). Near the top or bottom edge the page scrolls gently. A short swipe still just scrolls.
   */
  const cardKey = (el: HTMLElement): string | null => el.dataset.aflp ?? el.dataset.key ?? el.dataset.pickkey ?? null;
  const CARD = '.m-row[data-key], .m-row[data-pickkey], [data-aflp]';
  let lp: { timer: number; x: number; y: number } | null = null; let lpFired = false;
  let drag: { add: boolean; last: number; y: number; x: number; raf: number } | null = null;
  const isAf = (el: HTMLElement): boolean => el.dataset.aflp !== undefined;
  /** Set a card selected or not without redrawing the page (the finger is on it). */
  function paint(el: HTMLElement, on: boolean): void {
    const k = cardKey(el); if (!k) return;
    if (isAf(el)) { if (on) af.off.delete(k); else af.off.add(k); el.classList.toggle('sel', on); el.setAttribute('aria-checked', String(on)); el.querySelector('.m-chk')?.classList.toggle('on', on); }
    else { if (on) picked.add(k); else picked.delete(k); el.classList.toggle('picked', on); el.setAttribute('aria-pressed', String(on)); el.querySelector('.m-chk')?.classList.toggle('on', on); }
  }
  const isOn = (el: HTMLElement): boolean => { const k = cardKey(el); return !!k && (isAf(el) ? !af.off.has(k) : picked.has(k)); };
  /** The card the finger is over by position, also when a bar or the search field floats above it; every card passed on the way is changed too. */
  function dragAt(x: number, y: number): void {
    if (!drag) return;
    drag.x = x; drag.y = y;
    const main = $('m-main'), r = main.getBoundingClientRect();
    const bar = document.querySelector('.m-afbar'), barTop = bar ? bar.getBoundingClientRect().top : r.bottom;
    const yy = Math.min(Math.max(y, r.top + 70), barTop - 4);
    const cards = [...main.querySelectorAll<HTMLElement>(CARD)];
    let idx = -1, best = Infinity;
    cards.forEach((c, i) => { const b = c.getBoundingClientRect(), d = yy < b.top ? b.top - yy : yy > b.bottom ? yy - b.bottom : 0; if (d < best) { best = d; idx = i; } });
    if (idx < 0 || idx === drag.last) return;
    const from = drag.last < 0 ? idx : drag.last, lo = Math.min(from, idx), hi = Math.max(from, idx);
    for (let n = lo; n <= hi; n++) { const el = cards[n]!; if (isOn(el) !== drag.add) paint(el, drag.add); }
    drag.last = idx;
  }
  function dragLoop(): void {
    if (!drag) return;
    const main = $('m-main'), r = main.getBoundingClientRect(), edge = 90;
    const bottom = r.bottom - (document.querySelector('.m-afbar') ? 130 : 70);
    let v = 0;
    if (drag.y < r.top + edge + 56) v = -Math.min(6, 1 + (r.top + edge + 56 - drag.y) / 18);
    else if (drag.y > bottom) v = Math.min(6, 1 + (drag.y - bottom) / 14);
    if (v) { main.scrollTop += v; dragAt(drag.x, drag.y); }
    drag.raf = requestAnimationFrame(dragLoop);
  }
  function dragEnd(): void {
    if (!drag) return;
    cancelAnimationFrame(drag.raf); drag = null;
    const y = $('m-main').scrollTop; render(); $('m-main').scrollTop = y;
    setTimeout(() => { lpFired = false; }, 350);
  }
  let hinted = false;
  const hintOnce = (): void => { if (!hinted) { hinted = true; say('Ведіть пальцем по кружечках, щоб вибрати кілька'); } };
  /** Start selecting: the card under the finger flips, and every card the finger passes gets the same state. */
  function startDrag(card: HTMLElement, x: number, y: number): void {
    lpFired = true; buzz(18);
    if (!isAf(card)) { selecting = true; hintOnce(); }
    const add = !isOn(card);
    paint(card, add);
    drag = { add, last: -1, x, y, raf: 0 };
    drag.raf = requestAnimationFrame(dragLoop);
  }
  const GUT = '.m-chk';
  let tl: { timer: number; x: number; y: number; card: HTMLElement; gut: boolean } | null = null;
  const tlCancel = (): void => { if (tl) { clearTimeout(tl.timer); tl = null; } };
  root.addEventListener('touchstart', e => {
    const t = e.touches[0]; if (!t || e.touches.length > 1) { tlCancel(); return; }
    const el = e.target as HTMLElement, card = el.closest<HTMLElement>(CARD);
    if (!card) return;
    lpFired = false; tlCancel();
    const gut = !!el.closest(GUT);
    tl = { x: t.clientX, y: t.clientY, card, gut, timer: gut ? 0 : window.setTimeout(() => { if (tl) { const c = tl; tl = null; startDrag(c.card, c.x, c.y); } }, 450) };
  }, { passive: true });
  // After the long-press (or a drag started on the handle) the finger belongs to the selection: the browser must not scroll with it.
  root.addEventListener('touchmove', e => {
    const t = e.touches[0]; if (!t) return;
    if (drag) { e.preventDefault(); dragAt(t.clientX, t.clientY); return; }
    if (!tl) return;
    if (Math.hypot(t.clientX - tl.x, t.clientY - tl.y) <= 8) return;
    if (tl.gut) { const c = tl; tlCancel(); e.preventDefault(); startDrag(c.card, c.x, c.y); dragAt(t.clientX, t.clientY); } else tlCancel();
  }, { passive: false });
  const touchUp = (): void => { tlCancel(); if (drag) dragEnd(); else if (lpFired) setTimeout(() => { lpFired = false; }, 350); };
  root.addEventListener('touchend', touchUp); root.addEventListener('touchcancel', touchUp);
  root.addEventListener('contextmenu', e => { if ((e.target as HTMLElement).closest('.m-row, [data-aflp]')) e.preventDefault(); });
  root.addEventListener('click', e => { if (lpFired) { lpFired = false; e.stopPropagation(); e.preventDefault(); } }, true);
  const topBtn = $('m-top'), mainEl = $('m-main');
  const updateTop = (): void => {
    const on = (tab === 'files' || tab === 'rows') && !sub && mainEl.scrollTop > 360;
    topBtn.hidden = !on;
    const bar = document.querySelector<HTMLElement>('.m-afbar');
    topBtn.style.bottom = bar ? `${$('m-nav').offsetHeight + bar.offsetHeight + 12}px` : '';
  };
  mainEl.addEventListener('scroll', updateTop, { passive: true });
  topBtn.addEventListener('click', () => mainEl.scrollTo({ top: 0, behavior: 'smooth' }));
  new MutationObserver(updateTop).observe(mainEl, { childList: true });
  document.addEventListener('focusin', e => { if ((e.target as HTMLElement).matches(TEXTY)) $('m-app').classList.add('kb'); });
  document.addEventListener('focusout', () => { setTimeout(() => { if (!document.activeElement?.matches(TEXTY)) $('m-app').classList.remove('kb'); }, 120); });
  // A swipe across the editor moves to the next / previous row.
  let sx = 0, sy = 0, st = 0, sw = false;
  root.addEventListener('touchstart', e => { sw = tab === 'edit' && e.touches.length === 1 && !(e.target as HTMLElement).closest('textarea, button, input, .m-sheet'); if (sw) { sx = e.touches[0]!.clientX; sy = e.touches[0]!.clientY; st = Date.now(); } }, { passive: true });
  root.addEventListener('touchend', e => { if (!sw) return; sw = false; const c = e.changedTouches[0]!, dx = c.clientX - sx, dy = c.clientY - sy; if (Date.now() - st < 700 && Math.abs(dx) > 80 && Math.abs(dy) < Math.abs(dx) / 2) step(dx < 0 ? 1 : -1); }, { passive: true });
  window.addEventListener('pagehide', () => void store.flush());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') void store.flush(); });
  // What the Android shell calls: the back button (close the sheet, then one screen up), saving on leaving, a row opened from the widget.
  Object.assign(window, {
    __back: (): boolean => { if (sub) { sub = null; render(); return true; } if (sheet || menu) { sheet = false; menu = false; renderSheet(); renderChrome(); return true; } if (tab === 'edit') { go('rows'); return true; } if (tab === 'rows' || tab === 'more') { go('files'); return true; } return false; },
    __flush: (): Promise<void> => store.flush(),
    __open: (file: string, key: string): void => { if (store.view(file)) { store.open(file, key); go('edit'); } },
  });
  // Quietly look for a new version a few seconds after the start.
  if (canUpdate()) setTimeout(() => { const cfg = loadUpdateCfg(); if (!cfg.auto || !cfg.token) return; checkUpdate(cfg).then(c => { if (c.newer && c.release.sha !== cfg.skipped) { upd = c; say('Доступна нова версія: відкрийте «Ще» → «Оновлення»'); } }).catch(() => undefined); }, 4000);

  render();
}
