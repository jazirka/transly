import { Autosave, DupIndex, GameNameIndex, buildUsage, sysNamesOf, activeIssues, autoLineLimit, displayLength, edit, emptyProject, labelsOf, lengthDeviation, limitFor, note, pluginCandidates, propagate, readGame, reconcile, snapshotOf, speakerOf, statsOf, submit, viewsFromSnapshot, wrapLines } from '../core';
import type { Entry, GameFile, SavedProject, Unit } from '../core';
import { openBuild } from './build-dialog';
import { dataDirOf, isDesktop, rememberedGameDir, reopenGameDirDesktop } from './desktop';
import { $, el, esc, plural, toast } from './dom';
import { FOCUS_HTML, SIDE_HTML, focusClick, focusInput, renderFocus, renderGlossary, renderSidePanel, send, sideClick, step } from './focus';
import { pickGameFolder, readFiles, reopenHandle } from './folder';
import type { DirHandle, PickedFile } from './folder';
import { IdbStore, loadHandle, saveHandle } from './idb';
import { openImport } from './import-dialog';
import { openScene } from './scene-dialog';
import { autoCheck } from './updates';
import { openConsistency, openFindReplace } from './tools-dialogs';
import { openPluginTexts } from './plugins-dialog';
import { markup } from './markup';
import { openSettings } from './settings';
import { openSpeakers } from './speakers-dialog';
import { STATUS_LABEL, buildTm, shownStatus } from './state';
import type { Ctx, Filter, Mode, State } from './state';
import { publishWidget } from './android';
import { artifactDb, describeClaude, loadClaudeConfig, runClaudeSync } from './claude';
import { describeGithub, githubConfigured, loadGithubConfig, runGithubSync } from './github';
import { describe as describeSync, loadSyncConfig, runSync, syncConfigured } from './sync';
import { initResize, initRightResize } from './resize';

const SVG = {
  files: '<svg viewBox="0 0 16 16"><path d="M2 4.5h4l1.2 1.5H14V12.5H2z"/></svg>',
  rows: '<svg viewBox="0 0 16 16"><path d="M3 4h10M3 8h10M3 12h10"/></svg>',
  both: '<svg viewBox="0 0 16 16"><rect x="2.5" y="2.5" width="11" height="11" rx="1.5"/><path d="M2.5 8h11"/></svg>',
  menu: '<svg viewBox="0 0 16 16"><path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11"/></svg>',
  search: '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/></svg>',
  searchBig: '<svg viewBox="0 0 16 16"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/></svg>',
  keys: '<svg viewBox="0 0 16 16"><rect x="1.5" y="3.5" width="13" height="9" rx="1.8"/><path d="M4.2 6.5h.01M6.7 6.5h.01M9.3 6.5h.01M11.8 6.5h.01M4.5 9.5h7"/></svg>',
  gear: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="2"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4"/></svg>',
  play: '<svg viewBox="0 0 16 16"><path d="M4.5 2.5l9 5.5-9 5.5z" fill="currentColor" stroke="none"/></svg>',
  folder: '<svg viewBox="0 0 16 16"><path d="M2 4.5h4l1.2 1.5H14V12.5H2z"/><path d="M8 8v3M6.5 9.5h3"/></svg>',
  import: '<svg viewBox="0 0 16 16"><path d="M8 2.5v7M5 6.5l3 3 3-3M2.5 11v2h11v-2"/></svg>',
  build: '<svg viewBox="0 0 16 16"><path d="M2.5 9l2-4.5h7L13.5 9v3h-11z"/><circle cx="5.5" cy="12" r="1"/><circle cx="10.5" cy="12" r="1"/></svg>',
  panelL: '<svg viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="10" rx="2"/><path d="M6 3v10"/></svg>',
  panelR: '<svg viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="10" rx="2"/><path d="M10 3v10"/></svg>',
  cmt: '<svg class="cmi" viewBox="0 0 16 16" aria-label="Є коментарі"><path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z"/></svg>',
};

const FILTERS: [Filter, string][] = [['all', 'Усі'], ['new', 'Без перекладу'], ['draft', 'Чернетки'], ['done', 'Чекають вичитування'], ['qa', 'Проблеми'], ['cm', 'З коментарями']];
const LEN_LABEL = { far: 'далеко від оригіналу', longer: 'довші за оригінал', shorter: 'коротші за оригінал' } as const;
const FORMAT_LABEL: Record<string, string> = { json: 'RPG Maker MV · UTF-8', po: 'gettext · UTF-8', pot: 'gettext · UTF-8', csv: 'CSV · UTF-8', tsv: 'TSV · UTF-8', rpy: 'Ren’Py · UTF-8' };

const SHELL = `<div class="scroll-x"><div class="ide mode-table lp-open" id="ide">
  <header class="topbar">
    <div class="logo">T</div>
    <button class="tb-ic" id="hamb" title="Головне меню" aria-haspopup="menu" aria-expanded="false">${SVG.menu}</button>
    <nav class="menubar" id="menubar" role="menubar" aria-label="Головне меню" hidden></nav>
    <button class="tpill" id="proj-btn" title="Налаштування проєкту"><span class="pj">T</span><span id="proj-name">Проєкт</span></button>
    <div class="seg" id="seg" role="tablist" aria-label="Режим">
      <button role="tab" aria-selected="true" data-m="table" class="on"><svg viewBox="0 0 16 16"><path d="M2.5 3.5h11v9h-11zM2.5 7h11M6.5 3.5v9"/></svg>Таблиця</button>
      <button role="tab" aria-selected="false" data-m="edit"><svg viewBox="0 0 16 16"><path d="M2.5 3.5h11v9h-11zM6 3.5v9M6 8h7.5"/></svg>Редагування</button>
    </div>
    <button class="tpill stage" id="stage-pill" aria-pressed="false" title="Вичитування: перегляд рядків, що чекають перевірки, і схвалення"><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5l3 3 7-7"/></svg>Вичитування</button>
    <div class="grow"></div>
    <div class="prog" id="pg" title=""><div class="bar"><i class="a" id="pg-a"></i><i class="b" id="pg-b"></i><i class="c" id="pg-c"></i></div><span id="pg-txt" style="font-family:var(--mono);font-size:11.5px"></span></div>
    <div class="tsep"></div>
    <button class="tpill run" id="build" title="Зібрати переклад (F5)">${SVG.build}<span>Збірка</span></button>
    <button class="tb-ic play" id="run-btn" title="Зібрати й перевірити (F5)" aria-label="Зібрати й перевірити">${SVG.play}<span class="lbl">Грати</span></button>
    <div class="tsep"></div>
    <button class="tb-ic" id="open" title="Відкрити папку гри" aria-label="Відкрити папку гри">${SVG.folder}</button>
    <button class="tb-ic" id="sd-open" title="Знайти скрізь (⇧⇧)" aria-label="Знайти скрізь">${SVG.searchBig}</button>
    <button class="tb-ic" id="hk" title="Гарячі клавіші" aria-label="Гарячі клавіші">${SVG.keys}</button>
    <div class="tsep"></div>
    <button class="tb-ic" id="settings" title="Налаштування" aria-label="Налаштування">${SVG.gear}</button>
  </header>
  <header class="appbar">
    <button class="ab-ic" id="ab-left" aria-label="Файли й рядки" aria-pressed="false">${SVG.panelL}</button>
    <div class="abt"><b id="ab-title">Transly</b><small id="ab-sub"></small></div>
    <button class="chip on" id="ab-stage" title="Змінити етап"></button>
    <button class="ab-ic" id="ab-right" aria-label="Вказівки, глосарій, коментарі" aria-pressed="false">${SVG.panelR}</button>
    <button class="ab-ic" id="ab-set" aria-label="Налаштування">${SVG.gear}</button>
  </header>
  <div class="main">
    <nav class="strip" id="strip" aria-label="Бічні панелі">
      <button data-lp="files" class="on" title="Файли гри" aria-label="Файли гри">${SVG.files}</button>
      <hr class="ssep">
      <button data-lp="rows" title="Рядки файлу" aria-label="Рядки файлу">${SVG.rows}</button>
      <hr class="ssep">
      <button data-lp="both" title="Файли й рядки разом: панель ділиться навпіл" aria-label="Файли й рядки разом">${SVG.both}</button>
    </nav>
    <aside class="tree" id="lpanel" aria-label="Бічна панель: файли й рядки">
      <div class="mtabs" id="mtabs" role="group" aria-label="Бічна панель"><button data-lt="files">Файли</button><button data-lt="rows">Рядки</button><button class="ab-ic" id="mt-open" aria-label="Відкрити файли або вставити JSON" title="Відкрити файли або вставити JSON">${SVG.import}</button><button class="ab-ic" id="mt-search" aria-label="Пошук скрізь">${SVG.searchBig}</button></div>
      <div class="ph"><span class="grow" id="lp-title">Файли гри</span><span class="ico" id="lp-close" title="Сховати панель" role="button" aria-label="Сховати панель">—</span></div>
      <div class="treebody" id="tree"></div>
      <div class="rz rz-y" id="rz-y" role="separator" aria-orientation="horizontal" aria-label="Розділ між файлами й рядками" aria-valuemin="15" aria-valuemax="85" tabindex="0" title="Потягніть, щоб змінити співвідношення (подвійний клік — навпіл)" hidden></div>
      <div class="slist" id="lp-rows" hidden>
        <div class="fh"><div class="fin">${SVG.search}<input class="qin" id="q2" placeholder="Пошук рядків" aria-label="Пошук рядків"></div><div class="chips2"><span class="chipsHost" id="chips2"></span></div></div>
        <div class="sl-body" id="slist"></div>
      </div>
    </aside>
    <div class="rz rz-x" id="rz-x" role="separator" aria-orientation="vertical" aria-label="Ширина бічної панелі" aria-valuemin="200" aria-valuemax="640" tabindex="0" title="Потягніть, щоб змінити ширину (подвійний клік — стандартна)"></div>
    <main class="editor" id="main">
      <div class="tabs"><span class="tabs-host" id="tabs-host"></span></div>
      <div class="view" id="v-table">
        <div class="crumbs" id="crumbs"></div>
        <div class="filters"><div class="fin">${SVG.search}<input class="qin" id="q" placeholder="Фільтр у цьому файлі" aria-label="Фільтр"></div><span class="chipsHost" id="chips1"></span><span id="tagfilter"></span>
          <div class="r"><button class="chip" id="spkbtn">Мовець ▾</button><button class="chip" id="lenbtn">Довжина ▾</button></div></div>
        <div class="bulk" id="bulk"><b id="bulkn">0</b><span id="bulkt"></span><button id="bb-ok">Надіслати на вичитування</button><button id="bb-tm" title="Підставити збіг із пам’яті перекладів (від 70%) у порожні вибрані рядки">Застосувати з ПП</button><button id="bb-clear" class="ghost">Скасувати вибір</button></div>
        <div class="gridwrap"><div class="grid" id="grid" role="grid" aria-label="Рядки файлу"></div></div>
        <div class="legend-bar" aria-label="Умовні позначення"><span><i class="sd new"></i>без перекладу</span><span><i class="sd draft"></i>чернетка</span><span><i class="sd done"></i>чекає вичитування</span><span><i class="sd appr"></i>вичитано</span><span><i class="sd qa"></i>є проблема QA</span><span>${SVG.cmt}коментар</span></div>
      </div>
      <div class="view" id="v-focus">${FOCUS_HTML}</div>
    </main>
    ${SIDE_HTML}
  </div>
  <footer class="status">
    <span class="ok" id="sb-save"></span><span id="sb-fmt"></span><span id="sb-qa"></span><span id="st-sel"></span>
    <span id="sb-sync" class="sbtn" role="button" tabindex="0" title="Налаштування синхронізації"></span><span id="sb-build" class="sbtn" role="button" tabindex="0" title="Зібрати (F5)"></span>
    <div class="r"><span id="sb-file"></span><span id="sb-sess"></span></div>
  </footer>
</div></div>
<div class="scrim" id="scrim"></div>
<div class="pop" id="fpop" role="dialog" aria-label="Параметри" hidden></div>
<div class="pop keys" id="keypop" role="dialog" aria-label="Гарячі клавіші" hidden>
  <div class="kh">Гарячі клавіші</div>
  <div class="kr"><span>Відкрити рядок у редагуванні</span><kbd>Enter</kbd><kbd>2× клік</kbd></div>
  <div class="kr"><span>Наступний / попередній рядок</span><kbd>↓</kbd><kbd>↑</kbd></div>
  <div class="kr"><span>У редагуванні: наступний / попередній у списку</span><kbd>Alt</kbd><kbd>↓</kbd></div>
  <div class="kr"><span>Надіслати на вичитування / затвердити й далі</span><kbd>Ctrl</kbd><kbd>Enter</kbd></div>
  <div class="kr"><span>Змінити переклад у комірці таблиці</span><kbd>2× клік</kbd></div>
  <div class="kr"><span>Зібрати переклад</span><kbd>F5</kbd></div>
  <div class="kr"><span>Знайти скрізь</span><kbd>⇧</kbd><kbd>⇧</kbd></div>
  <div class="kr"><span>Закрити вікно чи меню</span><kbd>Esc</kbd></div>
</div>
<div class="sd-wrap" id="sd" hidden><div class="sd-box" role="dialog" aria-modal="true" aria-label="Пошук скрізь"><input id="sd-in" placeholder="Рядки, файли, терміни…" aria-label="Пошук скрізь" autocomplete="off"><div id="sd-res" role="listbox" aria-label="Результати"></div><div class="sd-foot">↑↓ вибір · Enter відкрити · Esc закрити</div></div></div>`;

export async function start(root: HTMLElement): Promise<void> {
  const store = new IdbStore('default');
  let saved: SavedProject;
  try { saved = (await store.load()) ?? emptyProject('Новий проєкт'); }
  catch { saved = emptyProject('Новий проєкт'); }
  const mq = matchMedia('(max-width: 760px)');
  const s: State = {
    views: [], game: [], saved, current: null, open: [], cur: null, mode: mq.matches ? 'edit' : 'table', filter: 'all', q: '', speaker: null, lenFilter: 'all',
    checked: new Set(), sideTab: 'hints', sideStack: false, sideCollapsed: false, saveOk: true, savedAt: null, who: saved.settings.who, phone: mq.matches,
    leftTab: { table: 'files', edit: 'rows', review: 'rows' }, leftOpen: !mq.matches, leftBoth: false, rightOpen: false, collapsed: new Set(), sess: { n: 0, t0: Date.now() }, lastBuild: null,
  };
  const fromSnapshot = viewsFromSnapshot(saved);
  if (fromSnapshot.length) { s.views = fromSnapshot; s.current = fromSnapshot[0]!.name; s.open = [s.current]; }
  let lastHandle: (DirHandle & { name: string }) | null = null;
  let dataDir: string | null = null;
  const desktopDir = isDesktop() ? rememberedGameDir() : null;
  try { lastHandle = (await loadHandle('default')) as typeof lastHandle; } catch { lastHandle = null; }
  const autosave = new Autosave(store, 400, ok => { s.saveOk = ok; if (ok) s.savedAt = Date.now(); renderStatus(); });
  let tmCache: ReturnType<typeof buildTm> | null = null;
  let unitMap = new Map<string, Unit>();
  let dupCache: { views: State['views']; idx: DupIndex } | null = null;

  const input = el('input');
  input.type = 'file'; input.hidden = true; input.id = 'folder-input';
  input.setAttribute('webkitdirectory', ''); input.setAttribute('aria-label', 'Папка гри');
  root.innerHTML = SHELL;
  root.appendChild(input);

  /** Longest line a message may have: the translator's number, or what the original's own lines suggest (0 = not checked). */
  let autoLimit: { views: State['views']; n: number } | null = null;
  const lineLimit = (): number => {
    const l = s.saved.settings.lineLimit;
    if (l < 0) return 0;
    if (l > 0) return l;
    if (!autoLimit || autoLimit.views !== s.views) autoLimit = { views: s.views, n: autoLineLimit(s.views) };
    return autoLimit.n;
  };
  let usageCache: { game: State['game']; u: ReturnType<typeof buildUsage> } | null = null;
  let namesCache: { views: State['views']; idx: GameNameIndex } | null = null;
  const qaOpts = () => ({ tolerancePct: s.saved.settings.tolerancePct, terms: s.saved.terms, lineLimit: lineLimit() });
  const ctx: Ctx = {
    s, autosave,
    entries: file => (s.saved.files[file] ??= {}),
    qaOpts, lineLimit,
    usage: () => { if (!usageCache || usageCache.game !== s.game) usageCache = { game: s.game, u: buildUsage(s.game, f => s.saved.labels?.[f]) }; return usageCache.u; },
    gameDir: () => dataDir,
    built: n => { s.lastBuild = { at: Date.now(), n }; renderTop(); },
    names: () => { if (!namesCache || namesCache.views !== s.views) namesCache = { views: s.views, idx: new GameNameIndex(s.views) }; return namesCache.idx; },
    speaker: u => speakerOf(u, s.saved.speakers),
    view: () => s.views.find(v => v.name === s.current) ?? null,
    unit: key => unitMap.get(key),
    visible: () => visibleUnits(true),
    tm: () => (tmCache ??= buildTm(s)),
    invalidateTm: () => { tmCache = null; },
    dups: () => { if (!dupCache || dupCache.views !== s.views) dupCache = { views: s.views, idx: new DupIndex(s.views) }; return dupCache.idx; },
    persist: () => autosave.queue(s.saved),
    render: () => renderAll(),
    select: (key, mode) => {
      s.cur = key;
      if (mode) setMode(mode, false);
      if (s.phone) { s.leftOpen = false; s.rightOpen = false; }
      renderAll();
      if (s.mode === 'table') document.querySelector<HTMLElement>(`.gr[data-key="${CSS.escape(key)}"]`)?.scrollIntoView({ block: 'nearest' });
      else { document.querySelector<HTMLElement>(`.si[data-key="${CSS.escape(key)}"]`)?.scrollIntoView({ block: 'nearest' }); $('#i-tr').focus(); }
    },
  };

  /* ---------- data helpers ---------- */
  const entryOf = (u: Unit): Entry | undefined => (s.current ? s.saved.files[s.current]?.[u.key] : undefined);
  /** Short key for the table: `msg[5]` for text, `choice[5.2]` for choice options, database keys as they are. */
  const shortKey = (key: string): string => {
    const c = /\.list\[(\d+)\]\.choice\[(\d+)\]$/.exec(key);
    if (c) return `choice[${c[1]}.${c[2]}]`;
    const pc = /\.list\[(\d+)\]\.cmd$/.exec(key);
    if (pc) return `plugin[${pc[1]}]`;
    const m = /\.list\[(\d+)\]$/.exec(key) ?? /^L(\d+)$/.exec(key);
    return m ? `msg[${m[1]}]` : key;
  };
  /** The game wraps text with hard line breaks; the table shows it as one paragraph. */
  const flow = (t: string): string => t.replace(/\n/g, ' ');
  const lenCls = (u: Unit, e: Entry | undefined): string => {
    if (!e?.target) return '';
    const d = Math.abs(lengthDeviation(u.source, e.target)), tol = s.saved.settings.tolerancePct;
    return d > tol ? 'over' : d > tol / 2 ? 'mid' : '';
  };
  const inContext = (u: Unit, e: Entry | undefined): boolean => {
    if (s.q) {
      const q = s.q.toLowerCase();
      if (!(u.source + ' ' + (e?.target ?? '') + ' ' + u.key + ' ' + ctx.speaker(u)).toLowerCase().includes(q)) return false;
    }
    if (s.speaker !== null && ctx.speaker(u) !== s.speaker) return false;
    if (s.lenFilter !== 'all') {
      if (!e?.target) return false;
      const d = lengthDeviation(u.source, e.target), tol = s.saved.settings.tolerancePct;
      if (s.lenFilter === 'far' ? Math.abs(d) <= tol : s.lenFilter === 'longer' ? d <= 0 : d >= 0) return false;
    }
    return true;
  };
  const matchesStatus = (u: Unit, e: Entry | undefined, f: Filter): boolean => {
    const st = shownStatus(ctx, u, e);
    switch (f) {
      case 'new': return (e?.status ?? 'new') === 'new';
      case 'draft': return e?.status === 'draft';
      case 'done': return e?.status === 'done';
      case 'appr': return e?.status === 'appr';
      case 'qa': return st === 'qa';
      case 'cm': return !!e?.comments?.length;
      default: return true;
    }
  };
  function visibleUnits(withStatus: boolean): Unit[] {
    const v = ctx.view();
    if (!v) return [];
    const ents = ctx.entries(v.name);
    return v.units.filter(u => inContext(u, ents[u.key]) && (!withStatus || matchesStatus(u, ents[u.key], s.filter)));
  }

  /* ---------- rendering ---------- */
  const lp = (): 'files' | 'rows' | null => (s.leftOpen ? s.leftTab[s.mode] : null);

  function renderLayout(): void {
    const ide = $('#ide');
    const l = lp();
    ide.className = `ide mode-${s.mode === 'table' ? 'table' : 'focus'} ${l ? 'lp-open' : 'lp-closed'}${s.phone ? ' sz-s' : ''}${s.rightOpen ? ' sheet-open' : ''}${s.sideCollapsed && !s.phone ? ' rp-collapsed' : ''}`;
    const both = !!l && s.leftBoth && !s.phone;
    $('#lpanel').classList.toggle('split', both);
    $('#rz-y').hidden = !both;
    document.querySelectorAll<HTMLElement>('#strip button').forEach(b => { const on = both ? b.dataset.lp === 'both' : b.dataset.lp === l; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
    $('#tree').hidden = !both && l !== 'files';
    $('#lp-rows').hidden = !both && l !== 'rows';
    $('#lp-title').textContent = both ? 'Файли й рядки' : l === 'rows' ? `Рядки · ${s.current ?? ''}` : 'Файли гри';
    document.querySelectorAll<HTMLElement>('#mtabs [data-lt]').forEach(b => { const on = b.dataset.lt === s.leftTab[s.mode]; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
    document.querySelectorAll<HTMLElement>('#seg [data-m]').forEach(b => { const on = b.dataset.m === s.mode || (s.mode === 'review' && b.dataset.m === 'edit'); b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
    $('#ab-left').setAttribute('aria-pressed', String(s.leftOpen));
    $('#ab-right').setAttribute('aria-pressed', String(s.rightOpen));
  }

  function treeNodes(): { t: 'd' | 'f'; d: number; name: string; label: string }[] {
    const out: { t: 'd' | 'f'; d: number; name: string; label: string }[] = [];
    const rpg = s.views.filter(v => !v.name.includes('/'));
    const others = s.views.filter(v => v.name.includes('/'));
    if (rpg.length) {
      out.push({ t: 'd', d: 0, name: 'data', label: 'data' });
      for (const v of rpg.filter(x => !/^Map\d+\.json$/.test(x.name))) out.push({ t: 'f', d: 1, name: v.name, label: v.name });
      const maps = rpg.filter(x => /^Map\d+\.json$/.test(x.name));
      if (maps.length) { out.push({ t: 'd', d: 1, name: 'data/maps', label: 'maps' }); for (const v of maps) out.push({ t: 'f', d: 2, name: v.name, label: v.name }); }
    }
    let prev: string[] = [];
    for (const v of others) {
      const parts = v.name.split('/');
      const dirs = parts.slice(0, -1);
      let i = 0;
      while (i < dirs.length && prev[i] === dirs[i]) i++;
      for (let k = i; k < dirs.length; k++) out.push({ t: 'd', d: k, name: dirs.slice(0, k + 1).join('/'), label: dirs[k]! });
      out.push({ t: 'f', d: dirs.length, name: v.name, label: parts[parts.length - 1]! });
      prev = dirs;
    }
    return out;
  }

  function fileIcon(name: string): [string, string] {
    if (/^Map\d+\.json$/.test(name)) return ['map', 'MAP'];
    if (name.endsWith('.json')) return ['json', '{}'];
    return ['gl', 'Aa'];
  }

  function renderTree(): void {
    const box = $('#tree');
    if (!s.views.length) { box.innerHTML = '<div class="msg-empty">Папку гри ще не відкрито</div>'; return; }
    let skip: number | null = null;
    box.innerHTML = treeNodes().map(n => {
      if (skip !== null && n.d > skip) return '';
      skip = null;
      if (n.t === 'd') {
        const c = s.collapsed.has(n.name);
        if (c) skip = n.d;
        return `<div class="node dir" style="--d:${n.d}" data-dir="${esc(n.name)}" role="button" tabindex="0" aria-expanded="${!c}"><span class="chev">${c ? '▸' : '▾'}</span><span class="ic dir">▤</span><span class="nm">${esc(n.label)}</span></div>`;
      }
      const v = s.views.find(x => x.name === n.name)!;
      const st = statsOf(v.units, s.saved.files[v.name] ?? {});
      const pc = Math.round(100 * st.approved / st.total);
      const [ic, lab] = fileIcon(n.name);
      const cur = n.name === s.current;
      return `<div class="node ${cur ? 'cur' : ''} ${!pc && !st.translated ? 'idle' : ''}" style="--d:${n.d}" data-file="${esc(n.name)}" role="button" tabindex="0" title="${cur ? 'Відкрито · ' : ''}${v.label ? esc(v.label) + ' · ' : ''}Вичитано ${pc}% · перекладено ${Math.round(100 * st.translated / st.total)}%"><span class="chev"></span><span class="ic ${ic}">${lab}</span><span class="nm">${v.label ? `${esc(v.label)}<span class="lc">${esc(n.label.replace(/\.json$/, ''))}</span>` : esc(n.label)}</span><span class="mini"><i class="${pc === 100 ? 'f' : ''}" style="width:${Math.max(pc, Math.round(100 * st.translated / st.total))}%"></i></span><span class="pc ${pc === 100 ? 'full' : ''}">${pc}%</span></div>`;
    }).join('');
  }

  function chipsHtml(): string {
    const v = ctx.view();
    if (!v) return '';
    const ents = ctx.entries(v.name);
    const ctxUnits = v.units.filter(u => inContext(u, ents[u.key]));
    const cnt = (f: Filter) => (f === 'all' ? ctxUnits.length : ctxUnits.filter(u => matchesStatus(u, ents[u.key], f)).length);
    return FILTERS.map(([f, l]) => `<button class="chip ${s.filter === f ? 'on' : cnt(f) === 0 && f !== 'all' ? 'zero' : ''}" data-filter="${f}" aria-pressed="${s.filter === f}">${l} <span class="n">${cnt(f)}</span></button>`).join('');
  }

  const tagFilterHtml = (): string => {
    const chip = (label: string, body: string, k: string) => `<span class="chip on tagf">${label} ${body} <span class="x" data-clear="${k}" title="Скинути" role="button" tabindex="0" aria-label="Скинути фільтр">✕</span></span>`;
    return (s.speaker !== null ? chip('Мовець:', `<b>${esc(s.speaker || '—')}</b>`, 'speaker') : '') + (s.lenFilter !== 'all' ? chip('Довжина:', `<b>${LEN_LABEL[s.lenFilter]}</b>`, 'len') : '');
  };

  function rowHtml(u: Unit, n: number): string {
    const e = entryOf(u), sel = u.key === s.cur, chk = s.checked.has(u.key);
    const st = shownStatus(ctx, u, e);
    const hits = enforced();
    const len = e?.target ? `${displayLength(e.target)}/${displayLength(u.source)}` : '—';
    return `<div class="gr ${sel ? 'sel' : ''} ${chk ? 'chk' : ''}" role="row" tabindex="${sel ? 0 : -1}" aria-selected="${sel}" data-key="${esc(u.key)}">
      <div class="ln" role="gridcell"><span class="num">${n}</span><input type="checkbox" class="rc" ${chk ? 'checked' : ''} aria-label="Вибрати рядок ${n}"></div>
      <div class="st" role="gridcell"><span class="sd ${st}" title="${STATUS_LABEL[st]}"></span><span class="vh">${STATUS_LABEL[st]}</span></div>
      <div role="gridcell"><span class="key" title="${esc(u.key)}">${esc(shortKey(u.key))}</span>${e?.comments?.length ? SVG.cmt : ''}</div>
      <div class="who" role="gridcell">${esc(ctx.speaker(u))}</div>
      <div class="src" role="gridcell">${markup(flow(u.source), hits)}</div>
      <div class="tr ${e?.target ? '' : 'empty'}" role="gridcell" title="Двічі клікніть, щоб редагувати тут">${e?.target ? markup(flow(e.target)) : 'не перекладено'}</div>
      <div class="len ${lenCls(u, e)}" role="gridcell" title="Символів у перекладі / в оригіналі">${len}</div></div>`;
  }
  let enforcedCache: { terms: SavedProject['terms']; en: string[] } | null = null;
  function enforced(): string[] {
    if (!enforcedCache || enforcedCache.terms !== s.saved.terms || enforcedCache.en.length !== s.saved.terms.filter(t => t.qa !== false).length) enforcedCache = { terms: s.saved.terms, en: s.saved.terms.filter(t => t.qa !== false).map(t => t.en) };
    return enforcedCache.en;
  }

  const siHtml = (u: Unit, n: number): string => {
    const e = entryOf(u), st = shownStatus(ctx, u, e);
    return `<div class="si ${u.key === s.cur ? 'sel' : ''}" data-key="${esc(u.key)}" role="button" tabindex="0"><span class="sd ${st}" title="${STATUS_LABEL[st]}"></span><div><div class="a"><span>${n}</span><b>${esc(ctx.speaker(u) || u.kind)}</b><span>${esc(shortKey(u.key))}</span>${e?.comments?.length ? SVG.cmt : ''}</div><div class="s">${esc(flow(u.source))}</div><div class="t">${e?.target ? esc(flow(e.target)) : '—'}</div></div></div>`;
  };
  const emptyHtml = '<div class="empty-state"><b>Нічого не знайдено</b><span>Немає рядків за поточним пошуком і статусом.</span><button class="btn" data-reset>Скинути фільтри</button></div>';

  function renderRowsList(): void {
    $('#chips2').innerHTML = chipsHtml();
    const v = ctx.view();
    if (!v) { $('#slist').innerHTML = '<div class="msg-empty">Оберіть файл</div>'; return; }
    const idx = new Map(v.units.map((u, i) => [u.key, i + 1]));
    const list = visibleUnits(true);
    $('#slist').innerHTML = list.length ? list.slice(0, 600).map(u => siHtml(u, idx.get(u.key)!)).join('') + (list.length > 600 ? `<div class="grid-note">Показано 600 із ${list.length}. Уточніть пошук.</div>` : '') : emptyHtml;
  }

  function renderTabs(): void {
    $('#tabs-host').innerHTML = s.open.map(n => {
      const v = s.views.find(x => x.name === n);
      if (!v) return '';
      const ents = s.saved.files[n] ?? {};
      let qa = 0;
      for (const u of v.units) { const e = ents[u.key]; if (e && e.target && activeIssues(u, e, qaOpts()).length) qa++; }
      const [ic, lab] = fileIcon(n);
      const on = n === s.current;
      return `<div class="tab ${on ? 'on' : ''}"><button class="tb" data-tab="${esc(n)}" aria-current="${on}" title="${esc(v.label ? n + ' · ' + v.label : n)}"><span class="tico ${ic === 'map' ? '' : 'j'}">${lab}</span>${esc(n.split('/').pop() ?? n)}${qa ? `<span class="badge" title="Проблеми QA у файлі">${qa}</span>` : ''}</button><button class="x" data-closetab="${esc(n)}" aria-label="Закрити вкладку ${esc(n)}">✕</button></div>`;
    }).join('');
  }

  function renderTable(): void {
    const v = ctx.view();
    const grid = $('#grid');
    $('#chips1').innerHTML = chipsHtml();
    $('#tagfilter').innerHTML = tagFilterHtml();
    ($('#q') as HTMLInputElement).value = s.q;
    if (!v) { grid.innerHTML = ''; return; }
    const idx = new Map(v.units.map((u, i) => [u.key, i + 1]));
    const list = visibleUnits(true);
    const ids = list.map(u => u.key);
    const nSel = ids.filter(k => s.checked.has(k)).length;
    const hasWho = v.units.some(u => ctx.speaker(u));
    grid.classList.toggle('no-who', !hasWho);
    grid.style.setProperty('--cols', hasWho ? '34px 22px 110px 96px minmax(160px,.9fr) minmax(180px,1fr) 60px' : '34px 22px 110px minmax(160px,.9fr) minmax(180px,1fr) 60px');
    let h = `<div class="gh" role="row"><div class="gcheck" role="columnheader"><input type="checkbox" id="selall" aria-label="Вибрати всі видимі рядки" ${nSel && nSel === ids.length ? 'checked' : ''}></div><div title="Статус" role="columnheader" class="s"><span class="vh">Статус</span></div><div class="s" role="columnheader">Ключ</div><div class="s" role="columnheader">Мовець</div><div role="columnheader">Оригінал · EN</div><div class="s" role="columnheader">Переклад · UK</div><div class="s" role="columnheader" title="Довжина перекладу / довжина оригіналу (без керівних кодів). Рекомендація: якнайближче до оригіналу" style="justify-content:flex-end;border-right:0">Знаків</div></div>`;
    h += list.length ? list.map(u => rowHtml(u, idx.get(u.key)!)).join('') : `<div class="empty-wrap" role="row"><div role="gridcell">${emptyHtml}</div></div>`;
    grid.innerHTML = h;
    grid.classList.toggle('has-sel', nSel > 0);
    const all = $('#selall') as HTMLInputElement | null;
    if (all) all.indeterminate = nSel > 0 && nSel < ids.length;
    const hidden = s.checked.size - nSel;
    $('#bulk').classList.toggle('show', nSel > 0);
    $('#bulkn').textContent = String(nSel);
    $('#bulkt').textContent = ' вибрано' + (hidden ? ` · ще ${hidden} приховано фільтром, їх дія не торкається` : '');
    const cur = s.cur ? idx.get(s.cur) : undefined;
    $('#crumbs').innerHTML = `<span>${esc(s.current?.includes('/') ? s.current.split('/').slice(0, -1).join('/') : 'data')}</span>›<span>${esc(s.current ?? '')}</span>${cur && s.cur ? `›<b>${esc(ctx.unit(s.cur)?.context ?? '')}</b>` : ''}<span class="r">${cur ? `рядок ${cur} з ${v.units.length}` : `${v.units.length} рядків`}${list.length !== v.units.length ? ` · показано ${list.length}` : ''}</span>`;
  }

  function renderTop(): void {
    $('#proj-name').textContent = s.saved.name;
    let total = 0, A = 0, D = 0, W = 0;
    for (const v of s.views) {
      total += v.units.length;
      const ents = s.saved.files[v.name] ?? {};
      for (const u of v.units) { const e = ents[u.key]; if (!e || !e.target) continue; if (e.status === 'appr') A++; else if (e.status === 'done') D++; else if (e.status === 'draft') W++; }
    }
    const cur = ctx.view();
    const nextU = cur ? cur.units.find(u => !s.saved.files[cur.name]?.[u.key]?.target && u.kind !== 'name' && u.kind !== 'term') : undefined;
    publishWidget({ name: s.saved.name, file: s.current ?? '', total, approved: A, done: D, draft: W, ...(cur && nextU ? { next: { file: cur.name, key: nextU.key, text: nextU.source.replace(/\s+/g, ' ').slice(0, 160) } } : {}) });
    $('#pg-a').style.width = total ? `${(100 * A) / total}%` : '0';
    $('#pg-b').style.width = total ? `${(100 * D) / total}%` : '0';
    $('#pg-c').style.width = total ? `${(100 * W) / total}%` : '0';
    $('#pg-txt').textContent = total ? `Перекладено ${Math.floor((100 * (A + D + W)) / total)}% (${(A + D + W).toLocaleString('uk-UA')} з ${total.toLocaleString('uk-UA')}) · вичитано ${Math.floor((100 * A) / total)}%` : 'Папку гри не відкрито';
    $('#pg').title = total ? `Вичитано ${Math.round((100 * A) / total)}% · Чекає вичитування ${Math.round((100 * D) / total)}% · Чернетки ${Math.round((100 * W) / total)}% · Решта без перекладу` : '';
    const sy = loadSyncConfig();
    const lastSync = Math.max(sy.last, loadGithubConfig().last, loadClaudeConfig().last);
    $('#sb-sync').hidden = !lastSync; $('#sb-build').hidden = !s.lastBuild;
    $('#sb-sync').textContent = lastSync ? 'Синхр.: ' + new Date(lastSync).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' }) : 'Синхр.: ще не було';
    $('#sb-build').textContent = s.lastBuild ? `Збірка: ${new Date(s.lastBuild.at).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })} · ${s.lastBuild.n} рядків` : 'Збірки ще не було';
    ($('#build') as HTMLButtonElement).disabled = !s.views.length;
    ($('#run-btn') as HTMLButtonElement).disabled = !s.views.length;
  }

  function renderStatus(): void {
    const v = ctx.view();
    const ents = v ? ctx.entries(v.name) : {};
    let qa = 0;
    if (v) for (const u of v.units) { const e = ents[u.key]; if (e && e.target && activeIssues(u, e, qaOpts()).length) qa++; }
    const sv = $('#sb-save');
    sv.textContent = !s.saveOk ? '○ Не збережено: повторю спробу' : s.savedAt ? '● Збережено о ' + new Date(s.savedAt).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '● Зміни зберігаються автоматично';
    sv.className = s.saveOk ? 'ok' : 'bad';
    $('#sb-fmt').textContent = s.current ? FORMAT_LABEL[s.current.split('.').pop() ?? ''] ?? '' : '';
    $('#sb-qa').textContent = qa ? plural(qa, ['проблема QA', 'проблеми QA', 'проблем QA']) : 'Проблем QA немає';
    $('#sb-qa').className = qa ? 'bad' : 'ok';
    const u = s.cur ? ctx.unit(s.cur) : undefined;
    $('#st-sel').textContent = u && v ? `Рядок ${v.units.indexOf(u) + 1} · ${STATUS_LABEL[shownStatus(ctx, u, entryOf(u))]}` : '';
    if (v) {
      const st = statsOf(v.units, ents);
      $('#sb-file').textContent = `Файл: ${st.approved} / ${st.total} вичитано · ${st.done} чекає вичитування`;
    } else $('#sb-file').textContent = '';
    const mins = Math.max(0, Math.round((Date.now() - s.sess.t0) / 60000));
    $('#sb-sess').textContent = `Сесія: ${s.sess.n} змін · ${mins} хв`;
    $('#ab-title').textContent = s.current ?? 'Transly';
    { const sp = $('#stage-pill'); sp.classList.toggle('on', s.mode === 'review'); sp.setAttribute('aria-pressed', String(s.mode === 'review')); }
    $('#ab-stage').textContent = s.mode === 'review' ? 'Вичитування' : 'Переклад';
    $('#ab-sub').textContent = v ? `${s.mode === 'review' ? 'Вичитування' : 'Переклад'} · ${statsOf(v.units, ents).approved} / ${v.units.length} вичитано` : '';
  }

  /** The centred message in the main area: the start screen, or the progress of reading files. */
  function emptyBox(): HTMLElement {
    let box = document.getElementById('start-empty');
    if (!box) { box = el('div', 'msg-empty'); box.id = 'start-empty'; $('#main').appendChild(box); }
    return box;
  }

  function renderMainEmpty(): boolean {
    const v = ctx.view();
    const tv = $('#v-table'), fv = $('#v-focus');
    if (v) { document.getElementById('start-empty')?.remove(); return false; }
    tv.style.display = 'none'; fv.style.display = 'none';
    const box = emptyBox();
    box.innerHTML = `<h2>${s.phone ? 'Відкрийте файли' : 'Відкрийте папку гри'}</h2>${s.phone ? 'На телефоні проєкт береться з комп’ютера: на ПК виберіть «Налаштування → Обмін проєктом через файл → Зберегти проєкт у файл», передайте файл сюди й відкрийте його, або вставте його вміст як текст. Так само можна відкрити файли самої гри.' : 'Оберіть папку <b>data</b> гри на RPG Maker (або саму папку гри), папку з файлами <b>.po</b>, <b>.csv</b>, <b>.rpy</b> (Ren’Py) чи JSON-локалізацією. Ваш переклад зберігається в цьому браузері, файли гри не змінюються.'}${(lastHandle || desktopDir) ? `<p><button class="btn p" id="resume">Продовжити з папкою «${esc(lastHandle?.name ?? (desktopDir ?? '').split(/[\\/]/).filter(Boolean).pop() ?? '')}»</button></p>` : ''}${s.phone ? `${claudeAvailable ? '<p><button class="btn p" id="cl2">Отримати з іншого пристрою (через Claude)</button></p>' : ''}<p><button class="btn p" id="imp2">Відкрити файли або вставити JSON…</button></p>` : '<p><button class="btn p" id="open2">Відкрити папку гри</button></p>'}`;
    return true;
  }

  function renderAll(): void {
    renderLayout();
    renderTop();
    renderTabs();
    renderTree();
    if (renderMainEmpty()) { renderStatus(); return; }
    $('#v-table').style.display = '';
    $('#v-focus').style.display = '';
    if (lp() === 'rows' || s.leftBoth || s.mode !== 'table') renderRowsList();
    if (s.mode === 'table') renderTable(); else renderFocus(ctx, isDesktop());
    renderSidePanel(ctx);
    renderStatus();
  }

  /* ---------- actions ---------- */
  function setMode(m: Mode, rerender = true): void {
    if (s.phone && m === 'table') m = 'edit';
    if (m === s.mode) return;
    const wasReview = s.mode === 'review';
    s.mode = m;
    if (m === 'review') s.filter = 'done'; else if (wasReview && s.filter === 'done') s.filter = 'all';
    if (m !== 'table' && !ctx.visible().some(u => u.key === s.cur)) s.cur = ctx.visible()[0]?.key ?? null;
    if (rerender) { renderAll(); if (m !== 'table' && s.cur) $('#i-tr').focus(); }
  }

  function openFile(name: string): void {
    if (!s.views.some(v => v.name === name)) return;
    if (!s.open.includes(name)) s.open.push(name);
    s.current = name; s.q = ''; s.speaker = null; s.lenFilter = 'all'; s.checked.clear();
    s.filter = s.mode === 'review' ? 'done' : 'all';
    unitMap = new Map((ctx.view()?.units ?? []).map(u => [u.key, u]));
    s.cur = s.mode === 'table' ? null : ctx.visible()[0]?.key ?? null;
  }

  function closeTab(name: string): void {
    const i = s.open.indexOf(name);
    if (i < 0) return;
    s.open.splice(i, 1);
    if (s.current === name) { const next = s.open[Math.min(i, s.open.length - 1)]; if (next) openFile(next); else { s.current = null; s.cur = null; } }
    renderAll();
  }

  /** Take over a merged/imported/synced project: pick up its snapshot when this device has no files yet. */
  function adopt(): void {
    if (!s.views.length) { s.views = viewsFromSnapshot(s.saved); if (s.views[0]) openFile(s.views[0].name); }
    else if (s.current) unitMap = new Map((ctx.view()?.units ?? []).map(u => [u.key, u]));
    s.who = s.saved.settings.who; tmCache = null; ctx.persist(); renderAll();
  }

  /**
   * Read the picked game files. With `keep`, they are added to what is already open (files with the same name are
   * replaced) instead of replacing the whole project: a phone that opens one file must not lose the others.
   */
  async function loadFiles(picked: PickedFile[], keep = false): Promise<void> {
    if (!picked.length) { toast('У вибраній папці немає файлів, які я вмію перекладати (RPG Maker JSON, .po, .csv, .rpy)'); return; }
    try { await loadPicked(picked, keep); }
    catch (err) { toast(`Не вдалося відкрити файли: ${err instanceof Error ? err.message : 'невідома помилка'}`); renderAll(); }
  }

  async function loadPicked(picked: PickedFile[], keep: boolean): Promise<void> {
    const box = emptyBox();
    box.innerHTML = '<h2>Читаю файли гри…</h2><div class="progress"><i id="bar"></i></div><span id="pct"></span>';
    $('#v-table').style.display = 'none'; $('#v-focus').style.display = 'none';
    const { files, failed } = await readFiles(picked, (d, t) => { $('#bar').style.width = `${(d / t) * 100}%`; $('#pct').textContent = `${d} з ${t}`; });
    const reset = ingest(files, keep);
    dataDir = isDesktop() ? dataDirOf(picked) : null;
    if (!s.views.length) { s.current = null; renderAll(); toast('У цих файлах немає тексту для перекладу'); return; }
    if (failed.length) toast(`Не вдалося прочитати файлів: ${failed.length}`);
    if (reset) toast(`Оригінал змінився в ${plural(reset, ['рядку', 'рядках', 'рядках'])}: їх повернуто в чернетки`);
    s.open = s.open.filter(n => s.views.some(v => v.name === n));
    openFile(s.current && s.views.some(v => v.name === s.current) ? s.current : s.views[0]!.name);
    ctx.persist();
    renderAll();
    offerPluginTexts();
  }

  /**
   * Read the game's strings into views and into the project's snapshot. The snapshot revision changes only when the
   * game's strings really did, so other devices fetch them again only then. Returns how many translated rows had
   * their original changed (they go back to draft).
   */
  function ingest(game: GameFile[], keep = false): number {
    const fresh = readGame(game, { pluginCommands: s.saved.settings.pluginCommands });
    if (keep) {
      const names = new Set(game.map(g => g.name));
      s.game = [...s.game.filter(g => !names.has(g.name)), ...game];
      const label = new Map(s.views.map(v => [v.name, v.label]));
      const kept = fresh.map(v => (v.label || !label.get(v.name) ? v : { ...v, label: label.get(v.name)! }));
      s.views = [...s.views.filter(v => !names.has(v.name)), ...kept].sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
    } else { s.game = game; s.views = fresh; }
    tmCache = null;
    s.saved.labels = labelsOf(s.views);
    s.saved.sysNames = sysNamesOf(game) ?? s.saved.sysNames;
    const snap = snapshotOf(s.views);
    if (JSON.stringify(snap) !== JSON.stringify(s.saved.snapshot ?? null)) { s.saved.assetsRev = Date.now(); s.saved.snapshot = snap; }
    let changed = 0;
    for (const v of s.views) { const ents = s.saved.files[v.name]; if (ents) changed += reconcile(v.units, ents, Date.now()).length; }
    return changed;
  }

  /** Switch which plugin commands count as text; the rows appear in the files they belong to. */
  function setPluginCommands(names: string[]): void {
    const st = s.saved.settings;
    st.pluginsAsked = true;
    const before = new Set(st.pluginCommands);
    if (names.length === before.size && names.every(n => before.has(n))) { ctx.persist(); return; }
    st.pluginCommands = names;
    s.saved.settingsAt = Date.now();
    const total = (): number => s.views.reduce((n, v) => n + v.units.length, 0);
    const was = total();
    ingest(s.game);
    unitMap = new Map((ctx.view()?.units ?? []).map(u => [u.key, u]));
    if (s.cur && !unitMap.has(s.cur)) s.cur = s.mode === 'table' ? null : ctx.visible()[0]?.key ?? null;
    ctx.persist(); renderAll();
    const d = total() - was;
    toast(d > 0 ? `Додано рядків із плагінів: ${d}` : d < 0 ? `Прибрано рядків із плагінів: ${-d}` : 'Рядків не змінилося');
  }

  /** Once per project, right after the game is first opened: ask which plugin commands hold text. */
  function offerPluginTexts(): void {
    const st = s.saved.settings;
    if (st.pluginsAsked || s.phone || !s.game.length) return;
    if (!pluginCandidates(s.game).some(c => c.likely)) { st.pluginsAsked = true; ctx.persist(); return; }
    openPluginTexts(ctx, setPluginCommands);
  }

  async function openFolder(): Promise<void> {
    const picked = await pickGameFolder(input);
    if (!picked) return;
    if (picked.handle) { lastHandle = picked.handle as typeof lastHandle; void saveHandle('default', picked.handle).catch(() => undefined); }
    await loadFiles(picked.files);
  }

  async function resume(): Promise<void> {
    if (!lastHandle && !desktopDir) return;
    const files = desktopDir ? await reopenGameDirDesktop() : await reopenHandle(lastHandle!);
    if (!files) { toast('Немає доступу до папки: оберіть її знову'); return; }
    await loadFiles(files);
  }

  /** Whether the artifact's shared database is there (known a moment after start). */
  let claudeAvailable = false;
  void artifactDb().then(db => { if (db) { claudeAvailable = true; if (!s.views.length) renderAll(); } });

  function openImportDlg(): void {
    s.leftOpen = false; renderLayout();
    openImport(ctx, adopt, files => loadFiles(files, true));
  }
  const doBuild = () => openBuild(ctx, dataDir, n => { s.lastBuild = { at: Date.now(), n }; renderTop(); });

  function openSettingsDlg(): void {
    openSettings(ctx, {
      reset: () => {
        // The project is empty again, so the game's strings have to be read into it afresh (plugin texts are off by default).
        if (s.game.length) { ingest(s.game); unitMap = new Map((ctx.view()?.units ?? []).map(u => [u.key, u])); if (s.cur && !unitMap.has(s.cur)) s.cur = null; }
        s.views.forEach(v => { s.saved.files[v.name] = {}; });
        renderAll(); ctx.persist();
      },
      adopt,
      plugins: () => openPluginTexts(ctx, setPluginCommands),
      importFiles: openImportDlg,
    });
  }

  /* ---------- popovers (speaker / length) ---------- */
  const fpop = () => $('#fpop');
  function showPop(btn: HTMLElement, html: string): void {
    const p = fpop();
    if (!p.hidden && p.dataset.for === btn.id) { p.hidden = true; return; }
    p.innerHTML = html; p.dataset.for = btn.id; p.hidden = false;
    const r = btn.getBoundingClientRect();
    p.style.left = Math.min(r.left, innerWidth - p.offsetWidth - 8) + 'px';
    p.style.top = r.bottom + 4 + 'px';
  }
  const closePops = () => { fpop().hidden = true; };

  /* ---------- global search ---------- */
  let sdItems: { t: 'file' | 'row' | 'term'; file?: string; key?: string; label: string; kind: string }[] = [];
  let sdSel = 0;
  function openSearch(): void { $('#sd').hidden = false; const i = $('#sd-in') as HTMLInputElement; i.value = ''; sdRender(); i.focus(); document.querySelector<HTMLElement>('#ide')!.inert = true; }
  function closeSearch(): void { $('#sd').hidden = true; $('#ide').inert = false; }
  function sdRender(): void {
    const q = ($('#sd-in') as HTMLInputElement).value.trim().toLowerCase();
    sdItems = [];
    if (!q) s.views.slice(0, 14).forEach(v => sdItems.push({ t: 'file', file: v.name, label: v.name, kind: 'Файл' }));
    else {
      for (const v of s.views) if (v.name.toLowerCase().includes(q)) sdItems.push({ t: 'file', file: v.name, label: v.name, kind: 'Файл' });
      outer: for (const v of s.views) {
        const ents = s.saved.files[v.name] ?? {};
        for (const u of v.units) {
          const e = ents[u.key];
          if ((u.source + ' ' + (e?.target ?? '') + ' ' + u.key).toLowerCase().includes(q)) { sdItems.push({ t: 'row', file: v.name, key: u.key, label: `${v.name} · ${u.source.slice(0, 70)}${e?.target ? ' → ' + e.target.slice(0, 40) : ''}`, kind: 'Рядок' }); if (sdItems.length > 40) break outer; }
        }
      }
      s.saved.terms.filter(t => (t.en + ' ' + t.uk).toLowerCase().includes(q)).slice(0, 6).forEach(t => sdItems.push({ t: 'term', label: `${t.en} → ${t.uk}`, kind: 'Термін' }));
    }
    sdItems = sdItems.slice(0, 14); sdSel = 0;
    $('#sd-res').innerHTML = sdItems.length ? sdItems.map((x, i) => `<div class="sd-it ${i === 0 ? 'on' : ''}" data-sd="${i}" role="option" aria-selected="${i === 0}"><span class="sd-k">${x.kind}</span><span class="sd-t">${esc(x.label)}</span></div>`).join('') : '<div class="sd-empty">Нічого не знайдено</div>';
  }
  function sdGo(i: number): void {
    const it = sdItems[i];
    if (!it) return;
    closeSearch();
    if (it.t === 'term') { s.sideTab = 'glossary'; s.sideCollapsed = false; if (s.mode === 'table') setMode('edit', false); s.rightOpen = true; renderAll(); ($('#gl-q') as HTMLInputElement).value = it.label.split(' → ')[0] ?? ''; renderGlossary(ctx); return; }
    if (it.file) {
      if (it.file !== s.current) openFile(it.file);
      if (it.key) { s.filter = 'all'; s.q = ''; ctx.select(it.key, s.mode === 'table' ? undefined : s.mode); } else renderAll();
    }
  }

  /* ---------- menu bar ---------- */
  type MenuItem = '-' | { t: string; fn: () => void; sc?: string };
  const MENUS: Record<string, MenuItem[]> = {
    'Файл': [{ t: 'Відкрити папку гри…', fn: () => void openFolder() }, { t: 'Відкрити файли або вставити JSON…', fn: openImportDlg }, { t: 'Зібрати…', fn: doBuild, sc: 'F5' }, '-', { t: 'Налаштування…', fn: openSettingsDlg }],
    'Вигляд': [{ t: 'Таблиця', fn: () => setMode('table') }, { t: 'Редагування', fn: () => setMode('edit') }, { t: 'Вичитування', fn: () => setMode('review') }],
    'Навігація': [{ t: 'Наступний рядок без перекладу', fn: () => jump('new', 1) }, { t: 'Наступна проблема QA', fn: () => jump('qa', 1) }, { t: 'Переглянути сцену…', fn: () => { const u = s.cur ? ctx.unit(s.cur) : undefined; if (u) openScene(ctx, u); else toast('Спершу виберіть рядок'); } }, '-', { t: 'Пошук скрізь…', fn: openSearch, sc: '⇧⇧' }],
    'Інструменти': [{ t: 'Визначити мовців…', fn: () => openSpeakers(ctx) }, { t: 'Знайти й замінити…', fn: () => openFindReplace(ctx) }, { t: 'Перевірити узгодженість…', fn: () => openConsistency(ctx) }, { t: 'Тексти плагінів…', fn: () => openPluginTexts(ctx, setPluginCommands) }, { t: 'Перенести довгі рядки у файлі', fn: wrapFile }, '-', { t: 'Налаштування…', fn: openSettingsDlg }],
    'Довідка': [{ t: 'Гарячі клавіші', fn: () => toggleKeys() }],
  };
  /** Re-flow every translated message of the current file whose lines are wider than the game window. */
  function wrapFile(): void {
    const v = ctx.view();
    const limit = lineLimit();
    if (!v) { toast('Спершу відкрийте файл'); return; }
    if (!limit) { toast('Ширину рядка вимкнено в налаштуваннях'); return; }
    const ents = ctx.entries(v.name);
    let n = 0;
    for (const u of v.units) {
      const e = ents[u.key];
      if (!e?.target || (u.kind !== 'dialogue' && u.kind !== 'scroll')) continue;
      if (!activeIssues(u, e, qaOpts()).some(i => i.key === 'wrap')) continue;
      const text = wrapLines(e.target, limitFor(limit, u.face));
      if (text !== e.target) { ents[u.key] = note(edit(e, u, text, s.mode === 'review' ? 'review' : 'translate', Date.now()), 'перенесено рядки', text, s.who, Date.now()); n++; }
    }
    if (n) { s.sess.n += n; ctx.persist(); ctx.invalidateTm(); renderAll(); }
    toast(n ? `Перенесено рядки: ${plural(n, ['репліка', 'репліки', 'реплік'])}` : 'Задовгих рядків у файлі немає');
  }
  function jump(kind: 'new' | 'qa', dir: 1 | -1): void {
    const v = ctx.view();
    if (!v) return;
    const ents = ctx.entries(v.name);
    const n = v.units.length;
    const start = Math.max(0, v.units.findIndex(u => u.key === s.cur));
    for (let k = 1; k <= n; k++) {
      const u = v.units[((start + dir * k) % n + n) % n]!;
      const e = ents[u.key];
      if (kind === 'new' ? (e?.status ?? 'new') === 'new' : shownStatus(ctx, u, e) === 'qa') {
        s.filter = 'all'; s.q = ''; s.speaker = null; s.lenFilter = 'all';
        ctx.select(u.key, s.mode === 'table' ? undefined : s.mode);
        return;
      }
    }
    toast(kind === 'new' ? 'Рядків без перекладу немає' : 'Проблем QA немає');
  }
  function toggleKeys(): void {
    const k = $('#keypop');
    if (!k.hidden) { k.hidden = true; return; }
    k.hidden = false;
    const r = $('#hk').getBoundingClientRect();
    k.style.left = Math.max(8, Math.min(r.right - k.offsetWidth, innerWidth - k.offsetWidth - 8)) + 'px';
    k.style.top = r.bottom + 4 + 'px';
  }
  let mbOpen: string | null = null;
  const mdd = (): HTMLElement => { let e = document.getElementById('mdd'); if (!e) { e = el('div', 'mdd'); e.id = 'mdd'; e.setAttribute('role', 'menu'); e.hidden = true; root.appendChild(e); } return e; };
  function mbClose(): void { mdd().hidden = true; mbOpen = null; document.querySelectorAll('#menubar button').forEach(b => { b.classList.remove('on'); b.setAttribute('aria-expanded', 'false'); }); }
  function mbShow(g: string): void {
    const btn = document.querySelector<HTMLElement>(`#menubar [data-mg="${CSS.escape(g)}"]`);
    if (!btn) return;
    mbClose(); mbOpen = g; btn.classList.add('on'); btn.setAttribute('aria-expanded', 'true');
    const dd = mdd();
    dd.innerHTML = MENUS[g]!.map((m, i) => m === '-' ? '<div class="msep" role="separator"></div>' : `<div class="mi" role="menuitem" tabindex="-1" data-mi="${g}|${i}"><span class="ml">${esc(m.t)}</span>${m.sc ? `<span class="ms">${esc(m.sc)}</span>` : ''}</div>`).join('');
    dd.hidden = false;
    const r = btn.getBoundingClientRect();
    dd.style.left = Math.min(r.left, innerWidth - dd.offsetWidth - 8) + 'px'; dd.style.top = r.bottom + 4 + 'px';
  }
  function mbToggle(on?: boolean): void {
    const bar = $('#menubar');
    const open = on ?? bar.hidden;
    if (open && !bar.children.length) bar.innerHTML = Object.keys(MENUS).map(g => `<button role="menuitem" aria-haspopup="menu" aria-expanded="false" data-mg="${esc(g)}">${esc(g)}</button>`).join('');
    if (!open) mbClose();
    bar.hidden = !open;
    $('.topbar').classList.toggle('menu-on', open);
    $('#hamb').setAttribute('aria-expanded', String(open));
  }

  /* ---------- bulk actions ---------- */
  function bulkSend(): void {
    const v = ctx.view();
    if (!v) return;
    const ents = ctx.entries(v.name);
    let ok = 0; const skipped = new Map<string, number>();
    for (const k of s.checked) {
      const u = unitMap.get(k);
      if (!u || !visibleUnits(true).includes(u)) continue;
      const r = submit(ents[k], u, 'translate', Date.now(), { blockErrors: s.saved.settings.blockErrors, qa: qaOpts() });
      if (r.ok) { ents[k] = note(r.entry, 'надіслано на вичитування', r.entry.target, s.who, Date.now()); ok++; }
      else skipped.set(r.reason.slice(0, 40), (skipped.get(r.reason.slice(0, 40)) ?? 0) + 1);
    }
    s.sess.n += ok;
    ctx.persist(); ctx.invalidateTm(); renderAll();
    const nSkip = [...skipped.values()].reduce((a, b) => a + b, 0);
    toast(`Надіслано на вичитування: ${ok}${nSkip ? `. Пропущено: ${nSkip} (${[...skipped.keys()].slice(0, 2).join('; ')})` : ''}`, { sticky: nSkip > 0 });
  }
  function bulkTm(): void {
    const v = ctx.view();
    if (!v) return;
    const ents = ctx.entries(v.name);
    let n = 0;
    for (const k of s.checked) {
      const u = unitMap.get(k);
      if (!u || ents[k]?.target) continue;
      const m = ctx.tm().find(u.source, { min: 70, limit: 1, exclude: x => x.s === u.source && false })[0];
      if (m) { ents[k] = note(edit(ents[k], u, m.t, 'translate', Date.now()), `підставлено з пам’яті (${m.score}%)`, m.t, s.who, Date.now()); n++; }
    }
    ctx.persist(); renderAll();
    toast(n ? `Підставлено з пам’яті: ${n}` : 'Збігів від 70% для порожніх вибраних рядків немає');
  }

  /* ---------- inline cell editing ---------- */
  function startInline(key: string): void {
    const cell = document.querySelector<HTMLElement>(`.gr[data-key="${CSS.escape(key)}"] .tr`);
    const u = ctx.unit(key);
    if (!cell || !u || cell.querySelector('textarea')) return;
    const ta = el('textarea', 'cell-ed');
    ta.rows = 2; ta.value = entryOf(u)?.target ?? ''; ta.setAttribute('aria-label', 'Переклад рядка');
    cell.innerHTML = ''; cell.appendChild(ta); cell.appendChild(el('div', 'cell-hint', 'Ctrl+Enter — надіслати на вичитування · Esc — скасувати · клік поза коміркою — зберегти')); ta.focus(); ta.select();
    let cancelled = false;
    const finish = () => {
      if (!cancelled && ta.value !== (entryOf(u)?.target ?? '')) {
        const ents = ctx.entries(s.current!);
        ents[key] = edit(ents[key], u, ta.value, 'translate', Date.now());
        s.sess.n++; ctx.persist(); ctx.invalidateTm();
      }
      renderAll();
    };
    ta.addEventListener('blur', finish, { once: true });
    ta.addEventListener('keydown', e => {
      if (e.key === 'Escape') { cancelled = true; e.preventDefault(); ta.blur(); }
      else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); ta.removeEventListener('blur', finish); const ents = ctx.entries(s.current!); ents[key] = edit(ents[key], u, ta.value, 'translate', Date.now()); const r = submit(ents[key], u, 'translate', Date.now(), { blockErrors: s.saved.settings.blockErrors, qa: qaOpts() }); if (r.ok) { ents[key] = note(r.entry, 'надіслано на вичитування', r.entry.target, s.who, Date.now()); toast('Надіслано на вичитування'); } else toast(r.reason, { sticky: true }); s.sess.n++; ctx.persist(); ctx.invalidateTm(); renderAll(); }
    });
  }

  /* ---------- events ---------- */
  root.addEventListener('click', e => {
    const t = e.target as HTMLElement;
    if (!t.closest('#fpop,#spkbtn,#lenbtn')) closePops();
    if (!t.closest('#keypop,#hk')) $('#keypop').hidden = true;
    if (t.closest('#open,#open2')) { void openFolder(); return; }
    if (t.closest('#resume')) { void resume(); return; }
    if (t.closest('#imp2,#mt-open')) { openImportDlg(); return; }
    if (t.closest('#cl2')) {
      toast('Отримую з іншого пристрою…');
      runClaudeSync(ctx, loadClaudeConfig(), adopt).then(r => toast(s.views.length ? describeClaude(r) : 'У спільній базі ще немає проєкту: спершу синхронізуйте на комп’ютері (Налаштування → Синхронізація через Claude)'), er => toast(er instanceof Error ? er.message : 'Не вдалося синхронізувати'));
      return;
    }
    if (t.closest('#settings,#ab-set,#proj-btn')) { openSettingsDlg(); return; }
    if (t.closest('#build,#run-btn,#sb-build')) { doBuild(); return; }
    if (t.closest('#sb-sync')) { openSettingsDlg(); return; }
    if (t.closest('#sd-open,#mt-search')) { openSearch(); return; }
    if (t.closest('#hk')) { toggleKeys(); return; }
    if (t.closest('#hamb')) { mbToggle(); return; }
    const mg = t.closest<HTMLElement>('#menubar [data-mg]');
    if (mg) { mbOpen === mg.dataset.mg ? mbClose() : mbShow(mg.dataset.mg!); return; }
    const mi = t.closest<HTMLElement>('#mdd [data-mi]');
    if (mi) { const [g, i] = mi.dataset.mi!.split('|'); const it = MENUS[g!]![Number(i)]; mbToggle(false); if (it && it !== '-') setTimeout(() => it.fn(), 0); return; }
    if (!t.closest('#menubar,#mdd,#hamb') && !$('#menubar').hidden) mbToggle(false);
    if (t.closest('#ab-left')) { s.leftOpen = !s.leftOpen; s.rightOpen = false; renderAll(); return; }
    if (t.closest('#ab-right')) { s.rightOpen = !s.rightOpen; s.leftOpen = false; renderAll(); return; }
    if (t.closest('#scrim')) { s.leftOpen = false; s.rightOpen = false; renderAll(); return; }
    if (t.closest('#stage-pill')) { setMode(s.mode === 'review' ? 'edit' : 'review'); return; }
    if (t.closest('#ab-stage')) { setMode(s.mode === 'review' ? 'edit' : 'review'); return; }
    const lt = t.closest<HTMLElement>('#mtabs [data-lt]');
    if (lt) { s.leftTab[s.mode] = lt.dataset.lt === 'rows' ? 'rows' : 'files'; renderAll(); return; }
    const sb = t.closest<HTMLElement>('#strip [data-lp]');
    if (sb) {
      if (sb.dataset.lp === 'both') { if (s.leftOpen && s.leftBoth) s.leftOpen = false; else { s.leftOpen = true; s.leftBoth = true; } renderAll(); return; }
      const want = sb.dataset.lp === 'rows' ? 'rows' : 'files';
      if (s.leftOpen && !s.leftBoth && s.leftTab[s.mode] === want) s.leftOpen = false; else { s.leftOpen = true; s.leftTab[s.mode] = want; }
      s.leftBoth = false; renderAll(); return;
    }
    if (t.closest('#lp-close')) { s.leftOpen = false; renderAll(); return; }
    const sm = t.closest<HTMLElement>('#seg [data-m]');
    if (sm) { setMode(sm.dataset.m as Mode); return; }
    const tab = t.closest<HTMLElement>('[data-tab]');
    if (tab) { openFile(tab.dataset.tab!); renderAll(); return; }
    const ct = t.closest<HTMLElement>('[data-closetab]');
    if (ct) { closeTab(ct.dataset.closetab!); return; }
    const dir = t.closest<HTMLElement>('[data-dir]');
    if (dir) { const n = dir.dataset.dir!; s.collapsed.has(n) ? s.collapsed.delete(n) : s.collapsed.add(n); renderTree(); return; }
    const f = t.closest<HTMLElement>('.node[data-file]');
    if (f) { openFile(f.dataset.file!); if (s.phone) s.leftTab[s.mode] = 'rows'; renderAll(); return; }
    const ch = t.closest<HTMLElement>('[data-filter]');
    if (ch) { s.filter = ch.dataset.filter as Filter; if (s.mode !== 'table' && !ctx.visible().some(u => u.key === s.cur)) s.cur = ctx.visible()[0]?.key ?? null; renderAll(); return; }
    const clr = t.closest<HTMLElement>('[data-clear]');
    if (clr) { if (clr.dataset.clear === 'speaker') s.speaker = null; else s.lenFilter = 'all'; renderAll(); return; }
    if (t.closest('[data-reset]')) { s.filter = s.mode === 'review' ? 'done' : 'all'; s.q = ''; s.speaker = null; s.lenFilter = 'all'; renderAll(); return; }
    if (t.closest('#spkbtn')) {
      const v = ctx.view();
      const names = v ? [...new Set(v.units.map(u => ctx.speaker(u)))].sort((a, b) => a.localeCompare(b, 'uk')) : [];
      showPop(t.closest<HTMLElement>('#spkbtn')!, `<div class="group">Мовець</div>${names.slice(0, 60).map(n => `<button data-spk="${esc(n)}">${esc(n || 'без мовця')}</button>`).join('')}<div class="msep" role="separator"></div><button data-act="speakers">Визначити мовців…</button>`);
      return;
    }
    if (t.closest('[data-act=speakers]')) { closePops(); openSpeakers(ctx); return; }
    const spk = t.closest<HTMLElement>('[data-spk]');
    if (spk) { s.speaker = spk.dataset.spk ?? ''; closePops(); renderAll(); return; }
    if (t.closest('#lenbtn')) { showPop(t.closest<HTMLElement>('#lenbtn')!, `<div class="group">Довжина відносно оригіналу</div>${(Object.keys(LEN_LABEL) as (keyof typeof LEN_LABEL)[]).map(k => `<button data-len="${k}">${LEN_LABEL[k]}</button>`).join('')}`); return; }
    const ln = t.closest<HTMLElement>('[data-len]');
    if (ln) { s.lenFilter = ln.dataset.len as typeof s.lenFilter; closePops(); renderAll(); return; }
    if (t.closest('#bb-ok')) { bulkSend(); return; }
    if (t.closest('#bb-tm')) { bulkTm(); return; }
    if (t.closest('#bb-clear')) { s.checked.clear(); renderAll(); return; }
    if (t.closest('#selall')) { const all = ($('#selall') as HTMLInputElement).checked; for (const u of visibleUnits(true)) all ? s.checked.add(u.key) : s.checked.delete(u.key); renderAll(); return; }
    const rc = t.closest<HTMLInputElement>('.rc');
    if (rc) { const k = rc.closest<HTMLElement>('.gr')!.dataset.key!; rc.checked ? s.checked.add(k) : s.checked.delete(k); renderAll(); return; }
    const sd = t.closest<HTMLElement>('[data-sd]');
    if (sd) { sdGo(Number(sd.dataset.sd)); return; }
    if (t.id === 'sd') { closeSearch(); return; }
    const si = t.closest<HTMLElement>('.si[data-key]');
    if (si) { if (s.phone) { s.leftOpen = false; } ctx.select(si.dataset.key!, s.mode === 'table' ? 'edit' : undefined); return; }
    if (sideClick(ctx, t)) return;
    if (s.mode !== 'table' && focusClick(ctx, t)) return;
    if (s.mode === 'table') {
      const row = t.closest<HTMLElement>('.gr');
      if (row && row.dataset.key !== s.cur && !t.closest('textarea')) { document.querySelector('.gr.sel')?.classList.remove('sel'); row.classList.add('sel'); s.cur = row.dataset.key ?? null; renderStatus(); renderSidePanel(ctx); }
    }
  });

  root.addEventListener('dblclick', e => {
    const t = e.target as HTMLElement;
    const cell = t.closest<HTMLElement>('.gr .tr');
    const row = t.closest<HTMLElement>('.gr');
    if (cell && row && s.mode === 'table') startInline(row.dataset.key!);
    else if (row && s.mode === 'table' && !t.closest('textarea')) ctx.select(row.dataset.key!, 'edit');
  });

  root.addEventListener('input', e => {
    const t = e.target as HTMLElement;
    if (t instanceof HTMLTextAreaElement && t.id === 'i-tr') { focusInput(ctx, t); renderStatus(); return; }
    if (t.id === 'q' || t.id === 'q2') {
      s.q = (t as HTMLInputElement).value;
      const pos = (t as HTMLInputElement).selectionStart ?? s.q.length;
      renderAll();
      const q = $(t.id === 'q' ? '#q' : '#q2') as HTMLInputElement;
      q.focus(); q.setSelectionRange(pos, pos);
    } else if (t.id === 'gl-q') renderGlossary(ctx);
  });

  $('#sd-in').addEventListener('input', sdRender);
  $('#sd-in').addEventListener('keydown', e => {
    const k = (e as KeyboardEvent).key;
    if (k === 'ArrowDown' || k === 'ArrowUp') { e.preventDefault(); sdSel = (sdSel + (k === 'ArrowDown' ? 1 : -1) + sdItems.length) % Math.max(1, sdItems.length); document.querySelectorAll('.sd-it').forEach((x, i) => { x.classList.toggle('on', i === sdSel); x.setAttribute('aria-selected', String(i === sdSel)); }); }
    else if (k === 'Enter') { e.preventDefault(); sdGo(sdSel); }
  });

  let lastShift = 0;
  document.addEventListener('keydown', e => {
    const t = e.target as HTMLElement;
    if (e.key === 'Escape') {
      if (!$('#sd').hidden) { closeSearch(); return; }
      if (!$('#fpop').hidden || !$('#keypop').hidden) { closePops(); $('#keypop').hidden = true; return; }
      if (!$('#menubar').hidden) { mbToggle(false); return; }
      if (s.phone && (s.leftOpen || s.rightOpen)) { s.leftOpen = false; s.rightOpen = false; renderAll(); return; }
    }
    if (document.querySelector('dialog[open]')) return;
    if (e.key === 'Shift' && !e.repeat) { const now = Date.now(); if (now - lastShift < 400) openSearch(); lastShift = now; return; }
    if (e.key === 'F5') { e.preventDefault(); doBuild(); return; }
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && s.mode !== 'table') { e.preventDefault(); step(ctx, e.key === 'ArrowDown' ? 1 : -1); return; }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && t.id === 'i-tr') { e.preventDefault(); send(ctx); return; }
    if (s.mode === 'table' && t.classList.contains('gr')) {
      const list = visibleUnits(true);
      const i = list.findIndex(u => u.key === t.dataset.key);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const n = list[i + (e.key === 'ArrowDown' ? 1 : -1)]; if (n) { s.cur = n.key; renderAll(); document.querySelector<HTMLElement>(`.gr[data-key="${CSS.escape(n.key)}"]`)?.focus(); } }
      else if (e.key === 'Enter') { e.preventDefault(); ctx.select(t.dataset.key!, 'edit'); }
    }
  });

  // Background sync on the chosen interval; failures are shown, never silent.
  setInterval(() => {
    const cfg = loadSyncConfig();
    if (!cfg.everyMin || !syncConfigured(cfg) || document.querySelector('dialog[open]')) return;
    if (Date.now() - cfg.last < cfg.everyMin * 60_000) return;
    runSync(ctx, cfg, adopt).then(r => toast(describeSync(r)), er => toast(er instanceof Error ? er.message : 'Не вдалося синхронізувати'));
  }, 60_000);
  setInterval(() => {
    const cfg = loadClaudeConfig();
    if (!cfg.everyMin || !claudeAvailable || document.querySelector('dialog[open]')) return;
    if (Date.now() - cfg.last < cfg.everyMin * 60_000) return;
    runClaudeSync(ctx, cfg, adopt).then(r => toast(describeClaude(r)), er => toast(er instanceof Error ? er.message : 'Не вдалося синхронізувати через Claude'));
  }, 60_000);
  setInterval(() => {
    const cfg = loadGithubConfig();
    if (!cfg.everyMin || !githubConfigured(cfg) || document.querySelector('dialog[open]')) return;
    if (Date.now() - cfg.last < cfg.everyMin * 60_000) return;
    runGithubSync(ctx, cfg, adopt).then(r => toast(describeGithub(r)), er => toast(er instanceof Error ? er.message : 'Не вдалося синхронізувати з GitHub'));
  }, 60_000);

  setInterval(renderStatus, 30_000);

  mq.addEventListener('change', () => {
    s.phone = mq.matches; s.leftOpen = !s.phone; s.rightOpen = false;
    if (s.phone && s.mode === 'table') setMode('edit', false);
    renderAll();
  });

  addEventListener('beforeunload', () => { void autosave.flush(); });
  setTimeout(() => void autoCheck(), 4000);
  // The Android app goes to the background without unloading the page: save what was typed.
  document.addEventListener('visibilitychange', () => { if (document.hidden) void autosave.flush(); });
  /** Back button: close whatever is open on top first; false when there is nothing to close. */
  function backStep(): boolean {
    const dlg = document.querySelector<HTMLDialogElement>('dialog[open]');
    if (dlg) { dlg.close(); return true; }
    if (!$('#sd').hidden) { closeSearch(); return true; }
    if (!fpop().hidden) { closePops(); return true; }
    if (!$('#keypop').hidden) { $('#keypop').hidden = true; return true; }
    if (!$('#menubar').hidden) { mbToggle(false); return true; }
    if (s.phone && (s.leftOpen || s.rightOpen)) { s.leftOpen = false; s.rightOpen = false; renderAll(); return true; }
    return false;
  }
  /** The widget's "next line" tap: open that row in the editor (waits until the project has loaded). */
  function openRow(file: string, key: string, tries = 0): void {
    if (s.views.some(v => v.name === file)) {
      if (s.current !== file) openFile(file);
      s.filter = 'all'; s.q = ''; s.speaker = null; s.lenFilter = 'all';
      if (!ctx.unit(key)) { renderAll(); return; }
      ctx.select(key, s.mode === 'table' ? 'edit' : s.mode);
    } else if (tries < 40) setTimeout(() => openRow(file, key, tries + 1), 250);
  }
  Object.assign(window, { __back: backStep, __flush: () => autosave.flush(), __open: (file: string, key: string) => openRow(file, key) });
  if (s.current) { unitMap = new Map((ctx.view()?.units ?? []).map(u => [u.key, u])); if (s.mode !== 'table') s.cur = ctx.visible()[0]?.key ?? null; }
  initResize();
  initRightResize();
  renderAll();
}
