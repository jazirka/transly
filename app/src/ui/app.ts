import { isAutoFilled, autoNote, planIngest, ingestQuiet, ingestNote, Autosave, LinkIndex, linkModeOf, pendingLinks, commitRows, threadsOf, GameNameIndex, buildUsage, sysNamesOf, activeIssues, autoLineLimit, displayLength, edit, emptyProject, labelsOf, flowText, isMessageUnit, lengthDeviation, note, pluginCandidates, readGame, snapshotOf, speakerOf, statsOf, submit, tooWide, viewsFromSnapshot, wrapMessage, wrapOf, hasAdvice, qaOf, termsStamp, adoptSynced, applyPlan, planOf, reconcileChanges, pct, progressOf, rowState, sumProgress, QUEUE_LABEL, nextIn, positionOf, queueRows, ago, copyLine, stamp, stampOf } from '../core';
import type { IngestReport, QaOptions, QueueKind, WrapPlan } from '../core';
import { pxMeasure } from './measure';
import { openWrapTool } from './wrap-dialog';
import { openQaRules } from './qarules-dialog';
import { GroupIndex, KIND_LABEL, UndoStack, approveEntry, groupColor, groupRows, liveGroups, outboxRescue, takeOutbox } from '../core';
import type { Entry, FileView, GameFile, Group, RowChange, SavedProject, Unit } from '../core';
import { openBuild } from './build-dialog';
import { dataDirOf, forgetGameDir, isDesktop, rememberedGameDir, reopenGameDir, reopenGameDirDesktop, setProject } from './desktop';
import { classifyFolder, folderBanner, folderLine } from './folder-service';
import type { FolderState } from './folder-service';
import { $, el, esc, plural, toast } from './dom';
import { focusFirst, menuKeys, rememberOpener, restoreOpener, roveTree, setUnavailable, treeKeys } from './keynav';
import { FOCUS_HTML, SIDE_HTML, qaClick, focusClick, focusInput, insertText, renderFocus, renderSidePanel, afterSendFollowUp, send, sideClick, step } from './focus';
import { wireDiscuss } from './discuss';
import { realOf } from './hintcards';
import { approveOpenRow } from './rowpanel';
import { wireTermCard } from './termcard';
import { wireLinks } from './links';
import { SCENE_HTML, focusCard, hasScenes, renderSceneView, sceneClick, sceneFocus, sceneIdOf, sceneInput } from './scene-view';
import { SCENES_HTML, renderScenesPanel, scenesClick, wireScenes } from './scenes-panel';
import { undoByKey, undoToast } from './undo-toast';
import { FILES_DRAG, GROUPS_HTML, dragFiles, groupsClick, placeMenuHtml, renderGroupsBlock, wireGroups } from './groups-panel';
import type { PlaceTarget } from './groups-panel';
import { GLOSSARY_HTML, editTerm, glossaryClick, renderGlossaryPanel, showTerm, wireGlossary } from './glossary-panel';
import { pickGameFolder, readFiles, reopenHandle } from './folder';
import type { DirHandle, PickedFile } from './folder';
import { IdbStore, LoadFailure, loadHandle, saveHandle } from './idb';
import { showRecovery } from './recovery';
import { openImport } from './import-dialog';

import { autoCheck } from './updates';
import { openFindReplace } from './tools-dialogs';
import { openLinkTool } from './links-dialog';
import { openTermSyncTool } from './termsync-dialog';
import { openPluginTexts } from './plugins-dialog';
import { openActivity, openAutofill } from './activity-dialog';
import { openIngestReport } from './ingest-dialog';
import { markup } from './markup';
import { openSettings } from './settings';
import type { SettingsTab } from './settings';
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
import { mountRows, patchRow, reveal } from './chunks';
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

/** A draft the program wrote and the translator has not looked at: its dot is drawn as a dashed ring (by shape, not by colour alone). */
const autoDraft = (st: string, e: Entry | undefined): boolean => st === 'draft' && isAutoFilled(e);
const FILTERS: [Filter, string][] = [['all', 'Усі'], ['new', 'Без перекладу'], ['draft', 'Чернетки'], ['auto', 'Авто'], ['done', 'Надіслані'], ['appr', 'Вичитані'], ['qa', 'Помилки'], ['adv', 'З порадами'], ['cm', 'З коментарями']];
const LEN_LABEL = { far: 'далеко від оригіналу', longer: 'довші за оригінал', shorter: 'коротші за оригінал' } as const;
const FORMAT_LABEL: Record<string, string> = { json: 'RPG Maker MV · UTF-8', po: 'gettext · UTF-8', pot: 'gettext · UTF-8', csv: 'CSV · UTF-8', tsv: 'TSV · UTF-8', rpy: 'Ren’Py · UTF-8' };

const SHELL = `<div class="scroll-x"><div class="ide mode-table lp-open" id="ide">
  <header class="topbar">
    <div class="logo" aria-hidden="true">T</div>
    <button class="tb-ic" id="hamb" title="Головне меню" aria-haspopup="menu" aria-expanded="false">${SVG.menu}</button>
    <nav class="menubar" id="menubar" role="menubar" aria-label="Головне меню" hidden></nav>
    <button class="tpill" id="proj-btn" aria-haspopup="menu" aria-expanded="false" title="Проєкт: відкрити іншу гру, налаштування"><span class="pj" id="proj-av" aria-hidden="true">T</span><span id="proj-name">Проєкт</span><span class="dd" aria-hidden="true">▾</span></button>
    <div class="seg" id="seg" role="group" aria-label="Режим">
      <button aria-pressed="true" data-m="table" class="on"><svg viewBox="0 0 16 16"><path d="M2.5 3.5h11v9h-11zM2.5 7h11M6.5 3.5v9"/></svg>Таблиця</button>
      <button aria-pressed="false" data-m="edit"><svg viewBox="0 0 16 16"><path d="M2.5 3.5h11v9h-11zM6 3.5v9M6 8h7.5"/></svg>Редагування</button>
      <button aria-pressed="false" data-m="scene" id="m-scene"><svg viewBox="0 0 16 16"><rect x="2.5" y="3" width="11" height="6" rx="1.5"/><rect x="2.5" y="11" width="7" height="2.5" rx="1"/></svg>Сцена</button>
    </div>
    <div class="grow"></div>
    <div class="prog" id="pg" title="" role="progressbar" aria-label="Прогрес перекладу" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div class="bar"><i class="a" id="pg-a"></i><i class="b" id="pg-b"></i><i class="c" id="pg-c"></i></div><span id="pg-txt" style="font-family:var(--mono);font-size:11.5px"></span></div>
    <div class="tsep"></div>
    <button class="tpill run" id="cfg-btn" aria-haspopup="menu" aria-expanded="false" title="Що запускає кнопка ▶">${SVG.build}<span id="cfg-name">Збірка (файл)</span><span class="dd" aria-hidden="true">▾</span></button>
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
      <div class="treebody" id="tree"><div class="ph card-ph" data-card="files"><span class="grow">Файли гри</span><span class="ico" data-hide-left="files" role="button" tabindex="0" aria-label="Сховати панель «Файли гри»" title="Сховати">—</span></div><div class="tree-q"><div class="fin">${SVG.search}<input class="qin" id="fq" placeholder="Пошук у файлах гри" aria-label="Пошук у файлах гри" autocomplete="off" spellcheck="false"></div></div><div class="tree-act" id="tree-act"></div>${GROUPS_HTML}<div id="tree-list" role="tree" aria-label="Файли гри"></div></div>
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
        <div class="filters"><div class="fin">${SVG.search}<input class="qin" id="q" placeholder="Фільтр у цьому файлі" aria-label="Фільтр"></div><span class="chipsHost" id="chips1"></span>
          <div class="r"><button class="chip" id="spkbtn">Мовець ▾</button><button class="chip" id="lenbtn">Довжина ▾</button></div></div>
        <div class="gridwrap"><div class="bulk" id="bulk"><div class="bulk-in"><b id="bulkn">0</b><span id="bulkt"></span><button id="bb-ok" title="Надіслати вибрані переклади">Надіслати</button><button id="bb-appr" title="Вичитати вибрані переклади (рядки, що ще не надіслано, надсилаються й вичитуються разом)">Вичитати</button><button id="bb-tm" title="Підставити збіг із пам’яті перекладів (від 70%) у порожні вибрані рядки">З пам’яті</button><button id="bb-clear" class="ghost" title="Скасувати вибір" aria-label="Скасувати вибір">✕</button></div></div><div class="grid" id="grid" role="grid" aria-label="Рядки файлу"></div></div>
      </div>
      <div class="view" id="v-focus">${FOCUS_HTML}</div>
      <div class="view" id="v-scene">${SCENE_HTML}</div>
    </main>
    ${SIDE_HTML}
  </div>
  <nav class="bnav" id="bnav" aria-label="Розділи"><button data-bn="files" aria-label="Файли"><svg viewBox="0 0 16 16"><path d="M2.5 4.5v8h11v-6.5h-6l-1.5-1.5z"/></svg><span>Файли</span></button><button data-bn="rows" aria-label="Рядки"><svg viewBox="0 0 16 16"><path d="M3 4h10M3 8h10M3 12h10"/></svg><span>Рядки</span></button><button data-bn="edit" aria-label="Редактор"><svg viewBox="0 0 16 16"><path d="M3 13l.7-3L11 2.7a1.4 1.4 0 0 1 2 2L5.7 12z"/></svg><span>Редактор</span></button><button data-bn="help" aria-label="Вказівки"><svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5"/><path d="M6.3 6.3a1.8 1.8 0 1 1 2.6 1.6c-.6.3-.9.7-.9 1.4M8 11.6v.1"/></svg><span>Вказівки</span></button><button data-bn="more" aria-label="Ще"><svg viewBox="0 0 16 16"><circle cx="3.5" cy="8" r="1" fill="currentColor"/><circle cx="8" cy="8" r="1" fill="currentColor"/><circle cx="12.5" cy="8" r="1" fill="currentColor"/></svg><span>Ще</span></button></nav>
  <footer class="status">
    <span class="ok" id="sb-save"></span><span id="sb-load" class="busy" role="status" hidden></span><span id="sb-fmt"></span><span id="sb-qa" class="sbtn" role="button" tabindex="0" title="Перейти до наступної помилки QA у проєкті (F8)"></span><span id="sb-adv" class="sbtn" role="button" tabindex="0" title="Показати рядки з порадами" hidden></span><span id="st-sel"></span>
    <span id="sb-sync" class="sbtn" role="button" tabindex="0" title="Налаштування синхронізації"></span><span id="sb-build" class="sbtn" role="button" tabindex="0" title="Зібрати (F5)"></span>
    <div class="r"><span id="sb-file"></span><span id="sb-sess"></span></div>
  </footer>
</div></div>
<div class="scrim" id="scrim"></div>
<div class="pop cfgpop projpop" id="projpop" role="menu" aria-label="Проєкт" hidden></div>
<div class="pop cfgpop" id="cfgpop" role="menu" aria-label="Що запускати" hidden></div>
<div class="pop" id="fpop" role="dialog" aria-label="Параметри" hidden></div>
<div class="pop keys" id="keypop" role="dialog" aria-label="Гарячі клавіші й позначки" hidden>
  <div class="kh">Гарячі клавіші</div>
  <div class="kr"><span>Відкрити рядок у редагуванні</span><kbd>Enter</kbd><kbd>2× клік</kbd></div>
  <div class="kr"><span>Наступний / попередній рядок</span><kbd>↓</kbd><kbd>↑</kbd></div>
  <div class="kr"><span>У редагуванні: наступний / попередній у списку</span><kbd>Alt</kbd><kbd>↓</kbd></div>
  <div class="kr"><span>Надіслати й далі</span><kbd>Ctrl</kbd><kbd>Enter</kbd></div>
  <div class="kr"><span>Вичитати й перейти до наступного на вичитку</span><kbd>Ctrl</kbd><kbd>⇧</kbd><kbd>Enter</kbd></div>
  <div class="kr"><span>Наступний / попередній рядок без перекладу (по всьому проєкту)</span><kbd>Alt</kbd><kbd>⇧</kbd><kbd>↓</kbd></div>
  <div class="kr"><span>Наступна / попередня помилка QA (по всьому проєкту)</span><kbd>F8</kbd><kbd>⇧</kbd><kbd>F8</kbd></div>
  <div class="kr"><span>Скасувати / повернути останню масову дію (поза полем вводу)</span><kbd>Ctrl</kbd><kbd>Z</kbd><kbd>Ctrl</kbd><kbd>⇧</kbd><kbd>Z</kbd></div>
  <div class="kr"><span>Змінити переклад у комірці таблиці</span><kbd>F2</kbd><kbd>2× клік</kbd></div>
  <div class="kr"><span>У комірці: зберегти й до наступного рядка</span><kbd>Enter</kbd><kbd>Tab</kbd></div>
  <div class="kr"><span>У комірці: новий рядок тексту</span><kbd>⇧</kbd><kbd>Enter</kbd></div>
  <div class="kr"><span>Запустити вибрану збірку (файл або гра)</span><kbd>F5</kbd></div>
  <div class="kr"><span>Знайти скрізь</span><kbd>Ctrl</kbd><kbd>K</kbd><kbd>⇧</kbd><kbd>⇧</kbd></div>
  <div class="kr"><span>Закрити вікно чи меню</span><kbd>Esc</kbd></div>
  <div class="kh kh2">Позначки рядків</div>
  <div class="kr kr-l"><span><i class="sd new"></i>без перекладу</span><span><i class="sd draft"></i>чернетка</span><span><i class="sd done"></i>надіслано</span><span><i class="sd appr"></i>вичитано</span><span><i class="sd qa"></i>є помилка QA</span></div>
</div>
<div class="sd-wrap" id="sd" hidden><div class="sd-box" role="dialog" aria-modal="true" aria-label="Пошук скрізь"><input id="sd-in" placeholder="Рядки, файли, терміни…" aria-label="Пошук скрізь" autocomplete="off" role="combobox" aria-autocomplete="list" aria-controls="sd-res" aria-expanded="true" aria-activedescendant=""><div id="sd-res" role="listbox" aria-label="Результати"></div><div class="sd-foot">↑↓ вибір · Enter відкрити · Esc закрити</div></div></div>
${WINDOW_CONTROLS_HTML}`;

export async function start(root: HTMLElement): Promise<void> {
  const store = new IdbStore('default');
  setProject('default');
  let saved: SavedProject;
  try { saved = (await store.load()) ?? emptyProject('Новий проєкт'); }
  catch (e) {
    // An unreadable stored project must never be replaced silently (the next autosave would overwrite it).
    if (!(e instanceof LoadFailure)) throw e;
    await showRecovery(root, e, () => store.releaseAfterBackup(e.raw));
    saved = emptyProject('Новий проєкт');
  }
  // what the previous session could not finish writing (the page was closed within the delay of the autosave)
  const kv = (() => { try { return window.localStorage; } catch { return null; } })();
  const back = kv ? takeOutbox(kv, 'default', saved, Date.now()) : null;
  if (back) saved = back.project;
  const mq = matchMedia('(max-width: 760px)');
  /** A window too narrow for three columns: the right panel is folded by itself and, when opened, lies over the centre. */
  const narrow = matchMedia('(min-width: 761px) and (max-width: 1180px)');
  const s: State = {
    views: [], game: [], saved, current: null, open: [], group: null, groupSel: null, picked: new Set(), cur: null, scene: null, mode: mq.matches ? 'edit' : 'table', filter: 'all', q: '', speaker: null, lenFilter: 'all', sort: 'order', compact: ls('transly.compact') === '1', kb: false,
    checked: new Set(), sideTab: 'panel', sideOn: ['panel'], saveOk: true, savedAt: null, who: saved.settings.who, phone: mq.matches,
    leftTab: { table: 'files', edit: 'rows', scene: 'scenes' }, leftOpen: !mq.matches, leftBoth: false, rightOpen: false, collapsed: new Set(), sess: { n: 0, t0: Date.now() }, lastBuild: null,
  };
  if (narrow.matches && !s.phone) s.sideOn = [];
  const fromSnapshot = viewsFromSnapshot(saved);
  if (fromSnapshot.length) { s.views = fromSnapshot; s.current = fromSnapshot[0]!.name; s.open = [s.current]; }
  let lastHandle: (DirHandle & { name: string }) | null = null;
  let dataDir: string | null = null;
  /** The folder remembered for the project (it changes when another one is picked or forgotten). */
  const desktopDir = (): string | null => (isDesktop() ? rememberedGameDir() : null);
  try { lastHandle = (await loadHandle('default')) as typeof lastHandle; } catch { lastHandle = null; }
  const autosave = new Autosave(store, 400, ok => { s.saveOk = ok; if (ok) s.savedAt = Date.now(); renderStatus(); }, undefined, kv ? outboxRescue(kv, 'default') : null);
  if (back) { autosave.keepAll(); autosave.queue(saved); }
  // Another tab or window wrote to the same stored project: the save merged its work in; take it over without redrawing
  // (the translator may be typing), the screen shows it the next time it is drawn.
  store.onForeign = merged => {
    s.saved = adoptSynced(s.saved, merged); s.who = s.saved.settings.who; tmCache = null;
    unitMap = new Map((ctx.view()?.units ?? []).map(u => [u.key, u]));
    autosave.queue(s.saved);
    toast('Знайдено правки з іншої вкладки: їх злито з вашими');
  };
  let tmCache: ReturnType<typeof buildTm> | null = null;
  /** The wrap mode the memory was built for: it decides how rows are compared, so a change of the setting needs a rebuild. */
  let tmFlow = false;
  let tmStale = false, tmBuiltAt = 0;
  let unitMap = new Map<string, Unit>();
  let linkCache: { views: State['views']; idx: LinkIndex } | null = null;

  const input = el('input');
  input.type = 'file'; input.hidden = true; input.id = 'folder-input';
  input.setAttribute('webkitdirectory', ''); input.setAttribute('aria-label', 'Папка гри');
  root.innerHTML = SHELL;
  root.appendChild(input);
  initWindowControls(() => autosave.flush());
  document.documentElement.dataset.booted = '1';
  if (back) toast(`Відновлено правки, які не встигли зберегтися перед закриттям: ${back.rows}`);

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
  /** What the project says about wrapping messages (the tool «Перенесення рядків»), with the width resolved. */
  const wrapPlan = (): WrapPlan => { const w = wrapOf(s.saved.settings); return { settings: w, limit: lineLimit(), disabled: s.saved.settings.lineLimit < 0, ...(w.unit === 'px' ? { measure: pxMeasure(w.px.font) } : {}) }; };
  const qaOpts = (): QaOptions => ({ tolerancePct: s.saved.settings.tolerancePct, terms: s.saved.terms, lineLimit: lineLimit(), wrap: wrapPlan(), rules: qaOf(s.saved.settings) });
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
    qaOpts, lineLimit, wrapPlan,
    usage: () => { if (!usageCache || usageCache.game !== s.game) usageCache = { game: s.game, u: buildUsage(s.game, f => s.saved.labels?.[f]) }; return usageCache.u; },
    gameDir: () => dataDir,
    gameHandle: () => lastHandle as unknown as ReturnType<Ctx['gameHandle']>,
    built: n => { s.lastBuild = { at: Date.now(), n }; stamp(s.saved, 'build', 'збірка', Date.now(), n); ctx.persist(); renderTop(); },
    names: () => { if (!namesCache || namesCache.views !== s.views) namesCache = { views: s.views, idx: new GameNameIndex(s.views) }; return namesCache.idx; },
    speaker: u => speakerOf(u, s.saved.speakers),
    view: () => (s.current === GROUP ? groupView() : s.views.find(v => v.name === s.current) ?? null),
    unit: key => unitMap.get(key),
    visible: () => visibleUnits(true),
    tm: () => {
      const flow = wrapOf(s.saved.settings).mode === 'text';
      if (!tmCache || tmFlow !== flow || (tmStale && Date.now() - tmBuiltAt > 1000)) { tmCache = buildTm(s); tmFlow = flow; tmBuiltAt = Date.now(); tmStale = false; }
      return tmCache;
    },
    invalidateTm: () => { tmCache = null; tmStale = false; },
    softTm: () => { tmStale = true; },
    links: () => { if (!linkCache || linkCache.views !== s.views) linkCache = { views: s.views, idx: new LinkIndex(s.views) }; return linkCache.idx; },
    persist: () => autosave.queue(s.saved),
    stage: () => 'translate',
    history: new UndoStack(),
    fileTitle: name => fileTitle(name),
    commit: (changes, kind, what) => { const id = commitRows(file => ctx.entries(file), changes, kind, s.who, Date.now(), what); s.sess.n += changes.length; ctx.history.record(id); return id; },
    render: () => renderAll(),
    open: (file, key) => openRow(file, key),
    openRows: (title, rows, gid) => openRows(title, rows, gid),
    tool: () => openWrapTool(ctx, { wrapFile }),
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
  const baseName = (name: string): string => (name.split('/').pop() ?? name).replace(/\.json$/i, '');
  const fileTitle = (name: string): string => { const label = s.views.find(v => v.name === name)?.label; return label ? `${label} · ${baseName(name)}` : baseName(name); };
  const currentLabel = (): string => (s.current === GROUP ? groupTitle() : s.current ? fileTitle(s.current) : '');
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
      if (!(u.source + ' ' + flowText(e?.target ?? '') + ' ' + u.key + ' ' + ctx.speaker(u)).toLowerCase().includes(q)) return false;
    }
    if (s.speaker !== null && ctx.speaker(u) !== s.speaker) return false;
    if (s.lenFilter !== 'all') {
      if (!e?.target) return false;
      const d = lengthDeviation(u.source, e.target), tol = s.saved.settings.tolerancePct;
      if (s.lenFilter === 'far' ? Math.abs(d) <= tol : s.lenFilter === 'longer' ? d <= 0 : d >= 0) return false;
    }
    return true;
  };
  const matchesStatus = (u: Unit, e: Entry | undefined, f: Filter, opts?: QaOptions): boolean => {
    switch (f) {
      case 'new': return rowState(e) === 'untranslated';
      case 'draft': return e?.status === 'draft';
      case 'auto': return isAutoFilled(e);
      case 'done': return e?.status === 'done';
      case 'appr': return e?.status === 'appr';
      case 'qa': return shownStatus(ctx, u, e) === 'qa';
      case 'adv': return hasAdvice(u, e, opts ?? qaOpts());
      case 'cm': return threadsOf(e?.comments).length > 0;
      default: return true;
    }
  };
  function visibleUnits(withStatus: boolean): Unit[] {
    const v = ctx.view();
    if (!v) return [];
    const ents = ctx.entries(v.name);
    const opts = withStatus && s.filter === 'adv' ? qaOpts() : undefined;
    const list = v.units.filter(u => inContext(u, ents[u.key]) && (!withStatus || matchesStatus(u, ents[u.key], s.filter, opts)));
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
    const over = narrow.matches && !s.phone && s.sideOn.length > 0;
    ide.className = `ide mode-${s.mode === 'table' ? 'table' : 'focus'}${s.mode === 'scene' ? ' scene-mode' : ''} ${l ? 'lp-open' : 'lp-closed'}${s.phone ? ' sz-s' : ''}${s.rightOpen ? ' sheet-open' : ''}${(!s.sideOn.length || over) && !s.phone ? ' rp-collapsed' : ''}${over ? ' rp-over' : ''}${s.compact ? ' compact' : ''}${s.kb ? ' kb' : ''}`;
    const both = (l === 'files' || l === 'rows') && s.leftBoth && !s.phone;
    $('#lpanel').classList.toggle('split', both);
    $('#rz-y').hidden = !both;
    document.querySelectorAll<HTMLElement>('#strip button').forEach(b => { const on = both || b.dataset.lp === l; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
    $('#tree').hidden = !both && l !== 'files';
    $('#lp-rows').hidden = !both && l !== 'rows';
    $('#lp-gl').hidden = l !== 'glossary';
    $('#lp-sc').hidden = l !== 'scenes';
    $('#lp-title').innerHTML = both ? 'Файли й рядки' : l === 'rows' ? `Рядки <span class="lt-f">${esc(currentLabel())}</span>` : l === 'glossary' ? 'Глосарій' : l === 'scenes' ? `Сцени <span class="lt-f">${esc(currentLabel())}</span>` : 'Файли гри';
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
      for (const v of rpg.filter(x => !/^Map\d+\.json$/.test(x.name))) out.push({ t: 'f', d: 1, name: v.name, label: baseName(v.name) });
      const maps = rpg.filter(x => /^Map\d+\.json$/.test(x.name));
      if (maps.length) { out.push({ t: 'd', d: 1, name: 'data/maps', label: 'maps' }); for (const v of maps) out.push({ t: 'f', d: 2, name: v.name, label: baseName(v.name) }); }
    }
    let prev: string[] = [];
    for (const v of others) {
      const parts = v.name.split('/');
      const dirs = parts.slice(0, -1);
      let i = 0;
      while (i < dirs.length && prev[i] === dirs[i]) i++;
      for (let k = i; k < dirs.length; k++) out.push({ t: 'd', d: k, name: dirs.slice(0, k + 1).join('/'), label: dirs[k]! });
      out.push({ t: 'f', d: dirs.length, name: v.name, label: baseName(v.name) });
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
    return g ? `<span class="gdot" style="background:${groupColor(g)}" role="img" aria-label="Група: ${esc(g.name)}" title="Група: ${esc(g.name)}"></span>` : '';
  };
  function renderTree(): void {
    renderGroupsBlock(ctx);
    const box = $('#tree-list');
    const had = box.contains(document.activeElement) ? (document.activeElement as HTMLElement) : null;
    const hadId = had ? { file: had.dataset.file, dir: had.dataset.dir } : null;
    $('#tree-act').innerHTML = s.views.length > 1 ? `<button class="btn" data-act="group-all" title="Усі рядки всіх файлів в одній таблиці">Усі файли разом</button>${s.picked.size ? `<button class="btn p" data-act="group-picked">Відкрити вибрані (${s.picked.size})</button><button class="btn" id="tree-grp" aria-haspopup="menu" title="Додати вибрані файли до групи">У групу ▾</button><button class="btn" data-act="group-clear" title="Зняти позначки">✕</button>` : '<span class="hint">Ctrl+клік: вибрати кілька файлів</span>'}` : '';
    // a tree with nothing in it is no tree: the message stands alone until there are files
    if (!s.views.length) { box.removeAttribute('role'); box.innerHTML = '<div class="msg-empty">Папку гри ще не відкрито</div>'; return; }
    box.setAttribute('role', 'tree');
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
        return `<div class="node dir" style="--d:${n.d}" data-dir="${esc(n.name)}" role="treeitem" tabindex="-1" aria-level="${n.d + 1}" aria-expanded="${!c}"><span class="chev">${c ? '▸' : '▾'}</span><span class="ic dir">▤</span><span class="nm">${esc(n.label)}</span></div>`;
      }
      const v = s.views.find(x => x.name === n.name)!;
      const st = statsOf(v.units, s.saved.files[v.name] ?? {});
      const pc = pct(st.translated, st.total), pcA = pct(st.approved, st.total), full = st.total > 0 && st.approved === st.total;
      const [ic, lab] = fileIcon(n.name);
      const cur = n.name === s.current;
      return `<div class="node ${cur ? 'cur' : ''} ${s.picked.has(n.name) ? 'pick' : ''} ${!st.translated ? 'idle' : ''}" style="--d:${n.d}" data-file="${esc(n.name)}" draggable="true" role="treeitem" tabindex="-1" aria-level="${n.d + 1}" aria-selected="${cur}" title="${cur ? 'Відкрито · ' : ''}${v.label ? esc(v.label) + ' · ' : ''}Перекладено ${pc}% · вичитано ${pcA}%"><span class="chev"></span><span class="ic ${ic}">${lab}</span><span class="nm">${fileGroupDot(n.name)}${v.label ? `${esc(v.label)}<span class="lc">${esc(n.label.replace(/\.json$/, ''))}</span>` : esc(n.label)}</span><span class="mini"><i class="${full ? 'f' : ''}" style="width:${pc}%"></i></span><span class="pc ${full ? 'full' : ''}">${pc}%</span></div>`;
    }).join('');
    // One tab stop for the whole tree; the node that had the focus keeps it after the redraw.
    const mine = hadId ? [...box.querySelectorAll<HTMLElement>('.node')].find(n => hadId.file ? n.dataset.file === hadId.file : n.dataset.dir === hadId.dir) : undefined;
    roveTree(box, mine);
    if (mine) mine.focus({ preventScroll: true });
  }

  function chipsHtml(): string {
    const v = ctx.view();
    if (!v) return '';
    const ents = ctx.entries(v.name);
    const ctxUnits = v.units.filter(u => inContext(u, ents[u.key]));
    const opts = qaOpts();
    return FILTERS.map(([f, l]) => {
      const n = f === 'all' ? ctxUnits.length : ctxUnits.filter(u => matchesStatus(u, ents[u.key], f, opts)).length;
      // A filter that finds nothing is not offered (unless it is the chosen one): the row stays short and nothing is cut off.
      if (n === 0 && f !== 'all' && s.filter !== f) return '';
      return `<button class="chip ${s.filter === f ? 'on' : ''}" data-filter="${f}" aria-pressed="${s.filter === f}">${l} <span class="n">${n}</span></button>`;
    }).join('');
  }

  /** The speaker and length buttons show the chosen value themselves, with a cross to drop it. */
  function renderFilterButtons(): void {
    const set = (id: string, on: boolean, label: string, clear: string): void => {
      const b = $(id);
      b.setAttribute('aria-haspopup', 'true'); if (!b.hasAttribute('aria-expanded')) b.setAttribute('aria-expanded', 'false');
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
    const adv = st !== 'qa' && hasAdvice(u, e, qaOpts());
    const hits = enforced();
    const len = e?.target ? `${displayLength(e.target)}/${displayLength(u.source)}` : '—';
    return `<div class="gr ${sel ? 'sel' : ''} ${chk ? 'chk' : ''}" role="row" tabindex="${sel ? 0 : -1}" aria-selected="${sel}" data-key="${esc(u.key)}">
      <div class="ln" role="gridcell"><span class="num">${n}</span><input type="checkbox" class="rc" ${chk ? 'checked' : ''} aria-label="Вибрати рядок ${n}"></div>
      <div class="st" role="gridcell"><span class="sd ${st}${autoDraft(st, e) ? ' auto' : ''}" title="${STATUS_LABEL[st]}${autoDraft(st, e) ? ' (заповнено застосунком, ще не переглянуто)' : ''}"${st === 'qa' ? ` data-hc="qa" data-hk="${esc(u.key)}"` : ''}></span><span class="vh">${STATUS_LABEL[st]}${autoDraft(st, e) ? ', авто' : ''}</span>${adv ? '<span class="adv" title="Є порада QA: відкрийте рядок, щоб побачити" data-hc="qa" data-hk="' + esc(u.key) + '"></span><span class="vh">Є порада</span>' : ''}</div>
      <div role="gridcell"><span class="key" title="${esc(u.key)}">${esc(shortKey(u.key))}</span>${cmIcon(e)}</div>
      <div class="who" role="gridcell">${esc(ctx.speaker(u))}</div>
      <div class="src" role="gridcell" lang="en">${markup(flow(u.source), hits)}<span class="skey" aria-hidden="true">${esc(shortKey(u.key))}</span></div>
      <div class="tr ${e?.target ? '' : 'empty'}" role="gridcell" title="Клікніть, щоб писати прямо тут">${e?.target ? markup(flow(e.target)) : '—'}</div>
      <div class="len ${lenCls(u, e)}" role="gridcell" title="Символів у перекладі / в оригіналі">${len}</div></div>`;
  }
  let enforcedCache: { stamp: string; en: string[] } | null = null;
  function enforced(): string[] {
    // The stamp changes with the list's identity, its length and every `touchTerms` (a renamed term keeps the length).
    const stamp = termsStamp(s.saved.terms);
    if (!enforcedCache || enforcedCache.stamp !== stamp) enforcedCache = { stamp, en: s.saved.terms.filter(t => t.qa !== false).map(t => t.en) };
    return enforcedCache.en;
  }

  const siHtml = (u: Unit, n: number): string => {
    const e = entryOf(u), st = shownStatus(ctx, u, e);
    return `<div class="si ${u.key === s.cur ? 'sel' : ''}" data-key="${esc(u.key)}" role="button" tabindex="0"><span class="sd ${st}${autoDraft(st, e) ? ' auto' : ''}" title="${STATUS_LABEL[st]}${autoDraft(st, e) ? ' (заповнено застосунком, ще не переглянуто)' : ''}"></span><div><div class="a"><span>${n}</span><b>${esc(ctx.speaker(u) || KIND_LABEL[u.kind])}</b><span>${esc(shortKey(u.key))}</span>${cmIcon(e)}</div><div class="s" lang="en">${esc(flow(u.source))}</div><div class="t">${e?.target ? esc(flow(e.target)) : '—'}</div></div></div>`;
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
    const tabOpts = qaOpts();
    $('#tabs-host').innerHTML = s.open.map(n => {
      const v = s.views.find(x => x.name === n);
      if (!v) return '';
      const ents = s.saved.files[n] ?? {};
      let qa = 0;
      for (const u of v.units) { const e = ents[u.key]; if (e && e.target && activeIssues(u, e, tabOpts).some(i => i.severity === 'bad')) qa++; }
      const [ic, lab] = fileIcon(n);
      const on = n === s.current;
      // A tab is short: the game's label (or the file's name); when two open tabs would read the same, the full name.
      const short = v.label || baseName(n), twin = s.open.some(o => o !== n && (s.views.find(x => x.name === o)?.label || baseName(o)) === short);
      return `<div class="tab ${on ? 'on' : ''}"><button class="tb" data-tab="${esc(n)}" aria-current="${on}" title="${esc(fileTitle(n) + (n.includes('/') ? ' · ' + n : ''))}"><span class="tico ${ic === 'map' ? '' : 'j'}">${lab}</span>${esc(twin ? fileTitle(n) : short)}${qa ? `<span class="badge" title="Проблеми QA у файлі">${qa}</span>` : ''}</button><button class="x" data-closetab="${esc(n)}" aria-label="Закрити вкладку ${esc(n)}">✕</button></div>`;
    }).join('') + (s.group ? `<div class="tab ${s.current === GROUP ? 'on' : ''}"><button class="tb" data-tab="${GROUP}" aria-current="${s.current === GROUP}" title="${esc(s.group.join(', '))}"><span class="tico j">▦</span>${esc(groupTitle())}</button><button class="x" data-closetab="${GROUP}" aria-label="Закрити групу">✕</button></div>` : '');
    document.querySelector<HTMLElement>('#tabs-host .tab.on')?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }

  /** The bulk bar, the select-all box and the tick state of the grid for the rows that are shown (`ids`). */
  function renderBulk(ids: string[]): void {
    const nSel = ids.filter(k => s.checked.has(k)).length;
    $('#grid').classList.toggle('has-sel', nSel > 0);
    const all = $('#selall') as HTMLInputElement | null;
    if (all) { all.checked = nSel > 0 && nSel === ids.length; all.indeterminate = nSel > 0 && nSel < ids.length; }
    const hidden = s.checked.size - nSel;
    $('#bulk').classList.toggle('show', nSel > 0);
    $('#bulkn').textContent = String(nSel);
    $('#bulkt').textContent = ' вибрано' + (hidden ? ` · ще ${hidden} приховано фільтром, їх дія не торкається` : '');
  }
  /** The ticks changed: only the rows that are drawn are touched (a long list keeps shells for the rest, drawn later from `s.checked`). */
  function renderSelection(): void {
    document.querySelectorAll<HTMLElement>('#grid .gr:not(.lazy)').forEach(r => { const on = s.checked.has(r.dataset.key ?? ''); r.classList.toggle('chk', on); const c = r.querySelector<HTMLInputElement>('.rc'); if (c) c.checked = on; });
    renderBulk(visibleUnits(true).map(u => u.key));
  }
  /** Is the table showing every row (no filter, search, speaker, length or sort)? Then a changed row stays where it is. */
  const tablePlain = (): boolean => s.mode === 'table' && s.filter === 'all' && !s.q && s.speaker === null && s.lenFilter === 'all' && s.sort === 'order' && !s.phone && !(lp() === 'rows' || s.leftBoth);
  /**
   * One row of the table changed (a cell was edited): draw that row again and bring the totals in line, instead of
   * drawing the whole workspace. Anything that could move or remove the row (a filter, a search, a sort) or a view
   * other than the plain table falls back to the full redraw.
   */
  function rowChanged(key: string): void {
    const u = ctx.unit(key);
    const old = u && tablePlain() ? document.querySelector<HTMLElement>(`#grid .gr[data-key="${CSS.escape(key)}"]:not(.lazy)`) : null;
    if (!u || !old || !patchRow('grid', key, rowHtml(u, Number(old.querySelector('.num')?.textContent) || 1))) { renderAll(); return; }
    $('#chips1').innerHTML = chipsHtml();
    renderTop(); renderTabs(); renderTree(); renderSidePanel(ctx); renderStatus();
  }
  /** Make another row the selected one without drawing the table again. */
  function selectRowLight(key: string): void {
    document.querySelector('#grid .gr.sel')?.classList.remove('sel');
    const row = document.querySelector<HTMLElement>(`#grid .gr[data-key="${CSS.escape(key)}"]`);
    s.cur = key;
    document.querySelectorAll<HTMLElement>('#grid .gr[tabindex="0"]').forEach(r => { r.tabIndex = -1; r.setAttribute('aria-selected', 'false'); });
    if (row) { row.classList.add('sel'); row.tabIndex = 0; row.setAttribute('aria-selected', 'true'); }
    else ensureGridStop();
    renderStatus(); renderSidePanel(ctx);
  }
  /** The table is one stop of the Tab key: when no row is selected the first one is that stop, so the keyboard can get into the table at all. */
  function ensureGridStop(): void {
    const grid = document.getElementById('grid');
    if (!grid || grid.querySelector('.gr[tabindex="0"]')) return;
    const first = grid.querySelector<HTMLElement>('.gr[data-key]');
    if (first) first.tabIndex = 0;
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
    renderBulk(ids);
    ensureGridStop();
    const cur = s.cur ? idx.get(s.cur) : undefined;
    $('#crumbs').innerHTML = `${s.current !== GROUP && s.current?.includes('/') ? `<span>${esc(s.current.split('/').slice(0, -1).join('/'))}</span>›` : ''}<span>${esc(currentLabel())}</span>${cur && s.cur ? `›<b>${esc(ctx.unit(s.cur)?.context ?? '')}</b>` : ''}<span class="r">${cur ? `рядок ${cur} з ${v.units.length}` : plural(v.units.length, ['рядок', 'рядки', 'рядків'])}${list.length !== v.units.length ? ` · показано ${list.length}` : ''}</span>`;
  }

  function renderTop(): void {
    $('#proj-name').textContent = s.saved.name;
    $('#proj-av').textContent = (Array.from(s.saved.name.trim())[0] ?? 'T').toUpperCase();
    // the four states of a row (see core/progress.ts): without text, draft, sent (not proofread yet), proofread
    const prog = sumProgress(s.views.map(v => progressOf(v.units, s.saved.files[v.name] ?? {})));
    const total = prog.total, A = prog.approved, D = prog.sent, W = prog.draft;
    const cur = ctx.view();
    const nextU = cur && cur.name !== GROUP ? cur.units.find(u => !s.saved.files[cur.name]?.[u.key]?.target && u.kind !== 'name' && u.kind !== 'term') : undefined;
    publishWidget({ name: s.saved.name, file: s.current === GROUP ? '' : s.current ?? '', total, approved: A, done: D, draft: W, ...(cur && nextU ? { next: { file: cur.name, key: nextU.key, text: nextU.source.replace(/\s+/g, ' ').slice(0, 160) } } : {}) });
    $('#pg-a').style.width = total ? `${(100 * A) / total}%` : '0';
    $('#pg-b').style.width = total ? `${(100 * D) / total}%` : '0';
    $('#pg-c').style.width = total ? `${(100 * W) / total}%` : '0';
    $('#pg-txt').textContent = total ? `Перекладено ${pct(prog.translated, total)}% (${prog.translated.toLocaleString('uk-UA')} з ${total.toLocaleString('uk-UA')}) · надіслано ${pct(prog.sent + prog.approved, total)}% · вичитано ${pct(A, total)}%` : 'Папку гри не відкрито';
    $('#pg').setAttribute('aria-valuenow', String(pct(prog.translated, total)));
    $('#pg').setAttribute('aria-valuetext', $('#pg-txt').textContent ?? '');
    $('#pg').title = total ? `Вичитано ${pct(A, total)}% · Надіслано, ще не вичитано ${pct(D, total)}% · Чернетки ${pct(W, total)}% · Без перекладу ${pct(prog.untranslated, total)}%` : '';
    // The project lives in the browser's storage only: the age of the newest copy outside it is always shown (and marked when there is none).
    const copy = copyLine(s.saved, Date.now(), prog.translated), built = stampOf(s.saved, 'build');
    $('#sb-sync').hidden = false; $('#sb-sync').textContent = copy.text; $('#sb-sync').className = copy.warn ? 'bad' : '';
    $('#sb-sync').title = copy.warn ? 'Проєкт зберігається лише в цьому браузері. Збережіть копію у файл («Налаштування → Застосунок») або синхронізуйте' : 'Остання копія проєкту поза браузером (файл або синхронізація)';
    $('#sb-build').hidden = !built;
    $('#sb-build').textContent = built ? `Збірка: ${ago(built.mt, Date.now())}${built.n !== undefined ? ` · ${plural(built.n, ['рядок', 'рядки', 'рядків'])}` : ''}` : '';
    renderRunCfg();
    setUnavailable($('#cfg-btn'), !s.views.length, 'Спершу відкрийте гру', 'Що запускає кнопка ▶');
    setUnavailable($('#run-btn'), !s.views.length, 'Спершу відкрийте гру', `Запустити «${CFG[runCfg].name}» (F5)`);
  }

  function renderStatus(): void {
    const v = ctx.view();
    const ents = v ? ctx.entries(v.name) : {};
    let qa = 0, adv = 0;
    const opts = qaOpts();
    if (v) for (const u of v.units) { const e = ents[u.key]; if (e && e.target) { if (activeIssues(u, e, opts).some(i => i.severity === 'bad')) qa++; if (hasAdvice(u, e, opts)) adv++; } }
    const sv = $('#sb-save');
    sv.textContent = !s.saveOk ? '○ Не збережено: повторю спробу' : s.savedAt ? '● Збережено о ' + new Date(s.savedAt).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '● Зміни зберігаються автоматично';
    sv.className = s.saveOk ? 'ok' : 'bad';
    $('#sb-fmt').textContent = s.current && s.current !== GROUP ? FORMAT_LABEL[s.current.split('.').pop() ?? ''] ?? '' : '';
    $('#sb-qa').textContent = qa ? plural(qa, ['помилка QA', 'помилки QA', 'помилок QA']) : 'Помилок QA немає';
    $('#sb-qa').className = qa ? 'bad' : 'ok';
    const ab = $('#sb-adv');
    ab.hidden = !adv;
    ab.textContent = adv ? `Поради: ${adv}` : '';
    const u = s.cur ? ctx.unit(s.cur) : undefined;
    $('#st-sel').textContent = u && v ? `Рядок ${v.units.indexOf(u) + 1} · ${STATUS_LABEL[shownStatus(ctx, u, entryOf(u))]}` : '';
    if (v) {
      const st = statsOf(v.units, ents);
      $('#sb-file').textContent = `${s.current === GROUP ? 'Група' : 'Файл'}: ${st.approved} / ${st.total} вичитано · ${st.done} чекають вичитки`;
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
    // What to say depends on the platform, not on the width of the window: a narrow desktop window is still the desktop.
    const handheld = s.phone && !isDesktop();
    const resume = (lastHandle || desktopDir()) ? `<p><button class="btn p" id="resume">Продовжити з папкою «${esc(lastHandle?.name ?? (desktopDir() ?? '').split(/[\\/]/).filter(Boolean).pop() ?? '')}»</button></p>` : '';
    const where = isDesktop() ? 'у проєкті на цьому комп’ютері' : 'у цьому браузері';
    box.innerHTML = `<h2>${handheld ? 'Відкрийте файли' : 'Відкрийте папку гри'}</h2>${handheld ? 'На телефоні проєкт береться з комп’ютера: на ПК виберіть «Налаштування → Синхронізація → Обмін проєктом через файл → Зберегти проєкт у файл», передайте файл сюди й відкрийте його, або вставте його вміст як текст. Так само можна відкрити файли самої гри.' : `Оберіть папку <b>data</b> гри на RPG Maker (або саму папку гри), папку з файлами <b>.po</b>, <b>.csv</b>, <b>.rpy</b> (Ren’Py) чи JSON-локалізацією. Ваш переклад зберігається ${where}, файли гри не змінюються.`}${resume}${handheld ? `${claudeAvailable ? '<p><button class="btn p" id="cl2">Отримати з іншого пристрою (через Claude)</button></p>' : ''}<p><button class="btn p" id="imp2">Відкрити файли або вставити JSON…</button></p>` : `<p><button class="btn p" id="open2">Відкрити папку гри</button></p><p><button class="btn" id="imp2">Відкрити файли або вставити JSON…</button></p>`}`;
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
    setUnavailable($('#m-scene'), !hasScenes(ctx), 'У цьому файлі немає сцен: режим «Сцена» працює для файлів із подіями гри', 'Усі репліки сцени поспіль, з перекладом на місці');
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
    const ingested = lastIngest;
    dataDir = isDesktop() ? dataDirOf(picked) : null;
    if (!s.views.length) { s.current = null; renderAll(); toast('У цих файлах немає тексту для перекладу'); return; }
    if (failed.length) toast(`Не вдалося прочитати файлів: ${failed.length}`);
    const fromBackup = picked.filter(f => f.fromBackup).length;
    const translated = sumProgress(s.views.map(v => progressOf(v.units, s.saved.files[v.name] ?? {}))).translated;
    const heavy = isDesktop() && !fromBackup && translated >= 10 && reset / translated >= 0.2;
    if (ingested && !heavy) toast(`Нова версія гри: ${ingestNote(ingested.report)}`, { action: { label: 'Показати', run: () => openIngestReport(ctx, ingested.report, ingested.batch) } });
    if (heavy) {
      // Many originals changed at once and there is no backup to read them from: most likely the folder already holds the translation.
      toast('Оригінали в папці гри змінилися майже скрізь, а резервної копії немає: схоже, там уже лежить переклад. Натисніть «Збірка (файл)» → «Повернути оригінали», потім відкрийте папку знову', { sticky: true });
    } else if (reset) {
      const back = lastReconcile ? `: ${plural(lastReconcile.demoted, ['рядок', 'рядки', 'рядків'])} повернуто в чернетки` : '';
      undoToast(ctx, `Оригінал змінився в ${plural(reset, ['рядку', 'рядках', 'рядках'])}${back}`, lastReconcile?.batch);
    } else if (fromBackup) toast('Оригінали прочитано з резервної копії гри (data.transly-orig)');
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
    // The translations are keyed by the position of a line in its file: a new version of the game is lined up with the old one by the
    // text of the originals first, so a line put in (or taken out) does not push the translations onto their neighbours.
    const now = Date.now();
    const ing = planIngest(s.saved.snapshot, fresh, s.saved.files, now);
    lastIngest = ingestQuiet(ing.report) ? null : { batch: ing.changes.length ? ctx.commit(ing.changes, 'rekey') : undefined, report: ing.report };
    const snap = snapshotOf(s.views);
    if (JSON.stringify(snap) !== JSON.stringify(s.saved.snapshot ?? null)) { s.saved.assetsRev = Date.now(); s.saved.snapshot = snap; }
    // Rows whose original changed: the sent and proofread ones go back to drafts as one action of the journal, so it is visible and can be taken back.
    const rec = reconcileChanges(s.views, s.saved.files, now);
    lastReconcile = rec.changes.length ? { batch: ctx.commit(rec.changes, 'reconcile'), demoted: rec.changes.length } : null;
    return rec.changed;
  }
  /** What the last reading of the game files did to rows whose original changed (for the message that follows). */
  let lastReconcile: { batch: string; demoted: number } | null = null;
  /** What lining the new version of the game up with the old one did (for the message that follows). */
  let lastIngest: { batch: string | undefined; report: IngestReport } | null = null;

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
    // On a narrow screen the list would cover the dialog; on a desktop the panel stays where it is.
    if (s.phone) { s.leftOpen = false; renderLayout(); }
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
    $('#cfg-btn').setAttribute('aria-label', `Що запускає кнопка ▶: ${CFG[runCfg].name}`);
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
    rememberOpener(btn); pop.hidden = false; btn.setAttribute('aria-expanded', 'true'); focusFirst(pop);
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
      <div class="pj-card"><span class="pj lg">${esc((Array.from(s.saved.name.trim())[0] ?? 'T').toUpperCase())}</span><div><b>${esc(s.saved.name)}</b><small class="${folder.kind === 'missing' || folder.kind === 'other' ? 'warn' : ''}" title="${esc(folderLine(folder, remembered))}">${esc(folderLine(folder, remembered))}</small><small>${total ? `Перекладено ${done.toLocaleString('uk-UA')} з ${total.toLocaleString('uk-UA')}` : 'Файлів ще немає'}</small></div></div>`;
    const r = btn.getBoundingClientRect();
    pop.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - 340))}px`; pop.style.top = `${r.bottom + 6}px`;
    rememberOpener(btn); pop.hidden = false; btn.setAttribute('aria-expanded', 'true'); focusFirst(pop);
  }
  /** Hide a popover; the focus that was inside it goes back to the control that opened it. */
  const hidePop = (pop: HTMLElement): void => {
    const had = pop.contains(document.activeElement); pop.hidden = true;
    if (pop.dataset.for) document.getElementById(pop.dataset.for)?.setAttribute('aria-expanded', 'false');
    if (had) restoreOpener();
  };
  const closeProjMenu = (): void => { hidePop($('#projpop')); $('#proj-btn').setAttribute('aria-expanded', 'false'); };
  const closeCfgMenu = (): void => { hidePop($('#cfgpop')); $('#cfg-btn').setAttribute('aria-expanded', 'false'); };
  const runCfgNow = (k: RunCfg): void => {
    if (!s.views.length) { toast('Спершу відкрийте гру'); return; }
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
  const doBuild = () => openBuild(ctx, dataDir, n => { s.lastBuild = { at: Date.now(), n }; stamp(s.saved, 'build', 'збірка', Date.now(), n); ctx.persist(); renderTop(); });

  function openSettingsDlg(tab?: SettingsTab): void {
    openSettings(ctx, {
      reset: () => {
        // The project is empty again, so the game's strings have to be read into it afresh (plugin texts are off by default).
        if (s.game.length) { ingest(s.game); unitMap = new Map((ctx.view()?.units ?? []).map(u => [u.key, u])); if (s.cur && !unitMap.has(s.cur)) s.cur = null; }
        // No game folder in memory (the files on screen came from the stored snapshot): the rows stay the project's game, so keep their snapshot.
        else if (s.views.length) s.saved.snapshot = snapshotOf(s.views);
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
      wrap: () => openWrapTool(ctx, { wrapFile }),
      qa: () => openQaRules(ctx),
      importFiles: openImportDlg,
    }, tab);
  }

  /* ---------- popovers (speaker / length) ---------- */
  const fpop = () => $('#fpop');
  function showPop(btn: HTMLElement, html: string): void {
    const p = fpop();
    if (!p.hidden && p.dataset.for === btn.id) { hidePop(p); return; }
    rememberOpener(btn);
    if (p.dataset.for) document.getElementById(p.dataset.for)?.setAttribute('aria-expanded', 'false');
    p.innerHTML = html; p.dataset.for = btn.id; p.hidden = false; btn.setAttribute('aria-expanded', 'true');
    const r = btn.getBoundingClientRect();
    p.style.left = Math.min(r.left, innerWidth - p.offsetWidth - 8) + 'px';
    p.style.top = r.bottom + 4 + 'px';
    focusFirst(p);
  }
  /** Phone: the five sections of the bottom bar. Files and rows are full pages, the hints are a bottom sheet. */
  function bottomNav(to: string, btn: HTMLElement): void {
    if (to === 'more') {
      // The phone has no menu bar: the same menus, as one list.
      showPop(btn, Object.entries(PHONE_MENUS).map(([g, items]) => `<div class="group">${esc(g)}</div>${items.map((it, i) => (it === '-' ? '' : `<button data-pmi="${esc(g)}|${i}">${esc(it.t)}</button>`)).join('')}`).join(''));
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
  const closePops = () => { hidePop(fpop()); closeCfgMenu(); closeProjMenu(); };
  const groupsApi = { pop: (a: HTMLElement, html: string) => showPop(a, html), closePops: () => closePops() };
  /** A menu at the pointer. */
  function popAt(x: number, y: number, html: string): void {
    const p = fpop();
    rememberOpener();
    p.innerHTML = html; p.dataset.for = 'at'; p.hidden = false;
    p.style.left = Math.max(8, Math.min(x, innerWidth - p.offsetWidth - 8)) + 'px';
    p.style.top = Math.max(8, Math.min(y, innerHeight - p.offsetHeight - 8)) + 'px';
    focusFirst(p);
  }
  const filesTarget = (name: string): PlaceTarget => {
    const many = s.picked.has(name) && s.picked.size > 1;
    return many ? { files: [...s.picked], label: plural(s.picked.size, ['файл', 'файли', 'файлів']) } : { files: [name], label: name.replace(/\.json$/, '') };
  };

  /* ---------- global search ---------- */
  interface SdItem { t: 'file' | 'row' | 'term'; file?: string; key?: string; term?: string; kind: string; title: string; sub?: string; where?: string; status?: string }
  let sdItems: SdItem[] = [];
  let sdSel = 0;
  let searchFrom: HTMLElement | null = null;
  function openSearch(): void { searchFrom = document.activeElement instanceof HTMLElement ? document.activeElement : null; $('#sd').hidden = false; const i = $('#sd-in') as HTMLInputElement; i.value = ''; sdRender(); i.focus(); holdInert('search', true); }
  function closeSearch(): void {
    $('#sd').hidden = true; holdInert('search', false);
    const from = searchFrom; searchFrom = null;
    // Back to where the search was started, unless the chosen result has already put the focus somewhere.
    setTimeout(() => { const at = document.activeElement; if (from && from.isConnected && from.getClientRects().length > 0 && (!at || at === document.body || $('#sd').contains(at))) from.focus({ preventScroll: true }); }, 0);
  }
  /**
   * The results come in three groups, each with its own limit (so rows never push the terms out): files, rows (the
   * original, the translation under it, where it is and its state) and terms. Without a query: the open files first.
   */
  function sdRender(): void {
    const q = ($('#sd-in') as HTMLInputElement).value.trim().toLowerCase();
    const files: SdItem[] = [], rows: SdItem[] = [], terms: SdItem[] = [];
    /** How many results each group really has, when more than it shows (the group header then says «показано 8 з 37»). */
    const total: Record<string, number> = {};
    const CAP = 999;
    const fileItem = (name: string): SdItem => ({ t: 'file', file: name, kind: 'Файли', title: fileTitle(name), sub: name.includes('/') ? name : undefined });
    if (!q) {
      const first = [...new Set([...s.open, ...s.views.map(v => v.name)])].filter(n => s.views.some(v => v.name === n));
      first.slice(0, 8).forEach(n => files.push(fileItem(n)));
    } else {
      let nFiles = 0;
      for (const v of s.views) if (`${v.name} ${v.label ?? ''}`.toLowerCase().includes(q)) { nFiles++; if (files.length < 5) files.push(fileItem(v.name)); }
      total['Файли'] = nFiles;
      let nRows = 0;
      outer: for (const v of s.views) {
        const ents = s.saved.files[v.name] ?? {};
        for (const u of v.units) {
          const e = ents[u.key];
          if (!(u.source + ' ' + flowText(e?.target ?? '') + ' ' + u.key).toLowerCase().includes(q)) continue;
          nRows++;
          if (rows.length < 8) rows.push({ t: 'row', file: v.name, key: u.key, kind: 'Рядки', title: u.source.replace(/\s+/g, ' ').slice(0, 90), sub: e?.target ? e.target.replace(/\s+/g, ' ').slice(0, 90) : '', where: `${fileTitle(v.name)} · ${shortKey(u.key)}`, status: shownStatus(ctx, u, e) });
          else if (nRows >= CAP) break outer;
        }
      }
      total['Рядки'] = nRows;
      const hitTerms = s.saved.terms.filter(t => (t.en + ' ' + t.uk).toLowerCase().includes(q));
      total['Терміни'] = hitTerms.length;
      hitTerms.slice(0, 4).forEach(t => terms.push({ t: 'term', term: t.en, kind: 'Терміни', title: t.en, sub: t.uk }));
    }
    sdItems = [...files, ...rows, ...terms]; sdSel = 0;
    let html = '', last = '';
    sdItems.forEach((x, i) => {
      if (x.kind !== last) {
        last = x.kind;
        const all = total[x.kind] ?? 0, shown = sdItems.filter(y => y.kind === x.kind).length;
        html += `<div class="sd-h" role="presentation">${x.kind}${all > shown ? ` · показано ${shown} з ${all >= CAP ? `${CAP}+` : all}` : ''}</div>`;
      }
      const dot = x.status ? `<i class="sd ${x.status}" title="${STATUS_LABEL[x.status as keyof typeof STATUS_LABEL] ?? ''}" aria-hidden="true"></i>` : '';
      html += `<div class="sd-it ${i === 0 ? 'on' : ''}" id="sd-opt-${i}" data-sd="${i}" role="option" aria-selected="${i === 0}">${dot}<span class="sd-b"><span class="sd-t">${esc(x.title)}</span>${x.sub ? `<span class="sd-s">${esc(x.sub)}</span>` : ''}${x.where ? `<span class="sd-w">${esc(x.where)}</span>` : ''}</span></div>`;
    });
    $('#sd-res').innerHTML = html || '<div class="sd-empty" role="status">Нічого не знайдено</div>';
    $('#sd-in').setAttribute('aria-activedescendant', sdItems.length ? 'sd-opt-0' : '');
  }
  function sdGo(i: number): void {
    const it = sdItems[i];
    if (!it) return;
    closeSearch();
    if (it.t === 'term') { s.leftOpen = true; s.leftBoth = false; s.leftTab[s.mode] = 'glossary'; renderAll(); showTerm(ctx, it.term ?? ''); return; }
    if (it.file) {
      if (it.file !== s.current) openFile(it.file);
      if (it.key) { s.filter = 'all'; s.q = ''; s.speaker = null; s.lenFilter = 'all'; ctx.select(it.key, s.mode === 'table' ? undefined : s.mode); } else renderAll();
    }
  }

  /* ---------- menu bar ---------- */
  type MenuItem = '-' | { t: string; fn: () => void; sc?: string };
  /** The menu bar of the desktop: what is already a button of the title bar (the modes, the shortcuts) is not repeated here. */
  const MENUS: Record<string, MenuItem[]> = {
    'Файл': [{ t: 'Відкрити папку гри…', fn: () => void openFolder() }, { t: 'Відкрити файли або вставити JSON…', fn: openImportDlg }, '-', { t: 'Зібрати…', fn: doBuild }, { t: 'Запустити вибране', fn: runSelected, sc: 'F5' }, '-', { t: 'Налаштування…', fn: () => openSettingsDlg() }],
    'Перехід': [{ t: 'Наступний рядок без перекладу', fn: () => jump('untranslated', 1), sc: 'Alt+⇧+↓' }, { t: 'Наступна помилка QA', fn: () => jump('error', 1), sc: 'F8' }, { t: 'Наступна порада', fn: () => jump('advice', 1) }, { t: 'Наступний на вичитку', fn: () => jump('unreviewed', 1) }, { t: 'Наступний зі зміненим оригіналом', fn: () => jump('sourceChanged', 1) }, '-', { t: 'Пошук скрізь…', fn: openSearch, sc: 'Ctrl+K' }],
    'Інструменти': [{ t: 'Визначити мовців…', fn: () => openSpeakers(ctx) }, { t: 'Знайти й замінити…', fn: () => openFindReplace(ctx) }, { t: 'Оновити за глосарієм…', fn: () => openTermSyncTool(ctx) }, { t: 'Автозаповнення…', fn: () => openAutofill(ctx, () => openLinkTool(ctx)) }, { t: 'Активність…', fn: () => openActivity(ctx) }, { t: 'Тексти плагінів…', fn: () => openPluginTexts(ctx, setPluginCommands) }, { t: 'Перенесення рядків…', fn: () => openWrapTool(ctx, { wrapFile }) }, { t: 'Правила QA…', fn: () => openQaRules(ctx) }],
  };
  /** The phone has no title bar: its «Ще» list is the same menus plus what the title bar offers on the desktop. */
  const PHONE_MENUS: Record<string, MenuItem[]> = {
    ...MENUS,
    'Вигляд': [{ t: 'Таблиця', fn: () => setMode('table') }, { t: 'Редагування', fn: () => setMode('edit') }, { t: 'Сцена', fn: () => setMode('scene') }],
    'Довідка': [{ t: 'Гарячі клавіші', fn: () => toggleKeys() }],
  };
  /** Re-flow every translated message of the current file whose lines are wider than the game window. */
  function wrapFile(): void {
    const v = ctx.view();
    if (!v) { toast('Спершу відкрийте файл'); return; }
    const plan = wrapPlan();
    if (plan.disabled || (!plan.limit && plan.settings.unit !== 'px')) { toast('Ширину рядка вимкнено в «Перенесення рядків»'); return; }
    const ents = ctx.entries(v.name);
    const changes: RowChange[] = [];
    for (const u of v.units) {
      const e = ents[u.key];
      if (!e?.target || !isMessageUnit(u) || !tooWide(plan, u, e.target).count) continue;
      const text = wrapMessage(plan, u, e.target).text;
      if (text !== e.target) changes.push({ file: v.name, key: u.key, next: edit(e, u, text, ctx.stage(), Date.now()), text });
    }
    // proofread messages are not re-flowed unasked
    const changePlan = planOf(ctx.entries, changes, 'wrap');
    const n = changePlan.changes.length;
    const batch = applyPlan(ctx.commit, changePlan);
    if (n) { ctx.persist(); ctx.invalidateTm(); renderAll(); }
    const left = changePlan.skipped.length ? `. Вичитаних пропущено: ${changePlan.skipped.length}` : '';
    if (n) undoToast(ctx, `Перенесено рядки: ${plural(n, ['репліка', 'репліки', 'реплік'])}${left}`, batch); else toast(changePlan.skipped.length ? `Задовгі лише вичитані рядки (${changePlan.skipped.length}): їх не чіпав` : 'Задовгих рядків у файлі немає');
  }
  /**
   * Go to the next (dir 1) or previous (dir -1) row of a queue in the WHOLE project (see core/queue.ts), going round at the
   * ends. The row opens in the mode you are in; the file is opened when the row is in another one.
   */
  function jump(kind: QueueKind, dir: 1 | -1): void {
    const rows = queueRows(s.views, s.saved, kind, qaOpts());
    const cu = s.cur ? ctx.unit(s.cur) : undefined;
    const from = cu ? realOf(ctx, cu) : null;
    const hit = nextIn(rows, positionOf(s.views, from), dir);
    if (!hit) { toast(QUEUE_LABEL[kind].empty); return; }
    const { file, key } = hit.row;
    if (file !== s.current) openFile(file);
    s.filter = 'all'; s.q = ''; s.speaker = null; s.lenFilter = 'all';
    const target = s.current === GROUP ? `${file}${SEP}${key}` : key;
    ctx.select(ctx.unit(target) ? target : key, s.mode === 'table' ? undefined : s.mode);
    toast(`${QUEUE_LABEL[kind].title}: ${hit.place} з ${rows.length}`);
  }
  function toggleKeys(): void {
    const k = $('#keypop');
    if (!k.hidden) { hidePop(k); return; }
    rememberOpener($('#hk'));
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
  /** Open the menu of a group of the bar and put the focus on its first item (the keyboard way in). */
  function mbEnter(g: string): void { mbShow(g); focusFirst(mdd(), '[role="menuitem"]'); }
  function mbToggle(on?: boolean): void {
    const bar = $('#menubar');
    const open = on ?? bar.hidden;
    const had = bar.contains(document.activeElement) || mdd().contains(document.activeElement);
    if (open && !bar.children.length) bar.innerHTML = Object.keys(MENUS).map(g => `<button role="menuitem" aria-haspopup="menu" aria-expanded="false" data-mg="${esc(g)}">${esc(g)}</button>`).join('');
    if (!open) mbClose();
    else rememberOpener($('#hamb'));
    bar.hidden = !open;
    $('.topbar').classList.toggle('menu-on', open);
    $('#hamb').setAttribute('aria-expanded', String(open));
    // The keyboard goes straight into the bar; closing it gives the focus back to the button that opened it.
    if (open) focusFirst(bar, '[data-mg]'); else if (had) restoreOpener();
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
    const batch = ok ? ctx.commit(changes, 'send') : undefined;
    ctx.persist(); ctx.invalidateTm(); renderAll();
    const nSkip = [...skipped.values()].reduce((a, b) => a + b, 0);
    undoToast(ctx, `Надіслано: ${ok}${nSkip ? `. Пропущено: ${nSkip} (${[...skipped.keys()].slice(0, 2).join('; ')})` : ''}`, batch, nSkip > 0);
    // Rows with the same original are not touched by a bulk send: say how many have something to look at.
    if (ok && linkModeOf(s.saved.settings) !== 'off') {
      const todo = pendingLinks(s.saved, ctx.links(), changes);
      if (todo) toast(`Зв’язаних рядків до перегляду: ${todo}`, { action: { label: 'Переглянути', run: () => openLinkTool(ctx) } });
    }
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
      const miss = (why: string): void => { skipped.set(why.slice(0, 40), (skipped.get(why.slice(0, 40)) ?? 0) + 1); };
      const r2 = approveEntry(ents[k], u, now, opts);
      if (r2.ok) changes.push({ file: v.name, key: k, next: r2.entry, text: r2.entry.target }); else miss(r2.reason);
    }
    const auto = changes.filter(c => isAutoFilled(ents[c.key])).length;
    const batch = changes.length ? ctx.commit(changes, 'approve', 'вичитано') : undefined;
    ctx.persist(); ctx.invalidateTm(); renderAll();
    const nSkip = [...skipped.values()].reduce((a, b) => a + b, 0);
    undoToast(ctx, `Вичитано: ${changes.length}${autoNote(auto)}${nSkip ? `. Пропущено: ${nSkip} (${[...skipped.keys()].slice(0, 2).join('; ')})` : ''}`, batch, nSkip > 0);
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
    const batch = n ? ctx.commit(changes, 'memory') : undefined;
    ctx.persist(); ctx.invalidateTm(); renderAll();
    if (n) undoToast(ctx, `Підставлено з пам’яті: ${n}`, batch); else toast('Збігів від 70% для порожніх вибраних рядків немає');
  }

  /* ---------- inline cell editing ---------- */
  function startInline(key: string): void {
    reveal('grid', key);
    const cell = document.querySelector<HTMLElement>(`.gr[data-key="${CSS.escape(key)}"] .tr`);
    const u = ctx.unit(key);
    if (!cell || !u || cell.querySelector('textarea')) return;
    const ta = el('textarea', 'cell-ed');
    ta.rows = 2; ta.value = entryOf(u)?.target ?? ''; ta.setAttribute('aria-label', 'Переклад рядка');
    // The caret goes to the end: the first letter typed must not wipe the translation.
    cell.innerHTML = ''; cell.appendChild(ta); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
    let cancelled = false;
    const save = (): void => {
      if (!cancelled && ta.value !== (entryOf(u)?.target ?? '')) {
        const ents = ctx.entries(s.current!);
        ents[key] = edit(ents[key], u, ta.value, ctx.stage(), Date.now());
        s.sess.n++; ctx.persist(); ctx.softTm();
      }
    };
    const finish = () => { save(); rowChanged(key); };
    ta.addEventListener('blur', finish, { once: true });
    ta.addEventListener('keydown', e => {
      if (e.key === 'Escape') { cancelled = true; e.preventDefault(); ta.blur(); }
      // Enter and Tab keep the translation and carry on in the next row's cell (Shift+Enter writes a line break, Shift+Tab goes back).
      else if ((e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) || (e.key === 'Tab' && !e.ctrlKey && !e.altKey)) {
        e.preventDefault(); ta.removeEventListener('blur', finish); save();
        const list = visibleUnits(true), at = list.findIndex(x => x.key === key);
        const next = list[at + (e.key === 'Tab' && e.shiftKey ? -1 : 1)];
        rowChanged(key);
        if (next) { reveal('grid', next.key); selectRowLight(next.key); }
        startInline(next?.key ?? key);
      }
      else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); ta.removeEventListener('blur', finish); const ents = ctx.entries(s.current!); ents[key] = edit(ents[key], u, ta.value, 'translate', Date.now()); const r = submit(ents[key], u, 'translate', Date.now(), { blockErrors: s.saved.settings.blockErrors, qa: qaOpts() }); if (r.ok) { afterSendFollowUp(ctx, u, ctx.commit([{ file: s.current!, key, next: r.entry, text: r.entry.target }], 'send'), Date.now()); } else toast(r.reason, { sticky: true }); ctx.persist(); ctx.invalidateTm(); renderAll(); }
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
    const off = t.closest<HTMLElement>('[aria-disabled="true"][data-why]');
    if (off) { toast(off.dataset.why!); return; }
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
    if (t.closest('#sb-adv')) { s.filter = 'adv'; renderAll(); return; }
    if (t.closest('#sb-qa')) { jump('error', 1); return; }
    if (t.closest('#sb-build')) { doBuild(); return; }
    if (t.closest('#sb-sync')) { openSettingsDlg('Синхронізація'); return; }
    if (t.closest('#lp-search,#mt-search')) { openSearch(); return; }
    if (t.closest('#hk')) { toggleKeys(); return; }
    if (t.closest('#hamb')) { mbToggle(); return; }
    const mg = t.closest<HTMLElement>('#menubar [data-mg]');
    if (mg) { if (mbOpen === mg.dataset.mg) mbClose(); else if (e.detail === 0) mbEnter(mg.dataset.mg!); else mbShow(mg.dataset.mg!); return; }
    const mi = t.closest<HTMLElement>('#mdd [data-mi]');
    if (mi) { const [g, i] = mi.dataset.mi!.split('|'); const it = MENUS[g!]![Number(i)]; mbToggle(false); if (it && it !== '-') setTimeout(() => it.fn(), 0); return; }
    if (!t.closest('#menubar,#mdd,#hamb') && !$('#menubar').hidden) mbToggle(false);
    if (t.closest('#scrim')) { s.leftOpen = false; s.rightOpen = false; renderAll(); return; }
    const bn = t.closest<HTMLElement>('#bnav [data-bn]');
    if (bn) { bottomNav(bn.dataset.bn!, bn); return; }
    if (t.closest('#ab-search')) { openSearch(); return; }
    const pmi = t.closest<HTMLElement>('[data-pmi]');
    if (pmi) { const [g, i] = pmi.dataset.pmi!.split('|'); closePops(); const it = PHONE_MENUS[g!]?.[Number(i)]; if (it && it !== '-') it.fn(); return; }
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
    if (t.closest('#bb-clear')) { s.checked.clear(); renderSelection(); return; }
    if (t.closest('#selall')) { const all = ($('#selall') as HTMLInputElement).checked; for (const u of visibleUnits(true)) all ? s.checked.add(u.key) : s.checked.delete(u.key); renderSelection(); return; }
    const rc = t.closest<HTMLInputElement>('.rc');
    if (rc) { const row = rc.closest<HTMLElement>('.gr')!, k = row.dataset.key!; rc.checked ? s.checked.add(k) : s.checked.delete(k); row.classList.toggle('chk', rc.checked); renderBulk(visibleUnits(true).map(u => u.key)); return; }
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
        if (row.dataset.key !== s.cur) selectRowLight(row.dataset.key!);
        startInline(row.dataset.key!); return;
      }
      if (row && row.dataset.key !== s.cur && !t.closest('textarea')) selectRowLight(row.dataset.key!);
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
  // Shift+click picks a range of rows: do not leave the text between them selected.
  root.addEventListener('mousedown', e => { if (e.shiftKey && (e.target as HTMLElement).closest('.gr') && !(e.target as HTMLElement).closest('textarea,input')) e.preventDefault(); });
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
      // The list is filtered as the translator types, but not on every letter: a long file is drawn once the typing pauses.
      s.q = (t as HTMLInputElement).value;
      const id = t.id;
      window.clearTimeout(qTimer);
      qTimer = window.setTimeout(() => {
        const box = $(id === 'q' ? '#q' : '#q2') as HTMLInputElement;
        const pos = box.selectionStart ?? s.q.length, had = document.activeElement === box;
        renderAll();
        const q = $(id === 'q' ? '#q' : '#q2') as HTMLInputElement;
        if (had) { q.focus(); q.setSelectionRange(pos, pos); }
      }, 160);
    }
  });

  $('#sd-in').addEventListener('input', sdRender);
  $('#sd-in').addEventListener('keydown', e => {
    const k = (e as KeyboardEvent).key;
    if (k === 'ArrowDown' || k === 'ArrowUp') { e.preventDefault(); sdSel = (sdSel + (k === 'ArrowDown' ? 1 : -1) + sdItems.length) % Math.max(1, sdItems.length); document.querySelectorAll('.sd-it').forEach((x, i) => { x.classList.toggle('on', i === sdSel); x.setAttribute('aria-selected', String(i === sdSel)); if (i === sdSel) { $('#sd-in').setAttribute('aria-activedescendant', x.id); x.scrollIntoView({ block: 'nearest' }); } }); }
    else if (k === 'Enter') { e.preventDefault(); sdGo(sdSel); }
  });

  let qTimer = 0;
  let lastShift = 0;
  document.addEventListener('keydown', e => {
    const t = e.target as HTMLElement;
    if (e.key === 'Escape') {
      if (!$('#sd').hidden) { closeSearch(); return; }
      if (!$('#fpop').hidden || !$('#cfgpop').hidden || !$('#projpop').hidden || !$('#keypop').hidden) {
        closePops(); hidePop($('#keypop'));
        return;
      }
      if (!mdd().hidden) { const g = mbOpen; mbClose(); document.querySelector<HTMLElement>(`#menubar [data-mg="${CSS.escape(g ?? '')}"]`)?.focus(); return; }
      if (!$('#menubar').hidden) { mbToggle(false); return; }
      if (s.phone && (s.leftOpen || s.rightOpen)) { s.leftOpen = false; s.rightOpen = false; renderAll(); return; }
    }
    if (document.querySelector('dialog[open]')) return;
    // Menus, popovers, the menu bar and the file tree answer the arrows.
    const pop = t.closest<HTMLElement>('#projpop,#cfgpop,#fpop,#keypop,#mdd');
    if (pop && !pop.hidden) {
      if (pop.id === 'mdd' && (e.key === 'ArrowRight' || e.key === 'ArrowLeft') && mbOpen) {
        const gs = Object.keys(MENUS), i = gs.indexOf(mbOpen);
        e.preventDefault(); mbEnter(gs[(i + (e.key === 'ArrowRight' ? 1 : -1) + gs.length) % gs.length]!); return;
      }
      if (menuKeys(e, pop)) return;
    }
    const bar = t.closest<HTMLElement>('#menubar');
    if (bar && t.dataset.mg) {
      const gs = [...bar.querySelectorAll<HTMLElement>('[data-mg]')], i = gs.indexOf(t);
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault(); const n = gs[(i + (e.key === 'ArrowRight' ? 1 : -1) + gs.length) % gs.length]!;
        if (mbOpen) mbEnter(n.dataset.mg!); else n.focus();
        return;
      }
      if (e.key === 'ArrowDown') { e.preventDefault(); mbEnter(t.dataset.mg!); return; }
      if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); gs[e.key === 'Home' ? 0 : gs.length - 1]?.focus(); return; }
    }
    const tree = t.closest<HTMLElement>('#tree-list');
    if (tree && treeKeys(e, tree)) return;
    // Space on a focused table row ticks it for the bulk bar (the tick box is shown while the row has the focus)
    if (e.key === ' ' && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey && s.mode === 'table' && t.classList.contains('gr')) { e.preventDefault(); t.querySelector<HTMLInputElement>('.rc')?.click(); return; }
    // A span or a div with role="button" is not a native button: Enter and Space press it, as they would a <button>.
    if ((e.key === 'Enter' || e.key === ' ') && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey && t.matches('[role="button"][tabindex]:not(button):not(a)')) { e.preventDefault(); t.click(); return; }
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') { e.preventDefault(); openSearch(); return; }
    // Ctrl+Z / Ctrl+Shift+Z (Ctrl+Y) outside the text fields walk the bulk actions back and forth; in a field the field's own undo keeps working.
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !t.closest('input,textarea,select,[contenteditable="true"]')) {
      const k = e.key.toLowerCase();
      if (k === 'z' || (k === 'y' && !e.shiftKey)) { e.preventDefault(); undoByKey(ctx, k === 'y' || e.shiftKey ? 'forward' : 'back'); return; }
    }
    // ⇧⇧ opens the search, but only from two bare presses outside a text field: capitals typed in quick succession («Н. Ш.») are not a command.
    if (e.key === 'Shift') {
      if (e.repeat) return;
      const typing = !!t.closest('input,textarea,select,[contenteditable="true"]');
      const now = Date.now();
      if (!typing && now - lastShift < 400) { lastShift = 0; openSearch(); } else lastShift = typing ? 0 : now;
      return;
    }
    lastShift = 0;
    if (e.key === 'F5') { e.preventDefault(); runSelected(); return; }
    // The next row that waits for you, in the whole project: an error (F8), a row without text (Alt+Shift+↓/↑), and «proofread and on» (Ctrl+Shift+Enter).
    if (e.key === 'F8') { e.preventDefault(); jump('error', e.shiftKey ? -1 : 1); return; }
    if (e.altKey && e.shiftKey && !e.ctrlKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); jump('untranslated', e.key === 'ArrowDown' ? 1 : -1); return; }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && e.shiftKey) {
      e.preventDefault();
      const ur = s.cur ? ctx.unit(s.cur) : undefined;
      if (ur && s.current && approveOpenRow(ctx, ur)) jump('unreviewed', 1);
      return;
    }
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && s.mode !== 'table') { e.preventDefault(); step(ctx, e.key === 'ArrowDown' ? 1 : -1); return; }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && t.id === 'i-tr') { e.preventDefault(); send(ctx); return; }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && t.classList.contains('sv-in')) { e.preventDefault(); s.cur = t.dataset.key ?? s.cur; send(ctx); return; }
    if (s.mode === 'table' && t.classList.contains('gr')) {
      const list = visibleUnits(true);
      const i = list.findIndex(u => u.key === t.dataset.key);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const n = list[i + (e.key === 'ArrowDown' ? 1 : -1)]; if (n) { reveal('grid', n.key); selectRowLight(n.key); const r = document.querySelector<HTMLElement>(`.gr[data-key="${CSS.escape(n.key)}"]`); r?.focus(); r?.scrollIntoView({ block: 'nearest' }); } }
      else if (e.key === 'Enter') { e.preventDefault(); ctx.select(t.dataset.key!, 'edit'); }
      else if (e.key === 'F2') { e.preventDefault(); startInline(t.dataset.key!); }
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
  narrow.addEventListener('change', () => {
    // Until the translator has chosen, the panel follows the window: folded when narrow, open when wide.
    if (!s.phone && !s.sideTouched) s.sideOn = narrow.matches ? [] : ['panel'];
    renderAll();
  });

  // A write that is only started may not survive the page: the changed rows also go to the synchronous outbox first.
  // While the store keeps refusing (storage full), the browser is asked to confirm before the page closes.
  addEventListener('beforeunload', e => {
    autosave.rescueNow(); void autosave.flush();
    if (autosave.failures > 0 && autosave.unsaved) { e.preventDefault(); e.returnValue = ''; }
  });
  addEventListener('pagehide', () => { autosave.rescueNow(); void autosave.flush(); });
  setTimeout(() => void autoCheck(), 4000);
  // The Android app goes to the background without unloading the page: save what was typed.
  document.addEventListener('visibilitychange', () => { if (document.hidden) { autosave.rescueNow(); void autosave.flush(); } });
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
