import { HINT_GLYPH, HINT_LABEL, KIND_LABEL, explainCodes, sceneTitle, stepScene, byHintOrder, commentId, historyRows, openThreads, restoreNote, sourceTermHits, targetHasTerm, threadsOf, batchTitle, batchUndoLabel, undoReport, setIgnored, canonicalRpgMakerName, claudeSync, formatOf, githubSync, isTextFormat, looksLikeProject, sceneLines, sceneUnits, speakerCandidates, describePage, DEFAULT_LINE_LIMIT, DEFAULT_WRAP, MV_WINDOW, autoLineLimit, flowText, isMessageUnit, linesShown, measureOf, pixelBudget, unitWord, usesPixels, widthOf, wrapMessage, wrapOf } from '../core';
import { APOSTROPHES, QA_RULES, QUEUE_LABEL, copyLine, stamp, rowsWithTerm, termRowsNote, adoptSynced, groupColor, isAutoFilled, pct as pctOf, keepFromText, keepToText, qaOf, withRuleLevel } from '../core';
import type { Issue, LinkMode, LinkState, QaSettings, RuleSeverity, TermChange, TermProposal, TermSync, WrapSettings } from '../core';
import { pxMeasure } from '../ui/measure';
import { CONF_LABEL, flagsText, markHtml } from '../ui/termsync-html';
import type { Comment, DiffSeg, Entry, GameFile } from '../core';
import { artifactDb, describeClaude, loadClaudeConfig, saveClaudeConfig } from '../ui/claude';
import { describeGithub, githubApi, githubConfigured, loadGithubConfig, saveGithubConfig } from '../ui/github';
import { esc, plural } from '../ui/dom';
import { showRecovery } from '../ui/recovery';
import { gameHtml } from '../ui/gamehtml';
import { markupTerms } from '../ui/markup';
import { androidBridge, publishWidget } from '../ui/android';
import type { WidgetStats } from '../ui/android';
import { buildWidget } from './widgetdata';
import { FILTERS, STATUS_LABEL, Store, skippedText } from './store';
import type { BulkResult, Filter, Shown, Sort } from './store';
import { scenesOf } from '../ui/scenecache';
import { icon } from './icons';
import { canUpdate, checkUpdate, installUpdate, loadUpdateCfg, saveUpdateCfg } from './update';
import type { UpdateCheck } from './update';

type Tab = 'files' | 'rows' | 'edit' | 'more';
const TAB_LABEL: Record<Tab, string> = { files: 'Файли', rows: 'Рядки', edit: 'Переклад', more: 'Ще' };
const SHAPE: Record<Shown, string> = { new: 'sd-new', draft: 'sd-draft', done: 'sd-done', appr: 'sd-appr', qa: 'sd-qa' };

export async function start(root: HTMLElement): Promise<void> {
  const store = await Store.open((f, keep) => showRecovery(root, f, keep));
  store.onForeignNotice = () => say('Знайдено правки з іншої вкладки: їх злито з вашими');
  let tab: Tab = store.hasGame ? (store.key ? 'edit' : 'rows') : 'files';
  let menu = false;
  /** Fields the keyboard opens for: only these switch the app into keyboard mode (a checkbox does not). */
  const TEXTY = 'textarea, input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=range]):not([type=file])';
  let sheet = false; let sheetTab: 'terms' | 'tm' | 'cm' | 'hist' | 'dict' | null = null; let gk: 'Тлумачення' | 'Синоніми' = 'Тлумачення';
  let busy = '';
  type Sub = 'scene' | 'find' | 'speakers' | 'settings' | 'wrap' | 'consistency' | 'termsync' | 'glossary' | 'autofill' | 'sendlog' | 'search' | 'qarules';
  let sub: Sub | null = null;
  let scope: 'file' | 'all' | 'group' = 'file';
  /** The group whose rows the Rows screen shows (scope «group»), and the group whose less common actions are open. */
  let gscope: string | null = null; let gmore: string | null = null;
  let layout: 'cards' | 'table' = (() => { try { return localStorage.getItem('transly-m-layout') === 'table' ? 'table' : 'cards'; } catch { return 'cards'; } })();
  /** The table needs room for its columns (a landscape phone, a tablet); on a narrow screen the rows are cards whatever was chosen. */
  const wide = matchMedia('(min-width: 700px)');
  const lay = (): 'cards' | 'table' => (wide.matches ? layout : 'cards');
  const fr = { find: '', replace: '', word: false, cs: false, appr: false, matches: [] as ReturnType<typeof store.find> };
  const PAGE = 100; let page = 1, pageSig = '';
  let refLang = ''; let fq = '';
  const collapsedCats = new Set<string>((() => { try { return JSON.parse(localStorage.getItem('transly-m-cats') ?? '[]') as string[]; } catch { return []; } })()); let sq = '';
  let srTimer = 0; let scnTimer = 0;
  let plPick: Set<string> | null = null; let resetArmed = false; let resetArmedAt = 0;
  let selecting = false; const picked = new Set<string>();
  /** Groups of files: files ticked for "into a group", the menu, groups unfolded, the group being renamed or asked about deletion. */
  let fsel = false; const fpicked = new Set<string>(); let fmenu = false; const gopen = new Set<string>(); let grename: string | null = null; let gdel: string | null = null; let gcreating = false;
  const scn: { mode: 'both' | 'tr' | 'src'; real: boolean; picked: string } = { mode: 'both', real: false, picked: '' };
  const act = { open: new Set<string>() };
  const gl = { q: '', en: '', uk: '', alt: '', qa: true, edit: false };
  const af = { off: new Set<string>() };
  /** The links screen: one cluster to review (opened from the card under the translation), or null for the list of all. */
  const lk: { scope: { file: string; key: string } | null; off: Set<string> } = { scope: null, off: new Set() };
  /** The tool «Оновити за глосарієм»: the change of a term, the rows found for it and what the translator ticked. */
  const ts: { change: TermChange | null; res: TermSync | null; pending: number; on: Map<string, boolean>; pick: Map<string, number[]>; shown: number; term: string; old: string } = { change: null, res: null, pending: 0, on: new Map(), pick: new Map(), shown: 40, term: '', old: '' };
  const tsId = (p: TermProposal): string => `${p.file}\u0001${p.key}`;
  const fileOf = (f: string): string => store.view(f)?.label ?? f.replace(/\.json$/, '');
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
    <input type="file" id="m-termfile" accept=".html,.htm,.csv,.tsv,.txt,text/html,text/csv,text/plain" hidden>
  </div>`;
  const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

  /** A message: the same text twice becomes «×2», two at most stay on screen, and a message about a bulk action can carry «Скасувати». */
  const say = (text: string, bad = false, undo?: string): void => {
    const host = $('m-toasts');
    const leave = (n: HTMLElement): void => { window.clearTimeout(Number(n.dataset.timer)); n.classList.add('out'); setTimeout(() => n.remove(), 220); };
    const life = undo ? 7000 : bad ? 6000 : 3200;
    const same = undo ? undefined : [...host.querySelectorAll<HTMLElement>('.m-toast:not(.out):not(.has-undo)')].find(x => x.dataset.text === text);
    if (same) {
      const n = Number(same.dataset.n ?? '1') + 1; same.dataset.n = String(n);
      const m = same.querySelector('.m-tmsg'); if (m) m.textContent = `${text} ×${n}`;
      window.clearTimeout(Number(same.dataset.timer)); same.dataset.timer = String(window.setTimeout(() => leave(same), life));
      return;
    }
    const t = document.createElement('div'); t.className = 'm-toast' + (bad ? ' bad' : '') + (undo ? ' has-undo' : ''); t.dataset.text = text;
    const m = document.createElement('span'); m.className = 'm-tmsg'; m.textContent = text; t.appendChild(m);
    if (undo) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'm-tundo'; b.textContent = 'Скасувати';
      b.addEventListener('click', () => { leave(t); const r = store.undoJournalBatch(undo); say(undoReport(r), !r.done); buzz(14); render(); });
      t.appendChild(b);
    }
    host.appendChild(t);
    const live = [...host.querySelectorAll<HTMLElement>('.m-toast:not(.out)')];
    while (live.length > 2) leave(live.shift()!);
    t.dataset.timer = String(window.setTimeout(() => leave(t), life));
  };
  const buzz = (ms = 10): void => { try { navigator.vibrate?.(ms); } catch { /* no vibrator */ } };
  /** The message after a send: it can be taken back; the rows with the same original that were filled have their own «Скасувати», and the ones that differ are counted. */
  const saySent = (r: ReturnType<typeof store.send>, text: string): void => {
    const l = r.link;
    if (l?.batch) { say(text, false, r.batch); say(`Автозаповнено чернетками: ${plural(l.n, ['однаковий рядок', 'однакові рядки', 'однакових рядків'])}${l.pending ? ` · відрізняється: ${l.pending}` : ''}`, false, l.batch); }
    else say(l?.pending ? `${text} · зв’язаних рядків відрізняється: ${l.pending}` : text, false, r.batch);
  };
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
  /** Redraw without losing the place in the list (a group's menu, its actions). */
  const renderKeep = (): void => { const y = $('m-main').scrollTop; render(); $('m-main').scrollTop = y; };
  /** A toast about a bulk action: how many rows, what was left out and why, and «Скасувати» for the whole action. */
  const sayBulk = (verb: string, r: BulkResult): void => { say(`${verb}: ${r.done}${skippedText(r)}`, r.done === 0, r.batch); };
  /** How a row's state reads: a row sent back says so. */
  const stateLabel = (st: Shown, e: { status?: string; returned?: boolean } | undefined): string => (e?.returned && e.status === 'draft' ? 'повернено на доопрацювання' : STATUS_LABEL[st]);
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
  const SUB_TITLE: Record<Sub, string> = { scene: 'Сцена', find: 'Знайти й замінити', speakers: 'Хто говорить', settings: 'Налаштування', wrap: 'Перенесення рядків', consistency: 'Зв’язані рядки', termsync: 'Оновити за глосарієм', glossary: 'Глосарій', autofill: 'Автозаповнення', sendlog: 'Активність', search: 'Пошук скрізь', qarules: 'Правила QA' };

  /* ---------- widgets ---------- */
  let wTimer = 0;
  /** The home-screen widgets get a fresh summary a moment after the last change. */
  function scheduleWidget(): void {
    clearTimeout(wTimer);
    wTimer = window.setTimeout(() => publishWidget(buildWidget(store.views, store.saved, store.file && store.key ? { file: store.file, key: store.key } : null) as unknown as WidgetStats), 800);
  }
  /** A button on a widget: open the row, open it with the keyboard, or send it. Returns a short result for the toast. */
  function widgetAction(action: string, file: string, key: string): string {
    if (!store.view(file) || !store.unit(file, key)) return 'Рядка вже немає';
    store.open(file, key); sheet = false; menu = false; sub = null; tab = 'edit'; render();
    if (action === 'keyboard') setTimeout(() => { const t = document.getElementById('m-tr') as HTMLTextAreaElement | null; if (t) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); } }, 250);
    if (action === 'send') { const r = store.send(); render(); if (r.why) { say(r.why, true); return r.why; } saySent(r, 'Надіслано'); return 'ok'; }
    return 'ok';
  }

  /* ---------- chrome ---------- */
  /** The tools (find and replace, speakers, activity, glossary, autofill, consistency, settings): one menu pinned to the top bar of every screen. */
  const TOOLS: [Sub, string, string][] = [['find', 'Знайти й замінити', 'sync'], ['speakers', 'Хто говорить', 'rows'], ['sendlog', 'Активність', 'send'], ['search', 'Пошук скрізь', 'search'], ['glossary', 'Глосарій', 'book'], ['autofill', 'Автозаповнення', 'edit'], ['consistency', 'Зв’язані рядки', 'check'], ['wrap', 'Перенесення рядків', 'rows'], ['qarules', 'Правила QA', 'check'], ['termsync', 'Оновити за глосарієм', 'book'], ['settings', 'Налаштування', 'more']];
  function toolsBtn(): string {
    if (sub || !store.hasGame) return '';
    return `<button class="m-hdr ${menu ? 'on' : ''}" data-menu aria-pressed="${menu}" aria-label="Інструменти" aria-expanded="${menu}">${icon('down')}<span class="m-hdr-t">Інструменти</span></button>`;
  }
  /** Top-bar button of the editor: glossary, memory, comments and history of the open row. */
  function helpBtn(): string {
    const c = store.current; if (tab !== 'edit' || sub || !c) return '';
    const n = store.terms(c.unit).length + store.suggestions(c.unit, c.entry).length + openThreads(c.entry);
    return `<button class="m-hdr ${sheet ? 'on' : ''}" data-sheet aria-pressed="${sheet}" aria-label="Підказки: глосарій, пам’ять перекладів, коментарі, історія">${icon('book')}<span class="m-hdr-t">Підказки</span>${n ? `<span class="m-badge">${n > 9 ? '9+' : n}</span>` : ''}</button>`;
  }
  function renderChrome(): void {
    const tot = store.totals();
    const pct = pctOf(tot.translated, tot.total);
    const gName = scope === 'group' && gscope ? store.groupsList().find(x => x.id === gscope)?.name : undefined;
    const title = tab === 'files' ? 'Файли гри' : tab === 'rows' ? (gName ? `Група «${gName}»` : store.view()?.label ?? store.file ?? 'Рядки') : tab === 'edit' ? (store.file ?? 'Переклад') : 'Ще';
    let where = '';
    if (tab === 'edit' && !sub && store.current) { const list = store.rows(), pos = list.findIndex(x => x.key === store.current!.unit.key); if (pos >= 0) where = `Рядок ${pos + 1} з ${list.length} · `; }
    else if (tab === 'rows' && !sub && scope === 'file' && store.view()) { const adv = store.adviceCount(); where = `${store.rows().length} з ${store.view()!.units.length} · ${adv ? `поради: ${adv} · ` : ''}`; }
    else if (tab === 'rows' && !sub && scope === 'group' && gscope) where = `${plural(store.groupRowList(gscope).length, ['рядок', 'рядки', 'рядків'])} · `;
    const subline = tab === 'more' || !store.hasGame || sub ? '' : `${where}${pct}% · ${store.saveOk ? 'збережено' : 'не збережено!'}`;
    $('m-bar').innerHTML = `${sub ? '<button class="m-back" data-subback aria-label="Назад">' + icon('prev') + '</button>' : ''}<div class="m-title"><b>${esc(sub ? SUB_TITLE[sub] : title)}</b>${subline ? `<small class="${store.saveOk ? '' : 'bad'}">${esc(subline)}</small>` : ''}</div>${busy || updBusy ? `<span class="m-busy" role="status"><i class="m-spin"></i>${esc(busy || 'Перевіряю…')}</span>` : ''}${helpBtn()}${toolsBtn()}`;
    $('m-bar').classList.toggle('loading', !!(busy || updBusy));
    document.documentElement.style.setProperty('--bar-h', $('m-bar').offsetHeight + 'px');
    $('m-nav').innerHTML = (Object.keys(TAB_LABEL) as Tab[]).map(t => `<button role="tab" data-go="${t}" aria-selected="${t === tab}" class="${t === tab ? 'on' : ''}" ${(t === 'rows' || t === 'edit') && !store.hasGame ? 'disabled' : ''}>${icon(t)}<span>${TAB_LABEL[t]}</span>${tabMark(t) ? `<i class="m-mark">${tabMark(t)}</i>` : ''}</button>`).join('');
    if (androidBridge()) scheduleWidget();
  }

  /* ---------- screens ---------- */
  function bar(done: number, total: number): string { const p = pctOf(done, total); return `<span class="m-meter" aria-hidden="true"><i style="width:${p}%"></i></span>`; }

  function screenFiles(): string {
    if (!store.hasGame) return `<div class="m-empty"><h2>Файлів ще немає</h2><p>Оберіть файли гри (RPG Maker .json, .po, .csv, .rpy) або збережений проєкт.</p><button class="m-primary" data-pick>${icon('folder')}<span>Обрати файли…</span></button><button class="m-secondary" data-go="more">Інші способи: проєкт, синхронізація</button></div>`;
    const bar = fsel ? selBar(fpicked.size, store.views.length, fpicked.size === store.views.length, 'data-fall', '', `<button class="m-primary" data-fgroup ${fpicked.size ? '' : 'disabled'} aria-haspopup="menu" aria-expanded="${fmenu}">У групу</button>`, 'data-fselect', fmenu ? groupMenu() : '') : '';
    return `<div class="m-sortrow m-frow"><span>${store.groupsList().length ? plural(store.groupsList().length, ['група', 'групи', 'груп']) : 'Груп ще немає'}</span><button class="m-mini" data-gnew aria-label="Нова група">＋ Група</button><button class="m-mini ${fsel ? 'on' : ''}" data-fselect aria-pressed="${fsel}">${fsel ? 'Готово' : 'Вибрати файли'}</button></div>${gcreating ? '<form class="m-gnew" data-gcreateform><input id="g-name" placeholder="Назва групи" aria-label="Назва нової групи" maxlength="60" autocomplete="off"><button class="m-mini" type="submit">Створити</button></form>' : ''}<div id="m-flist">${filesList()}</div>${bar}<div class="m-searchbar"><label class="m-search m-pill">${icon('search')}<span class="m-ph" aria-hidden="true">Пошук файлу</span><input id="m-fq" type="search" placeholder=" " aria-label="Пошук файлу" value="${esc(fq)}" enterkeyhint="search" autocomplete="off"></label></div>`;
  }
  /** Where the ticked files can go: a group, out of groups, or a new group. */
  function groupMenu(): string {
    const files = [...fpicked];
    const now = new Set(files.map(f => store.fileGroup(f)?.id ?? ''));
    return `<div class="m-gmenu" role="menu" aria-label="У групу">${store.groupsList().map(g => `<button class="m-gm ${now.size === 1 && now.has(g.id) ? 'on' : ''}" role="menuitem" data-fplace="${esc(g.id)}"><i class="m-gdot" style="background:${groupColor(g)}"></i>${esc(g.name)}</button>`).join('')}${[...now].some(x => x) ? '<button class="m-gm" role="menuitem" data-fplace="">Прибрати з групи</button>' : ''}<form class="m-gnew" data-fnewform><input id="fg-new" placeholder="Нова група" aria-label="Назва нової групи" maxlength="60" autocomplete="off"><button class="m-mini" type="submit">＋</button></form></div>`;
  }
  const fileItem = (v: FileViewLike): string => {
    const st = store.stats(v.name), pc = pctOf(st.translated, st.total);
    const g = store.fileGroup(v.name);
    const attr = fsel ? `data-fpick="${esc(v.name)}" aria-pressed="${fpicked.has(v.name)}"` : `data-file="${esc(v.name)}"`;
    return `<li><button class="m-item ${v.name === store.file && !fsel ? 'cur' : ''} ${fsel && fpicked.has(v.name) ? 'picked' : ''}" ${attr}><span class="m-ico">${/^Map\d+\.json$/.test(v.name) ? 'MAP' : '{ }'}</span><span class="m-item-t"><b>${g ? `<i class="m-gdot" style="background:${groupColor(g)}" aria-label="Група: ${esc(g.name)}"></i>` : ''}${esc(v.label ?? v.name.replace(/\.json$/, ''))}</b><small>${esc(v.label ? v.name.replace(/\.json$/, '') : plural(st.total, ['рядок', 'рядки', 'рядків']))}</small>${bar(st.translated, st.total)}</span><span class="m-item-n">${pc}%</span></button></li>`;
  };
  type FileViewLike = (typeof store.views)[number];
  /** The groups, each with its files, above the automatic categories. */
  function groupsHtml(q: string): string {
    const list = store.groupsList();
    if (!list.length) return '';
    return `<section class="m-cat open m-groups"><button class="m-cat-h" data-gtog="__all" aria-expanded="true" tabindex="-1" style="pointer-events:none"><b>Групи файлів</b><small>${list.length}</small></button>${list.map(g => {
      const files = store.groupFiles(g.id).map(f => store.views.find(v => v.name === f)!).filter(v => !q || (v.name + ' ' + (v.label ?? '')).toLowerCase().includes(q));
      const all = store.groupFiles(g.id);
      const t = all.reduce((n, f) => { const st = store.stats(f); return { tr: n.tr + st.translated, all: n.all + st.total }; }, { tr: 0, all: 0 });
      const open = gopen.has(g.id) || !!q;
      const acts = open ? (grename === g.id
        ? `<form class="m-grename" data-grsave="${esc(g.id)}"><input id="gr-ren" value="${esc(g.name)}" aria-label="Нова назва групи" maxlength="60" autocomplete="off"><button class="m-mini" type="submit">Гаразд</button></form>`
        : `<div class="m-gacts"><button class="m-mini" data-grows="${esc(g.id)}" ${all.length ? '' : 'disabled'}>Рядки</button><button class="m-mini" data-gsend="${esc(g.id)}" ${all.length ? '' : 'disabled'}>Надіслати</button><button class="m-mini ${gmore === g.id ? 'on' : ''}" data-gmore="${esc(g.id)}" aria-expanded="${gmore === g.id}" aria-label="Інші дії групи">⋯</button>${gmore === g.id ? `<button class="m-mini" data-grename="${esc(g.id)}">Назва</button><button class="m-mini" data-gcolor="${esc(g.id)}">Колір</button><button class="m-mini danger" data-gdel="${esc(g.id)}">${gdel === g.id ? 'Справді видалити?' : 'Видалити'}</button>` : ''}</div>`) : '';
      return `<div class="m-grp"><button class="m-cat-h m-grp-h" data-gfold="${esc(g.id)}" aria-expanded="${open}"><span class="m-cat-c">${icon('down')}</span><i class="m-gdot" style="background:${groupColor(g)}"></i><b>${esc(g.name)}</b><small>${all.length} · ${pctOf(t.tr, t.all)}%</small></button>${open ? `${acts}${files.length ? `<ul class="m-list">${files.map(fileItem).join('')}</ul>` : '<p class="m-none">Файлів немає: «Вибрати файли», потім «У групу»</p>'}` : ''}</div>`;
    }).join('')}</section>`;
  }
  /** The files whose name or title contains the search words. */
  function filesList(): string {
    const q = fq.trim().toLowerCase();
    const views = store.views.filter(v => !q || (v.name + ' ' + (v.label ?? '')).toLowerCase().includes(q));
    const g = groupsHtml(q);
    if (!views.length) return g || '<p class="m-none">Файлів за цим пошуком немає</p>';
    const item = fileItem;
    // The same automatic categories as on the computer: the game's data, the maps, and each other folder.
    const cat = (name: string): string => (name.includes('/') ? name.split('/').slice(0, -1).join('/') : /^Map\d+\.json$/.test(name) ? 'Карти' : 'Дані гри');
    const groups = new Map<string, typeof views>();
    for (const v of views) { const k = cat(v.name); groups.set(k, [...(groups.get(k) ?? []), v]); }
    if (groups.size < 2) return `${g}<ul class="m-list">${views.map(item).join('')}</ul>`;
    return g + [...groups].map(([k, vs]) => {
      const open = !!q || !collapsedCats.has(k);
      const t = vs.reduce((n, v) => { const st = store.stats(v.name); return { tr: n.tr + st.translated, all: n.all + st.total }; }, { tr: 0, all: 0 });
      return `<section class="m-cat ${open ? 'open' : ''}"><button class="m-cat-h" data-cat="${esc(k)}" aria-expanded="${open}"><span class="m-cat-c">${icon('down')}</span><b>${esc(k)}</b><small>${vs.length} · ${pctOf(t.tr, t.all)}%</small></button>${open ? `<ul class="m-list">${vs.map(item).join('')}</ul>` : ''}</section>`;
    }).join('');
  }

  /** The rows of every file of a group as one list (searchable); a tap opens the row in the editor. */
  function screenGroupRows(id: string): string {
    const g = store.groupsList().find(x => x.id === id);
    if (!g) { scope = 'file'; gscope = null; return screenRows(); }
    const all = store.groupRowList(id), q = store.q.trim().toLowerCase();
    const list = q ? all.filter(h => (h.unit.source + ' ' + flowText(store.entry(h.file, h.unit.key)?.target ?? '') + ' ' + h.unit.key).toLowerCase().includes(q)) : all;
    const shown = list.slice(0, PAGE * page);
    return `<div class="m-tools"><label class="m-search">${icon('search')}<input id="m-q" type="search" placeholder="Пошук у групі «${esc(g.name)}»" aria-label="Пошук у групі" value="${esc(store.q)}" enterkeyhint="search" autocomplete="off"></label>
      <div class="m-scope" role="group" aria-label="Де шукати"><button data-scope="file">Файл</button><button class="on" data-scope="group" aria-pressed="true">Група «${esc(g.name)}»</button></div></div>
      <ul class="m-list rows">${shown.map(h => {
        const e = store.entry(h.file, h.unit.key), st = store.shown(h.unit, e);
        return `<li><button class="m-row" data-hit="${esc(h.file)}" data-hitkey="${esc(h.unit.key)}"><span class="sd ${SHAPE[st]}" title="${STATUS_LABEL[st]}"></span><span class="m-row-t"><small>${esc(store.view(h.file)?.label ?? h.file.replace(/\.json$/, ''))} · ${esc(store.speaker(h.unit) || KIND_LABEL[h.unit.kind])}</small><span class="m-src">${esc(h.unit.source.replace(/\s+/g, ' '))}</span><span class="m-tr ${e?.target ? '' : 'none'}">${e?.target ? esc(e.target.replace(/\s+/g, ' ')) : '—'}</span></span></button></li>`;
      }).join('') || '<li class="m-none">Нічого не знайдено</li>'}${list.length > shown.length ? `<li class="m-more-li"><button class="m-mini" data-more>Показати ще ${Math.min(PAGE, list.length - shown.length)} · ${shown.length} з ${list.length}</button></li>` : ''}</ul>`;
  }

  function screenRows(): string {
    if (scope === 'group' && gscope) return screenGroupRows(gscope);
    const v = store.view();
    if (!v) return empty('Файл не вибрано', 'Оберіть файл у розділі «Файли».', 'files', 'До файлів');
    if (scope === 'all') return screenAll();
    const sig = `${store.file}|${store.filter}|${store.q}|${store.sort}`;
    const rows = store.rows();
    if (sig !== pageSig) { pageSig = sig; page = 1; const at = store.key ? rows.findIndex(u => u.key === store.key) : -1; if (at >= PAGE) page = Math.ceil((at + 1) / PAGE); }
    const shown = rows.slice(0, PAGE * page);
    const chips = FILTERS.map(([f, l]) => `<button class="m-chip ${store.filter === f ? 'on' : ''}" data-filter="${f}" aria-pressed="${store.filter === f}">${l}</button>`).join('');
    const sbar = `<div class="m-searchbar"><label class="m-search m-pill">${icon('search')}<span class="m-ph" aria-hidden="true">Пошук у файлі</span><input id="m-q" type="search" placeholder=" " aria-label="Пошук у файлі" value="${esc(store.q)}" enterkeyhint="search" autocomplete="off"></label></div>`;
    const L = lay();
    const orders = { order: 'За порядком', new: 'Спершу без перекладу', qa: 'Спершу з помилками', long: 'Спершу найдовші' } as Record<Sort, string>;
    return `<div class="m-tools compact"><div class="m-chiprow"><div class="m-chips" role="group" aria-label="Фільтр"><button class="m-chip scope" data-scope="all" aria-pressed="false" title="Шукати в усіх файлах">Усі файли</button>${chips}</div>
      <div class="m-chipacts">${L === 'cards' ? `<button class="m-mini ${selecting ? 'on' : ''}" data-select aria-pressed="${selecting}">${selecting ? 'Готово' : 'Вибрати'}</button>` : ''}<label class="m-sortbtn" title="Порядок: ${esc(orders[store.sort])}">${icon('sort')}<select id="m-sort" aria-label="Порядок">${(['order', 'new', 'qa', 'long'] as Sort[]).map(s => `<option value="${s}" ${store.sort === s ? 'selected' : ''}>${orders[s]}</option>`).join('')}</select></label></div></div>
      ${wide.matches ? `<div class="m-scope m-layout" role="group" aria-label="Вигляд"><button class="${L === 'cards' ? 'on' : ''}" data-layout="cards">Картки</button><button class="${L === 'table' ? 'on' : ''}" data-layout="table">Таблиця</button></div>` : ''}</div>
      ${L === 'table' ? tableHtml(v.name, shown, rows.length) : `<ul class="m-list rows">${shown.map((u, i) => {
        const e = store.entry(v.name, u.key), st = store.shown(u, e);
        return `<li><button class="m-row ${u.key === store.key && !selecting ? 'cur' : ''} ${selecting && picked.has(u.key) ? 'picked' : ''}" ${selecting ? `data-pickkey="${esc(u.key)}" aria-pressed="${picked.has(u.key)}"` : `data-key="${esc(u.key)}"`}>${selecting ? '<span class="m-edge" aria-hidden="true"></span>' : ''}<span class="sd ${SHAPE[st]}" title="${STATUS_LABEL[st]}"></span><span class="m-row-t"><small>${i + 1} · ${esc(store.speaker(u) || KIND_LABEL[u.kind])}${threadsOf(e?.comments).length ? ` <span class="m-cmk" title="Є коментарі" aria-label="Є коментарі">${icon('cm')}</span>` : ''}</small><span class="m-src">${esc(u.source.replace(/\s+/g, ' '))}</span><span class="m-tr ${e?.target ? '' : 'none'}">${e?.target ? esc(e.target.replace(/\s+/g, ' ')) : '—'}</span></span></button></li>`;
      }).join('') || '<li class="m-none">Нічого не знайдено</li>'}${rows.length > shown.length ? `<li class="m-more-li"><button class="m-mini" data-more>Показати ще ${Math.min(PAGE, rows.length - shown.length)} · ${shown.length} з ${rows.length}</button></li>` : ''}</ul>`}${selecting && L === 'cards' ? selBar(picked.size, rows.length, picked.size === rows.length && rows.length > 0, 'data-selall', `<button class="m-mini" data-selcopy ${picked.size ? '' : 'disabled'}>Оригінал</button><button class="m-mini" data-seltm ${picked.size ? '' : 'disabled'}>З пам’яті</button><button class="m-mini danger" data-selclear ${picked.size ? '' : 'disabled'}>Очистити</button>`, `<button class="m-ic" data-selappr ${picked.size ? '' : 'disabled'} aria-label="Вичитати вибрані" title="Вичитати вибрані">${icon('check')}</button><button class="m-primary" data-selsend ${picked.size ? '' : 'disabled'}>${icon('send')}<span>Надіслати</span></button>`, 'data-select') : ''}${selecting && layout === 'cards' ? '' : sbar}`;
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
        return `<li><button class="m-row" data-hit="${esc(h.file)}" data-hitkey="${esc(h.unit.key)}"><span class="sd ${SHAPE[st]}"></span><span class="m-row-t"><small>${esc(store.view(h.file)?.label ?? h.file)} · ${esc(KIND_LABEL[h.unit.kind])}</small><span class="m-src">${esc(h.unit.source.replace(/\s+/g, ' '))}</span><span class="m-tr ${e?.target ? '' : 'none'}">${e?.target ? esc(e.target.replace(/\s+/g, ' ')) : '—'}</span></span></button></li>`;
      }).join('') || `<li class="m-none">${store.q.trim() ? 'Нічого не знайдено' : 'Введіть слово для пошуку'}</li>`}${hits.length >= 200 ? '<li class="m-none">Показано перші 200: уточніть пошук</li>' : ''}</ul>`;
  }

  /* ---------- sub-screens (opened from the editor or «Ще») ---------- */
  /** Go to the next (1) or previous (-1) scene: its first line without a translation becomes the open one. */
  function stepSceneBy(d: 1 | -1): void {
    const v = store.view(), c = store.current; if (!v || !c) return;
    const to = stepScene(scenesOf(v.units), c.unit.key, d);
    const first = to?.units.find(u => !store.entry(v.name, u.key)?.target) ?? to?.units[0];
    if (first) { store.select(first.key); scn.picked = first.key; render(); $('m-main').scrollTop = 0; buzz(8); }
  }
  /** The scene a row is in: the event page it belongs to (with its place among the scenes of the file), or a few rows around it in a file that has no scenes. */
  function sceneOf(v: NonNullable<ReturnType<typeof store.view>>, key: string): { units: typeof v.units; i: number; n: number; title: string } {
    const idx = scenesOf(v.units), at = idx?.byKey.get(key);
    const sc = idx && at !== undefined ? idx.scenes[at] : undefined;
    return sc && idx ? { units: sc.units, i: at! + 1, n: idx.scenes.length, title: sceneTitle(sc) } : { units: sceneUnits(v.units, key), i: 0, n: 0, title: '' };
  }
  /** The scene as the message windows of the game: colours, names, choices, width check; a tap picks a line, the bar below acts on it. */
  function screenScene(): string {
    const c = store.current, v = store.view();
    if (!c || !v) return empty('Рядок не вибрано', 'Спершу оберіть рядок.', 'rows', 'До рядків');
    const here = sceneOf(v, c.unit.key), around = here.units, lines = sceneLines(around);
    // The picked line must belong to this scene (the open row may have moved to another one meanwhile).
    if (!scn.picked || !around.some(u => u.key === scn.picked)) scn.picked = c.unit.key;
    const actors = store.views.find(x => x.name === 'Actors.json');
    const actorName = (n: number): string | undefined => { const u = actors?.units.find(x => x.key === `[${n}].name`); return u ? (store.saved.files['Actors.json']?.[u.key]?.target || u.source) : undefined; };
    const plan = store.wrapPlan(), realMeasure = pxMeasure(MV_WINDOW.font), measure = measureOf(plan);
    const body = (u: (typeof v.units)[number]): { html: string; missing: boolean; over: boolean } => {
      const tr = store.entry(v.name, u.key)?.target ?? '', missing = !tr, message = isMessageUnit(u);
      // «At build» the game window gets the translation wrapped by the build: show it as the game will.
      const asGame = message && !missing && scn.mode !== 'src' && plan.settings.mode === 'build' ? wrapMessage(plan, u, tr).text : tr;
      const shown = scn.mode === 'src' || (missing && scn.mode !== 'tr') ? u.source : asGame || u.source;
      const checked = message && !missing, max = checked ? widthOf(plan, u) : 0;
      const wide = (l: string): boolean => (scn.real ? realMeasure(l) > pixelBudget(!!u.face) : !!max && measure(l) > max);
      const rows = shown.split('\n');
      return { missing, over: checked && rows.some(wide), html: rows.map(l => `<div class="scn-ln${checked && wide(l) ? ' over' : ''}">${gameHtml(l, actorName, n => store.saved.sysNames?.variables[n]) || '&nbsp;'}</div>`).join('') };
    };
    const box = (u: (typeof v.units)[number], inner: string, cls = ''): string => {
      const st = store.shown(u, store.entry(v.name, u.key));
      return `<button class="scn-box ${cls} ${u.key === scn.picked ? 'cur' : ''}" data-scpick="${esc(u.key)}" aria-pressed="${u.key === scn.picked}"><span class="sd ${SHAPE[st]}" title="${STATUS_LABEL[st]}"></span><span class="scn-in">${inner}</span></button>`;
    };
    const orig = (u: (typeof v.units)[number], missing: boolean): string => (scn.mode === 'both' && !missing ? `<div class="scn-orig">${u.source.split('\n').map(x => `<div>${esc(x)}</div>`).join('')}</div>` : '');
    const tag = (missing: boolean, over: boolean, bad = ''): string => `${missing && scn.mode !== 'src' ? '<span class="scn-tag">не перекладено</span>' : ''}${over ? '<span class="scn-tag bad">рядок задовгий для вікна гри</span>' : ''}${bad ? `<span class="scn-tag bad">${esc(bad)}</span>` : ''}`;
    const badOf = (u: (typeof v.units)[number]): string => { const e = store.entry(v.name, u.key); return e?.target ? store.issues(u, e).find(i => i.severity === 'bad')?.message ?? '' : ''; };
    const one = (l: ReturnType<typeof sceneLines>[number]): string => {
      if (l.kind === 'choice') return `<div class="scn-choice" role="group" aria-label="Варіанти відповіді"><small>Вибір гравця</small>${l.units.map((u, i) => { const t = body(u); return box(u, `<span class="scn-n">${i + 1}</span><span>${t.html}${orig(u, t.missing)}${tag(t.missing, t.over, badOf(u))}</span>`, 'opt'); }).join('')}</div>`;
      const u = l.unit, t = body(u), who = store.speaker(u);
      return box(u, `${who ? `<span class="scn-who">${esc(who)}</span>` : ''}<span class="scn-win${l.kind === 'scroll' ? ' scroll' : ''}">${t.html}</span>${orig(u, t.missing)}${tag(t.missing, t.over, badOf(u))}`);
    };
    const all = lines.flatMap(l => (l.kind === 'choice' ? l.units : [l.unit]));
    const st = all.map(u => store.entry(v.name, u.key)?.status ?? 'new');
    const done = all.filter(u => store.entry(v.name, u.key)?.target).length, appr = st.filter(x => x === 'appr').length, wait = st.filter(x => x === 'done').length;
    const page = around[0]?.page, cond = page ? describePage(page, store.saved.sysNames).join('; ') : '';
    const canSend = all.some(u => store.entry(v.name, u.key)?.status === 'draft');
    const modes: ['both' | 'tr' | 'src', string][] = [['both', 'Обидва'], ['tr', 'Переклад'], ['src', 'Оригінал']];
    return `<div class="m-scene"><div class="scn-head">${here.n ? `<div class="scn-nav"><button class="m-ic sm" data-scstep="-1" aria-label="Попередня сцена" ${stepScene(scenesOf(v.units), c.unit.key, -1) ? '' : 'disabled'}>${icon('prev')}</button><span class="scn-nav-t"><b>${esc(here.title)}</b><small>сцена ${here.i} із ${here.n}</small></span><button class="m-ic sm" data-scstep="1" aria-label="Наступна сцена" ${stepScene(scenesOf(v.units), c.unit.key, 1) ? '' : 'disabled'}>${icon('next')}</button></div>` : `<b>${esc(v.label ?? v.name)}</b>`}<small>${plural(all.length, ['рядок', 'рядки', 'рядків'])} · перекладено ${done} · вичитано ${appr} · надіслано ${wait}</small>${cond ? `<small class="scn-cond">Умови: ${esc(cond)}</small>` : ''}</div>
      <div class="m-dseg scn-modes" role="group" aria-label="Що показувати">${modes.map(([k, l]) => `<button data-scmode="${k}" class="${scn.mode === k ? 'on' : ''}" aria-pressed="${scn.mode === k}">${l}</button>`).join('')}</div>
      <label class="m-check"><input type="checkbox" id="scn-real" ${scn.real ? 'checked' : ''}> Вікно як у грі: ширина в пікселях (816 px, шрифт 28)</label>
      <div class="scn-list">${lines.map(one).join('') || '<p class="m-none">У цій сцені немає текстових рядків</p>'}</div></div>
      <div class="scn-quick"><div class="scn-q-src">${esc((v.units.find(u => u.key === scn.picked)?.source ?? '').replace(/\s+/g, ' '))}</div><textarea id="scn-tr" class="m-textarea" spellcheck="false" autocapitalize="sentences" placeholder="Переклад вибраного рядка" aria-label="Переклад вибраного рядка">${esc(store.entry(v.name, scn.picked)?.target ?? '')}</textarea></div>
      <div class="scn-bar"><button class="m-secondary" data-scedit>${icon('edit')}<span>Редагувати</span></button><button class="m-secondary" data-sceneappr ${all.some(u => store.entry(v.name, u.key)?.target && store.entry(v.name, u.key)?.status !== 'appr') ? '' : 'disabled'} aria-label="Вичитати всю сцену">${icon('check')}<span>Вичитати</span></button><button class="m-primary" data-scenesend ${canSend ? '' : 'disabled'} aria-label="Надіслати всю сцену">${icon('send')}<span>Надіслати</span></button></div>`;
  }

  function screenFind(): string {
    return `<div class="m-more"><section class="m-card"><label class="m-lbl" for="f-find">Що замінити</label><input id="f-find" class="m-input" value="${esc(fr.find)}" autocomplete="off" spellcheck="false">
      <label class="m-lbl" for="f-rep">На що</label><input id="f-rep" class="m-input" value="${esc(fr.replace)}" autocomplete="off" spellcheck="false">
      <label class="m-check"><input type="checkbox" id="f-word" ${fr.word ? 'checked' : ''}> Лише ціле слово</label><label class="m-check"><input type="checkbox" id="f-case" ${fr.cs ? 'checked' : ''}> З урахуванням регістру</label>
      <label class="m-check"><input type="checkbox" id="f-appr" ${fr.appr ? 'checked' : ''}> Змінити й вичитані (вони стануть чернетками)</label>
      <button class="m-secondary wide" data-dofind>Знайти в перекладах</button></section>
      ${fr.matches.length ? `<section class="m-card"><h3>Знайдено: ${fr.matches.length}</h3>${fr.matches.slice(0, 60).map(m => `<div class="m-diff"><small>${esc(m.file)}</small><s>${esc(m.before)}</s><span>${esc(m.after)}</span></div>`).join('')}${fr.matches.length > 60 ? `<p class="m-hint">Показано 60 із ${fr.matches.length}. Заміна торкнеться всіх.</p>` : ''}${(() => { const i = store.replaceImpact(fr.matches); return `${i.appr ? `<p class="m-hint">${fr.appr ? `Вичитаних: ${i.appr}, вони стануть чернетками.` : `Вичитаних пропущено: ${i.appr} (позначте «Змінити й вичитані», щоб їх включити).`}</p>` : ''}${i.done ? `<p class="m-hint">Надісланих, що стануть чернетками: ${i.done}.</p>` : ''}`; })()}<button class="m-primary wide" data-doreplace>Замінити в усіх (${fr.matches.length})</button></section>` : ''}</div>`;
  }

  /** Find a word in the originals, translations and keys of every file. */
  function screenSearch(): string {
    const res = store.searchAll(sq);
    return `<div class="m-more"><section class="m-card"><label class="m-lbl" for="sr-q">Що шукати</label><input id="sr-q" class="m-input" value="${esc(sq)}" autocomplete="off" spellcheck="false" placeholder="слово з оригіналу, перекладу чи ключ">
      <p class="m-hint">${!sq.trim() ? 'Шукає в усіх файлах гри: в оригіналах, перекладах і ключах.' : res.length ? `Знайдено: ${res.length}${res.length >= 60 ? '+' : ''}. Торкніться рядка, щоб відкрити.` : 'Нічого не знайдено'}</p></section>
      ${res.map((r, i) => `<button class="m-found" data-srn="${i}"><small>${esc(r.file)}</small><b>${esc(r.source.slice(0, 120))}</b>${r.target ? `<span>${esc(r.target.slice(0, 120))}</span>` : ''}</button>`).join('')}</div>`;
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
        text: b.kind === 'send' ? `Ви надіслали ${n(b.items.length)}` : `Ви вичитали ${n(b.items.length)}`,
        ...(b.guessed ? { sub: 'Запису про надсилання немає, знайдено за часом зміни' } : {}), rows: b.items.slice(0, 12), undo: `${b.at}|${b.kind}|${b.guessed ? 1 : 0}` })),
      ...store.autos().map((b): Ev => ({ id: `a${b.at}${b.kind}`, at: b.at, icon: 'edit',
        text: b.kind === 'words' ? `Автозаповнення за словами: ${n(b.items.length)}` : `Підставлено з однакових рядків: ${n(b.items.length)}`,
        sub: b.kind === 'words' ? 'Чернетки, їх варто переглянути' : 'Надіслані без вашого перегляду', rows: b.items.slice(0, 12), undo: `${b.at}|${b.kind}`, undoLabel: 'Скасувати заповнення', undoAttr: 'data-undoauto' })),
      ...store.journal().map((b): Ev => ({ id: `j${b.id}`, at: b.at, icon: b.kind === 'undo' || b.kind === 'redo' ? 'prev' : 'check', text: batchTitle(b),
        ...(b.total > b.items.length ? { sub: `ще ${n(b.total - b.items.length)} змінено після цього` } : {}), rows: b.items.slice(0, 12), undo: b.id, undoLabel: batchUndoLabel(b), undoAttr: 'data-undojournal' })),
      ...store.autosUndone().map((u): Ev => ({ id: `au${u.at}${u.kind}`, at: u.at, icon: 'prev', text: `Ви скасували ${u.kind === 'words' ? 'автозаповнення' : 'підстановку'}: ${n(u.count)}` })),
      ...store.undone().map((u): Ev => ({ id: `u${u.at}${u.kind}`, at: u.at, icon: 'prev', text: u.kind === 'send' ? `Ви скасували надсилання: ${n(u.count)}` : `Ви скасували вичитування: ${n(u.count)}` })),
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
    return `<div class="m-more act">${html || '<p class="m-none">Активності ще немає</p>'}<p class="m-hint">Масові дії (надсилання, автозаповнення, заміни, перенесення рядків, очищення) можна скасувати, поки рядки не змінено, і потім повторити. Якщо дія була на іншому пристрої (наприклад, на ПК), спершу синхронізуйте проєкт у «Ще».</p></div>`;
  }

  /** The glossary: add a term, tap one to change it. */
  function screenGlossary(): string {
    const q = gl.q.trim().toLowerCase();
    const list = store.saved.terms.filter(t => !q || (t.en + ' ' + t.uk).toLowerCase().includes(q)).sort((x, y) => x.en.localeCompare(y.en, 'en')).slice(0, 80);
    const banner = ts.pending && ts.change ? `<section class="m-card"><b>Знайдено ${plural(ts.pending, ['рядок', 'рядки', 'рядків'])} зі старою формою «${esc(ts.change.old[0] ?? '')}»</b><button class="m-primary wide" data-tsopen>Переглянути</button><button class="m-mini ghost" data-tsdismiss>Закрити</button></section>` : '';
    return `<div class="m-more">${banner}<section class="m-card"><h3>${gl.edit ? 'Змінити термін' : 'Новий термін'}</h3>
      <label class="m-lbl" for="g-en">Оригінал</label><input id="g-en" class="m-input" value="${esc(gl.en)}" autocomplete="off" autocapitalize="none">
      <label class="m-lbl" for="g-uk">Переклад</label><input id="g-uk" class="m-input" value="${esc(gl.uk)}" autocomplete="off">
      <label class="m-lbl" for="g-alt">Інші дозволені переклади (через кому)</label><input id="g-alt" class="m-input" value="${esc(gl.alt)}" autocomplete="off">
      <label class="m-check"><input type="checkbox" id="g-qa" ${gl.qa ? 'checked' : ''}> Перевіряти в QA</label>
      <div class="m-btnrow"><button class="m-primary" data-gsave>${gl.edit ? 'Зберегти' : 'Додати термін'}</button>${gl.edit ? '<button class="m-secondary" data-gcancel>Скасувати</button>' : ''}</div></section>
      <label class="m-search">${icon('search')}<input id="g-q" type="search" placeholder="Пошук серед ${store.saved.terms.length} термінів" value="${esc(gl.q)}" autocomplete="off"></label>
      ${list.map(t => `<div class="m-term"><button class="m-term-t" data-gedit="${esc(t.en)}"><b>${esc(t.en)}</b><span>→ ${esc(t.uk)}${t.alt?.length ? ` · ${esc(t.alt.join(', '))}` : ''}</span></button><button class="m-mini ghost" data-tdel="${esc(t.en)}" aria-label="Видалити термін ${esc(t.en)}">Видалити</button></div>`).join('') || '<p class="m-none">Термінів ще немає</p>'}</div>`;
  }

  /** Lines made only of words that are already known: shown first, written only after the tap. */
  /** The bar both selection screens share, built like the editor's action bar: pills above, square buttons and the main action below. */
  function selBar(n: number, total: number, allOn: boolean, allAttr: string, pills: string, primary: string, exitAttr: string, above = ''): string {
    return `<div class="m-afbar" role="toolbar" aria-label="Дії з вибраним">${above}<div class="m-act2"><button class="m-mini" ${allAttr}>${allOn ? 'Зняти вибір' : 'Вибрати всі'}</button>${pills}</div>
      <div class="m-act1"><button class="m-ic" ${exitAttr} aria-label="Вийти з вибору">${icon('x')}</button><span class="m-ic cnt" aria-label="Вибрано ${n} з ${total}">${n}/${total}</span>${primary}</div></div>`;
  }
  function screenAutofill(): string {
    const list = store.autofill(), shown = list.slice(0, 80), on = list.filter(p => !af.off.has(p.file + '|' + p.key));
    const allOn = on.length === list.length;
    const twins = store.linkTodo();
    return `<div class="m-more m-afwrap"><p class="m-hint">Застосунок заповнює порожні рядки сам, але завжди чернетками з позначкою «авто»; їх можна скасувати в «Активності».</p>
      <button class="m-secondary wide" data-sub="consistency">${icon('sync')}<span>Однакові оригінали${twins ? `: ${twins}` : ': усе узгоджено'}</span></button>
      <p class="m-hint">За словами. Знаю слів: ${store.wordCount()} · рядків для автозаповнення: ${list.length}</p>
      ${shown.map(p => { const k = p.file + '|' + p.key, sel = !af.off.has(k); return `<div class="m-af ${sel ? 'sel' : ''}" role="checkbox" aria-checked="${sel}" data-aflp="${esc(k)}" data-afk="${esc(k)}"><span class="m-edge" aria-hidden="true"></span><span class="m-af-t"><small>${esc(store.view(p.file)?.label ?? p.file)}</small><b>${esc(p.source)}</b><i>→ ${esc(p.target)}</i></span></div>`; }).join('') || '<p class="m-none">Немає рядків, які можна скласти зі знайомих слів</p>'}
      ${list.length > 80 ? `<p class="m-hint">Показано 80 із ${list.length}: після запису решта з’явиться тут.</p>` : ''}
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

  const LINK_LABEL: Record<LinkState, string> = { main: 'еталон', same: 'такий самий', empty: 'без перекладу', differs: 'інший', edited: 'змінено пізніше', unlinked: 'відв’язано', draft: 'чернетка' };
  /** The tool «Оновити за глосарієм»: a form (term and its old rendering), then the rows to update. */
  function screenTermSync(): string {
    const res = ts.res, change = ts.change;
    if (!res || !change) {
      const terms = [...store.saved.terms].sort((a, b) => a.en.localeCompare(b.en, 'en')), last = store.lastTermChange;
      if (!terms.length) return '<div class="m-more"><p class="m-none">У глосарії ще немає термінів</p></div>';
      const cur = terms.find(x => x.en === ts.term) ?? terms.find(x => x.en.toLowerCase() === last?.en.toLowerCase()) ?? terms[0]!;
      const old = ts.old || (last && last.en.toLowerCase() === cur.en.toLowerCase() ? last.old[0] ?? '' : '');
      return `<div class="m-more"><section class="m-card"><h3>Оновити за глосарієм</h3><p class="m-hint">Оберіть термін і напишіть, яким був його переклад раніше (наприклад «меч»). Знайдуться всі рядки зі старою формою в будь-якому відмінку, і ви побачите, чим їх замінити.</p>
        <label class="m-lbl" for="ts-term">Термін</label><select id="ts-term" class="m-input">${terms.map(x => `<option value="${esc(x.en)}" ${x === cur ? 'selected' : ''}>${esc(x.en)} → ${esc(x.uk)}</option>`).join('')}</select>
        <label class="m-lbl" for="ts-old">Старий переклад</label><input id="ts-old" class="m-input" value="${esc(old)}" autocomplete="off">
        <button class="m-primary wide" data-tsfind>Знайти</button></section></div>`;
    }
    const n = [...ts.on.values()].filter(Boolean).length, sure = res.proposals.filter(p => p.tick).length;
    const rows = res.proposals.slice(0, ts.shown).map((p, i) => {
      const ch = ts.pick.get(tsId(p)) ?? [], why = p.conf.level === 'high' ? '' : flagsText(p.conf.flags);
      const alts = p.spans.map((sp, si) => (sp.alts.length ? `<select class="m-input" data-tsalt="${i}|${si}" aria-label="Інша форма"><option value="-1" ${(ch[si] ?? -1) < 0 ? 'selected' : ''}>${esc(sp.text)}</option>${sp.alts.map((a, ai) => `<option value="${ai}" ${ch[si] === ai ? 'selected' : ''}>${esc(a.text)}</option>`).join('')}</select>` : '')).join('');
      return `<label class="m-check m-opt"><input type="checkbox" data-tspick="${i}" ${ts.on.get(tsId(p)) ? 'checked' : ''}><span>${esc(fileOf(p.file))} · <b class="ts-conf ${p.conf.level}">${CONF_LABEL[p.conf.level]}</b>${why ? ` · ${esc(why)}` : ''}${p.status === 'appr' ? ' · вичитано' : p.status === 'done' ? ' · надіслано' : ''}<span class="ts-b">${markHtml(p, 'old')}</span><span class="ts-a">${markHtml(p, 'new', ch)}</span>${alts}</span></label>`;
    }).join('');
    return `<div class="m-more"><section class="m-card"><h3>${esc(change.old.join(', '))} → ${esc(change.next)}</h3><p class="m-hint">Позначені лише впевнені заміни, де в оригіналі є цей термін; решту перевірте самі. Статус рядків не змінюється, дію можна скасувати.</p><small class="m-hint">Знайдено ${res.total}${res.truncated ? `, перші ${res.proposals.length}` : ''}. Вибрано ${n}; впевнених ${sure}.</small></section>
      ${rows}${ts.shown < res.proposals.length ? '<button class="m-secondary wide" data-tsmore>Показати ще</button>' : ''}
      <button class="m-primary wide" data-tsgo ${n ? '' : 'disabled'}>Оновити вибрані</button><button class="m-mini ghost" data-tsback>Назад</button></div>`;
  }
  /** The tool «Зв’язані рядки»: rows with the same original that do not agree (or one cluster, from the card in the editor). */
  function screenConsistency(): string {
    if (lk.scope) return screenLinkRows(lk.scope);
    const r = store.linkClusters(60);
    if (!r.total) return '<div class="m-more"><p class="m-none">Усе узгоджено: зв’язані рядки мають однаковий переклад</p></div>';
    const cards = r.clusters.map((c, ci) => {
      const first = c.view.rows[0]!;
      const variants = c.variants.map((v, vi) => `<div class="m-var"><span>${esc(v.target.slice(0, 160))}${v.rows.some(x => x.ref === c.view.main?.ref) ? ' ★' : ''}</span><small>× ${v.rows.length}</small><button class="m-mini" data-lkkeep="${ci}|${vi}">Лишити цей</button></div>`).join('');
      const fill = c.variants.length === 1 && c.counts.empty ? `<div class="m-var"><span>Без перекладу</span><small>${c.counts.empty}</small><button class="m-mini" data-lkfill="${ci}">Заповнити</button></div>` : '';
      return `<section class="m-card"><b>${esc(c.text.slice(0, 120))}</b><small>${plural(c.view.rows.length, ['рядок', 'рядки', 'рядків'])}${c.counts.unlinked ? `, відв’язано ${c.counts.unlinked}` : ''}</small>${variants}${fill}<button class="m-mini ghost" data-hit="${esc(first.file)}" data-hitkey="${esc(first.key)}">Відкрити перший</button></section>`;
    }).join('');
    return `<div class="m-more"><p class="m-hint">Рядки з однаковим оригіналом зв’язані: їхній переклад має бути однаковим. Оберіть варіант, який лишається всюди (він стає головним), або заповніть порожні. Відв’язані рядки не чіпаються.${store.linkMode() === 'off' ? ' Зв’язування вимкнено в налаштуваннях: рядки не оновлюються самі.' : ''}</p>${r.total > r.clusters.length ? `<p class="m-hint">Показано ${r.clusters.length} з ${r.total}.</p>` : ''}${cards}</div>`;
  }
  /** One cluster: the rows that would take the reference, to tick and update. */
  function screenLinkRows(sc: { file: string; key: string }): string {
    const plan = store.linkPlan(sc.file, sc.key), back = '<button class="m-mini ghost" data-lkback>Усі зв’язані рядки</button>';
    if (!plan?.view.reference) return `<div class="m-more"><p class="m-none">Для цих рядків немає чого поширювати: жоден не надіслано</p>${back}</div>`;
    const items = [...plan.fills, ...plan.updates, ...plan.edited];
    if (!items.length) return `<div class="m-more"><p class="m-none">Зв’язані рядки вже однакові</p>${back}</div>`;
    const ref = plan.view.reference, n = items.filter(r => !lk.off.has(r.ref)).length;
    return `<div class="m-more"><section class="m-card"><b>${esc(plan.view.text.slice(0, 120))}</b><small>Еталон${plan.view.main ? ' (головний, який ви обрали)' : ' (надіслано останнім)'}: ${esc(ref.target.slice(0, 160))} · ${esc(fileOf(ref.file))}</small></section>
      <p class="m-hint">Вибрано ${n} з ${items.length}.${plan.edited.length ? ' Рядки, змінені пізніше за еталон, не позначені.' : ''}</p>
      ${items.map((r, i) => `<label class="m-check m-opt"><input type="checkbox" data-lkpick="${i}" ${lk.off.has(r.ref) ? '' : 'checked'}><span>${esc(fileOf(r.file))} · ${LINK_LABEL[r.state]}${r.status === 'appr' ? ' · вичитано (стане «надіслано»)' : ''}<small class="m-hint">${esc(r.target.slice(0, 120)) || '—'} → ${esc(ref.target.slice(0, 120))}</small></span></label>`).join('')}
      <button class="m-primary wide" data-lkgo ${n ? '' : 'disabled'}>Оновити вибрані</button>${back}</div>`;
  }
  /** The card under the translation: the rows that share the original and what the translator can do with them. */
  function linksCard(c: NonNullable<typeof store.current>): string {
    const v = store.linkView(c.file, c.unit.key);
    if (!v) return '';
    const plan = store.linkPlan(c.file, c.unit.key), todo = plan ? plan.fills.length + plan.updates.length + plan.edited.length : 0;
    const ordered = [v.self, ...v.rows.filter(x => x !== v.self)].slice(0, 6);
    const rows = ordered.map(r => {
      const i = v.rows.indexOf(r), self = r === v.self, isMain = v.main?.ref === r.ref;
      return `<div class="m-lkrow${self ? ' me' : ''}"><span class="m-lks lk-${r.state}">${isMain ? 'головний ★' : LINK_LABEL[r.state]}</span><small>${self ? 'цей рядок' : esc(fileOf(r.file))}</small>${r.target.trim() ? `<span class="m-lkt">${esc(r.target.slice(0, 100))}</span>` : ''}<span class="m-lka">${self ? '' : `<button class="m-mini ghost" data-lkopen="${i}">Відкрити</button>`}${r.state === 'unlinked' ? `<button class="m-mini ghost" data-lkrelink="${i}">Зв’язати</button>` : `<button class="m-mini ghost" data-lkunlink="${i}">Відв’язати</button>`}${self && r.target.trim() ? (isMain ? `<button class="m-mini ghost" data-lkclear="${i}">Скинути головний</button>` : `<button class="m-mini ghost" data-lkmain="${i}">Зробити головним</button>`) : ''}</span></div>`;
    }).join('');
    const more = v.rows.length > 6 ? `<small class="m-hint">І ще ${v.rows.length - 6}</small>` : '';
    return `<section class="m-card" id="m-lk"><h3>Зв’язані рядки<span class="m-count">${v.rows.length - 1}</span></h3>${store.linkMode() === 'off' ? '<small class="m-hint">Зв’язування вимкнено в налаштуваннях</small>' : ''}${rows}${more}${todo && plan?.view.reference ? `<button class="m-secondary wide" data-lkreview>Оновити зв’язані (${todo})</button>` : ''}</section>`;
  }

  /** The tool «Перенесення рядків»: the same choices as on the computer, applied as they change. */
  const WRAP_SAMPLE = 'Мандрівник дістався перекладацького містечка наприкінці осені, і там на нього чекав старий друг, якого він не бачив багато років.';
  const wp = { text: '', face: false };
  /** The tool «Правила QA»: the level of each rule of form, what it found in the open file, and one-tap mending. */
  function screenQaRules(): string {
    const q = qaOf(store.saved.settings), has = !!store.view(), stats = new Map(store.ruleStats().map(r => [r.id, r]));
    const lv: [RuleSeverity, string][] = [['off', 'Вимкнено'], ['warn', 'Порада'], ['bad', 'Помилка']];
    const apos: Record<string, string> = { any: 'Приймати всі правильні', '’': 'Лише ’', 'ʼ': 'Лише ʼ', "'": "Лише ' з клавіатури" };
    return `<div class="m-more"><p class="m-hint">Правила дивляться на форму тексту. «Порада» нічого не блокує, а «Помилка» не дає надіслати рядок, доки його не виправлено. ${has ? `Лічильники: у файлі «${esc(store.view()!.label ?? store.file ?? '')}».` : 'Відкрийте файл, щоб побачити лічильники.'}</p>
      ${QA_RULES.map(r => {
        const lvl = q.sev[r.id] ?? r.def, st = stats.get(r.id), n = st?.rows ?? 0, fix = st?.fixable ?? 0;
        return `<section class="m-card"><h3>${esc(r.title)}</h3><p class="m-hint">${esc(r.explain)}</p>
          <label class="m-lbl" for="qr-l-${r.id}">Рівень</label><select id="qr-l-${r.id}" class="m-input" data-lvl="${r.id}">${lv.map(([v, l]) => `<option value="${v}" ${v === lvl ? 'selected' : ''}>${l}${v === r.def ? ' (типово)' : ''}</option>`).join('')}</select>
          ${has ? `<p class="m-hint" role="status">${n ? `Знайдено в ${plural(n, ['рядку', 'рядках', 'рядках'])}` : 'У файлі нічого не знайдено'}</p>` : ''}
          ${fix ? `<button class="m-secondary" data-fixall="${r.id}">Виправити в файлі (${fix})</button>` : ''}</section>`;
      }).join('')}
      <section class="m-card"><h3>Латинські слова, які можна лишати</h3><label class="m-lbl" for="qr-keep">По одному слову на рядок. Слова з оригіналу, HP, MP, NPC, одиниці виміру й римські цифри дозволені завжди.</label>
        <textarea id="qr-keep" class="m-textarea sm" rows="3" spellcheck="false" autocomplete="off">${esc(keepToText(store.saved.settings.qa?.keep))}</textarea>
        <label class="m-lbl" for="qr-apos">Апостроф у проєкті</label><select id="qr-apos" class="m-input">${APOSTROPHES.map(a => `<option value="${esc(a)}" ${q.apostrophe === a ? 'selected' : ''}>${esc(apos[a] ?? a)}</option>`).join('')}</select></section></div>`;
  }
  function screenWrap(): string {
    const st = store.saved.settings, w = wrapOf(st), auto = autoLineLimit(store.views), px = w.unit === 'px';
    if (!wp.text) { const c = store.current; wp.text = c && isMessageUnit(c.unit) ? flowText(c.entry?.target ?? '') : ''; if (!wp.text) wp.text = WRAP_SAMPLE; }
    const opt = (v: string, l: string, on: boolean): string => `<option value="${v}" ${on ? 'selected' : ''}>${l}</option>`;
    const radio = (name: string, v: string, l: string, h: string, on: boolean): string => `<label class="m-check m-opt"><input type="radio" name="${name}" value="${v}" ${on ? 'checked' : ''}><span>${l}<small class="m-hint">${h}</small></span></label>`;
    return `<div class="m-more">
      <section class="m-card"><h3>Коли переносити</h3>
        ${radio('w-mode', 'build', 'Під час збірки й запуску гри (рекомендовано)', 'Текст у проєкті лишається без розривів. Збірка робиться на комп’ютері; тут цей режим лише впливає на поради.', w.mode === 'build')}
        ${radio('w-mode', 'text', 'У тексті, коли надсилаю рядок', 'Розриви стають частиною перекладу.', w.mode === 'text')}
        ${radio('w-mode', 'off', 'Не переносити', 'Лише радити, коли рядок задовгий.', w.mode === 'off')}</section>
      <section class="m-card"><h3>Ширина рядка</h3>
        <label class="m-lbl" for="w-unit">Рахувати в</label><select id="w-unit" class="m-input">${opt('chars', 'символах', !px)}${opt('px', 'пікселях вікна гри', px)}</select>
        <div ${px ? 'hidden' : ''} id="w-chars"><label class="m-lbl" for="w-lim-mode">Ширина</label><select id="w-lim-mode" class="m-input">${opt('auto', `за оригіналом${auto ? ` (зараз ${auto})` : ` (не визначено, діє ${DEFAULT_LINE_LIMIT})`}`, st.lineLimit === 0)}${opt('custom', 'своє число', st.lineLimit > 0)}${opt('off', 'не обмежувати', st.lineLimit < 0)}</select>
          <label class="m-lbl" for="w-lim">Символів у рядку</label><input id="w-lim" class="m-input" type="number" inputmode="numeric" min="10" max="200" value="${st.lineLimit > 0 ? st.lineLimit : auto || DEFAULT_LINE_LIMIT}" ${st.lineLimit > 0 ? '' : 'disabled'}></div>
        <div ${px ? '' : 'hidden'} id="w-px"><label class="m-lbl" for="w-pxw">Ширина вікна гри, px</label><input id="w-pxw" class="m-input" type="number" inputmode="numeric" min="320" max="4096" value="${w.px.width}">
          <label class="m-lbl" for="w-pxf">Шрифт гри, px</label><input id="w-pxf" class="m-input" type="number" inputmode="numeric" min="10" max="96" value="${w.px.font}">
          <label class="m-check"><input type="checkbox" id="w-pxoff" ${st.lineLimit < 0 ? 'checked' : ''}> Не обмежувати ширину</label></div>
        <p class="m-hint">Пікселі враховують справжню ширину літер, але шрифт гри невідомий, тож вимір приблизний. Поруч із портретом текст вужчий.</p></section>
      <section class="m-card"><h3>Переніс слів</h3>
        <label class="m-lbl" for="w-hy">Слово по складах, з дефісом</label><select id="w-hy" class="m-input">${opt('off', 'не переносити слова', w.hyphen === 'off')}${opt('needed', 'лише коли треба (рекомендовано)', w.hyphen === 'needed')}${opt('fill', 'коли краще заповнює рядок', w.hyphen === 'fill')}</select>
        <label class="m-lbl" for="w-hc">Знак переносу</label><input id="w-hc" class="m-input" maxlength="2" value="${esc(w.hyphenChar)}" autocomplete="off">
        <label class="m-lbl" for="w-ml">Літер перед переносом, не менше</label><input id="w-ml" class="m-input" type="number" inputmode="numeric" min="1" max="6" value="${w.minLeft}">
        <label class="m-lbl" for="w-mr">Літер після переносу, не менше</label><input id="w-mr" class="m-input" type="number" inputmode="numeric" min="1" max="6" value="${w.minRight}">
        <p class="m-hint">Слова з латинкою, цифрами, кодами всередині та слова з дефісом не розбиваються.</p></section>
      <section class="m-card"><h3>Розриви, які поставили ви</h3>
        ${radio('w-keep', 'long', 'Зберігати, переносити лише задовгі (рекомендовано)', 'Охайно розбитий текст не чіпається.', w.keep === 'long')}
        ${radio('w-keep', 'reflow', 'Збирати текст заново завжди', 'Старі розриви ігноруються.', w.keep === 'reflow')}
        <label class="m-lbl" for="w-max">Радити, коли рядків у повідомленні більше, ніж (0 вимикає)</label><input id="w-max" class="m-input" type="number" inputmode="numeric" min="0" max="12" value="${w.maxLines}">
        <p class="m-hint">Вікно показує ${w.maxLines || 4} рядки; довше повідомлення гра покаже на кількох сторінках. Нічого не обрізається.</p></section>
      <p class="m-err" id="w-err" role="alert" hidden></p>
      <section class="m-card"><h3>Приклад</h3>
        <label class="m-lbl" for="w-ex">Текст для перевірки</label><textarea id="w-ex" class="m-textarea sm" rows="3" spellcheck="false">${esc(wp.text)}</textarea>
        <label class="m-check"><input type="checkbox" id="w-face" ${wp.face ? 'checked' : ''}> Поруч портрет персонажа</label>
        <div id="w-view" class="m-wview" aria-live="polite"></div><p class="m-hint" id="w-stat" role="status"></p></section></div>`;
  }
  /** What the form holds as settings, or the reason it cannot be saved yet. */
  function readWrapForm(): { wrap: WrapSettings; lineLimit: number } | string {
    const v = (id: string): string => ($(id) as HTMLInputElement | HTMLSelectElement).value, n = (id: string): number => Number(v(id));
    const ok = (x: number, lo: number, hi: number): boolean => Number.isFinite(x) && x >= lo && x <= hi;
    const checked = (name: string): string => document.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`)?.value ?? '';
    const st = store.saved.settings, w0 = wrapOf(st), unit = v('w-unit') === 'px' ? 'px' : 'chars';
    let lineLimit = 0;
    if (unit === 'px') {
      if (!ok(n('w-pxw'), 320, 4096)) return 'Ширина вікна: від 320 до 4096 пікселів';
      if (!ok(n('w-pxf'), 10, 96)) return 'Шрифт: від 10 до 96 пікселів';
      lineLimit = ($('w-pxoff') as HTMLInputElement).checked ? -1 : st.lineLimit < 0 ? 0 : st.lineLimit;
    } else {
      const m = v('w-lim-mode');
      if (m === 'custom' && !ok(n('w-lim'), 10, 200)) return 'Ширина рядка: від 10 до 200 символів';
      lineLimit = m === 'off' ? -1 : m === 'custom' ? Math.round(n('w-lim')) : 0;
    }
    if ([...v('w-hc')].length !== 1 || /\s/.test(v('w-hc'))) return 'Знак переносу це один видимий символ';
    if (!ok(n('w-ml'), 1, 6) || !ok(n('w-mr'), 1, 6)) return 'Літер при переносі: від 1 до 6';
    if (!ok(n('w-max'), 0, 12)) return 'Кількість рядків: від 0 до 12';
    return { lineLimit, wrap: { ...DEFAULT_WRAP, mode: checked('w-mode') as WrapSettings['mode'], unit, hyphen: v('w-hy') as WrapSettings['hyphen'], hyphenChar: v('w-hc'), minLeft: n('w-ml'), minRight: n('w-mr'), keep: checked('w-keep') as WrapSettings['keep'], maxLines: n('w-max'), px: { width: unit === 'px' ? n('w-pxw') : w0.px.width, font: unit === 'px' ? n('w-pxf') : w0.px.font } } };
  }
  /** The example under the form: the text as the window will show it. */
  function wrapPreview(): void {
    const view = document.getElementById('w-view'); if (!view) return;
    const plan = store.wrapPlan(), unit = { kind: 'dialogue' as const, key: 'events[0].pages[0].list[0]', ...(wp.face ? { face: 'Actor1#0' } : {}) };
    const width = widthOf(plan, unit), measure = measureOf(plan), mode = plan.settings.mode;
    const r = mode === 'off' || width <= 0 ? null : wrapMessage(plan, unit, wp.text);
    const lines = (r ? r.text : wp.text).split('\n'), max = plan.settings.maxLines;
    view.innerHTML = wp.text.trim() ? lines.map((l, i) => { const m = Math.round(measure(l)), over = width > 0 && m > width; return `${max > 0 && i === max ? '<div class="pg">Далі: наступна сторінка вікна</div>' : ''}<div class="ln${over ? ' over' : ''}${max > 0 && i >= max ? ' next' : ''}"><span>${esc(l) || '&nbsp;'}</span>${width > 0 ? `<em>${m}/${width}</em>` : ''}</div>`; }).join('') : '<div class="m-hint">Немає тексту</div>';
    const n = linesShown(plan, unit, wp.text);
    $('w-stat').textContent = [mode === 'build' ? 'Так гра покаже цей текст; у проєкті він лишається без розривів.' : mode === 'text' ? 'Так текст запишеться, коли ви надішлете рядок.' : 'Переносу немає: текст як написаний.', `Рядків: ${n}`, r?.hyphenated ? `слів із переносом: ${r.hyphenated}` : '', max > 0 && n > max ? `понад ${max}: гра покаже на кількох сторінках` : '', width > 0 ? `ширина до ${width} ${unitWord(plan)}` : 'ширину вимкнено'].filter(Boolean).join(' · ') + '.';
  }
  /** Save the form (when it is valid) and redraw the example; `final` also redraws the screen, e.g. after the unit changed. */
  function applyWrapForm(final: boolean): void {
    const r = readWrapForm(), err = $('w-err');
    err.hidden = typeof r !== 'string'; err.textContent = typeof r === 'string' ? r : '';
    if (typeof r === 'string') return;
    const st = store.saved.settings;
    if (JSON.stringify(wrapOf(st)) !== JSON.stringify(r.wrap) || st.lineLimit !== r.lineLimit) { st.wrap = r.wrap; st.lineLimit = r.lineLimit; store.saved.settingsAt = Date.now(); store.persist(); }
    if (final) { const y = $('m-main').scrollTop; render(); $('m-main').scrollTop = y; } else wrapPreview();
  }

  function screenSettings(): string {
    const st = store.saved.settings;
    return `<div class="m-more"><section class="m-card"><label class="m-lbl" for="s-tol">Допуск довжини перекладу відносно оригіналу, %</label><input id="s-tol" class="m-input" type="number" min="5" max="100" step="5" value="${esc(String(st.tolerancePct))}">
      <button class="m-secondary wide" data-sub="wrap">${icon('rows')}<span>Перенесення рядків…</span></button>
      <label class="m-check"><input type="checkbox" id="s-block" ${st.blockErrors ? 'checked' : ''}> Не надсилати рядок із помилкою QA</label>
      <label class="m-lbl" for="s-link">Автозаповнення однакових рядків після «Надіслати»</label><select id="s-link" class="m-input"><option value="ask" ${store.linkMode() === 'ask' ? 'selected' : ''}>заповнювати порожні чернетками, про різні питати (рекомендовано)</option><option value="auto" ${store.linkMode() === 'auto' ? 'selected' : ''}>заповнювати порожні й самому оновлювати різні (вичитані не чіпає)</option><option value="off" ${store.linkMode() === 'off' ? 'selected' : ''}>не заповнювати</option></select>
      <label class="m-lbl" for="s-who">Ваше ім’я в коментарях та історії</label><input id="s-who" class="m-input" value="${esc(String(st.who))}" maxlength="40" autocomplete="off"></section>
      <section class="m-card"><h3>Довідкові мови</h3><p class="m-hint">Копія тієї ж гри іншою мовою: її рядки показуються під оригіналом як підказка.</p>
        ${store.refLangs().map(l => `<div class="m-var"><span>${esc(l.toUpperCase())}</span><small></small><button class="m-mini ghost" data-refdel="${esc(l)}">Прибрати</button></div>`).join('')}
        <label class="m-lbl" for="rf-lang">Код мови (ru, pl, en…)</label><input id="rf-lang" class="m-input" maxlength="8" value="${esc(refLang)}" autocomplete="off">
        <button class="m-primary wide" data-refpick>Обрати файли гри цією мовою</button></section>
      <section class="m-card"><h3>Імпорт глосарію</h3><p class="m-hint">З файлу: таблиця Google Sheets, збережена як веб-сторінка (.html), або .csv / .tsv із колонками «Оригінал», «Переклад 1…», «Опис», «Розділ».</p>
        <label class="m-check"><input type="checkbox" id="i-termqa"> Перевіряти ці терміни в QA (для великого глосарію краще вимкнути: він лише підказує)</label>
        <button class="m-secondary wide" data-termfile>${icon('folder')}<span>Імпортувати з файлу…</span></button>
        <label class="m-lbl" for="i-terms">Або вставте рядки «англійською, табуляція, українською»</label><textarea id="i-terms" class="m-textarea sm" rows="3" spellcheck="false"></textarea>
        <button class="m-secondary wide" data-termgo>Імпортувати вставлені терміни</button></section>
      <section class="m-card"><h3>Імпорт пам’яті перекладів</h3><p class="m-hint">Рядки «оригінал, табуляція, переклад».</p><textarea id="i-tm" class="m-textarea sm" rows="3" spellcheck="false" aria-label="Пари для імпорту"></textarea>
        <button class="m-secondary wide" data-tmgo>Імпортувати пари</button></section>
      ${pluginsCard()}
      <section class="m-card"><h3>Небезпечна зона</h3><p class="m-hint">Видаляє весь переклад, глосарій та імпортовану пам’ять на цьому телефоні. Файли гри не змінюються.</p>
        <button class="m-mini danger wide" data-reset>${resetArmed ? 'Так, видалити весь переклад' : 'Скинути проєкт…'}</button></section>
      <p class="m-hint">Довжина тексту не обмежується: застосунок лише радить, коли переклад дуже відрізняється від оригіналу або рядок ширший за вікно гри.</p></div>`;
  }

  /** Plugins show text through their own commands; the translator ticks the ones that hold lines for the player. */
  function pluginsCard(): string {
    const st = store.saved.settings, cands = store.pluginCands();
    if (!cands.length) return `<section class="m-card"><h3>Тексти плагінів</h3><p class="m-hint">${store.game.length ? 'У цій грі не знайдено команд плагінів із текстом.' : 'Файлів гри зараз немає (проєкт відкрито зі збереженого файлу). Відкрийте файли гри, щоб вибрати команди.'}${st.pluginCommands.length ? ` Увімкнено раніше: ${esc(st.pluginCommands.join(', '))}.` : ''}</p></section>`;
    if (!plPick) { plPick = new Set(st.pluginCommands); if (!st.pluginsAsked) for (const c of cands) if (c.likely) plPick.add(c.name); }
    return `<section class="m-card"><h3>Тексти плагінів</h3><p class="m-hint">Деякі ігри показують текст командами плагінів. Позначте команди, чий текст бачить гравець: вони з’являться як окремі рядки.</p>
      ${cands.map(c => `<label class="m-check"><input type="checkbox" data-pl="${esc(c.name)}" ${plPick!.has(c.name) ? 'checked' : ''}> <span><b>${esc(c.name)}</b> <small>· команд з текстом: ${c.withText}${c.withText < c.count ? ` із ${c.count}` : ''}${c.likely ? ' · схоже на текст для гравця' : ''}</small>${c.samples.map(x => `<small class="m-pls">«${esc(x)}»</small>`).join('')}</span></label>`).join('')}
      <button class="m-primary wide" data-plapply>Застосувати</button></section>`;
  }

  function issuesHtml(): string {
    const c = store.current; if (!c) return '';
    const sd = (i: Issue): string => `<span class="sd ${i.severity === 'bad' ? 'sd-qa' : 'sd-draft'}"></span>`;
    // a rule of form explains itself under its remark; the older remarks are short enough
    const live = byHintOrder(store.issues(c.unit, c.entry)).map(i => `<div class="m-issue ${i.severity}"><div class="m-issue-t">${sd(i)}<span class="m-kind k-${i.cat}"><span aria-hidden="true">${HINT_GLYPH[i.cat]}</span> ${HINT_LABEL[i.cat]}</span><span>${esc(i.message)}${i.detail && i.key.includes('-') ? `<small class="m-issue-d">${esc(i.detail)}</small>` : ''}</span></div><div class="m-issue-a">${i.codes?.length ? `<button class="m-mini" data-ins="${esc(i.codes.join(''))}">Вставити</button>` : ''}${i.key === 'wrap' ? '<button class="m-mini" data-wrap>Перенести</button>' : ''}${i.fix && !i.codes?.length && i.key !== 'wrap' ? `<button class="m-mini" data-fix="${esc(i.key)}">${esc(i.fix.label)}</button>` : ''}<button class="m-mini ghost" data-ign="${esc(i.key)}">Ігнорувати</button></div></div>`).join('');
    const set = store.ignored(c.unit, c.entry).map(i => `<div class="m-issue muted"><div class="m-issue-t"><span class="sd sd-draft"></span><span>${esc(i.message)} <em class="m-tagi">проігноровано</em></span></div><div class="m-issue-a"><button class="m-mini ghost" data-unign="${esc(i.key)}">Повернути</button></div></div>`).join('');
    return live + set;
  }

  /** The original with its glossary terms as words that can be tapped: a wavy line when the translation lacks the term. */
  function sourceHtml(source: string, terms: ReturnType<typeof store.terms>, target: string): string {
    return markupTerms(source, sourceTermHits(source, terms).map(h => ({ start: h.start, end: h.end, en: h.term.en, missing: !!target && !targetHasTerm(target, h.term.uk, h.term.alt) })));
  }
  function screenEdit(): string {
    const c = store.current;
    if (!c) return empty('Рядок не вибрано', 'Оберіть рядок зі списку.', 'rows', 'До рядків');
    const u = c.unit, e = c.entry, st = store.shown(u, e), v = store.view();
    const terms = store.terms(u);
    return `<div class="m-edit" id="m-edit">
      <div class="m-ctx">${isAutoFilled(e) ? '<span class="m-tag" title="Заповнено застосунком і ще не переглянуто: це чернетка">авто</span>' : ''}<span class="m-tag">${esc(KIND_LABEL[u.kind])}</span>${store.speaker(u) ? `<span class="m-tag who">${esc(store.speaker(u))}</span>` : ''}${v?.label ? `<span class="m-tag">${esc(v.label)}</span>` : ''}<span class="m-status"><span class="sd ${SHAPE[st]}"></span>${stateLabel(st, e)}</span></div>
      <section class="m-card"><h3>Оригінал</h3><div class="m-source" id="m-source">${sourceHtml(u.source, terms, e?.target ?? '')}</div>${store.refs(c.file, u.key).map(r => `<div class="m-ref"><small>Довідка · ${esc(r.lang.toUpperCase())}</small>${esc(r.text)}</div>`).join('')}${(() => { const w = store.usageOf(c.file, u.key); return w.length ? `<div class="m-ref"><small>Де видається</small>${w.map(esc).join('<br>')}</div>` : ''; })()}</section>
      <section class="m-card m-tr-card"><h3>Переклад<span class="m-count" id="m-count"></span></h3>
        <textarea id="m-tr" class="m-textarea" spellcheck="false" autocapitalize="sentences" placeholder="Напишіть переклад…" aria-label="Переклад">${esc(e?.target ?? '')}</textarea>
        <div id="m-issues" class="m-issues">${issuesHtml()}</div>
      </section>
      <div id="m-prev" class="m-prev"></div>
      ${linksCard(c)}
    </div>
    <div class="m-actions" id="m-actions"><div class="m-act2"><button class="m-mini" data-sub="scene">${icon('rows')} Сцена</button>${c.entry?.status === 'appr' ? '' : `<button class="m-mini" data-approve>${icon('check')} Вичитати</button>`}${c.entry?.status === 'done' || c.entry?.status === 'appr' ? `<button class="m-mini" data-rework title="Повернути на доопрацювання">${icon('undo')} Повернути</button>` : ''}<button class="m-mini danger" data-clear>Очистити</button></div><div class="m-act1"><button class="m-ic" data-step="-1" aria-label="Попередній рядок" ${store.neighbour(-1) ? '' : 'disabled'}>${icon('prev')}</button><button class="m-ic" data-step="1" aria-label="Наступний рядок" ${store.neighbour(1) ? '' : 'disabled'}>${icon('next')}</button><button class="m-ic" data-queue aria-label="Наступний рядок без перекладу в проєкті" title="Наступний рядок без перекладу в проєкті">${icon('down')}</button><button class="m-primary" data-send>${icon('send')}<span>Надіслати</span></button></div></div>`;
  }

  function screenMore(): string {
    const gh = loadGithubConfig(), tot = store.totals();
    const pct = pctOf(tot.translated, tot.total);
    return `<div class="m-more">
      ${store.hasGame ? `<section class="m-card"><h3>Прогрес</h3><div class="m-big">${pct}%</div>${bar(tot.translated, tot.total)}<p class="m-hint">Перекладено ${tot.translated} з ${tot.total} · надіслано, не вичитано ${tot.done} · вичитано ${tot.approved}</p>${(() => { const c = copyLine(store.saved, Date.now(), tot.translated); return `<p class="m-hint${c.warn ? ' m-bad' : ''}">${c.text}${c.warn ? '. Проєкт зберігається лише на цьому телефоні: збережіть його у файл або синхронізуйте' : ''}</p>`; })()}</section>` : ''}
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

  /* ---------- the card of a glossary term (a tap on the term in the original) ---------- */
  let termShown: string | null = null;
  /** The control code whose card is shown (the same bottom card as for a term). */
  let codeShown: string | null = null;
  function renderCodeCard(): void {
    let box = document.getElementById('m-tcard');
    const c = store.current;
    if (!codeShown || !c) { box?.remove(); return; }
    if (!box) { box = document.createElement('aside'); box.id = 'm-tcard'; box.className = 'm-tcard'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'Керівний код гри'); root.appendChild(box); }
    const actor = (n: number): string | undefined => { const u = store.views.find(x => x.name === 'Actors.json')?.units.find(x => x.key === `[${n}].name`); return u ? store.saved.files['Actors.json']?.[u.key]?.target || u.source : undefined; };
    const meaning = explainCodes(codeShown, actor, store.saved.sysNames)[0]?.meaning ?? 'керівний код гри';
    const has = (c.entry?.target ?? '').includes(codeShown);
    box.innerHTML = `<div class="m-tc-r"><span class="m-tc-l">КОД</span><div><b class="mono">${esc(codeShown)}</b><div class="m-tc-n">${esc(meaning)}. Гра підставляє це сама: код має стояти в перекладі так само, як в оригіналі.</div></div></div>
      <div class="m-tc-x">${has ? '' : `<button class="m-primary" data-cc="insert">Вставити ${esc(codeShown)}</button>`}<button class="m-secondary" data-cc="close">Закрити</button></div>`;
  }
  function renderTermCard(): void {
    if (codeShown) { renderCodeCard(); return; }
    let box = document.getElementById('m-tcard');
    const t0 = termShown ? store.saved.terms.find(y => y.en === termShown) : undefined;
    const c = store.current;
    if (!t0 || !c) { box?.remove(); return; }
    const used = c.entry?.target ? targetHasTerm(c.entry.target, t0.uk, t0.alt) : null;
    if (!box) { box = document.createElement('aside'); box.id = 'm-tcard'; box.className = 'm-tcard'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'Термін глосарію'); root.appendChild(box); }
    box.innerHTML = `<div class="m-tc-r"><span class="m-tc-l">UK</span><div><b>${esc(t0.uk)}</b>${t0.alt?.length ? `<div class="m-tc-a">також: ${t0.alt.map(a => `<i>${esc(a)}</i>`).join('')}</div>` : ''}<div class="m-tc-t">${t0.kind ? `<span class="m-tg k">${esc(t0.kind)}</span>` : ''}<span class="m-tg ${t0.qa === false ? '' : 'ok'}">${t0.qa === false ? 'лише підказка' : 'перевіряється в QA'}</span>${used === null ? '' : used ? '<span class="m-tg ok">є в перекладі</span>' : '<span class="m-tg warn">немає в перекладі</span>'}</div></div></div>
      <div class="m-tc-r en"><span class="m-tc-l">EN</span><div><b>${esc(t0.en)}</b>${t0.note ? `<div class="m-tc-n">${esc(t0.note)}</div>` : ''}</div></div>
      <div class="m-tc-x"><button class="m-primary" data-tc="insert">Вставити «${esc(t0.uk)}»</button><button class="m-secondary" data-tc="edit">Змінити</button><button class="m-secondary" data-tc="close">Закрити</button></div>`;
  }
  const showTermCard = (en: string): void => { termShown = en; codeShown = null; renderTermCard(); };
  /** The term or code of the original nearest to a tap (within about 22 px), when the tap itself fell on neither. */
  function nearestWord(e: MouseEvent): HTMLElement | null {
    const src = document.getElementById('m-source');
    if (!src || !(e.target as HTMLElement).closest?.('#m-source')) return null;
    let best: HTMLElement | null = null, d = 22;
    for (const w of src.querySelectorAll<HTMLElement>('.th[data-term], .code[data-hk]')) for (const r of w.getClientRects()) {
      const dx = Math.max(r.left - e.clientX, 0, e.clientX - r.right), dy = Math.max(r.top - e.clientY, 0, e.clientY - r.bottom), dist = Math.hypot(dx, dy);
      if (dist < d) { d = dist; best = w; }
    }
    return best;
  }

  /* ---------- the hints sheet ---------- */
  /** Thread with an open answer form; comment being edited; comment waiting for the second tap of a deletion. */
  let cmReply: string | null = null, cmEdit: string | null = null, cmDel: string | null = null;
  const diffHtml = (d: DiffSeg[]): string => d.map(s => (s.t === 'same' ? esc(s.text) : s.t === 'add' ? `<ins>${esc(s.text)}</ins>` : `<del>${esc(s.text)}</del>`)).join('');
  /** The discussion of the open row as threads: answers, closing, editing and deleting one's own comments. */
  function threadsHtml(e: Entry | undefined): string {
    const th = threadsOf(e?.comments);
    if (!th.length) return '<p class="m-none">Коментарів ще немає</p>';
    const one = (cm: Comment): string => {
      const id = commentId(cm), mine = cm.who === store.who;
      const edited = cm.ed && cm.ed > cm.at ? ` · змінено ${fmtTime(cm.ed)}` : '';
      if (cmEdit === id) return `<div class="m-cmc"><textarea class="m-cmin" id="m-cmedit" rows="3" aria-label="Редагувати коментар">${esc(cm.text)}</textarea><div class="m-cma"><button class="m-mini p" data-cm="save-edit" data-cid="${esc(id)}">Зберегти</button><button class="m-mini ghost" data-cm="cancel">Скасувати</button></div></div>`;
      return `<div class="m-cmc"><small><b>${esc(cm.who)}</b> · ${fmtTime(cm.at)}${edited}</small><p>${esc(cm.text)}</p>${mine ? `<div class="m-cma"><button class="m-mini ghost" data-cm="edit" data-cid="${esc(id)}">Змінити</button><button class="m-mini ghost ${cmDel === id ? 'danger' : ''}" data-cm="delete" data-cid="${esc(id)}">${cmDel === id ? 'Справді видалити?' : 'Видалити'}</button></div>` : ''}</div>`;
    };
    const card = (t: (typeof th)[number]): string => `<div class="m-thr ${t.resolved ? 'closed' : ''}">${one(t.root)}${t.replies.map(one).join('')}
      ${cmReply === t.id ? `<div class="m-cmc"><textarea class="m-cmin" id="m-cmreply" rows="2" placeholder="Відповісти…" aria-label="Відповідь"></textarea><div class="m-cma"><button class="m-mini p" data-cm="send-reply" data-cid="${esc(t.id)}">Надіслати</button><button class="m-mini ghost" data-cm="cancel">Скасувати</button></div></div>`
        : `<div class="m-cma foot">${t.resolved ? `<small>розв’язано · ${esc(t.by?.who ?? '')}</small><button class="m-mini ghost" data-cm="reopen" data-cid="${esc(t.id)}">Відкрити знову</button>` : `<button class="m-mini ghost" data-cm="reply" data-cid="${esc(t.id)}">Відповісти</button><button class="m-mini ghost ok" data-cm="resolve" data-cid="${esc(t.id)}">✓ Розв’язати</button>`}</div>`}</div>`;
    const open = th.filter(x => !x.resolved), closed = th.filter(x => x.resolved);
    return open.map(card).join('') + (closed.length ? `<details class="m-thr-closed"><summary>Розв’язані · ${closed.length}</summary>${closed.map(card).join('')}</details>` : '');
  }
  /** The history of the open row: what changed in each record, and a way back to a version or to what was before it. */
  function historyHtml(rows: ReturnType<typeof historyRows>): string {
    if (!rows.length) return '<p class="m-none">Історії ще немає</p>';
    return `<ol class="m-time">${rows.map(r => `<li class="${r.isCurrent ? 'cur' : ''}"><small>${fmtTime(r.rec.at)} · ${esc(r.rec.who)}${r.isCurrent ? ' · зараз у полі' : ''}</small><span class="m-chipx">${esc(r.rec.what)}</span>${r.rec.text ? `<p class="m-diff">${r.before ? diffHtml(r.diff) : esc(r.rec.text)}</p>` : ''}
      <div class="m-cma">${r.canRestore ? `<button class="m-mini ghost" data-hv="restore" data-i="${r.index}">Відновити цю версію</button>` : ''}${r.canRestoreBefore ? `<button class="m-mini ghost" data-hv="before" data-i="${r.index}">Було до цього</button>` : ''}</div></li>`).join('')}</ol>`;
  }
  const fmtTime = (t: number): string => new Date(t).toLocaleString('uk-UA', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  /** Side panel under the top bar: one topic at a time (glossary, memory, comments, history); the top-bar button that opened it closes it. */
  function renderSheet(): void {
    const wrap = $('m-sheet'); wrap.hidden = !sheet && !menu;
    if (menu) {
      wrap.dataset.open = '';
      const badge: Partial<Record<Sub, number>> = { autofill: store.autofill().length + store.linkTodo(), sendlog: store.sends().length + store.autos().length + store.journal().length };
      const short: Partial<Record<Sub, string>> = { find: 'Заміна', search: 'Пошук', autofill: 'Автозаповнення', speakers: 'Мовці', wrap: 'Перенос', termsync: 'За глосарієм' };
      const item = (k: Sub): string => { const [, l, ic] = TOOLS.find(t => t[0] === k)!; return `<button class="m-mi" data-sub="${k}">${icon(ic)}<span>${short[k] ?? l}</span>${badge[k] ? `<i>${badge[k]! > 99 ? '99+' : badge[k]}</i>` : ''}</button>`; };
      wrap.innerHTML = `<div class="m-scrim" data-close></div><nav class="m-menu" aria-label="Інструменти"><span class="m-grab" aria-hidden="true"></span><div class="m-mgrid">${(['find', 'search', 'autofill', 'speakers', 'glossary', 'wrap', 'termsync', 'sendlog'] as Sub[]).map(item).join('')}</div>
        <div class="m-msep"></div><button class="m-mi wide" data-sub="qarules">${icon('check')}<span>Правила QA</span></button><button class="m-mi wide" data-sub="settings">${icon('more')}<span>Налаштування</span></button></nav>`;
      return;
    }
    const c = store.current;
    if (!sheet || !c) { wrap.innerHTML = ''; delete wrap.dataset.open; return; }
    const fresh = wrap.dataset.open !== '1'; wrap.dataset.open = '1';
    const terms = store.terms(c.unit), tm = store.suggestions(c.unit, c.entry), hist = historyRows(c.entry?.history, c.entry?.target ?? '').slice(0, 20);
    const counts = { terms: terms.length, tm: tm.length, cm: openThreads(c.entry), hist: hist.length, dict: 0 };
    const tabs: ['terms' | 'tm' | 'cm' | 'hist' | 'dict', string][] = [['terms', 'Глосарій'], ['tm', 'Пам’ять'], ['cm', 'Коментарі'], ['hist', 'Історія']];
    const cur = sheetTab ?? (counts.terms ? 'terms' : counts.tm ? 'tm' : counts.cm ? 'cm' : 'terms');
    if (cur !== 'cm') { cmReply = cmEdit = cmDel = null; }
    const idx = tabs.findIndex(t => t[0] === cur), dir = fresh ? '' : idx > prevTabIdx ? 'from-r' : idx < prevTabIdx ? 'from-l' : '';
    prevTabIdx = idx;
    const panel = cur === 'terms' ? (terms.length ? terms.map((t, i) => `<button class="m-hit" data-term="${i}"><b>${esc(t.en)}</b><span>→ ${esc(t.uk)}${t.alt?.length ? ` · ${esc(t.alt.join(', '))}` : ''}</span></button>`).join('') : '<p class="m-none">У цьому рядку термінів немає</p>') + '<button class="m-mini" data-gadd>Додати термін</button>'
      : cur === 'tm' ? (tm.length ? tm.map((m, i) => `<button class="m-hit" data-tm="${i}"><b class="m-score">${m.score}%</b><span>${esc(m.t)}</span></button>`).join('') : '<p class="m-none">Схожих перекладів немає</p>')
      : cur === 'cm' ? threadsHtml(c.entry)
      : historyHtml(hist);
    wrap.innerHTML = `<div class="m-scrim ${fresh ? 'in' : ''}" data-close></div><aside class="m-sheet ${fresh ? 'in' : ''} ${cur === 'cm' ? 'tall' : ''}" role="dialog" aria-label="Допомога до рядка">
      <span class="m-grab" aria-hidden="true"></span>
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
    main.innerHTML = sub ? ({ scene: screenScene, find: screenFind, speakers: screenSpeakers, settings: screenSettings, wrap: screenWrap, consistency: screenConsistency, termsync: screenTermSync, glossary: screenGlossary, autofill: screenAutofill, sendlog: screenSendLog, search: screenSearch, qarules: screenQaRules }[sub])() : tab === 'files' ? screenFiles() : tab === 'rows' ? screenRows() : tab === 'edit' ? screenEdit() : screenMore();
    renderSheet();
    // a field that was removed by this redraw cannot report that it lost the focus
    if (!document.activeElement?.matches(TEXTY)) $('m-app').classList.remove('kb');
    if (entered && tab === 'rows' && !sub) requestAnimationFrame(() => document.querySelector('.m-row.cur, .m-table tr.cur')?.scrollIntoView({ block: 'center' }));
    if (tab === 'edit' && !sub) { refreshMeta(); autosize(); }
    if (sub === 'wrap') wrapPreview();
    if (tab === 'more') void artifactDb().then(db => { const el = document.getElementById('m-claude'); if (db && el) el.hidden = false; });
  }
  store.onChange(() => { renderChrome(); });

  function autosize(): void { const t = document.getElementById('m-tr') as HTMLTextAreaElement | null; if (t) { t.style.height = 'auto'; t.style.height = Math.max(window.innerHeight < 520 ? 88 : 132, t.scrollHeight + 2) + 'px'; } }
  /** Typing changes the numbers and the QA messages, not the field itself. */
  function refreshMeta(): void {
    const c = store.current; if (!c) return;
    const n = document.getElementById('m-count'); const t = c.entry?.target ?? '';
    if (n) n.textContent = `${[...t].length} / ${[...c.unit.source].length}`;
    const pv = document.getElementById('m-prev');
    if (pv) {
      const plan = store.wrapPlan(), width = isMessageUnit(c.unit) ? widthOf(plan, c.unit) : 0, px = usesPixels(plan), mode = plan.settings.mode;
      pv.hidden = width <= 0 || !t.trim();
      if (!pv.hidden) {
        const measure = measureOf(plan), max = c.unit.kind === 'dialogue' ? plan.settings.maxLines : 0;
        const lines = (mode === 'build' ? wrapMessage(plan, c.unit, t).text : t).split('\n');
        if (px) pv.style.removeProperty('--lim'); else pv.style.setProperty('--lim', String(width));
        const n = linesShown(plan, c.unit, t);
        pv.innerHTML = `<small>${mode === 'build' ? `Так гра покаже: до ${width} ${px ? 'px' : 'зн.'} у рядку` : `Вікно гри: ${width} ${px ? 'px' : 'зн.'} у рядку`}${max > 0 && n > max ? ` · ${n} рядків, вікно показує ${max}: гра покаже на кількох сторінках` : ''}</small><div class="m-prevbox">${lines.map(l => { const over = Math.round(measure(l)) - width; return `<div class="${over > 0 ? 'over' : ''}">${esc(l) || '&nbsp;'}${over > 0 ? `<em>+${over}</em>` : ''}</div>`; }).join('')}</div>`;
      }
    }
    const box = document.getElementById('m-issues'); if (box) box.innerHTML = issuesHtml();
    const stEl = document.querySelector('.m-status'); if (stEl) { const st = store.shown(c.unit, c.entry); stEl.innerHTML = `<span class="sd ${SHAPE[st]}"></span>${stateLabel(st, c.entry)}`; }
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
      const parts = [projects ? `проєкт злито${conflicts ? ` (конфліктів: ${conflicts})` : ''}` : '', game.length ? `файлів гри: ${game.length}` : '', reset ? `оригінал змінився в ${reset} рядках${store.lastReconcile ? `, у чернетки повернуто ${store.lastReconcile.demoted}` : ''}` : ''].filter(Boolean);
      if (unknown.length) say(`Не впізнав: ${unknown.slice(0, 3).join(', ')}${unknown.length > 3 ? '…' : ''}`, true);
      if (parts.length) say(parts.join(' · '), false, store.lastReconcile?.batch);
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
      store.saved = adoptSynced(store.saved, rep.project); stamp(store.saved, 'copy', 'синхронізація', Date.now()); cfg.last = Date.now(); cfg.state = rep.state; saveGithubConfig(cfg); store.adopt();
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
      store.saved = adoptSynced(store.saved, rep.project); stamp(store.saved, 'copy', 'синхронізація', Date.now()); cfg.last = Date.now(); cfg.state = rep.state; saveGithubConfig(cfg); store.adopt();
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
      store.saved = adoptSynced(store.saved, rep.project); stamp(store.saved, 'copy', 'синхронізація', Date.now()); cfg.last = Date.now(); cfg.state = rep.state; saveClaudeConfig(cfg); store.adopt();
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
    if ((x = q('[data-sub]'))) { sub = x.dataset.sub as Sub; if (sub === 'consistency') lk.scope = null; if (sub === 'scene' && store.current) scn.picked = store.current.unit.key; sheet = false; menu = false; render(); $('m-main').scrollTop = 0; return; }
    if (q('[data-subback]')) { sub = null; render(); return; }
    if ((x = q('[data-layout]'))) { layout = x.dataset.layout as 'cards' | 'table'; try { localStorage.setItem('transly-m-layout', layout); } catch { /* private mode */ } render(); return; }
    if ((x = q('[data-cell]'))) { editCell(x); return; }
    if ((x = q('[data-scope]'))) { scope = x.dataset.scope as 'file' | 'all' | 'group'; page = 1; render(); return; }
    if ((x = q('[data-hit]'))) { store.open(x.dataset.hit!, x.dataset.hitkey!); if (scope === 'all') scope = 'file'; go('edit'); return; }
    if ((x = q('[data-scpick]'))) { scn.picked = x.dataset.scpick!; const y = $('m-main').scrollTop; render(); $('m-main').scrollTop = y; return; }
    if ((x = q('[data-scmode]'))) { scn.mode = x.dataset.scmode as typeof scn.mode; const y = $('m-main').scrollTop; render(); $('m-main').scrollTop = y; return; }
    if (q('[data-scedit]')) { store.select(scn.picked); sub = null; go('edit'); return; }
    if (q('[data-scenesend]') || q('[data-sceneappr]')) {
      const v = store.view(), c = store.current;
      if (v && c) {
        const units = sceneOf(v, c.unit.key).units, approve = !!q('[data-sceneappr]');
        // Sending takes the drafts (what is sent or approved already is not an error); approving takes every row with a translation.
        const todo = approve ? units : units.filter(u => store.entry(v.name, u.key)?.status === 'draft');
        if (!armed(todo.length, approve ? 'scene-appr' : 'scene')) return;
        const r = approve ? store.approveMany(v.name, todo, 'вичитано (вся сцена)') : store.sendMany(v.name, todo, 'scene');
        sayBulk(approve ? 'Вичитано' : 'Надіслано', r); buzz(14);
        // The line a QA error stopped is shown with its remark: the view goes to the first of them.
        if (r.blocked[0]) { scn.picked = r.blocked[0].key; render(); document.querySelector('.scn-box.cur')?.scrollIntoView({ block: 'center' }); return; }
        render();
      }
      return;
    }
    if ((x = q('[data-scstep]'))) { stepSceneBy(Number(x.dataset.scstep) as 1 | -1); return; }
    if (q('[data-dofind]')) { fr.matches = store.find({ find: fr.find, replace: fr.replace, caseSensitive: fr.cs, wholeWord: fr.word }); if (!fr.find) say('Вкажіть, що шукати', true); else if (!fr.matches.length) say('Нічого не знайдено'); render(); return; }
    if (q('[data-doreplace]')) { const r = store.replaceAll(fr.matches, fr.appr); fr.matches = []; say(r.message, false, r.batch); buzz(14); render(); return; }
    if (q('[data-tsopen]')) { if (ts.change) { ts.res = store.planTermSync(ts.change); ts.on = new Map(ts.res.proposals.map(p => [tsId(p), p.tick])); ts.pick = new Map(); ts.shown = 40; ts.pending = 0; sub = 'termsync'; sheet = false; menu = false; render(); $('m-main').scrollTop = 0; } return; }
    if (q('[data-tsdismiss]')) { ts.pending = 0; render(); return; }
    if (q('[data-tsfind]')) {
      const en = $<HTMLSelectElement>('ts-term').value, old = $<HTMLInputElement>('ts-old').value.trim(), term = store.saved.terms.find(y => y.en === en);
      ts.term = en; ts.old = old;
      if (!term || !old) { say('Вкажіть, яким був старий переклад', true); return; }
      if (old.toLowerCase() === term.uk.trim().toLowerCase()) { say('Старий і новий переклад однакові', true); return; }
      const change = { en, old: [old], next: term.uk.trim() }, res = store.planTermSync(change);
      if (!res.total) { say(`Рядків зі старою формою «${old}» не знайдено`); return; }
      ts.change = change; ts.res = res; ts.on = new Map(res.proposals.map(p => [tsId(p), p.tick])); ts.pick = new Map(); ts.shown = 40; render(); $('m-main').scrollTop = 0; return;
    }
    if (q('[data-tsmore]')) { ts.shown += 40; const y = $('m-main').scrollTop; render(); $('m-main').scrollTop = y; return; }
    if (q('[data-tsback]')) { ts.res = null; ts.change = null; render(); return; }
    if (q('[data-tsgo]')) {
      const res = ts.res; if (!res) return;
      const r = store.applyTermSync(res.proposals.filter(p => ts.on.get(tsId(p))).map(p => ({ proposal: p, choice: ts.pick.get(tsId(p)) ?? [] })));
      say(r.n ? `Оновлено за глосарієм: ${plural(r.n, ['рядок', 'рядки', 'рядків'])}${r.skipped ? `. Вичитаних пропущено: ${r.skipped}` : ''}` : r.skipped ? `Вичитаних пропущено: ${r.skipped}, нічого не оновлено` : 'Нічого оновлювати: рядки вже змінено', !r.n, r.batch); buzz(14);
      ts.res = null; ts.change = null; ts.pending = 0; sub = 'glossary'; render(); return;
    }
    if ((x = q('[data-lkkeep]'))) { const [ci, vi] = x.dataset.lkkeep!.split('|').map(Number); const c = store.linkClusters(60).clusters[ci!]; const v = c?.variants[vi!]; if (c && v) { const f = c.view.rows[0]!; const r = store.keepVariant(f.file, f.key, v.rows[0]!); say(r.n ? `Узгоджено рядків: ${r.n}` : 'Головний переклад обрано', false, r.batch); buzz(14); } render(); return; }
    if ((x = q('[data-lkfill]'))) { const c = store.linkClusters(60).clusters[Number(x.dataset.lkfill)]; if (c) { const f = c.view.rows[0]!; const r = store.fillLinked(f.file, f.key); say(`Заповнено рядків: ${r.n}`, false, r.batch); buzz(14); } render(); return; }
    if ((x = q('[data-lkopen]'))) { const c = store.current; const row = c && store.linkView(c.file, c.unit.key)?.rows[Number(x.dataset.lkopen)]; if (row) { store.open(row.file, row.key); render(); $('m-main').scrollTop = 0; } return; }
    if ((x = q('[data-lkunlink]'))) { const c = store.current; const row = c && store.linkView(c.file, c.unit.key)?.rows[Number(x.dataset.lkunlink)]; if (row) { store.unlinkRow(row); say('Рядок відв’язано'); render(); } return; }
    if ((x = q('[data-lkrelink]'))) { const c = store.current; const row = c && store.linkView(c.file, c.unit.key)?.rows[Number(x.dataset.lkrelink)]; if (row) { store.relinkRow(row); say('Рядок знову зв’язано'); render(); } return; }
    if ((x = q('[data-lkmain]'))) { const c = store.current; const row = c && store.linkView(c.file, c.unit.key)?.rows[Number(x.dataset.lkmain)]; if (row) { store.setMainRow(row); const n = store.linkPlan(c!.file, c!.unit.key); const k = n ? n.fills.length + n.updates.length + n.edited.length : 0; say(k ? `Головний переклад обрано. Інших рядків: ${k}` : 'Головний переклад обрано'); render(); } return; }
    if ((x = q('[data-lkclear]'))) { const c = store.current; const row = c && store.linkView(c.file, c.unit.key)?.rows[Number(x.dataset.lkclear)]; if (row) { store.clearMainRow(row.source); say('Головний переклад скинуто'); render(); } return; }
    if (q('[data-lkreview]')) { const c = store.current; if (c) { const plan = store.linkPlan(c.file, c.unit.key); lk.scope = { file: c.file, key: c.unit.key }; lk.off = new Set((plan?.edited ?? []).map(r => r.ref)); sub = 'consistency'; sheet = false; menu = false; render(); $('m-main').scrollTop = 0; } return; }
    if (q('[data-lkback]')) { lk.scope = null; render(); return; }
    if (q('[data-lkgo]')) { const sc = lk.scope; const plan = sc && store.linkPlan(sc.file, sc.key); if (plan?.view.reference) { const items = [...plan.fills, ...plan.updates, ...plan.edited].filter(r => !lk.off.has(r.ref)); const r = store.applyLinks(plan.view.reference.target, items); say(`Оновлено зв’язані рядки: ${r.n}`, false, r.batch); buzz(14); } lk.scope = null; render(); return; }
    if (q('[data-refpick]')) { refLang = ($<HTMLInputElement>('rf-lang').value || '').trim().toLowerCase(); if (!refLang) { say('Вкажіть код мови, наприклад ru або pl', true); return; } $<HTMLInputElement>('m-reffile').click(); return; }
    if ((x = q('[data-cat]'))) { const k = x.dataset.cat!; if (collapsedCats.has(k)) collapsedCats.delete(k); else collapsedCats.add(k); try { localStorage.setItem('transly-m-cats', JSON.stringify([...collapsedCats])); } catch { /* private mode */ } const l = document.getElementById('m-flist'); if (l) l.innerHTML = filesList(); return; }
    if (q('[data-termfile]')) { $<HTMLInputElement>('m-termfile').click(); return; }
    if (q('[data-termgo]')) { const r = store.importTermsText($<HTMLTextAreaElement>('i-terms').value); say(`Додано термінів: ${r.added}${r.rejected ? `, пропущено рядків без пари: ${r.rejected}` : ''}`, !r.added); render(); return; }
    if (q('[data-tmgo]')) { const r = store.importMemory($<HTMLTextAreaElement>('i-tm').value); say(`Імпортовано пар: ${r.added}${r.rejected ? `, пропущено рядків без табуляції: ${r.rejected}` : ''}`, !r.added); render(); return; }
    if (q('[data-plapply]')) { const d = store.setPluginCommands([...(plPick ?? [])]); plPick = null; say(d > 0 ? `Додано рядків із плагінів: ${d}` : d < 0 ? `Прибрано рядків із плагінів: ${-d}` : 'Рядків не змінилося'); render(); return; }
    if (q('[data-reset]')) { if (!resetArmed) { resetArmed = true; resetArmedAt = Date.now(); render(); setTimeout(() => { if (resetArmed) { resetArmed = false; if (sub === 'settings') render(); } }, 6000); return; } if (Date.now() - resetArmedAt < 1200) return; resetArmed = false; store.resetProject(); sub = null; say('Проєкт скинуто'); go('files'); render(); return; }
    if ((x = q('[data-srn]'))) { const r = store.searchAll(sq)[Number(x.dataset.srn)]; if (r) { sub = null; store.open(r.file, r.key); go('edit'); } return; }
    if ((x = q('[data-refdel]'))) { store.removeReference(x.dataset.refdel!); say(`Довідку ${x.dataset.refdel!.toUpperCase()} прибрано`); render(); return; }
    if (q('[data-spsave]')) { const n = store.setSpeakers(sp.draft); sp.draft.clear(); say(n ? `Мовців оновлено: ${n}` : 'Змін немає'); render(); return; }
    if (q('[data-fselect]')) { fsel = !fsel; fpicked.clear(); fmenu = false; render(); return; }
    if ((x = q('[data-fpick]'))) { const f = x.dataset.fpick!; if (fpicked.has(f)) fpicked.delete(f); else fpicked.add(f); fmenu = false; render(); return; }
    if (q('[data-fall]')) { if (fpicked.size === store.views.length) fpicked.clear(); else store.views.forEach(v => fpicked.add(v.name)); fmenu = false; render(); return; }
    if (q('[data-fgroup]')) { fmenu = !fmenu; renderKeep(); return; }
    if ((x = q('[data-fplace]'))) {
      const id = x.dataset.fplace!, files = [...fpicked];
      store.placeFiles(files, id || null);
      say(id ? `${plural(files.length, ['файл', 'файли', 'файлів'])} → «${store.groupsList().find(g => g.id === id)?.name ?? ''}»` : 'Прибрано з групи');
      fsel = false; fmenu = false; fpicked.clear(); render(); return;
    }
    if (q('[data-gnew]')) { gcreating = !gcreating; render(); if (gcreating) document.getElementById('g-name')?.focus(); return; }
    if ((x = q('[data-gfold]'))) { const id = x.dataset.gfold!; if (gopen.has(id)) gopen.delete(id); else gopen.add(id); grename = null; gdel = null; gmore = null; renderKeep(); return; }
    if ((x = q('[data-gsend]'))) { sayBulk('Надіслано', store.sendGroup(x.dataset.gsend!)); renderKeep(); return; }
    if ((x = q('[data-gmore]'))) { gmore = gmore === x.dataset.gmore ? null : x.dataset.gmore!; gdel = null; renderKeep(); return; }
    if ((x = q('[data-grows]'))) { scope = 'group'; gscope = x.dataset.grows!; page = 1; store.setQuery(''); go('rows'); return; }
    if ((x = q('[data-grename]'))) { grename = x.dataset.grename!; renderKeep(); document.getElementById('gr-ren')?.focus(); return; }
    if ((x = q('[data-gcolor]'))) {
      const id = x.dataset.gcolor!, g = store.groupsList().find(y => y.id === id), cs = store.groupColors;
      if (g) store.recolorGroup(id, cs[(cs.indexOf(g.color ?? '') + 1) % cs.length]!);
      renderKeep(); return;
    }
    if ((x = q('[data-gdel]'))) {
      const id = x.dataset.gdel!;
      if (gdel !== id) { gdel = id; renderKeep(); setTimeout(() => { if (gdel === id) { gdel = null; if (tab === 'files') render(); } }, 4000); return; }
      gdel = null; const name = store.groupsList().find(y => y.id === id)?.name ?? '';
      store.removeGroup(id); if (gscope === id) { scope = 'file'; gscope = null; } gmore = null; say(`Групу «${name}» видалено; файли лишилися`); renderKeep(); return;
    }
    if ((x = q('[data-file]'))) { store.open(x.dataset.file!); go('rows'); return; }
    if ((x = q('[data-filter]'))) { store.setFilter(x.dataset.filter as Filter); render(); return; }
    if (q('[data-more]')) { page++; const y = $('m-main').scrollTop; render(); $('m-main').scrollTop = y; return; }
    if (q('[data-select]')) { selecting = !selecting; picked.clear(); if (selecting) hintOnce(); render(); return; }
    if ((x = q('[data-pickkey]'))) { const k = x.dataset.pickkey!; if (picked.has(k)) picked.delete(k); else picked.add(k); render(); return; }
    if (q('[data-selall]')) { const all = store.rows(); if (picked.size === all.length) picked.clear(); else all.forEach(u => picked.add(u.key)); render(); return; }
    if (q('[data-seltm]')) {
      const v = store.view(); if (!v) return; const us = v.units.filter(u => picked.has(u.key));
      buzz(14); picked.clear(); say('Підставляю з пам’яті…');
      void store.memoryFill(v.name, us).then(r => { say(r.n ? `З пам’яті: ${r.n}` : 'Збігів від 70% для порожніх вибраних рядків немає', !r.n, r.batch); render(); });
      render(); return;
    }
    if (q('[data-selsend]') || q('[data-selappr]') || q('[data-selclear]') || q('[data-selcopy]')) {
      const v = store.view(); if (!v) return; const us = v.units.filter(u => picked.has(u.key));
      if (q('[data-selsend]')) { if (!armed(us.length, 'sel')) return; sayBulk('Надіслано', store.sendMany(v.name, us)); }
      else if (q('[data-selappr]')) { if (!armed(us.length, 'sel-appr')) return; sayBulk('Вичитано', store.approveMany(v.name, us)); }
      else if (q('[data-selclear]')) { if (!confirmTap(q('[data-selclear]')!, `Очистити ${us.length}?`)) return; const r = store.clearMany(v.name, us); say(`Очищено: ${r.n}`, false, r.batch); }
      else { const r = store.copyMany(v.name, us); say(`Скопійовано оригінал: ${r.n}`, false, r.batch); }
      buzz(14); picked.clear(); render(); return;
    }
    if ((x = q('[data-key]'))) { openRow(x.dataset.key!); return; }
    if ((x = q('[data-step]'))) { step(Number(x.dataset.step) as 1 | -1); return; }
    if ((x = q('[data-cm]'))) {
      const id = x.dataset.cid ?? '', val = (sel: string): string => (document.querySelector<HTMLTextAreaElement>(sel)?.value ?? '').trim();
      switch (x.dataset.cm) {
        case 'reply': cmReply = id; cmEdit = null; renderSheet(); document.getElementById('m-cmreply')?.focus(); return;
        case 'edit': cmEdit = id; cmReply = null; renderSheet(); document.getElementById('m-cmedit')?.focus(); return;
        case 'cancel': cmReply = cmEdit = null; renderSheet(); return;
        case 'send-reply': { const text = val('#m-cmreply'); if (!text) { say('Напишіть відповідь', true); return; } cmReply = null; store.reply(id, text); buzz(8); renderSheet(); renderChrome(); return; }
        case 'save-edit': { const text = val('#m-cmedit'); if (!text) { say('Коментар не може бути порожнім. Щоб прибрати його, натисніть «Видалити»', true); return; } cmEdit = null; store.editComment(id, text); renderSheet(); return; }
        case 'delete': if (cmDel !== id) { cmDel = id; renderSheet(); setTimeout(() => { if (cmDel === id) { cmDel = null; renderSheet(); } }, 4000); return; } cmDel = null; store.deleteComment(id); buzz(8); renderSheet(); renderChrome(); return;
        case 'resolve': case 'reopen': store.resolve(id, x.dataset.cm === 'resolve'); buzz(8); renderSheet(); renderChrome(); return;
      }
      return;
    }
    if ((x = q('[data-hv]'))) {
      const c = store.current; if (!c) return;
      const r = historyRows(c.entry?.history, c.entry?.target ?? '').find(y => y.index === Number(x!.dataset.i));
      const text = r ? (x.dataset.hv === 'before' ? r.before : r.rec.text) : '';
      if (!r || !text) return;
      store.restore(text, restoreNote(r.rec, x.dataset.hv === 'before' ? 'before' : 'text', fmtTime(r.rec.at)));
      say('Текст відновлено. Повернути попередній можна тут же, в історії'); buzz(10); render(); return;
    }
    // A term or a control code of the original opens its card; a tap that just misses one goes to the nearest within reach, not to nothing.
    {
      const hit = q('#m-source .th[data-term], #m-source .code[data-hk]') ?? nearestWord(e as MouseEvent);
      if (hit) { codeShown = hit.matches('.code') ? hit.dataset.hk ?? null : null; if (codeShown) { termShown = null; renderCodeCard(); } else showTermCard(hit.dataset.term!); return; }
    }
    if ((x = q('[data-cc]'))) { if (x.dataset.cc === 'insert' && codeShown) insert(codeShown); codeShown = null; renderTermCard(); return; }
    if ((x = q('[data-tc]'))) {
      const t0 = store.saved.terms.find(y => y.en === termShown);
      if (x.dataset.tc === 'insert' && t0) insert(t0.uk);
      else if (x.dataset.tc === 'edit' && t0) { Object.assign(gl, { en: t0.en, uk: t0.uk, alt: (t0.alt ?? []).join(', '), qa: t0.qa !== false, edit: true }); sub = 'glossary'; termShown = null; render(); return; }
      termShown = null; renderTermCard(); return;
    }
    if ((termShown || codeShown) && !q('#m-tcard')) { termShown = null; codeShown = null; renderTermCard(); }
    if (q('[data-send]')) {
      // the row to go on with is chosen before the send (with the filter «Чернетки» the sent row leaves the list)
      const nextBefore = store.neighbour(1);
      const r = store.send();
      if (r.why) { say(/^Є помилка QA/.test(r.why) ? 'Є помилка QA: виправте її під полем' : r.why, true); buzz(30); document.getElementById('m-issues')?.scrollIntoView({ block: 'nearest' }); return; }
      buzz(14);
      const next = nextBefore;
      if (next) { store.select(next.key); saySent(r, 'Надіслано'); render(); $('m-main').scrollTop = 0; } else { saySent(r, 'Це був останній рядок у списку'); render(); }
      return;
    }
    if (q('[data-queue]')) {
      const r = store.nextQueue('untranslated', 1);
      say(r ? `${QUEUE_LABEL.untranslated.title}: ${r.place} з ${r.total}` : QUEUE_LABEL.untranslated.empty, !r);
      if (r) { render(); $('m-main').scrollTop = 0; }
      return;
    }
    if (q('[data-copy]')) { const c = store.current; if (c) { ($('m-tr') as HTMLTextAreaElement).value = c.unit.source; store.write(c.unit.source); refreshMeta(); autosize(); } return; }
    if (q('[data-approve]')) {
      const r = store.approve();
      if (r.why) { say(/^Є помилка QA/.test(r.why) ? 'Є помилка QA: виправте її під полем' : r.why, true); document.getElementById('m-issues')?.scrollIntoView({ block: 'nearest' }); return; }
      say('Вичитано', false, r.batch); render(); return;
    }
    if (q('[data-rework]')) {
      const r = store.back();
      if (r.why) { say(r.why, true); return; }
      say('Повернено на доопрацювання', false, r.batch); render(); return;
    }
    if ((x = q('[data-clear]'))) {
      if (!confirmTap(x)) return;
      const c = store.current;
      if (c?.entry?.target) { const r = store.clearMany(c.file, [c.unit]); say('Переклад очищено', false, r.batch); }
      ($('m-tr') as HTMLTextAreaElement).value = ''; refreshMeta(); autosize(); return;
    }
    if ((x = q('[data-ins]'))) { insert(x.dataset.ins ?? ''); return; }
    if (q('[data-wrap]')) { const r = store.wrap(); if (r) { say('Рядки перенесено за шириною вікна', false, r.batch); render(); } else say('Рядки вже вміщаються'); return; }
    if ((x = q('[data-fix]'))) {
      const c = store.current, iss = c && store.issues(c.unit, c.entry).find(i => i.key === x!.dataset.fix);
      if (iss?.fix) { const t = $('m-tr') as HTMLTextAreaElement; t.value = iss.fix.text; t.dispatchEvent(new Event('input', { bubbles: true })); say('Виправлено'); }
      return;
    }
    if ((x = q('[data-unign]'))) { store.mutate((_f, _u, en) => setIgnored(en as NonNullable<typeof en>, x!.dataset.unign!, false, Date.now())); refreshMeta(); return; }
    if ((x = q('[data-fixall]'))) { const r = store.fixRule(x.dataset.fixall!); say(r.n ? `Виправлено рядків: ${r.n}${r.skipped ? `. Вичитаних пропущено: ${r.skipped}` : ''}` : r.skipped ? `Вичитаних пропущено: ${r.skipped}, нічого не виправлено` : 'Нічого виправляти: рядки вже без цієї помилки', false, r.batch); render(); return; }
    if ((x = q('[data-ign]'))) { store.mutate((_f, _u, en) => setIgnored(en as NonNullable<typeof en>, x!.dataset.ign!, true, Date.now())); refreshMeta(); return; }
    if (q('[data-gsave]')) {
      const v = (id: string): string => $<HTMLInputElement>(id).value;
      if (!store.saveTerm(v('g-en'), v('g-uk'), v('g-alt'), $<HTMLInputElement>('g-qa').checked)) { say('Заповніть оригінал і переклад', true); return; }
      const termNow = store.saved.terms.find(y => y.en.trim().toLowerCase() === v('g-en').trim().toLowerCase());
      const rowsNote = !gl.edit && termNow ? termRowsNote(termNow.en, rowsWithTerm(store.views, store.saved, termNow)) : '';
      say(gl.edit ? 'Термін змінено' : 'Термін додано'); if (rowsNote) say(rowsNote); buzz(10); Object.assign(gl, { en: '', uk: '', alt: '', qa: true, edit: false });
      const ch = store.lastTermChange, r = ch ? store.planTermSync(ch, 1) : null;
      if (ch && r?.total) { ts.change = ch; ts.pending = r.total; ts.res = null; say(`Знайдено ${plural(r.total, ['рядок', 'рядки', 'рядків'])} зі старою формою «${ch.old[0] ?? ''}»`); }
      render(); return;
    }
    if (q('[data-gcancel]')) { Object.assign(gl, { en: '', uk: '', alt: '', qa: true, edit: false }); render(); return; }
    if ((x = q('[data-gedit]'))) { const t = store.saved.terms.find(y => y.en === x!.dataset.gedit); if (t) { Object.assign(gl, { en: t.en, uk: t.uk, alt: (t.alt ?? []).join(', '), qa: t.qa !== false, edit: true }); render(); $('m-main').scrollTop = 0; } return; }
    if ((x = q('[data-tdel]'))) { store.removeTerm(x.dataset.tdel!); say('Термін видалено'); render(); return; }
    if ((x = q('[data-actopen]'))) { const k = x.dataset.actopen!; if (act.open.has(k)) act.open.delete(k); else act.open.add(k); const y = $('m-main').scrollTop; render(); $('m-main').scrollTop = y; return; }
    if ((x = q('[data-undojournal]'))) { const r = store.undoJournalBatch(x.dataset.undojournal!); say(r.done ? undoReport(r) : 'Рядки вже змінено: скасувати нічого', !r.done); buzz(14); render(); return; }
    if ((x = q('[data-undoauto]'))) { const [at, kind] = x.dataset.undoauto!.split('|'); const n = store.undoAutoFill(Number(at), kind!); say(n ? `Скасовано: ${plural(n, ['рядок', 'рядки', 'рядків'])}` : 'Нічого скасовувати', !n); buzz(14); render(); return; }
    if ((x = q('[data-undosend]'))) { const [at, kind, g] = x.dataset.undosend!.split('|'); const n = store.undoSend(Number(at), kind!, g === '1'); say(n ? `Скасовано: ${plural(n, ['рядок', 'рядки', 'рядків'])}` : 'Нічого скасовувати', !n); buzz(14); render(); return; }
    if ((x = q('[data-afterm]'))) { const [w, v] = x.dataset.afterm!.split('|'); if (store.saveTerm(w!, v!, '', true)) { say('Термін додано: ' + w + ' - ' + v); buzz(10); } render(); return; }
    if ((x = q('[data-afnew]'))) { Object.assign(gl, { en: x.dataset.afnew!, uk: '', alt: '', qa: true, edit: false }); sub = 'glossary'; render(); $('m-main').scrollTop = 0; return; }
    if (q('[data-afall]')) { const list = store.autofill(); const allOn = list.every(p => !af.off.has(p.file + '|' + p.key)); if (allOn) list.forEach(p => af.off.add(p.file + '|' + p.key)); else af.off.clear(); const y = $('m-main').scrollTop; render(); $('m-main').scrollTop = y; return; }
    if ((x = q('[data-afk]'))) { const k = x.dataset.afk!; if (af.off.has(k)) af.off.delete(k); else af.off.add(k); const y = $('m-main').scrollTop; render(); $('m-main').scrollTop = y; return; }
    if (q('[data-afapply]')) { const r = store.applyAutofill(store.autofill().filter(p => !af.off.has(p.file + '|' + p.key))); af.off.clear(); say(`Вписано рядків: ${r.n}`, false, r.batch); buzz(14); render(); return; }
    if (q('[data-gadd]')) { const c = store.current; gl.en = c && c.unit.source.length <= 40 ? c.unit.source : ''; gl.uk = ''; gl.edit = false; sheet = false; sub = 'glossary'; render(); return; }
    if ((x = q('[data-gk]'))) { gk = x.dataset.gk as typeof gk; renderSheet(); return; }
    if ((x = q('[data-stab]'))) { sheetTab = x.dataset.stab as typeof sheetTab; renderSheet(); return; }
    if (q('[data-menu]')) { menu = !menu; sheet = false; renderSheet(); renderChrome(); return; }
    if (q('[data-sheet]')) { sheet = !sheet; menu = false; renderSheet(); renderChrome(); return; }
    if (q('[data-close]')) { sheet = false; menu = false; renderSheet(); renderChrome(); return; }
    if ((x = q('[data-term]'))) { const c = store.current; const tm = c ? store.terms(c.unit)[Number(x.dataset.term)] : null; if (tm) { sheet = false; renderSheet(); insert(tm.uk); } return; }
    if ((x = q('[data-tm]'))) { const c = store.current; const m = c ? store.suggestions(c.unit, c.entry)[Number(x.dataset.tm)] : null; if (m) { sheet = false; renderSheet(); ($('m-tr') as HTMLTextAreaElement).value = m.t; store.write(m.t); refreshMeta(); autosize(); } return; }
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
      // the file carries the mark of its own making (a copy of the project now exists outside the browser)
      stamp(store.saved, 'copy', 'файл', Date.now()); store.persist();
      const blob = new Blob([JSON.stringify(store.saved)], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${store.saved.name || 'transly'}.transly.json`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
      return;
    }
  });
  root.addEventListener('submit', e => {
    const f = e.target as HTMLElement;
    if (f.matches('[data-gcreateform]')) {
      e.preventDefault();
      const g = store.addGroup($<HTMLInputElement>('g-name').value);
      if (!g) { say('Напишіть назву групи', true); return; }
      gcreating = false; gopen.add(g.id); say(`Групу «${g.name}» створено`); render(); return;
    }
    if (f.matches('[data-fnewform]')) {
      e.preventDefault();
      const g = store.addGroup($<HTMLInputElement>('fg-new').value);
      if (!g) { say('Напишіть назву групи', true); return; }
      const files = [...fpicked]; store.placeFiles(files, g.id); gopen.add(g.id);
      say(`${plural(files.length, ['файл', 'файли', 'файлів'])} → «${g.name}»`); fsel = false; fmenu = false; fpicked.clear(); render(); return;
    }
    if (f.matches('[data-grsave]')) {
      e.preventDefault();
      const r = store.renameGroup(f.dataset.grsave!, $<HTMLInputElement>('gr-ren').value);
      if (r === 'exists') say('Група з такою назвою вже є', true); else if (r === 'empty') say('Напишіть назву групи', true); else grename = null;
      render(); return;
    }
    if (!f.matches('[data-cmform]')) return; e.preventDefault();
    const ta = $<HTMLTextAreaElement>('m-cm'); const text = ta.value.trim(); if (!text) return;
    store.comment(text); buzz(8); renderSheet(); renderChrome();
  });
  root.addEventListener('input', e => {
    const t = e.target as HTMLElement;
    if (t.id === 'sr-q') { sq = (t as HTMLInputElement).value; clearTimeout(srTimer); srTimer = window.setTimeout(() => { const el = document.getElementById('sr-q') as HTMLInputElement | null; if (!el || sub !== 'search') return; const keep = el.selectionStart ?? 0; render(); const qi = document.getElementById('sr-q') as HTMLInputElement; qi.focus(); qi.setSelectionRange(keep, keep); }, 250); return; }
    if (t.id === 'f-find') fr.find = (t as HTMLInputElement).value;
    else if (t.id === 'f-rep') fr.replace = (t as HTMLInputElement).value;
    else if (t.id === 'scn-tr') { const v = store.view(); if (v && scn.picked) { store.writeAtQuiet(v.name, scn.picked, (t as HTMLTextAreaElement).value); clearTimeout(scnTimer); scnTimer = window.setTimeout(() => { const el = document.getElementById('scn-tr') as HTMLTextAreaElement | null; if (!el || sub !== 'scene') return; const keep = el.selectionStart; const y = $('m-main').scrollTop; render(); $('m-main').scrollTop = y; const e2 = document.getElementById('scn-tr') as HTMLTextAreaElement | null; if (e2) { e2.focus(); e2.setSelectionRange(keep, keep); } }, 500); } }
    else if (t.id === 'sp-q') { sp.q = (t as HTMLInputElement).value; const keep = (t as HTMLInputElement).selectionStart ?? 0; render(); const qi = document.getElementById('sp-q') as HTMLInputElement; qi.focus(); qi.setSelectionRange(keep, keep); }
    else if (t.classList.contains('m-spin')) sp.draft.set((t as HTMLInputElement).dataset.k!, (t as HTMLInputElement).value);
    else if (t.id === 's-tol') { const n = Number((t as HTMLInputElement).value); if (n >= 5 && n <= 100) { store.saved.settings.tolerancePct = n; store.saved.settingsAt = Date.now(); store.persist(); } }
    else if (t.id === 'ts-old') ts.old = (t as HTMLInputElement).value;
    else if (t.id === 'w-ex') { wp.text = (t as HTMLTextAreaElement).value; wrapPreview(); }
    else if (t.id.startsWith('w-')) applyWrapForm(false);
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
    if ((t as HTMLInputElement).dataset?.tspick !== undefined) { const p = ts.res?.proposals[Number((t as HTMLInputElement).dataset.tspick)]; if (p) { ts.on.set(tsId(p), (t as HTMLInputElement).checked); const y = $('m-main').scrollTop; render(); $('m-main').scrollTop = y; } return; }
    if ((t as HTMLSelectElement).dataset?.tsalt !== undefined) { const [i, si] = (t as HTMLSelectElement).dataset.tsalt!.split('|').map(Number); const p = ts.res?.proposals[i!]; if (p) { const cur = ts.pick.get(tsId(p)) ?? []; cur[si!] = Number((t as HTMLSelectElement).value); ts.pick.set(tsId(p), cur); const y = $('m-main').scrollTop; render(); $('m-main').scrollTop = y; } return; }
    if (t.id === 'ts-term') { ts.term = (t as HTMLSelectElement).value; ts.old = ''; render(); return; }
    if ((t as HTMLInputElement).dataset?.lkpick !== undefined) { const sc = lk.scope, plan = sc && store.linkPlan(sc.file, sc.key), r = plan && [...plan.fills, ...plan.updates, ...plan.edited][Number((t as HTMLInputElement).dataset.lkpick)]; if (r) { if ((t as HTMLInputElement).checked) lk.off.delete(r.ref); else lk.off.add(r.ref); const y = $('m-main').scrollTop; render(); $('m-main').scrollTop = y; } return; }
    if ((t as HTMLSelectElement).dataset?.lvl) { store.setQa(withRuleLevel(store.saved.settings.qa, (t as HTMLSelectElement).dataset.lvl!, (t as HTMLSelectElement).value as RuleSeverity)); const y = $('m-main').scrollTop; render(); $('m-main').scrollTop = y; return; }
    if (t.id === 'qr-apos') { store.setQa({ ...(store.saved.settings.qa ?? {}), apostrophe: (t as HTMLSelectElement).value as QaSettings['apostrophe'] }); return; }
    if (t.id === 'qr-keep') { store.setQa({ ...(store.saved.settings.qa ?? {}), keep: keepFromText((t as HTMLTextAreaElement).value) }); return; }
    if (t.id === 'scn-real') { scn.real = (t as HTMLInputElement).checked; const y = $('m-main').scrollTop; render(); $('m-main').scrollTop = y; return; }
    if (t.id === 'f-word') fr.word = (t as HTMLInputElement).checked;
    else if (t.id === 'f-case') fr.cs = (t as HTMLInputElement).checked;
    else if (t.id === 'f-appr') { fr.appr = (t as HTMLInputElement).checked; render(); }
    else if (t.id === 's-block') { store.saved.settings.blockErrors = (t as HTMLInputElement).checked; store.saved.settingsAt = Date.now(); store.persist(); }
    else if (t.id === 's-link') { const m = (t as HTMLSelectElement).value as LinkMode; store.saved.settings.linkMode = m; store.saved.settings.propagate = m !== 'off'; store.saved.settingsAt = Date.now(); store.persist(); }
    else if (t.id === 'w-face') { wp.face = (t as HTMLInputElement).checked; wrapPreview(); }
    else if (t.id.startsWith('w-') && t.id !== 'w-ex') applyWrapForm(true);
    else if ((t as HTMLInputElement).name?.startsWith('w-')) applyWrapForm(true);
    if ((t as HTMLInputElement).dataset?.pl !== undefined) { const c = t as HTMLInputElement; if (c.checked) plPick?.add(c.dataset.pl!); else plPick?.delete(c.dataset.pl!); return; }
    if (t.id === 'm-termfile') { const f = (t as HTMLInputElement).files?.[0]; (t as HTMLInputElement).value = ''; if (f) void f.text().then(text => { const r = store.importTermsFile(f.name, text, $<HTMLInputElement>('i-termqa')?.checked ?? false); say(r ? `Додано термінів: ${r.added}${r.merged ? `, доповнено варіантами: ${r.merged}` : ''}${r.skipped ? `, пропущено рядків: ${r.skipped}` : ''}` : 'У файлі не знайдено термінів: потрібна колонка «Оригінал» і хоча б одна «Переклад»', !r); render(); }).catch(() => say('Не вдалося прочитати файл', true)); return; }
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
    if (isAf(el)) { if (on) af.off.delete(k); else af.off.add(k); el.classList.toggle('sel', on); el.setAttribute('aria-checked', String(on)); }
    else { if (on) picked.add(k); else picked.delete(k); el.classList.toggle('picked', on); el.setAttribute('aria-pressed', String(on)); }
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
  const hintOnce = (): void => { if (!hinted) { hinted = true; say('Торкайтеся рядків або ведіть пальцем по лівому краю, щоб вибрати кілька'); } };
  /** Start selecting: the card under the finger flips, and every card the finger passes gets the same state. */
  function startDrag(card: HTMLElement, x: number, y: number): void {
    lpFired = true; buzz(18);
    if (!isAf(card)) { selecting = true; hintOnce(); }
    const add = !isOn(card);
    paint(card, add);
    drag = { add, last: -1, x, y, raf: 0 };
    drag.raf = requestAnimationFrame(dragLoop);
  }
  const GUT = '.m-edge';
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
    const bar = document.querySelector<HTMLElement>('.m-afbar, .m-searchbar');
    topBtn.style.bottom = bar ? `${navBottom() + bar.offsetHeight + 12}px` : '';
  };
  mainEl.addEventListener('scroll', updateTop, { passive: true });
  /** The height the navigation takes at the bottom (it is a rail on the left in landscape, and then takes none). */
  function navBottom(): number { const n = $('m-nav').getBoundingClientRect(); return n.width > n.height ? n.height : 0; }
  const setBarH = (): void => { document.documentElement.style.setProperty('--bar-h', $('m-bar').offsetHeight + 'px'); };
  window.addEventListener('resize', setBarH);
  topBtn.addEventListener('click', () => mainEl.scrollTo({ top: 0, behavior: 'smooth' }));
  new MutationObserver(updateTop).observe(mainEl, { childList: true });
  /** The field the translator writes in stays in sight above the action bar when the keyboard opens or the screen changes size. */
  const WRITE = '#m-tr, #scn-tr, .m-cell, #m-q';
  const showField = (t: Element | null, block: ScrollLogicalPosition): void => { if (t && t.matches(WRITE)) (t as HTMLElement).scrollIntoView({ block, behavior: 'auto' }); };
  document.addEventListener('focusin', e => {
    const t = e.target as HTMLElement;
    if (t.matches(TEXTY)) $('m-app').classList.add('kb');
    // The keyboard takes a moment to come up: bring the field into the middle once it has.
    if (t.matches(WRITE)) setTimeout(() => { if (document.activeElement === t) showField(t, 'center'); }, 260);
  });
  window.visualViewport?.addEventListener('resize', () => showField(document.activeElement, 'nearest'));
  // Landscape brings the table and the side rail; a turn back takes them away. Nothing is redrawn while the keyboard is up (a redraw would drop the field).
  wide.addEventListener('change', () => { if (!$('m-app').classList.contains('kb')) render(); });
  document.addEventListener('focusout', () => { setTimeout(() => { if (!document.activeElement?.matches(TEXTY)) $('m-app').classList.remove('kb'); }, 120); });
  // A swipe across the editor moves to the next / previous row.
  let sx = 0, sy = 0, st = 0, sw = false;
  root.addEventListener('touchstart', e => { sw = (tab === 'edit' || sub === 'scene') && e.touches.length === 1 && !(e.target as HTMLElement).closest('textarea, button, input, .m-sheet, .m-menu, #m-tcard'); if (sw) { sx = e.touches[0]!.clientX; sy = e.touches[0]!.clientY; st = Date.now(); } }, { passive: true });
  root.addEventListener('touchend', e => { if (!sw) return; sw = false; const c = e.changedTouches[0]!, dx = c.clientX - sx, dy = c.clientY - sy; if (Date.now() - st < 700 && Math.abs(dx) > 80 && Math.abs(dy) < Math.abs(dx) / 2) { if (sub === 'scene') stepSceneBy(dx < 0 ? 1 : -1); else step(dx < 0 ? 1 : -1); } }, { passive: true });
  window.addEventListener('pagehide', () => void store.flush());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') void store.flush(); });
  // What the Android shell calls: the back button (close the sheet, then one screen up), saving on leaving, a row opened from the widget.
  Object.assign(window, {
    __back: (): boolean => { if (sub) { sub = null; render(); return true; } if (sheet || menu) { sheet = false; menu = false; renderSheet(); renderChrome(); return true; } if (tab === 'edit') { go('rows'); return true; } if (tab === 'rows' || tab === 'more') { go('files'); return true; } return false; },
    __flush: (): Promise<void> => store.flush(),
    __widgetAction: (action: string, file: string, key: string): string => widgetAction(action, file, key),
    __open: (file: string, key: string): void => { if (store.view(file)) { store.open(file, key); go('edit'); } },
  });
  // Quietly look for a new version a few seconds after the start.
  if (canUpdate()) setTimeout(() => { const cfg = loadUpdateCfg(); if (!cfg.auto || !cfg.token) return; checkUpdate(cfg).then(c => { if (c.newer && c.release.sha !== cfg.skipped) { upd = c; say('Доступна нова версія: відкрийте «Ще» → «Оновлення»'); } }).catch(() => undefined); }, 4000);

  render();
}
