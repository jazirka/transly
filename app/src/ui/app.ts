import { Autosave, DupIndex, commitRows, threadsOf, GameNameIndex, buildUsage, sysNamesOf, activeIssues, autoLineLimit, displayLength, edit, emptyProject, labelsOf, lengthDeviation, limitFor, note, pluginCandidates, propagate, readGame, reconcile, snapshotOf, speakerOf, statsOf, submit, viewsFromSnapshot, wrapLines } from '../core';
import { GroupIndex, groupRows, liveGroups } from '../core';
import type { Entry, FileView, GameFile, Group, RowChange, SavedProject, Unit } from '../core';
import { openBuild } from './build-dialog';
import { dataDirOf, forgetGameDir, isDesktop, rememberedGameDir, reopenGameDir, reopenGameDirDesktop, setProject } from './desktop';
import { classifyFolder, folderBanner, folderLine } from './folder-service';
import type { FolderState } from './folder-service';
import { $, el, esc, plural, toast } from './dom';
import { FOCUS_HTML, SIDE_HTML, qaClick, focusClick, focusInput, insertText, renderFocus, renderSidePanel, send, sideClick, step } from './focus';
import { wireDiscuss } from './discuss';
import { wireTermCard } from './termcard';
import { wireLinks } from './links';
import { SCENE_HTML, focusCard, hasScenes, renderSceneView, sceneClick, sceneFocus, sceneIdOf, sceneInput } from './scene-view';
import { SCENES_HTML, renderScenesPanel, scenesClick, wireScenes } from './scenes-panel';
import { FILES_DRAG, GROUPS_HTML, dragFiles, groupsClick, placeMenuHtml, renderGroupsBlock, wireGroups } from './groups-panel';
import type { PlaceTarget } from './groups-panel';
import { GLOSSARY_HTML, editTerm, glossaryClick, renderGlossaryPanel, showTerm, wireGlossary } from './glossary-panel';
import { pickGameFolder, readFiles, reopenHandle } from './folder';
import type { DirHandle, PickedFile } from './folder';
import { IdbStore, loadHandle, saveHandle } from './idb';
import { openImport } from './import-dialog';
import { openScene } from './scene-dialog';
import { autoCheck } from './updates';
import { openConsistency, openFindReplace } from './tools-dialogs';
import { openPluginTexts } from './plugins-dialog';
import { openActivity, openAutofill } from './activity-dialog';
import { markup } from './markup';
import { openSettings } from './settings';
import { openSpeakers } from './speakers-dialog';
import { initMobile } from './mobile';
import { holdInert } from './modal';
import { WINDOW_CONTROLS_HTML, initWindowControls } from './winctl';
import { GROUP, SEP, STATUS_LABEL, buildTm, shownStatus, splitKey } from './state';
import type { Ctx, Filter, LeftTab, Mode, SortMode, State } from './state';
import { publishWidget } from './android';
import { artifactDb, describeClaude, loadClaudeConfig, runClaudeSync } from './claude';
import { describeGithub, githubConfigured, loadGithubConfig, runGithubSync } from './github';
import { describe as describeSync, loadSyncConfig, runSync, syncConfigured } from './sync';
import { initResize, initRightResize } from './resize';
import { mountRows, reveal } from './chunks';
import { buildAndRunGame, playInGame } from './play';

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
  scene: '<svg viewBox="0 0 16 16"><rect x="2.5" y="3" width="11" height="6" rx="1.5"/><rect x="2.5" y="11" width="7" height="2.5" rx="1"/></svg>',
  book: '<svg viewBox="0 0 16 16"><path d="M3.5 2.5h8a1 1 0 0 1 1 1v10H4.5a1 1 0 0 1-1-1z"/><path d="M6 5.5h4"/></svg>',
  cmt: '<svg class="cmi" viewBox="0 0 16 16" aria-label="Є відкриті обговорення"><path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z"/></svg>',
  cmtDone: '<svg class="cmi done" viewBox="0 0 16 16" aria-label="Обговорення розв’язані"><path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z"/><path d="M5.8 7l1.5 1.5L10.3 5.6"/></svg>',
};

const ls = (k: string): string | null => { try { return localStorage.getItem(k); } catch { return null; } };
const UI_KEY = 'transly.ui.v1';

const FILTERS: [Filter, string][] = [['all', 'Усі'], ['new', 'Без перекладу'], ['draft', 'Чернетки'], ['done', 'Надіслані'], ['appr', 'Вичитані'], ['qa', 'Помилки'], ['cm', 'З коментарями']];
const LEN_LABEL = { far: 'далеко від оригіналу', longer: 'довші за оригінал', shorter: 'коротші за оригінал' } as const;
const FORMAT_LABEL: Record<string, string> = { json: 'RPG Maker MV · UTF-8', po: 'gettext · UTF-8', pot: 'gettext · UTF-8', csv: 'CSV · UTF-8', tsv: 'TSV · UTF-8', rpy: 'Ren’Py · UTF-8' };

const SHELL = `<div class="scroll-x"><div class="ide mode-table lp-open" id="ide">
  <header class="topbar">
    <div class="logo">T</div>
    <button class="tb-ic" id="hamb" title="Головне меню" aria-haspopup="menu" aria-expanded="false">${SVG.menu}</button>
    <nav class="menubar" id="menubar" role="menubar" aria-label="Головне меню" hidden></nav>
    <button class="tpill" id="proj-btn" aria-haspopup="menu" aria-expanded="false" title="Проєкт: відкрити іншу гру, налаштування"><span class="pj" id="proj-av">T</span><span id="proj-name">Проєкт</span><span class="dd">▾</span></button>
    <div class="seg" id="seg" role="group" aria-label="Режим">
      <button aria-pressed="true" data-m="table" class="on"><svg viewBox="0 0 16 16"><path d="M2.5 3.5h11v9h-11zM2.5 7h11M6.5 3.5v9"/></svg>Таблиця</button>
      <button aria-pressed="false" data-m="edit"><svg viewBox="0 0 16 16"><path d="M2.5 3.5h11v9h-11zM6 3.5v9M6 8h7.5"/></svg>Редагування</button>
      <button aria-pressed="false" data-m="scene" id="m-scene"><svg viewBox="0 0 16 16"><rect x="2.5" y="3" width="11" height="6" rx="1.5"/><rect x="2.5" y="11" width="7" height="2.5" rx="1"/></svg>Сцена</button>
    </div>
    <div class="grow"></div>
    <div class="prog" id="pg" title=""><div class="bar"><i class="a" id="pg-a"></i><i class="b" id="pg-b"></i><i class="c" id="pg-c"></i></div><span id="pg-txt" style="font-family:var(--mono);font-size:11.5px"></span></div>
    <div class="tsep"></div>
    <button class="tpill run" id="cfg-btn" aria-haspopup="menu" aria-expanded="false" title="Що запускає кнопка ▶">${SVG.build}<span id="cfg-name">Збірка (файл)</span><span class="dd">▾</span></button>
    <button class="tb-ic play" id="run-btn" title="Запустити (F5)" aria-label="Запустити">${SVG.play}</button>
    <div class="tsep"></div>
    <button class="tb-ic" id="hk" title="Гарячі клавіші" aria-label="Гарячі клавіші">${SVG.keys}</button>
    <div class="tsep"></div>
    <button class="tb-ic" id="settings" title="Налаштування" aria-label="Налаштування">${SVG.gear}</button>
  </header>
  <header class="appbar">
    <div class="abt"><b id="ab-title">Transly</b><small id="ab-sub"></small></div>
    <button class="ab-ic" id="ab-search" aria-label="Пошук скрізь">${SVG.searchBig}</button>
  </header>
  <div class="folder-bar" id="folder-bar" role="status" hidden></div>
  <div class="main">
    <nav class="strip" id="strip" aria-label="Бічні панелі">
      <button data-lp="files" class="on" title="Файли гри" aria-label="Файли гри">${SVG.files}</button>
      <hr class="ssep">
      <button data-lp="rows" title="Рядки файлу" aria-label="Рядки файлу">${SVG.rows}</button>
      <hr class="ssep">
      <button data-lp="scenes" title="Сцени файлу" aria-label="Сцени файлу">${SVG.scene}</button>
      <hr class="ssep">
      <button data-lp="glossary" title="Глосарій проєкту" aria-label="Глосарій проєкту">${SVG.book}</button>
    </nav>
    <aside class="tree" id="lpanel" aria-label="Бічна панель: файли й рядки">
      <div class="mtabs" id="mtabs" role="group" aria-label="Бічна панель"><button data-lt="files">Файли</button><button data-lt="rows">Рядки</button><button data-lt="scenes">Сцени</button><button data-lt="glossary">Глосарій</button><button class="ab-ic" id="mt-open" aria-label="Відкрити файли або вставити JSON" title="Відкрити файли або вставити JSON">${SVG.import}</button><button class="ab-ic" id="mt-search" aria-label="Пошук скрізь">${SVG.searchBig}</button></div>
      <div class="ph"><span class="grow" id="lp-title">Файли гри</span><button class="ico ico-btn" id="lp-search" type="button" aria-label="Знайти скрізь (Ctrl+K)" title="Знайти скрізь (Ctrl+K або двічі Shift)">${SVG.search}</button><span class="ico" id="lp-close" title="Сховати панель" role="button" aria-label="Сховати панель">—</span></div>
      <div class="treebody" id="tree"><div class="ph card-ph" data-card="files"><span class="grow">Файли гри</span><span class="ico" data-hide-left="files" role="button" tabindex="0" aria-label="Сховати панель «Файли гри»" title="Сховати">—</span></div><div class="tree-q"><div class="fin">${SVG.search}<input class="qin" id="fq" placeholder="Пошук у файлах гри" aria-label="Пошук у файлах гри" autocomplete="off" spellcheck="false"></div></div><div class="tree-act" id="tree-act"></div>${GROUPS_HTML}<div id="tree-list"></div></div>
      <div class="rz rz-y" id="rz-y" role="separator" aria-orientation="horizontal" aria-label="Розділ між файлами й рядками" aria-valuemin="15" aria-valuemax="85" tabindex="0" title="Потягніть, щоб змінити співвідношення (подвійний клік — навпіл)" hidden></div>
      <div class="slist" id="lp-rows" hidden>
        <div class="ph card-ph" data-card="rows"><span class="grow">Рядки файлу</span><span class="ico" data-hide-left="rows" role="button" tabindex="0" aria-label="Сховати панель «Рядки файлу»" title="Сховати">—</span></div>
        <div class="fh"><div class="fin">${SVG.search}<input class="qin" id="q2" placeholder="Пошук рядків" aria-label="Пошук рядків"></div><div class="chips2"><button class="chip" id="sortbtn" aria-haspopup="menu">↕ За порядком</button><span class="chipsHost" id="chips2"></span></div></div>
        <div class="sl-body" id="slist"></div>
      </div>
      ${SCENES_HTML}
      ${GLOSSARY_HTML}
    </aside>
    <div class="rz rz-x" id="rz-x" role="separator" aria-orientation="vertical" aria-label="Ширина бічної панелі" aria-valuemin="200" aria-valuemax="640" tabindex="0" title="Потягніть, щоб змінити ширину (подвійний клік — стандартна)"></div>
    <main class="editor" id="main">
      <div class="tabs"><span class="tabs-host" id="tabs-host"></span></div>
      <div class="view" id="v-table">
        <div class="crumbs" id="crumbs"></div>
        <div class="filters"><div class="fin">${SVG.search}<input class="qin" id="q" placeholder="Фільтр у цьому файлі" aria-label="Фільтр"></div><span class="chipsHost" id="chips1"></span><span id="tagfilter"></span>
          <div class="r"><button class="chip" id="spkbtn">Мовець ▾</button><button class="chip" id="lenbtn">Довжина ▾</button></div></div>
        <div class="bulk" id="bulk"><b id="bulkn">0</b><span id="bulkt"></span><button id="bb-ok" title="Надіслати вибрані переклади">Надіслати</button><button id="bb-appr" title="Вичитати вибрані переклади (рядки, що ще не надіслано, надсилаються й вичитуються разом)">Вичитати</button><button id="bb-tm" title="Підставити збіг із пам’яті перекладів (від 70%) у порожні вибрані рядки">Підставити з пам’яті</button><button id="bb-clear" class="ghost">Скасувати вибір</button></div>
        <div class="gridwrap"><div class="grid" id="grid" role="grid" aria-label="Рядки файлу"></div></div>
        <div class="legend-bar" aria-label="Умовні позначення"><span><i class="sd new"></i>без перекладу</span><span><i class="sd draft"></i>чернетка</span><span><i class="sd done"></i>надіслано</span><span><i class="sd appr"></i>вичитано</span><span><i class="sd qa"></i>є помилка QA</span><span>${SVG.cmt}коментар</span></div>
      </div>
      <div class="view" id="v-focus">${FOCUS_HTML}</div>
      <div class="view" id="v-scene">${SCENE_HTML}</div>
    </main>
    ${SIDE_HTML}
  </div>
  <nav class="bnav" id="bnav" aria-label="Розділи"><button data-bn="files" aria-label="Файли"><svg viewBox="0 0 16 16"><path d="M2.5 4.5v8h11v-6.5h-6l-1.5-1.5z"/></svg><span>Файли</span></button><button data-bn="rows" aria-label="Рядки"><svg viewBox="0 0 16 16"><path d="M3 4h10M3 8h10M3 12h10"/></svg><span>Рядки</span></button><button data-bn="edit" aria-label="Редактор"><svg viewBox="0 0 16 16"><path d="M3 13l.7-3L11 2.7a1.4 1.4 0 0 1 2 2L5.7 12z"/></svg><span>Редактор</span></button><button data-bn="help" aria-label="Вказівки"><svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5"/><path d="M6.3 6.3a1.8 1.8 0 1 1 2.6 1.6c-.6.3-.9.7-.9 1.4M8 11.6v.1"/></svg><span>Вказівки</span></button><button data-bn="more" aria-label="Ще"><svg viewBox="0 0 16 16"><circle cx="3.5" cy="8" r="1" fill="currentColor"/><circle cx="8" cy="8" r="1" fill="currentColor"/><circle cx="12.5" cy="8" r="1" fill="currentColor"/></svg><span>Ще</span></button></nav>
  <footer class="status">
    <span class="ok" id="sb-save"></span><span id="sb-load" class="busy" role="status" hidden></span><span id="sb-fmt"></span><span id="sb-qa"></span><span id="st-sel"></span>
    <span id="sb-sync" class="sbtn" role="button" tabindex="0" title="Налаштування синхронізації"></span><span id="sb-build" class="sbtn" role="button" tabindex="0" title="Зібрати (F5)"></span>
    <div class="r"><span id="sb-file"></span><span id="sb-sess"></span></div>
  </footer>
</div></div>
<div class="scrim" id="scrim"></div>
<div class="pop cfgpop projpop" id="projpop" role="menu" aria-label="Проєкт" hidden></div>
<div class="pop cfgpop" id="cfgpop" role="menu" aria-label="Що запускати" hidden></div>
<div class="pop" id="fpop" role="dialog" aria-label="Параметри" hidden></div>
<div class="pop keys" id="keypop" role="dialog" aria-label="Гарячі клавіші" hidden>
  <div class="kh">Гарячі клавіші</div>
  <div class="kr"><span>Відкрити рядок у редагуванні</span><kbd>Enter</kbd><kbd>2× клік</kbd></div>
  <div class="kr"><span>Наступний / попередній рядок</span><kbd>↓</kbd><kbd>↑</kbd></div>
  <div class="kr"><span>У редагуванні: наступний / попередній у списку</span><kbd>Alt</kbd><kbd>↓</kbd></div>
  <div class="kr"><span>У редагуванні: вставити оригінал у переклад</span><kbd>Alt</kbd><kbd>O</kbd></div>
  <div class="kr"><span>Надіслати й далі</span><kbd>Ctrl</kbd><kbd>Enter</kbd></div>
  <div class="kr"><span>Змінити переклад у комірці таблиці</span><kbd>2× клік</kbd></div>
  <div class="kr"><span>Запустити вибрану збірку (файл або гра)</span><kbd>F5</kbd></div>
  <div class="kr"><span>Знайти скрізь</span><kbd>Ctrl</kbd><kbd>K</kbd><kbd>⇧</kbd><kbd>⇧</kbd></div>
  <div class="kr"><span>Закрити вікно чи меню</span><kbd>Esc</kbd></div>
</div>
<div class="sd-wrap" id="sd" hidden><div class="sd-box" role="dialog" aria-modal="true" aria-label="Пошук скрізь"><input id="sd-in" placeholder="Рядки, файли, терміни…" aria-label="Пошук скрізь" autocomplete="off"><div id="sd-res" role="listbox" aria-label="Результати"></div><div class="sd-foot">↑↓ вибір · Enter відкрити · Esc закрити</div></div></div>
${WINDOW_CONTROLS_HTML}`;

export async function start(root: HTMLElement): Promise<void> {
  const store = new IdbStore('default');
  setProject('default');
  let saved: SavedProject;
  try { saved = (await store.load()) ?? emptyProject('Новий проєкт'); }
  catch { saved = emptyProject('Новий проєкт'); }
  const mq = matchMedia('(max-width: 760px)');
  const s: State = {
    views: [], game: [], saved, current: null, open: [], group: null, groupSel: null, picked: new Set(), cur: null, scene: null, mode: mq.matches ? 'edit' : 'table', filter: 'all', q: '', speaker: null, lenFilter: 'all', sort: 'order', compact: ls('transly.compact') === '1', kb: false,
    checked: new Set(), sideTab: 'panel', sideOn: ['panel'], saveOk: true, savedAt: null, who: saved.settings.who, phone: mq.matches,
    leftTab: { table: 'files', edit: 'rows', scene: 'scenes' }, leftOpen: !mq.matches, leftBoth: false, rightOpen: false, collapsed: new Set(), sess: { n: 0, t0: Date.now() }, lastBuild: null,
  };
  const fromSnapshot = viewsFromSnapshot(saved);
  if (fromSnapshot.length) { s.views = fromSnapshot; s.current = fromSnapshot[0]!.name; s.open = [s.current]; }
  let lastHandle: (DirHandle & { name: string }) | null = null;
  let dataDir: string | null = null;
  /** The folder remembered for the project (it changes when another one is picked or forgotten). */
  const desktopDir = (): string | null => (isDesktop() ? rememberedGameDir() : null);
  try { lastHandle = (await loadHandle('default')) as typeof lastHandle; } catch { lastHandle = null; }
  const autosave = new Autosave(store, 400, ok => { s.saveOk = ok; if (ok) s.savedAt = Date.now(); renderStatus(); });
  let tmCache: ReturnType<typeof buildTm> | null = null;
  let tmStale = false, tmBuiltAt = 0;
  let unitMap = new Map<string, Unit>();
  let dupCache: { views: State['views']; idx: DupIndex } | null = null;

  const input = el('input');
  input.type = 'file'; input.hidden = true; input.id = 'folder-input';
  input.setAttribute('webkitdirectory', ''); input.setAttribute('aria-label', 'Папка гри');
  root.innerHTML = SHELL;
  root.appendChild(input);
  initWindowControls(() => autosave.flush());
  document.documentElement.dataset.booted = '1';

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
  /**
   * Several files shown as one table: the rows are copies whose key is `file␟key`, and this object reads and writes
   * the entries of the files they came from, so everything that works on one file works on the group unchanged.
   */
  const groupEntries = new Proxy({} as Record<string, Entry>, {
    get: (_, k) => { const r = typeof k === 'string' ? splitKey(k) : null; return r ? s.saved.files[r.file]?.[r.key] : undefined; },
    set: (_, k, v: Entry) => { const r = typeof k === 'string' ? splitKey(k) : null; if (r) (s.saved.files[r.file] ??= {})[r.key] = v; return !!r; },
    deleteProperty: (_, k) => { const r = typeof k === 'string' ? splitKey(k) : null; if (r && s.saved.files[r.file]) delete s.saved.files[r.file]![r.key]; return true; },
    has: (_, k) => { const r = typeof k === 'string' ? splitKey(k) : null; return !!r && !!s.saved.files[r.file]?.[r.key]; },
    ownKeys: () => (s.group ?? []).flatMap(f => (s.groupSel ? [...(s.groupSel.keys.get(f) ?? [])].filter(k => s.saved.files[f]?.[k]) : Object.keys(s.saved.files[f] ?? {})).map(k => f + SEP + k)),
    getOwnPropertyDescriptor: (_, k) => { const r = typeof k === 'string' ? splitKey(k) : null; const v = r && s.saved.files[r.file]?.[r.key]; return v ? { value: v, enumerable: true, configurable: true, writable: true } : undefined; },
  });
  let groupCache: { views: State['views']; names: string; sel: State['groupSel']; view: FileView } | null = null;
  const groupView = (): FileView | null => {
    if (!s.group?.length) return null;
    const names = s.group.join('\n');
    if (!groupCache || groupCache.views !== s.views || groupCache.names !== names || groupCache.sel !== s.groupSel) {
      const units: Unit[] = [];
      for (const f of s.group) {
        const only = s.groupSel?.keys.get(f);
        for (const u of s.views.find(v => v.name === f)?.units ?? []) if (!only || only.has(u.key)) units.push({ ...u, key: f + SEP + u.key });
      }
      groupCache = { views: s.views, names, sel: s.groupSel, view: { name: GROUP, label: '', units } };
    }
    return groupCache.view;
  };
  /** The groups' index, rebuilt when the project or the groups change. */
  let groupRev = 0;
  let gIdx: { saved: SavedProject; rev: number; idx: GroupIndex; byId: Map<string, Group> } | null = null;
  const groupIndex = (): NonNullable<typeof gIdx> => {
    if (!gIdx || gIdx.saved !== s.saved || gIdx.rev !== groupRev) gIdx = { saved: s.saved, rev: groupRev, idx: new GroupIndex(s.saved), byId: new Map(liveGroups(s.saved).map(g => [g.id, g])) };
    return gIdx;
  };
  const ctx: Ctx = {
    s, autosave,
    entries: file => (file === GROUP ? groupEntries : (s.saved.files[file] ??= {})),
    qaOpts, lineLimit,
    usage: () => { if (!usageCache || usageCache.game !== s.game) usageCache = { game: s.game, u: buildUsage(s.game, f => s.saved.labels?.[f]) }; return usageCache.u; },
    gameDir: () => dataDir,
    built: n => { s.lastBuild = { at: Date.now(), n }; renderTop(); },
    names: () => { if (!namesCache || namesCache.views !== s.views) namesCache = { views: s.views, idx: new GameNameIndex(s.views) }; return namesCache.idx; },
    speaker: u => speakerOf(u, s.saved.speakers),
    view: () => (s.current === GROUP ? groupView() : s.views.find(v => v.name === s.current) ?? null),
    unit: key => unitMap.get(key),
    visible: () => visibleUnits(true),
    tm: () => {
      if (!tmCache || (tmStale && Date.now() - tmBuiltAt > 1000)) { tmCache = buildTm(s); tmBuiltAt = Date.now(); tmStale = false; }
      return tmCache;
    },
    invalidateTm: () => { tmCache = null; tmStale = false; },
    softTm: () => { tmStale = true; },
    dups: () => { if (!dupCache || dupCache.views !== s.views) dupCache = { views: s.views, idx: new DupIndex(s.views) }; return dupCache.idx; },
    persist: () => autosave.queue(s.saved),
    stage: () => 'translate',
    commit: (changes, kind, what) => { const id = commitRows(file => ctx.entries(file), changes, kind, s.who, Date.now(), what); s.sess.n += changes.length; return id; },
    render: () => renderAll(),
    open: (file, key) => openRow(file, key),
    openRows: (title, rows, gid) => openRows(title, rows, gid),
    openFile: file => { openFile(file); renderAll(); },
    groupsChanged: () => groupsChanged(),
    groupOf: (file, key) => { const g = groupIndex(); const id = g.idx.groupOf(file, key); return id ? g.byId.get(id) ?? null : null; },
    select: (key, mode) => {
      s.cur = key;
      if (mode) setMode(mode, false);
      // In the scene mode a row of another scene brings that scene in.
      if (s.mode === 'scene') s.scene = sceneIdOf(ctx, key);
      if (s.phone) { s.leftOpen = false; s.rightOpen = false; }
      renderAll();
      if (s.mode === 'table') { reveal('grid', key); document.querySelector<HTMLElement>(`.gr[data-key="${CSS.escape(key)}"]`)?.scrollIntoView({ block: 'nearest' }); }
      else if (s.mode === 'scene') focusCard(key);
      else { reveal('slist', key); document.querySelector<HTMLElement>(`.si[data-key="${CSS.escape(key)}"]`)?.scrollIntoView({ block: 'nearest' }); $('#i-tr').focus(); }
    },
  };

  /* ---------- data helpers ---------- */
  const entryOf = (u: Unit): Entry | undefined => (s.current === GROUP ? groupEntries[u.key] : s.current ? s.saved.files[s.current]?.[u.key] : undefined);
  /** The name shown for what is open: a file, or the group. */
  const currentLabel = (): string => (s.current === GROUP ? groupTitle() : s.current ?? '');
  const groupTitle = (): string => s.groupSel?.title ?? (s.group && s.group.length === s.views.length ? 'Усі файли разом' : `Група з ${s.group?.length ?? 0} файлів`);
  /** Short key for the table: `msg[5]` for text, `choice[5.2]` for choice options, database keys as they are; in a group the file comes first. */
  const shortKey = (full: string): string => {
    const r = splitKey(full);
    const body = shortKeyOf(r ? r.key : full);
    return r ? `${r.file.split('/').pop()!.replace(/\.json$/, '')} · ${body}` : body;
  };
  const shortKeyOf = (key: string): string => {
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
    switch (f) {
      case 'new': return (e?.status ?? 'new') === 'new';
      case 'draft': return e?.status === 'draft';
      case 'done': return e?.status === 'done';
      case 'appr': return e?.status === 'appr';
      case 'qa': return shownStatus(ctx, u, e) === 'qa';
      case 'cm': return threadsOf(e?.comments).length > 0;
      default: return true;
    }
  };
  function visibleUnits(withStatus: boolean): Unit[] {
    const v = ctx.view();
    if (!v) return [];
    const ents = ctx.entries(v.name);
    const list = v.units.filter(u => inContext(u, ents[u.key]) && (!withStatus || matchesStatus(u, ents[u.key], s.filter)));
    if (s.sort === 'order') return list;
    // Array.sort is stable: rows with the same rank keep the order of the file.
    const rank = (u: Unit): number => {
      const e = ents[u.key];
      if (s.sort === 'new') return e?.target ? 1 : 0;
      if (s.sort === 'qa') return shownStatus(ctx, u, e) === 'qa' ? 0 : 1;
      return -u.source.length;
    };
    return list.map(u => [rank(u), u] as const).sort((a, b) => a[0] - b[0]).map(x => x[1]);
  }

  /* ---------- where the translator was ---------- */
  /** The open file, the selected row, filters, search, sort and the list's scroll: back where they were after a restart. */
  let uiRestored = false;
  function saveUi(): void {
    if (!uiRestored || !s.current || s.current === GROUP) return;
    try { localStorage.setItem(UI_KEY, JSON.stringify({ current: s.current, cur: s.cur, filter: s.filter, q: s.q, speaker: s.speaker, sort: s.sort, mode: s.mode, scroll: document.getElementById('slist')?.scrollTop ?? 0 })); } catch { /* private mode */ }
  }
  function restoreUi(): void {
    // Before the game's files are read there is nothing to go back to; try again once they are.
    if (uiRestored || !s.views.length) return;
    let u: { current?: string; cur?: string | null; filter?: Filter; q?: string; speaker?: string | null; sort?: SortMode; mode?: Mode; scroll?: number } = {};
    try { u = JSON.parse(ls(UI_KEY) ?? '{}') as typeof u; } catch { /* damaged: start fresh */ }
    uiRestored = true;
    if (!u.current || !s.views.some(v => v.name === u.current)) return;
    if (s.current !== u.current) openFile(u.current);
    if (u.filter && FILTERS.some(f => f[0] === u.filter)) s.filter = u.filter;
    s.q = u.q ?? ''; s.speaker = u.speaker ?? null;
    if (u.sort && u.sort in SORT_LABEL) s.sort = u.sort;
    // The old review mode is gone: a saved one opens as the editor; the scene mode needs a file with scenes.
    let um: Mode | undefined = (u.mode as string | undefined) === 'review' ? 'edit' : u.mode;
    if (um === 'scene') { if (hasScenes(ctx)) s.scene = sceneIdOf(ctx, u.cur ?? null); else um = 'edit'; }
    if (um && (!s.phone || um !== 'table') && s.mode !== um) s.mode = um;
    if (u.cur && unitMap.has(u.cur)) s.cur = u.cur;
    else if (s.mode !== 'table') s.cur = ctx.visible()[0]?.key ?? null;
    const top = u.scroll ?? 0;
    if (top) setTimeout(() => { const l = document.getElementById('slist'); if (l) l.scrollTop = top; }, 0);
  }

  /* ---------- rendering ---------- */
  const lp = (): LeftTab | null => (s.leftOpen ? s.leftTab[s.mode] : null);

  function renderLayout(): void {
    const ide = $('#ide');
    const l = lp();
    ide.className = `ide mode-${s.mode === 'table' ? 'table' : 'focus'}${s.mode === 'scene' ? ' scene-mode' : ''} ${l ? 'lp-open' : 'lp-closed'}${s.phone ? ' sz-s' : ''}${s.rightOpen ? ' sheet-open' : ''}${!s.sideOn.length && !s.phone ? ' rp-collapsed' : ''}${s.compact ? ' compact' : ''}${s.kb ? ' kb' : ''}`;
    const both = (l === 'files' || l === 'rows') && s.leftBoth && !s.phone;
    $('#lpanel').classList.toggle('split', both);
    $('#rz-y').hidden = !both;
    document.querySelectorAll<HTMLElement>('#strip button').forEach(b => { const on = both || b.dataset.lp === l; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
    $('#tree').hidden = !both && l !== 'files';
    $('#lp-rows').hidden = !both && l !== 'rows';
    $('#lp-gl').hidden = l !== 'glossary';
    $('#lp-sc').hidden = l !== 'scenes';
    $('#lp-title').textContent = both ? 'Файли й рядки' : l === 'rows' ? `Рядки · ${currentLabel()}` : l === 'glossary' ? 'Глосарій' : l === 'scenes' ? `Сцени · ${currentLabel()}` : 'Файли гри';
    document.querySelectorAll<HTMLElement>('#mtabs [data-lt]').forEach(b => { const on = b.dataset.lt === s.leftTab[s.mode]; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
    document.querySelectorAll<HTMLElement>('#seg [data-m]').forEach(b => { const on = b.dataset.m === s.mode; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
    const here = s.rightOpen ? 'help' : s.leftOpen ? s.leftTab[s.mode] : s.mode === 'table' ? 'rows' : 'edit';
    document.querySelectorAll<HTMLElement>('#bnav [data-bn]').forEach(b => { const on = b.dataset.bn === here; b.classList.toggle('on', on); b.setAttribute('aria-current', String(on)); });
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

  let fileQ = '';
  /** The coloured dot of the group a file is in. */
  const fileGroupDot = (name: string): string => {
    const g = ctx.groupOf(name, '\u0000');
    return g ? `<span class="gdot" style="background:${esc(g.color ?? '#8b72e8')}" role="img" aria-label="Група: ${esc(g.name)}" title="Група: ${esc(g.name)}"></span>` : '';
  };
  function renderTree(): void {
    renderGroupsBlock(ctx);
    const box = $('#tree-list');
    $('#tree-act').innerHTML = s.views.length > 1 ? `<button class="btn" data-act="group-all" title="Усі рядки всіх файлів в одній таблиці">Усі файли разом</button>${s.picked.size ? `<button class="btn p" data-act="group-picked">Відкрити вибрані (${s.picked.size})</button><button class="btn" id="tree-grp" aria-haspopup="menu" title="Додати вибрані файли до групи">У групу ▾</button><button class="btn" data-act="group-clear" title="Зняти позначки">✕</button>` : '<span class="hint">Ctrl+клік по файлах, щоб відкрити їх разом</span>'}` : '';
    if (!s.views.length) { box.innerHTML = '<div class="msg-empty">Папку гри ще не відкрито</div>'; return; }
    let skip: number | null = null;
    const q = fileQ.trim().toLowerCase();
    let nodes = treeNodes();
    if (q) {
      const hit = (n: { name: string; label: string }): boolean => `${n.name} ${n.label} ${s.views.find(x => x.name === n.name)?.label ?? ''}`.toLowerCase().includes(q);
      // Folders stay only when a file inside them matches.
      nodes = nodes.filter((n, i) => {
        if (n.t === 'f') return hit(n);
        for (let j = i + 1; j < nodes.length && nodes[j]!.d > n.d; j++) if (nodes[j]!.t === 'f' && hit(nodes[j]!)) return true;
        return false;
      });
      if (!nodes.length) { box.innerHTML = '<div class="msg-empty">Нічого не знайдено</div>'; return; }
    }
    box.innerHTML = nodes.map(n => {
      if (!q && skip !== null && n.d > skip) return '';
      skip = null;
      if (n.t === 'd') {
        const c = !q && s.collapsed.has(n.name);
        if (c) skip = n.d;
        return `<div class="node dir" style="--d:${n.d}" data-dir="${esc(n.name)}" role="button" tabindex="0" aria-expanded="${!c}"><span class="chev">${c ? '▸' : '▾'}</span><span class="ic dir">▤</span><span class="nm">${esc(n.label)}</span></div>`;
      }
      const v = s.views.find(x => x.name === n.name)!;
      const st = statsOf(v.units, s.saved.files[v.name] ?? {});
      const pc = Math.round(100 * st.approved / st.total);
      const [ic, lab] = fileIcon(n.name);
      const cur = n.name === s.current;
      return `<div class="node ${cur ? 'cur' : ''} ${s.picked.has(n.name) ? 'pick' : ''} ${!pc && !st.translated ? 'idle' : ''}" style="--d:${n.d}" data-file="${esc(n.name)}" draggable="true" role="button" tabindex="0" title="${cur ? 'Відкрито · ' : ''}${v.label ? esc(v.label) + ' · ' : ''}Вичитано ${pc}% · перекладено ${Math.round(100 * st.translated / st.total)}%"><span class="chev"></span><span class="ic ${ic}">${lab}</span><span class="nm">${fileGroupDot(n.name)}${v.label ? `${esc(v.label)}<span class="lc">${esc(n.label.replace(/\.json$/, ''))}</span>` : esc(n.label)}</span><span class="mini"><i class="${pc === 100 ? 'f' : ''}" style="width:${Math.max(pc, Math.round(100 * st.translated / st.total))}%"></i></span><span class="pc ${pc === 100 ? 'full' : ''}">${pc}%</span></div>`;
    }).join('');
  }

  function chipsHtml(): string {
    const v = ctx.view();
    if (!v) return '';
    const ents = ctx.entries(v.name);
    const ctxUnits = v.units.filter(u => inContext(u, ents[u.key]));
    return FILTERS.map(([f, l]) => {
      const n = f === 'all' ? ctxUnits.length : ctxUnits.filter(u => matchesStatus(u, ents[u.key], f)).length;
      return `<button class="chip ${s.filter === f ? 'on' : n === 0 && f !== 'all' ? 'zero' : ''}" data-filter="${f}" aria-pressed="${s.filter === f}">${l} <span class="n">${n}</span></button>`;
    }).join('');
  }

  /** The speaker and length buttons show the chosen value themselves, with a cross to drop it. */
  function renderFilterButtons(): void {
    const set = (id: string, on: boolean, label: string, clear: string): void => {
      const b = $(id);
      b.classList.toggle('on', on);
      b.innerHTML = `${esc(label)} ▾${on ? `<span class="x" data-clear="${clear}" title="Скинути" role="button" tabindex="0" aria-label="Скинути фільтр">✕</span>` : ''}`;
    };
    set('#spkbtn', s.speaker !== null, s.speaker === null ? 'Мовець' : s.speaker || 'Без мовця', 'speaker');
    set('#lenbtn', s.lenFilter !== 'all', s.lenFilter === 'all' ? 'Довжина' : LEN_LABEL[s.lenFilter], 'len');
  }

  /** The mark of a row that has discussions: open ones, or only settled ones. */
  const cmIcon = (e: Entry | undefined): string => {
    const th = e?.comments?.length ? threadsOf(e.comments) : [];
    return !th.length ? '' : th.some(x => !x.resolved) ? SVG.cmt : SVG.cmtDone;
  };
  function rowHtml(u: Unit, n: number): string {
    const e = entryOf(u), sel = u.key === s.cur, chk = s.checked.has(u.key);
    const st = shownStatus(ctx, u, e);
    const hits = enforced();
    const len = e?.target ? `${displayLength(e.target)}/${displayLength(u.source)}` : '—';
    return `<div class="gr ${sel ? 'sel' : ''} ${chk ? 'chk' : ''}" role="row" tabindex="${sel ? 0 : -1}" aria-selected="${sel}" data-key="${esc(u.key)}">
      <div class="ln" role="gridcell"><span class="num">${n}</span><input type="checkbox" class="rc" ${chk ? 'checked' : ''} aria-label="Вибрати рядок ${n}"></div>
      <div class="st" role="gridcell"><span class="sd ${st}" title="${STATUS_LABEL[st]}"${st === 'qa' ? ` data-hc="qa" data-hk="${esc(u.key)}"` : ''}></span><span class="vh">${STATUS_LABEL[st]}</span></div>
      <div role="gridcell"><span class="key" title="${esc(u.key)}">${esc(shortKey(u.key))}</span>${cmIcon(e)}</div>
      <div class="who" role="gridcell">${esc(ctx.speaker(u))}</div>
      <div class="src" role="gridcell">${markup(flow(u.source), hits)}</div>
      <div class="tr ${e?.target ? '' : 'empty'}" role="gridcell" title="Клікніть, щоб писати прямо тут">${e?.target ? markup(flow(e.target)) : '—'}</div>
      <div class="len ${lenCls(u, e)}" role="gridcell" title="Символів у перекладі / в оригіналі">${len}</div></div>`;
  }
  let enforcedCache: { terms: SavedProject['terms']; en: string[] } | null = null;
  function enforced(): string[] {
    if (!enforcedCache || enforcedCache.terms !== s.saved.terms || enforcedCache.en.length !== s.saved.terms.filter(t => t.qa !== false).length) enforcedCache = { terms: s.saved.terms, en: s.saved.terms.filter(t => t.qa !== false).map(t => t.en) };
    return enforcedCache.en;
  }

  const siHtml = (u: Unit, n: number): string => {
    const e = entryOf(u), st = shownStatus(ctx, u, e);
    return `<div class="si ${u.key === s.cur ? 'sel' : ''}" data-key="${esc(u.key)}" role="button" tabindex="0"><span class="sd ${st}" title="${STATUS_LABEL[st]}"></span><div><div class="a"><span>${n}</span><b>${esc(ctx.speaker(u) || u.kind)}</b><span>${esc(shortKey(u.key))}</span>${cmIcon(e)}</div><div class="s">${esc(flow(u.source))}</div><div class="t">${e?.target ? esc(flow(e.target)) : '—'}</div></div></div>`;
  };
  const emptyHtml = '<div class="empty-state"><b>Нічого не знайдено</b><span>Немає рядків за поточним пошуком і статусом.</span><button class="btn" data-reset>Скинути фільтри</button></div>';

  const SORT_LABEL: Record<SortMode, string> = { order: 'За порядком', new: 'Без перекладу спершу', qa: 'Помилки спершу', long: 'Найдовші спершу' };
  function renderRowsList(): void {
    $('#chips2').innerHTML = (s.speaker !== null ? `<button class="chip on" data-clear="speaker" title="Скинути фільтр за мовцем">${esc(s.speaker || 'Без мовця')} ✕</button>` : '') + chipsHtml();
    $('#sortbtn').textContent = `↕ ${SORT_LABEL[s.sort]}`;
    $('#sortbtn').classList.toggle('on', s.sort !== 'order');
    const v = ctx.view();
    if (!v) { $('#slist').innerHTML = '<div class="msg-empty">Оберіть файл</div>'; return; }
    const idx = new Map(v.units.map((u, i) => [u.key, i + 1]));
    const list = visibleUnits(true);
    const box = $('#slist');
    if (list.length) mountRows('slist', box, box, '', list.map(u => u.key), i => siHtml(list[i]!, idx.get(list[i]!.key)!), s.current ?? '', 72, 'si');
    else box.innerHTML = emptyHtml;
  }


  function renderTabs(): void {
    $('#tabs-host').innerHTML = s.open.map(n => {
      const v = s.views.find(x => x.name === n);
      if (!v) return '';
      const ents = s.saved.files[n] ?? {};
      let qa = 0;
      for (const u of v.units) { const e = ents[u.key]; if (e && e.target && activeIssues(u, e, qaOpts()).some(i => i.severity === 'bad')) qa++; }
      const [ic, lab] = fileIcon(n);
      const on = n === s.current;
      return `<div class="tab ${on ? 'on' : ''}"><button class="tb" data-tab="${esc(n)}" aria-current="${on}" title="${esc(v.label ? n + ' · ' + v.label : n)}"><span class="tico ${ic === 'map' ? '' : 'j'}">${lab}</span>${esc(n.split('/').pop() ?? n)}${qa ? `<span class="badge" title="Проблеми QA у файлі">${qa}</span>` : ''}</button><button class="x" data-closetab="${esc(n)}" aria-label="Закрити вкладку ${esc(n)}">✕</button></div>`;
    }).join('') + (s.group ? `<div class="tab ${s.current === GROUP ? 'on' : ''}"><button class="tb" data-tab="${GROUP}" aria-current="${s.current === GROUP}" title="${esc(s.group.join(', '))}"><span class="tico j">▦</span>${esc(groupTitle())}</button><button class="x" data-closetab="${GROUP}" aria-label="Закрити групу">✕</button></div>` : '');
    document.querySelector<HTMLElement>('#tabs-host .tab.on')?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }

  function renderTable(): void {
    const v = ctx.view();
    const grid = $('#grid');
    $('#chips1').innerHTML = chipsHtml();
    renderFilterButtons();
    ($('#q') as HTMLInputElement).value = s.q;
    if (!v) { grid.innerHTML = ''; return; }
    const idx = new Map(v.units.map((u, i) => [u.key, i + 1]));
    const list = visibleUnits(true);
    const ids = list.map(u => u.key);
    const nSel = ids.filter(k => s.checked.has(k)).length;
    const hasWho = v.units.some(u => ctx.speaker(u));
    grid.classList.toggle('no-who', !hasWho);
    grid.style.setProperty('--cols', hasWho ? '34px 22px 110px 96px minmax(160px,.9fr) minmax(180px,1fr) 78px' : '34px 22px 110px minmax(160px,.9fr) minmax(180px,1fr) 78px');
    let h = `<div class="gh" role="row"><div class="gcheck" role="columnheader"><input type="checkbox" id="selall" aria-label="Вибрати всі видимі рядки" ${nSel && nSel === ids.length ? 'checked' : ''}></div><div title="Статус" role="columnheader" class="s"><span class="vh">Статус</span></div><div class="s" role="columnheader">Ключ</div><div class="s" role="columnheader">Мовець</div><div role="columnheader">Оригінал · EN</div><div class="s" role="columnheader">Переклад · UK</div><div class="s" role="columnheader" title="Кількість знаків: переклад / оригінал (без керівних кодів). Рекомендація: якнайближче до оригіналу" style="justify-content:flex-end;border-right:0">К-сть зн.</div></div>`;
    // Every row has its place; a row is drawn when it comes near the screen: nothing is cut off, however long the file or the group is.
    if (list.length) mountRows('grid', grid, grid.parentElement!, h, ids, i => rowHtml(list[i]!, idx.get(list[i]!.key)!), s.current ?? '', 56);
    else grid.innerHTML = h + `<div class="empty-wrap" role="row"><div role="gridcell">${emptyHtml}</div></div>`;
    grid.classList.toggle('has-sel', nSel > 0);
    const all = $('#selall') as HTMLInputElement | null;
    if (all) all.indeterminate = nSel > 0 && nSel < ids.length;
    const hidden = s.checked.size - nSel;
    $('#bulk').classList.toggle('show', nSel > 0);
    $('#bulkn').textContent = String(nSel);
    $('#bulkt').textContent = ' вибрано' + (hidden ? ` · ще ${hidden} приховано фільтром, їх дія не торкається` : '');
    const cur = s.cur ? idx.get(s.cur) : undefined;
    $('#crumbs').innerHTML = `<span>${esc(s.current !== GROUP && s.current?.includes('/') ? s.current.split('/').slice(0, -1).join('/') : 'data')}</span>›<span>${esc(currentLabel())}</span>${cur && s.cur ? `›<b>${esc(ctx.unit(s.cur)?.context ?? '')}</b>` : ''}<span class="r">${cur ? `рядок ${cur} з ${v.units.length}` : `${v.units.length} рядків`}${list.length !== v.units.length ? ` · показано ${list.length}` : ''}</span>`;
  }

  function renderTop(): void {
    $('#proj-name').textContent = s.saved.name;
    $('#proj-av').textContent = (Array.from(s.saved.name.trim())[0] ?? 'T').toUpperCase();
    let total = 0, A = 0, D = 0, W = 0;
    for (const v of s.views) {
      total += v.units.length;
      const ents = s.saved.files[v.name] ?? {};
      for (const u of v.units) { const e = ents[u.key]; if (!e || !e.target) continue; if (e.status === 'appr') A++; else if (e.status === 'done') D++; else if (e.status === 'draft') W++; }
    }
    const cur = ctx.view();
    const nextU = cur && cur.name !== GROUP ? cur.units.find(u => !s.saved.files[cur.name]?.[u.key]?.target && u.kind !== 'name' && u.kind !== 'term') : undefined;
    publishWidget({ name: s.saved.name, file: s.current === GROUP ? '' : s.current ?? '', total, approved: A, done: D, draft: W, ...(cur && nextU ? { next: { file: cur.name, key: nextU.key, text: nextU.source.replace(/\s+/g, ' ').slice(0, 160) } } : {}) });
    $('#pg-a').style.width = total ? `${(100 * A) / total}%` : '0';
    $('#pg-b').style.width = total ? `${(100 * D) / total}%` : '0';
    $('#pg-c').style.width = total ? `${(100 * W) / total}%` : '0';
    $('#pg-txt').textContent = total ? `Перекладено ${Math.floor((100 * (A + D + W)) / total)}% (${(A + D + W).toLocaleString('uk-UA')} з ${total.toLocaleString('uk-UA')}) · вичитано ${Math.floor((100 * A) / total)}%` : 'Папку гри не відкрито';
    $('#pg').title = total ? `Вичитано ${Math.round((100 * A) / total)}% · Надіслано ${Math.round((100 * D) / total)}% · Чернетки ${Math.round((100 * W) / total)}% · Решта без перекладу` : '';
    const sy = loadSyncConfig();
    const lastSync = Math.max(sy.last, loadGithubConfig().last, loadClaudeConfig().last);
    $('#sb-sync').hidden = !lastSync; $('#sb-build').hidden = !s.lastBuild;
    $('#sb-sync').textContent = lastSync ? 'Синхр.: ' + new Date(lastSync).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' }) : 'Синхр.: ще не було';
    $('#sb-build').textContent = s.lastBuild ? `Збірка: ${new Date(s.lastBuild.at).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })} · ${s.lastBuild.n} рядків` : 'Збірки ще не було';
    ($('#cfg-btn') as HTMLButtonElement).disabled = !s.views.length;
    renderRunCfg();
    ($('#run-btn') as HTMLButtonElement).disabled = !s.views.length;
  }

  function renderStatus(): void {
    const v = ctx.view();
    const ents = v ? ctx.entries(v.name) : {};
    let qa = 0;
    if (v) for (const u of v.units) { const e = ents[u.key]; if (e && e.target && activeIssues(u, e, qaOpts()).some(i => i.severity === 'bad')) qa++; }
    const sv = $('#sb-save');
    sv.textContent = !s.saveOk ? '○ Не збережено: повторю спробу' : s.savedAt ? '● Збережено о ' + new Date(s.savedAt).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '● Зміни зберігаються автоматично';
    sv.className = s.saveOk ? 'ok' : 'bad';
    $('#sb-fmt').textContent = s.current && s.current !== GROUP ? FORMAT_LABEL[s.current.split('.').pop() ?? ''] ?? '' : '';
    $('#sb-qa').textContent = qa ? plural(qa, ['помилка QA', 'помилки QA', 'помилок QA']) : 'Помилок QA немає';
    $('#sb-qa').className = qa ? 'bad' : 'ok';
    const u = s.cur ? ctx.unit(s.cur) : undefined;
    $('#st-sel').textContent = u && v ? `Рядок ${v.units.indexOf(u) + 1} · ${STATUS_LABEL[shownStatus(ctx, u, entryOf(u))]}` : '';
    if (v) {
      const st = statsOf(v.units, ents);
      $('#sb-file').textContent = `${s.current === GROUP ? 'Група' : 'Файл'}: ${st.approved} / ${st.total} вичитано · ${st.done} надіслано`;
    } else $('#sb-file').textContent = '';
    const mins = Math.max(0, Math.round((Date.now() - s.sess.t0) / 60000));
    $('#sb-sess').textContent = `Сесія: ${s.sess.n} змін · ${mins} хв`;
    $('#ab-title').textContent = s.current ? currentLabel() : 'Transly';
    $('#ab-sub').textContent = v ? `${statsOf(v.units, ents).approved} / ${v.units.length} вичитано` : '';
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
    box.innerHTML = `<h2>${s.phone ? 'Відкрийте файли' : 'Відкрийте папку гри'}</h2>${s.phone ? 'На телефоні проєкт береться з комп’ютера: на ПК виберіть «Налаштування → Обмін проєктом через файл → Зберегти проєкт у файл», передайте файл сюди й відкрийте його, або вставте його вміст як текст. Так само можна відкрити файли самої гри.' : 'Оберіть папку <b>data</b> гри на RPG Maker (або саму папку гри), папку з файлами <b>.po</b>, <b>.csv</b>, <b>.rpy</b> (Ren’Py) чи JSON-локалізацією. Ваш переклад зберігається в цьому браузері, файли гри не змінюються.'}${(lastHandle || desktopDir()) ? `<p><button class="btn p" id="resume">Продовжити з папкою «${esc(lastHandle?.name ?? (desktopDir() ?? '').split(/[\\/]/).filter(Boolean).pop() ?? '')}»</button></p>` : ''}${s.phone ? `${claudeAvailable ? '<p><button class="btn p" id="cl2">Отримати з іншого пристрою (через Claude)</button></p>' : ''}<p><button class="btn p" id="imp2">Відкрити файли або вставити JSON…</button></p>` : '<p><button class="btn p" id="open2">Відкрити папку гри</button></p>'}`;
    return true;
  }

  function renderAll(): void {
    saveUi();
    renderLayout();
    renderTop();
    renderTabs();
    renderTree();
    if (renderMainEmpty()) { renderStatus(); return; }
    $('#v-table').style.display = '';
    $('#v-focus').style.display = '';
    if (lp() === 'rows' || s.leftBoth || s.mode === 'edit') renderRowsList();
    if (lp() === 'glossary') renderGlossaryPanel(ctx);
    if (lp() === 'scenes') renderScenesPanel(ctx);
    ($('#m-scene') as HTMLButtonElement).disabled = !hasScenes(ctx);
    if (s.mode === 'table') renderTable(); else if (s.mode === 'scene') renderSceneView(ctx); else renderFocus(ctx, isDesktop());
    renderSidePanel(ctx);
    renderStatus();
  }

  /* ---------- actions ---------- */
  function setMode(m: Mode, rerender = true): void {
    if (m === s.mode) return;
    if (m === 'scene') {
      if (!hasScenes(ctx)) { toast(s.current === GROUP ? 'Сцену видно у файлі, відкритому окремо: відкрийте його зі списку файлів' : 'У цьому файлі немає сцен: вони є лише в картах, спільних подіях і боях'); return; }
      s.scene = sceneIdOf(ctx, s.cur);
      s.leftTab.scene = 'scenes'; s.leftOpen = true; s.leftBoth = false;
    }
    s.mode = m;
    if (m === 'edit' && !ctx.visible().some(u => u.key === s.cur)) s.cur = ctx.visible()[0]?.key ?? null;
    if (m === 'scene' && !s.cur) { const idx = sceneIdOf(ctx, null); void idx; }
    if (rerender) { renderAll(); if (m === 'edit' && s.cur) $('#i-tr').focus(); else if (m === 'scene' && s.cur) focusCard(s.cur); }
  }

  function openFile(name: string): void {
    if (!s.views.some(v => v.name === name)) return;
    if (!s.open.includes(name)) s.open.push(name);
    s.current = name; s.q = ''; s.lenFilter = 'all'; s.checked.clear();
    s.filter = 'all';
    unitMap = new Map((ctx.view()?.units ?? []).map(u => [u.key, u]));
    s.cur = s.mode === 'table' ? null : ctx.visible()[0]?.key ?? null;
  }

  /** Show the rows of several files in one table (a group keeps its tab until it is closed). */
  function openGroup(names: string[]): void {
    const known = names.filter(n => s.views.some(v => v.name === n));
    if (!known.length) return;
    s.group = known; s.groupSel = null;
    s.current = GROUP; s.q = ''; s.lenFilter = 'all'; s.checked.clear();
    s.filter = 'all';
    unitMap = new Map((ctx.view()?.units ?? []).map(u => [u.key, u]));
    s.cur = null;
  }

  /** Show some rows of the game in one table: the table, not the editor, so the rows can be gone through and sent together. */
  function openRows(title: string, rows: { file: string; key: string }[], gid?: string): void {
    const keys = new Map<string, Set<string>>();
    for (const r of rows) { if (!s.views.some(v => v.name === r.file)) continue; let k = keys.get(r.file); if (!k) keys.set(r.file, k = new Set()); k.add(r.key); }
    if (!keys.size) { toast('Тут ще немає рядків'); return; }
    s.group = [...keys.keys()]; s.groupSel = { title, ...(gid ? { gid } : {}), keys };
    s.current = GROUP; s.q = ''; s.lenFilter = 'all'; s.checked.clear();
    s.filter = 'all';
    unitMap = new Map((ctx.view()?.units ?? []).map(u => [u.key, u]));
    s.cur = null;
    renderAll();
  }

  /** The groups, or what is in them, changed. */
  function groupsChanged(): void {
    groupRev++;
    // A table of one of the translator's groups follows it.
    if (s.groupSel?.gid && s.current === GROUP) {
      const id = s.groupSel.gid, g = s.saved.groups?.[id];
      const rows = g && !g.del ? groupRows(s.saved, s.views).get(id) ?? [] : [];
      const keys = new Map<string, Set<string>>();
      for (const r of rows) { let k = keys.get(r.file); if (!k) keys.set(r.file, k = new Set()); k.add(r.key); }
      s.group = [...keys.keys()]; s.groupSel = { ...s.groupSel, title: g && !g.del ? g.name : s.groupSel.title, keys };
      unitMap = new Map((ctx.view()?.units ?? []).map(u => [u.key, u]));
      if (s.cur && !unitMap.has(s.cur)) s.cur = null;
      s.checked.clear();
    }
    renderAll();
  }

  function closeTab(name: string): void {
    if (name === GROUP) {
      const viewing = s.current === GROUP;
      s.group = null; s.groupSel = null;
      if (viewing) {
        s.checked.clear();
        const next = s.open[s.open.length - 1];
        if (next) openFile(next); else { s.current = null; s.cur = null; }
      }
      renderAll(); return;
    }
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

  /** The small "reading the game" note in the status bar, for the quiet reading of the remembered folder. */
  const showLoad = (text: string | null): void => { const el0 = $('#sb-load'); el0.hidden = !text; el0.textContent = text ?? ''; };

  /**
   * `quiet` is for the folder remembered from an earlier session: the project is already on the screen (from its stored
   * copy of the originals), so the files are read in the background and nothing is replaced under the translator's hands.
   * `stale` tells that the choice was overtaken meanwhile (another folder was picked).
   */
  async function loadPicked(picked: PickedFile[], keep: boolean, opts: { quiet?: boolean; stale?: () => boolean } = {}): Promise<void> {
    const quiet = !!opts.quiet;
    if (quiet) showLoad('Читаю файли гри…');
    else {
      const box = emptyBox();
      box.innerHTML = '<h2>Читаю файли гри…</h2><div class="progress"><i id="bar"></i></div><span id="pct"></span>';
      $('#v-table').style.display = 'none'; $('#v-focus').style.display = 'none';
    }
    const { files, failed } = await readFiles(picked, (d, t) => { if (quiet) showLoad(`Читаю файли гри: ${d} з ${t}`); else { $('#bar').style.width = `${(d / t) * 100}%`; $('#pct').textContent = `${d} з ${t}`; } });
    if (quiet) showLoad(null);
    if (opts.stale?.()) return;
    const reset = ingest(files, keep);
    dataDir = isDesktop() ? dataDirOf(picked) : null;
    if (!s.views.length) { s.current = null; renderAll(); toast('У цих файлах немає тексту для перекладу'); return; }
    if (failed.length) toast(`Не вдалося прочитати файлів: ${failed.length}`);
    const fromBackup = picked.filter(f => f.fromBackup).length;
    let translated = 0;
    for (const v of s.views) for (const u of v.units) if (s.saved.files[v.name]?.[u.key]?.target) translated++;
    if (isDesktop() && !fromBackup && translated >= 10 && reset / translated >= 0.2) {
      // Many originals changed at once and there is no backup to read them from: most likely the folder already holds the translation.
      toast('Оригінали в папці гри змінилися майже скрізь, а резервної копії немає: схоже, там уже лежить переклад. Натисніть «Збірка (файл)» → «Повернути оригінали», потім відкрийте папку знову', { sticky: true });
    } else if (reset) toast(`Оригінал змінився в ${plural(reset, ['рядку', 'рядках', 'рядках'])}: їх повернуто в чернетки`);
    else if (fromBackup) toast('Оригінали прочитано з резервної копії гри (data.transly-orig)');
    s.open = s.open.filter(n => s.views.some(v => v.name === n));
    if (quiet && s.current && s.current !== GROUP && s.views.some(v => v.name === s.current)) unitMap = new Map((ctx.view()?.units ?? []).map(u => [u.key, u]));
    else { openFile(s.current && s.views.some(v => v.name === s.current) ? s.current : s.views[0]!.name); restoreUi(); }
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
    folderSeq++; // a folder chosen by hand beats the automatic restore that may still be running
    await loadFiles(picked.files);
    if (isDesktop()) {
      const root = rememberedGameDir();
      folder = root ? { kind: 'ok', root, dataDir, files: picked.files } : { kind: 'none' };
      folderHidden = false;
      renderFolderBar(); renderTop();
    }
  }

  /* ---------- the game folder of the project ---------- */
  let folder: FolderState = { kind: 'none' };
  /** The translator chose to work without the folder: the banner stays away until the next start. */
  let folderHidden = false;
  let folderSeq = 0;
  function renderFolderBar(): void {
    const bar = $('#folder-bar'), b = isDesktop() && !folderHidden ? folderBanner(folder) : null;
    if (!b || (folder.kind !== 'missing' && folder.kind !== 'other')) { bar.hidden = true; bar.replaceChildren(); return; }
    bar.hidden = false; bar.dataset.kind = folder.kind;
    bar.innerHTML = `<span class="fb-t" title="${esc(folder.root)}">${esc(b.text)}</span><span class="fb-a">${b.actions.includes('repick') ? '<button class="btn p" id="fb-repick">Вказати заново</button>' : ''}${b.actions.includes('use') ? '<button class="btn" id="fb-use">Усе одно використати</button>' : ''}<button class="btn" id="fb-hide">Працювати без папки</button></span>`;
  }
  async function readFolderQuietly(files: PickedFile[], seq: number): Promise<void> {
    try { await loadPicked(files, false, { quiet: true, stale: () => seq !== folderSeq }); }
    catch (err) { showLoad(null); toast(`Не вдалося прочитати файли гри: ${err instanceof Error ? err.message : 'невідома помилка'}`); }
  }
  /** At the start: find the project's folder again, check it is the same game, and read it in the background. */
  async function restoreFolder(): Promise<void> {
    if (!isDesktop()) return;
    const seq = ++folderSeq;
    const found = await reopenGameDir();
    if (seq !== folderSeq) return;
    folder = classifyFolder(found, s.views.map(v => v.name));
    // Nothing is written into a folder that is not this game's: without a data folder the build and the launch refuse.
    dataDir = folder.kind === 'ok' ? folder.dataDir : null;
    renderFolderBar(); renderTop();
    if (folder.kind === 'ok' && folder.files.length && !s.game.length) await readFolderQuietly(folder.files, seq);
  }
  function useFolderAnyway(): void {
    if (folder.kind !== 'other') return;
    const f = folder;
    folder = { kind: 'ok', root: f.root, dataDir: f.dataDir, files: f.files };
    dataDir = f.dataDir;
    renderFolderBar(); renderTop();
    void readFolderQuietly(f.files, ++folderSeq);
  }

  async function resume(): Promise<void> {
    if (!lastHandle && !desktopDir()) return;
    const files = desktopDir() ? await reopenGameDirDesktop() : await reopenHandle(lastHandle!);
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
  /* ---------- run configurations: what the ▶ button does (like IntelliJ's run selector) ---------- */
  type RunCfg = 'file' | 'game' | 'scene';
  const CFG: Record<RunCfg, { name: string; sub: string; desk: boolean }> = {
    file: { name: 'Збірка (файл)', sub: 'ZIP, папка або запис у файли гри', desk: false },
    game: { name: 'Збірка (гра)', sub: 'Записати переклад із чернетками й запустити гру для тестування', desk: true },
    scene: { name: 'Поточна сцена', sub: 'Те саме, але гра починається зі сцени вибраного рядка', desk: true },
  };
  const loadCfg = (): RunCfg => { try { const v = localStorage.getItem('transly.runcfg'); return (v === 'game' || v === 'scene') && isDesktop() ? v : 'file'; } catch { return 'file'; } };
  let runCfg: RunCfg = loadCfg();
  function renderRunCfg(): void {
    if (runCfg === 'game' && !isDesktop()) runCfg = 'file';
    $('#cfg-name').textContent = CFG[runCfg].name;
    $('#run-btn').title = `Запустити «${CFG[runCfg].name}» (F5)`;
    $('#run-btn').setAttribute('aria-label', `Запустити «${CFG[runCfg].name}»`);
  }
  function openCfgMenu(): void {
    const pop = $('#cfgpop'), btn = $('#cfg-btn');
    if (!pop.hidden) { pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); return; }
    pop.innerHTML = (Object.keys(CFG) as RunCfg[]).map(k => {
      const off = CFG[k].desk && !isDesktop();
      return `<div class="cfg-row ${k === runCfg ? 'on' : ''}"><button role="menuitemradio" aria-checked="${k === runCfg}" data-cfg="${k}" ${off ? 'disabled' : ''}><span class="cfg-t">${CFG[k].name}</span><small>${off ? 'Лише в застосунку на ПК' : CFG[k].sub}</small></button>${off ? '' : `<button class="cfg-go" data-cfg-run="${k}" title="Запустити «${CFG[k].name}»" aria-label="Запустити «${CFG[k].name}»">${SVG.play}</button>`}</div>`;
    }).join('') + `<hr><button role="menuitem" data-cfg-edit><span class="cfg-t">Налаштувати збірку…</span></button>`;
    const r = btn.getBoundingClientRect();
    pop.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - 300))}px`; pop.style.top = `${r.bottom + 6}px`;
    pop.hidden = false; btn.setAttribute('aria-expanded', 'true');
  }
  function openProjMenu(): void {
    const pop = $('#projpop'), btn = $('#proj-btn');
    if (!pop.hidden) { pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); return; }
    let total = 0, done = 0;
    for (const v of s.views) { total += v.units.length; const ents = s.saved.files[v.name] ?? {}; for (const u of v.units) if (ents[u.key]?.target) done++; }
    const remembered = rememberedGameDir();
    pop.innerHTML = `<button role="menuitem" data-pj="folder"><span class="cfg-t">Відкрити папку гри…</span></button>
      <button role="menuitem" data-pj="files"><span class="cfg-t">Відкрити файли або вставити JSON…</span></button>
      <hr><div class="pj-h">Поточний проєкт</div>
      <div class="pj-card"><span class="pj lg">${esc((Array.from(s.saved.name.trim())[0] ?? 'T').toUpperCase())}</span><div><b>${esc(s.saved.name)}</b><small class="${folder.kind === 'missing' || folder.kind === 'other' ? 'warn' : ''}" title="${esc(folderLine(folder, remembered))}">${esc(folderLine(folder, remembered))}</small><small>${total ? `Перекладено ${done.toLocaleString('uk-UA')} з ${total.toLocaleString('uk-UA')}` : 'Файлів ще немає'}</small></div></div>
      <hr><button role="menuitem" data-pj="settings"><span class="cfg-t">Налаштування проєкту…</span></button>`;
    const r = btn.getBoundingClientRect();
    pop.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - 340))}px`; pop.style.top = `${r.bottom + 6}px`;
    pop.hidden = false; btn.setAttribute('aria-expanded', 'true');
  }
  const closeProjMenu = (): void => { $('#projpop').hidden = true; $('#proj-btn').setAttribute('aria-expanded', 'false'); };
  const closeCfgMenu = (): void => { $('#cfgpop').hidden = true; $('#cfg-btn').setAttribute('aria-expanded', 'false'); };
  const runCfgNow = (k: RunCfg): void => {
    if (!s.views.length) return;
    const fail = (err: unknown) => toast('Не вдалося запустити: ' + (err instanceof Error ? err.message : String(err)));
    if (k === 'game') buildAndRunGame(ctx).catch(fail);
    else if (k === 'scene') {
      const u = s.cur ? ctx.unit(s.cur) : undefined;
      if (!u || !s.current) { toast('Виберіть рядок: гра почнеться з його сцени'); return; }
      if (s.current === GROUP) { toast('Запуск у грі працює для файлу, відкритого окремо: відкрийте його зі списку файлів'); return; }
      playInGame(ctx, s.current, u, 'event', 0).catch(fail);
    } else doBuild();
  };
  const runSelected = (): void => runCfgNow(runCfg);
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
      folder: {
        text: () => folderLine(folder, rememberedGameDir()),
        change: () => { void openFolder(); },
        forget: () => { forgetGameDir(); folderSeq++; folder = { kind: 'none' }; dataDir = null; renderFolderBar(); renderTop(); },
      },
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
  /** Phone: the five sections of the bottom bar. Files and rows are full pages, the hints are a bottom sheet. */
  function bottomNav(to: string, btn: HTMLElement): void {
    if (to === 'more') {
      // The phone has no menu bar: the same menus, as one list.
      showPop(btn, Object.entries(MENUS).map(([g, items]) => `<div class="group">${esc(g)}</div>${items.map((it, i) => (it === '-' ? '' : `<button data-pmi="${esc(g)}|${i}">${esc(it.t)}</button>`)).join('')}`).join(''));
      return;
    }
    closePops();
    if (to === 'help') { s.rightOpen = !s.rightOpen; s.leftOpen = false; }
    else if (to === 'edit') {
      s.rightOpen = false; s.leftOpen = false;
      if (s.mode === 'table') setMode('edit', false);
      if (!s.cur || !ctx.visible().some(u => u.key === s.cur)) s.cur = ctx.visible()[0]?.key ?? null;
    } else {
      s.rightOpen = false;
      if (s.leftOpen && s.leftTab[s.mode] === to) s.leftOpen = false; else { s.leftOpen = true; s.leftTab[s.mode] = to as 'files' | 'rows'; }
      s.leftBoth = false;
    }
    renderAll();
    if (to === 'edit' && s.cur) { reveal('slist', s.cur); document.querySelector<HTMLElement>(`.si[data-key="${CSS.escape(s.cur)}"]`)?.scrollIntoView({ block: 'nearest' }); }
  }
  const closePops = () => { fpop().hidden = true; $('#cfgpop').hidden = true; $('#projpop').hidden = true; };
  const groupsApi = { pop: (a: HTMLElement, html: string) => showPop(a, html), closePops: () => closePops() };
  /** A menu at the pointer. */
  function popAt(x: number, y: number, html: string): void {
    const p = fpop();
    p.innerHTML = html; p.dataset.for = 'at'; p.hidden = false;
    p.style.left = Math.max(8, Math.min(x, innerWidth - p.offsetWidth - 8)) + 'px';
    p.style.top = Math.max(8, Math.min(y, innerHeight - p.offsetHeight - 8)) + 'px';
  }
  const filesTarget = (name: string): PlaceTarget => {
    const many = s.picked.has(name) && s.picked.size > 1;
    return many ? { files: [...s.picked], label: plural(s.picked.size, ['файл', 'файли', 'файлів']) } : { files: [name], label: name.replace(/\.json$/, '') };
  };

  /* ---------- global search ---------- */
  let sdItems: { t: 'file' | 'row' | 'term'; file?: string; key?: string; label: string; kind: string }[] = [];
  let sdSel = 0;
  function openSearch(): void { $('#sd').hidden = false; const i = $('#sd-in') as HTMLInputElement; i.value = ''; sdRender(); i.focus(); holdInert('search', true); }
  function closeSearch(): void { $('#sd').hidden = true; holdInert('search', false); }
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
    if (it.t === 'term') { s.leftOpen = true; s.leftBoth = false; s.leftTab[s.mode] = 'glossary'; renderAll(); showTerm(ctx, it.label.split(' → ')[0] ?? ''); return; }
    if (it.file) {
      if (it.file !== s.current) openFile(it.file);
      if (it.key) { s.filter = 'all'; s.q = ''; s.speaker = null; s.lenFilter = 'all'; ctx.select(it.key, s.mode === 'table' ? undefined : s.mode); } else renderAll();
    }
  }

  /* ---------- menu bar ---------- */
  type MenuItem = '-' | { t: string; fn: () => void; sc?: string };
  const MENUS: Record<string, MenuItem[]> = {
    'Файл': [{ t: 'Відкрити папку гри…', fn: () => void openFolder() }, { t: 'Відкрити файли або вставити JSON…', fn: openImportDlg }, { t: 'Зібрати…', fn: doBuild, sc: 'F5' }, '-', { t: 'Налаштування…', fn: openSettingsDlg }],
    'Вигляд': [{ t: 'Таблиця', fn: () => setMode('table') }, { t: 'Редагування', fn: () => setMode('edit') }, { t: 'Сцена', fn: () => setMode('scene') }],
    'Навігація': [{ t: 'Наступний рядок без перекладу', fn: () => jump('new', 1) }, { t: 'Наступна помилка QA', fn: () => jump('qa', 1) }, { t: 'Сцена', fn: () => setMode('scene') }, '-', { t: 'Пошук скрізь…', fn: openSearch, sc: 'Ctrl+K' }],
    'Інструменти': [{ t: 'Визначити мовців…', fn: () => openSpeakers(ctx) }, { t: 'Знайти й замінити…', fn: () => openFindReplace(ctx) }, { t: 'Перевірити узгодженість…', fn: () => openConsistency(ctx) }, { t: 'Автозаповнення за словами…', fn: () => openAutofill(ctx) }, { t: 'Активність…', fn: () => openActivity(ctx) }, { t: 'Тексти плагінів…', fn: () => openPluginTexts(ctx, setPluginCommands) }, { t: 'Перенести довгі рядки у файлі', fn: wrapFile }, '-', { t: 'Налаштування…', fn: openSettingsDlg }],
    'Довідка': [{ t: 'Гарячі клавіші', fn: () => toggleKeys() }],
  };
  /** Re-flow every translated message of the current file whose lines are wider than the game window. */
  function wrapFile(): void {
    const v = ctx.view();
    const limit = lineLimit();
    if (!v) { toast('Спершу відкрийте файл'); return; }
    if (!limit) { toast('Ширину рядка вимкнено в налаштуваннях'); return; }
    const ents = ctx.entries(v.name);
    const changes: RowChange[] = [];
    for (const u of v.units) {
      const e = ents[u.key];
      if (!e?.target || (u.kind !== 'dialogue' && u.kind !== 'scroll')) continue;
      if (!activeIssues(u, e, qaOpts()).some(i => i.key === 'wrap')) continue;
      const text = wrapLines(e.target, limitFor(limit, u.face));
      if (text !== e.target) changes.push({ file: v.name, key: u.key, next: edit(e, u, text, ctx.stage(), Date.now()), text });
    }
    const n = changes.length;
    if (n) { ctx.commit(changes, 'wrap'); ctx.persist(); ctx.invalidateTm(); renderAll(); }
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
    toast(kind === 'new' ? 'Рядків без перекладу немає' : 'Помилок QA немає');
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
    const changes: RowChange[] = []; const skipped = new Map<string, number>();
    const visible = new Set(visibleUnits(true));
    for (const k of s.checked) {
      const u = unitMap.get(k);
      if (!u || !visible.has(u)) continue;
      const r = submit(ents[k], u, ctx.stage(), Date.now(), { blockErrors: s.saved.settings.blockErrors, qa: qaOpts() });
      if (r.ok) changes.push({ file: v.name, key: k, next: r.entry, text: r.entry.target });
      else skipped.set(r.reason.slice(0, 40), (skipped.get(r.reason.slice(0, 40)) ?? 0) + 1);
    }
    const ok = changes.length;
    if (ok) ctx.commit(changes, ctx.stage() === 'translate' ? 'send' : 'approve');
    ctx.persist(); ctx.invalidateTm(); renderAll();
    const nSkip = [...skipped.values()].reduce((a, b) => a + b, 0);
    toast(`Надіслано: ${ok}${nSkip ? `. Пропущено: ${nSkip} (${[...skipped.keys()].slice(0, 2).join('; ')})` : ''}`, { sticky: nSkip > 0 });
  }
  /** Approve the ticked rows: a draft is sent first, so the history says both. */
  function bulkApprove(): void {
    const v = ctx.view();
    if (!v) return;
    const ents = ctx.entries(v.name);
    const changes: RowChange[] = []; const skipped = new Map<string, number>();
    const visible = new Set(visibleUnits(true));
    const opts = { blockErrors: s.saved.settings.blockErrors, qa: qaOpts() };
    const now = Date.now();
    for (const k of s.checked) {
      const u = unitMap.get(k);
      if (!u || !visible.has(u)) continue;
      let next = ents[k];
      const miss = (why: string): void => { skipped.set(why.slice(0, 40), (skipped.get(why.slice(0, 40)) ?? 0) + 1); };
      if (!next?.target.trim()) { miss('Переклад порожній'); continue; }
      if (next.status !== 'done' && next.status !== 'appr') { const r1 = submit(next, u, 'translate', now, opts); if (!r1.ok) { miss(r1.reason); continue; } next = r1.entry; }
      const r2 = submit(next, u, 'review', now, opts);
      if (r2.ok) changes.push({ file: v.name, key: k, next: r2.entry, text: r2.entry.target }); else miss(r2.reason);
    }
    if (changes.length) ctx.commit(changes, 'approve', 'вичитано');
    ctx.persist(); ctx.invalidateTm(); renderAll();
    const nSkip = [...skipped.values()].reduce((a, b) => a + b, 0);
    toast(`Вичитано: ${changes.length}${nSkip ? `. Пропущено: ${nSkip} (${[...skipped.keys()].slice(0, 2).join('; ')})` : ''}`, { sticky: nSkip > 0 });
  }
  function bulkTm(): void {
    const v = ctx.view();
    if (!v) return;
    const ents = ctx.entries(v.name);
    const changes: RowChange[] = [];
    for (const k of s.checked) {
      const u = unitMap.get(k);
      if (!u || ents[k]?.target) continue;
      const m = ctx.tm().find(u.source, { min: 70, limit: 1, exclude: x => x.s === u.source && false })[0];
      if (m) changes.push({ file: v.name, key: k, next: edit(ents[k], u, m.t, ctx.stage(), Date.now()), text: m.t, what: `підставлено з пам’яті (${m.score}%)` });
    }
    const n = changes.length;
    if (n) ctx.commit(changes, 'memory');
    ctx.persist(); ctx.invalidateTm(); renderAll();
    toast(n ? `Підставлено з пам’яті: ${n}` : 'Збігів від 70% для порожніх вибраних рядків немає');
  }

  /* ---------- inline cell editing ---------- */
  function startInline(key: string): void {
    reveal('grid', key);
    const cell = document.querySelector<HTMLElement>(`.gr[data-key="${CSS.escape(key)}"] .tr`);
    const u = ctx.unit(key);
    if (!cell || !u || cell.querySelector('textarea')) return;
    const ta = el('textarea', 'cell-ed');
    ta.rows = 2; ta.value = entryOf(u)?.target ?? ''; ta.setAttribute('aria-label', 'Переклад рядка');
    cell.innerHTML = ''; cell.appendChild(ta); ta.focus(); ta.select();
    let cancelled = false;
    const finish = () => {
      if (!cancelled && ta.value !== (entryOf(u)?.target ?? '')) {
        const ents = ctx.entries(s.current!);
        ents[key] = edit(ents[key], u, ta.value, ctx.stage(), Date.now());
        s.sess.n++; ctx.persist(); ctx.softTm();
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
  // Pressing the empty part of the top bar starts a window drag, which swallows the click that closes open menus: close them here.
  document.querySelector('.topbar')!.addEventListener('pointerdown', e => {
    if ((e.target as HTMLElement).closest('button,a,input,select,textarea,[role=button],[role=tab],[role=menuitem],[tabindex]')) return;
    closePops(); $('#keypop').hidden = true; if (!$('#menubar').hidden) mbToggle(false);
  });
  root.addEventListener('click', e => {
    const t = e.target as HTMLElement;
    if (!t.closest('#fpop,#spkbtn,#lenbtn,#sortbtn,#bnav,#cfgpop,#cfg-btn,#projpop,#proj-btn')) closePops();
    if (!t.closest('#keypop,#hk')) $('#keypop').hidden = true;
    if (t.closest('#open2,#fb-repick')) { void openFolder(); return; }
    if (t.closest('#fb-use')) { useFolderAnyway(); return; }
    if (t.closest('#fb-hide')) { folderHidden = true; renderFolderBar(); return; }
    if (t.closest('#resume')) { void resume(); return; }
    if (t.closest('#imp2,#mt-open')) { openImportDlg(); return; }
    if (t.closest('#cl2')) {
      toast('Отримую з іншого пристрою…');
      runClaudeSync(ctx, loadClaudeConfig(), adopt).then(r => toast(s.views.length ? describeClaude(r) : 'У спільній базі ще немає проєкту: спершу синхронізуйте на комп’ютері (Налаштування → Синхронізація через Claude)'), er => toast(er instanceof Error ? er.message : 'Не вдалося синхронізувати'));
      return;
    }
    if (t.closest('#settings')) { openSettingsDlg(); return; }
    if (!t.closest('#cfgpop,#cfg-btn')) closeCfgMenu();
    if (!t.closest('#projpop,#proj-btn')) closeProjMenu();
    if (t.closest('#proj-btn')) { openProjMenu(); return; }
    const pj = t.closest<HTMLElement>('#projpop [data-pj]');
    if (pj) { closeProjMenu(); if (pj.dataset.pj === 'folder') void openFolder(); else if (pj.dataset.pj === 'files') openImportDlg(); else openSettingsDlg(); return; }
    if (t.closest('#cfg-btn')) { openCfgMenu(); return; }
    const cfgRun = t.closest<HTMLElement>('#cfgpop [data-cfg-run]');
    if (cfgRun) { closeCfgMenu(); runCfgNow(cfgRun.dataset.cfgRun as RunCfg); return; }
    if (t.closest('#cfgpop [data-cfg-edit]')) { closeCfgMenu(); doBuild(); return; }
    const cfgItem = t.closest<HTMLElement>('#cfgpop [data-cfg]');
    if (cfgItem) { runCfg = cfgItem.dataset.cfg as RunCfg; try { localStorage.setItem('transly.runcfg', runCfg); } catch { /* private mode */ } closeCfgMenu(); renderRunCfg(); return; }
    if (t.closest('#run-btn')) { runSelected(); return; }
    if (t.closest('#sb-build')) { doBuild(); return; }
    if (t.closest('#sb-sync')) { openSettingsDlg(); return; }
    if (t.closest('#lp-search,#mt-search')) { openSearch(); return; }
    if (t.closest('#hk')) { toggleKeys(); return; }
    if (t.closest('#hamb')) { mbToggle(); return; }
    const mg = t.closest<HTMLElement>('#menubar [data-mg]');
    if (mg) { mbOpen === mg.dataset.mg ? mbClose() : mbShow(mg.dataset.mg!); return; }
    const mi = t.closest<HTMLElement>('#mdd [data-mi]');
    if (mi) { const [g, i] = mi.dataset.mi!.split('|'); const it = MENUS[g!]![Number(i)]; mbToggle(false); if (it && it !== '-') setTimeout(() => it.fn(), 0); return; }
    if (!t.closest('#menubar,#mdd,#hamb') && !$('#menubar').hidden) mbToggle(false);
    if (t.closest('#scrim')) { s.leftOpen = false; s.rightOpen = false; renderAll(); return; }
    const bn = t.closest<HTMLElement>('#bnav [data-bn]');
    if (bn) { bottomNav(bn.dataset.bn!, bn); return; }
    if (t.closest('#ab-search')) { openSearch(); return; }
    const pmi = t.closest<HTMLElement>('[data-pmi]');
    if (pmi) { const [g, i] = pmi.dataset.pmi!.split('|'); closePops(); const it = MENUS[g!]?.[Number(i)]; if (it && it !== '-') it.fn(); return; }
    const lt = t.closest<HTMLElement>('#mtabs [data-lt]');
    if (lt) { s.leftTab[s.mode] = (['rows', 'glossary', 'scenes'] as const).find(x => x === lt.dataset.lt) ?? 'files'; renderAll(); return; }
    const hl = t.closest<HTMLElement>('[data-hide-left]');
    if (hl) { if (hl.dataset.hideLeft === 'glossary' || hl.dataset.hideLeft === 'scenes') s.leftOpen = false; else { s.leftBoth = false; s.leftTab[s.mode] = hl.dataset.hideLeft === 'files' ? 'rows' : 'files'; } renderAll(); return; }
    const sb = t.closest<HTMLElement>('#strip [data-lp]');
    if (sb) {
      // Each button switches its own panel on or off; both on = the zone is split between them.
      const want: LeftTab = (['rows', 'glossary', 'scenes'] as const).find(x => x === sb.dataset.lp) ?? 'files', other = want === 'rows' ? 'files' : 'rows';
      const cur = s.leftTab[s.mode];
      // The glossary and the scenes are panels of their own: they take the whole zone and never share it with files or rows.
      const own = (x: string): boolean => x === 'glossary' || x === 'scenes';
      if (own(want) || own(cur)) { if (s.leftOpen && cur === want) s.leftOpen = false; else { s.leftOpen = true; s.leftTab[s.mode] = want; } s.leftBoth = false; }
      else if (s.phone) { if (s.leftOpen && cur === want) s.leftOpen = false; else { s.leftOpen = true; s.leftTab[s.mode] = want; } s.leftBoth = false; }
      else if (!s.leftOpen) { s.leftOpen = true; s.leftBoth = false; s.leftTab[s.mode] = want; }
      else if (s.leftBoth) { s.leftBoth = false; s.leftTab[s.mode] = other; }
      else if (cur === want) s.leftOpen = false;
      else s.leftBoth = true;
      renderAll(); return;
    }
    if (t.closest('#lp-close')) { s.leftOpen = false; renderAll(); return; }
    const sm = t.closest<HTMLElement>('#seg [data-m]');
    if (sm) { setMode(sm.dataset.m as Mode); return; }
    const tab = t.closest<HTMLElement>('[data-tab]');
    if (tab) { if (tab.dataset.tab === GROUP) openGroup(s.group ?? []); else openFile(tab.dataset.tab!); renderAll(); return; }
    const ct = t.closest<HTMLElement>('[data-closetab]');
    if (ct) { closeTab(ct.dataset.closetab!); return; }
    const ga = t.closest<HTMLElement>('[data-act^=group-]');
    if (ga) {
      const a = ga.dataset.act;
      closePops();
      if (a === 'group-clear') { s.picked.clear(); renderTree(); return; }
      openGroup(a === 'group-all' ? s.views.map(v => v.name) : [...s.picked]);
      s.picked.clear(); renderAll(); return;
    }
    const dir = t.closest<HTMLElement>('[data-dir]');
    if (dir) { const n = dir.dataset.dir!; s.collapsed.has(n) ? s.collapsed.delete(n) : s.collapsed.add(n); renderTree(); return; }
    const f = t.closest<HTMLElement>('.node[data-file]');
    if (f && (e.ctrlKey || e.metaKey)) { const n = f.dataset.file!; s.picked.has(n) ? s.picked.delete(n) : s.picked.add(n); renderTree(); return; }
    if (f) { openFile(f.dataset.file!); if (s.phone) s.leftTab[s.mode] = 'rows'; renderAll(); return; }
    const ch = t.closest<HTMLElement>('[data-filter]');
    if (ch) { s.filter = ch.dataset.filter as Filter; if (s.mode !== 'table' && !ctx.visible().some(u => u.key === s.cur)) s.cur = ctx.visible()[0]?.key ?? null; renderAll(); return; }
    const clr = t.closest<HTMLElement>('[data-clear]');
    if (clr) { closePops(); if (clr.dataset.clear === 'speaker') s.speaker = null; else s.lenFilter = 'all'; renderAll(); return; }
    if (t.closest('[data-reset]')) { s.filter = 'all'; s.q = ''; s.speaker = null; s.lenFilter = 'all'; renderAll(); return; }
    if (t.closest('#spkbtn')) {
      const v = ctx.view();
      // Speakers of every file, not only the open one: the choice stays when another file is opened.
      const counts = new Map<string, number>();
      if (v) for (const f of s.views) for (const u of f.units) { const n = ctx.speaker(u); counts.set(n, (counts.get(n) ?? 0) + 1); }
      const names = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'uk'));
      showPop(t.closest<HTMLElement>('#spkbtn')!, `<div class="group">Мовець · у всіх файлах</div>${s.speaker !== null ? '<button data-clear="speaker">Усі мовці</button>' : ''}${names.slice(0, 80).map(([n, c]) => `<button data-spk="${esc(n)}" ${s.speaker === n ? 'class="on"' : ''}>${esc(n || 'без мовця')} <span class="hint">${c.toLocaleString('uk-UA')}</span></button>`).join('')}<div class="msep" role="separator"></div>${s.speaker !== null && s.current !== GROUP && s.views.length > 1 ? '<button data-act="group-all">Показати в усіх файлах разом</button>' : ''}<button data-act="speakers">Визначити мовців…</button>`);
      return;
    }
    if (t.closest('[data-act=speakers]')) { closePops(); openSpeakers(ctx); return; }
    const spk = t.closest<HTMLElement>('[data-spk]');
    if (spk) { s.speaker = spk.dataset.spk ?? ''; closePops(); renderAll(); return; }
    if (t.closest('#sortbtn')) { showPop(t.closest<HTMLElement>('#sortbtn')!, `<div class="group">Сортування</div>${(Object.keys(SORT_LABEL) as SortMode[]).map(k => `<button data-sort="${k}" ${s.sort === k ? 'class="on"' : ''}>${SORT_LABEL[k]}</button>`).join('')}`); return; }
    const so = t.closest<HTMLElement>('[data-sort]');
    if (so) { s.sort = so.dataset.sort as SortMode; closePops(); renderAll(); return; }
    if (t.closest('#lenbtn')) { showPop(t.closest<HTMLElement>('#lenbtn')!, `<div class="group">Довжина відносно оригіналу</div>${(Object.keys(LEN_LABEL) as (keyof typeof LEN_LABEL)[]).map(k => `<button data-len="${k}">${LEN_LABEL[k]}</button>`).join('')}`); return; }
    const ln = t.closest<HTMLElement>('[data-len]');
    if (ln) { s.lenFilter = ln.dataset.len as typeof s.lenFilter; closePops(); renderAll(); return; }
    if (t.closest('#bb-ok')) { bulkSend(); return; }
    if (t.closest('#bb-appr')) { bulkApprove(); return; }
    if (t.closest('#bb-tm')) { bulkTm(); return; }
    if (t.closest('#tree-grp')) { const first = [...s.picked][0]; if (first) showPop(t.closest<HTMLElement>('#tree-grp')!, placeMenuHtml(ctx, filesTarget(first))); return; }
    if (t.closest('#bb-clear')) { s.checked.clear(); renderAll(); return; }
    if (t.closest('#selall')) { const all = ($('#selall') as HTMLInputElement).checked; for (const u of visibleUnits(true)) all ? s.checked.add(u.key) : s.checked.delete(u.key); renderAll(); return; }
    const rc = t.closest<HTMLInputElement>('.rc');
    if (rc) { const k = rc.closest<HTMLElement>('.gr')!.dataset.key!; rc.checked ? s.checked.add(k) : s.checked.delete(k); renderAll(); return; }
    const sd = t.closest<HTMLElement>('[data-sd]');
    if (sd) { sdGo(Number(sd.dataset.sd)); return; }
    if (t.id === 'sd') { closeSearch(); return; }
    const si = t.closest<HTMLElement>('.si[data-key]');
    if (si) { if (s.phone) { s.leftOpen = false; } ctx.select(si.dataset.key!, s.mode === 'table' ? 'edit' : undefined); return; }
    if (groupsClick(ctx, t, groupsApi) || glossaryClick(ctx, t) || scenesClick(ctx, t)) return;
    if (sideClick(ctx, t)) return;
    if (s.mode === 'scene' && sceneClick(ctx, t, key => { s.cur = key; send(ctx); })) return;
    if (s.mode !== 'table' && focusClick(ctx, t)) return;
    if (s.mode === 'table') {
      const row = t.closest<HTMLElement>('.gr');
      // A phone has no room to write inside the table: a tap opens the row in the editor.
      if (s.phone && row && row.dataset.key) { ctx.select(row.dataset.key, 'edit'); return; }
      // A click on a translation cell selects its row and starts writing right there.
      if (row && t.closest('.gr .tr') && !t.closest('textarea')) {
        if (row.dataset.key !== s.cur) { document.querySelector('.gr.sel')?.classList.remove('sel'); row.classList.add('sel'); s.cur = row.dataset.key ?? null; renderStatus(); renderSidePanel(ctx); }
        startInline(row.dataset.key!); return;
      }
      if (row && row.dataset.key !== s.cur && !t.closest('textarea')) { document.querySelector('.gr.sel')?.classList.remove('sel'); row.classList.add('sel'); s.cur = row.dataset.key ?? null; renderStatus(); renderSidePanel(ctx); }
    }
  });

  $('#fq').addEventListener('input', e => { fileQ = (e.target as HTMLInputElement).value; renderTree(); });
  $('#fq').addEventListener('keydown', e => { if (e.key === 'Escape' && fileQ) { e.stopPropagation(); fileQ = ''; ($('#fq') as HTMLInputElement).value = ''; renderTree(); } });
  // The tab strip scrolls sideways with the wheel and with a faint thumb drawn over its top edge (no scrollbar row of its own).
  {
    const host = $('#tabs-host'), bar = host.parentElement!;
    const track = el('div', 'tabs-track'), thumb = el('i', 'tabs-thumb');
    track.appendChild(thumb); bar.appendChild(track);
    const sync = (): void => {
      const over = host.scrollWidth - host.clientWidth;
      track.hidden = over <= 1;
      if (over <= 1) return;
      const w = Math.max(28, (host.clientWidth / host.scrollWidth) * track.clientWidth);
      thumb.style.width = `${w}px`;
      thumb.style.transform = `translateX(${(host.scrollLeft / over) * (track.clientWidth - w)}px)`;
    };
    host.addEventListener('scroll', sync, { passive: true });
    new ResizeObserver(sync).observe(host);
    new MutationObserver(sync).observe(host, { childList: true });
    thumb.addEventListener('pointerdown', e => {
      e.preventDefault(); thumb.setPointerCapture(e.pointerId); thumb.classList.add('drag');
      const x0 = e.clientX, l0 = host.scrollLeft;
      const move = (ev: PointerEvent): void => { const over = host.scrollWidth - host.clientWidth, room = track.clientWidth - thumb.offsetWidth; host.scrollLeft = l0 + ((ev.clientX - x0) / Math.max(1, room)) * over; };
      const up = (): void => { thumb.classList.remove('drag'); thumb.removeEventListener('pointermove', move); thumb.removeEventListener('pointerup', up); };
      thumb.addEventListener('pointermove', move); thumb.addEventListener('pointerup', up);
    });
    track.addEventListener('pointerdown', e => { if (e.target === track) host.scrollLeft += (e.offsetX > thumb.offsetLeft ? 1 : -1) * host.clientWidth * 0.8; });
    requestAnimationFrame(sync);
  }
  // The tab strip scrolls sideways with the wheel as well as with its scrollbar.
  $('#tabs-host').addEventListener('wheel', e => { const h = e.currentTarget as HTMLElement; if (h.scrollWidth > h.clientWidth && Math.abs(e.deltaY) > Math.abs(e.deltaX)) { h.scrollLeft += e.deltaY; e.preventDefault(); } }, { passive: false });
  root.addEventListener('dblclick', e => {
    const t = e.target as HTMLElement;
    const cell = t.closest<HTMLElement>('.gr .tr');
    const row = t.closest<HTMLElement>('.gr');
    if (cell && row && s.mode === 'table') startInline(row.dataset.key!);
    else if (row && s.mode === 'table' && !t.closest('textarea')) ctx.select(row.dataset.key!, 'edit');
  });

  let scenePanelTimer = 0;
  // A field of the scene mode got the focus: that row is the open one, the right panel follows.
  root.addEventListener('focusin', e => {
    const t = e.target as HTMLElement;
    if (t instanceof HTMLTextAreaElement) sceneFocus(ctx, t, () => { renderSidePanel(ctx); renderStatus(); saveUi(); });
  });
  root.addEventListener('input', e => {
    const t = e.target as HTMLElement;
    if (t instanceof HTMLTextAreaElement && t.id === 'i-tr') { focusInput(ctx, t); renderStatus(); return; }
    if (t instanceof HTMLTextAreaElement && sceneInput(ctx, t)) { renderStatus(); window.clearTimeout(scenePanelTimer); scenePanelTimer = window.setTimeout(() => renderSidePanel(ctx), 250); return; }
    if (t.id === 'q' || t.id === 'q2') {
      s.q = (t as HTMLInputElement).value;
      const pos = (t as HTMLInputElement).selectionStart ?? s.q.length;
      renderAll();
      const q = $(t.id === 'q' ? '#q' : '#q2') as HTMLInputElement;
      q.focus(); q.setSelectionRange(pos, pos);
    }
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
      if (!$('#fpop').hidden || !$('#cfgpop').hidden || !$('#projpop').hidden || !$('#keypop').hidden) { closePops(); $('#keypop').hidden = true; return; }
      if (!$('#menubar').hidden) { mbToggle(false); return; }
      if (s.phone && (s.leftOpen || s.rightOpen)) { s.leftOpen = false; s.rightOpen = false; renderAll(); return; }
    }
    if (document.querySelector('dialog[open]')) return;
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') { e.preventDefault(); openSearch(); return; }
    if (e.key === 'Shift' && !e.repeat) { const now = Date.now(); if (now - lastShift < 400) openSearch(); lastShift = now; return; }
    if (e.key === 'F5') { e.preventDefault(); runSelected(); return; }
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && s.mode !== 'table') { e.preventDefault(); step(ctx, e.key === 'ArrowDown' ? 1 : -1); return; }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && t.id === 'i-tr') { e.preventDefault(); send(ctx); return; }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && t.classList.contains('sv-in')) { e.preventDefault(); s.cur = t.dataset.key ?? s.cur; send(ctx); return; }
    if (s.mode === 'table' && t.classList.contains('gr')) {
      const list = visibleUnits(true);
      const i = list.findIndex(u => u.key === t.dataset.key);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const n = list[i + (e.key === 'ArrowDown' ? 1 : -1)]; if (n) { s.cur = n.key; renderAll(); reveal('grid', n.key); document.querySelector<HTMLElement>(`.gr[data-key="${CSS.escape(n.key)}"]`)?.focus(); } }
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
  restoreUi();
  wireDiscuss(ctx);
  wireLinks(ctx);
  wireTermCard(ctx, {
    insert: text => insertText(ctx, text),
    goto: (file, key) => openRow(file, key),
    remark: (button, key) => { s.cur = key; qaClick(ctx, button); },
    edit: en => { s.leftOpen = true; s.leftBoth = false; s.leftTab[s.mode] = 'glossary'; renderAll(); editTerm(ctx, en); },
  });
  wireGlossary(ctx);
  wireScenes(ctx);
  wireGroups(ctx, groupsApi);
  // Right click on a file puts it in a group; a file can also be dragged onto one.
  document.addEventListener('contextmenu', e => {
    const file = (e.target as HTMLElement).closest<HTMLElement>('.node[data-file]');
    if (!file) return;
    e.preventDefault();
    popAt(e.clientX, e.clientY, placeMenuHtml(ctx, filesTarget(file.dataset.file!)));
  });
  document.addEventListener('dragstart', e => {
    const f = (e.target as HTMLElement).closest?.('.node[data-file]') as HTMLElement | null | undefined;
    if (!f || !e.dataTransfer) return;
    e.dataTransfer.setData(FILES_DRAG, dragFiles(filesTarget(f.dataset.file!).files));
    e.dataTransfer.setData('text/plain', f.dataset.file!);
    e.dataTransfer.effectAllowed = 'copy';
  });
  initMobile(ctx);
  initResize();
  initRightResize();
  renderAll();
  void restoreFolder();
}
