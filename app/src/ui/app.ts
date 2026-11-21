import { branchOf, projectTitle, iconLetters, nameFromFolder, builtDrift, inboxOf, syncTheme, isAutoFilled, autoNote, planIngest, looksLikeAnotherGame, ingestQuiet, ingestNote, Autosave, LinkIndex, linkModeOf, pendingLinks, commitRows, threadsOf, GameNameIndex, buildUsage, sysNamesOf, activeIssues, autoLineLimit, displayLength, edit, emptyProject, labelsOf, flowText, isMessageUnit, lengthDeviation, note, pluginCandidates, readGame, snapshotOf, speakerOf, statsOf, submit, tooWide, viewsFromSnapshot, wrapMessage, wrapOf, hasAdvice, jumpTarget, qaOf, termsStamp, adoptSynced, applyPlan, planOf, reconcileChanges, pct, progressOf, rowState, sumProgress, QUEUE_LABEL, nextIn, positionOf, queueRows, ago, copyLine, stamp, stampOf } from '../core';
import type { InboxItem, IngestReport, QaOptions, QueueKind, WrapPlan } from '../core';
import { pxMeasure } from './measure';
import { openWrapTool } from './wrap-dialog';
import { openQaRules } from './qarules-dialog';
import { GroupIndex, KIND_LABEL, UndoStack, approveEntry, groupColor, groupRows, liveGroups, outboxRescue, takeOutbox } from '../core';
import type { Entry, FileView, GameFile, Group, RowChange, SavedProject, Unit } from '../core';
import { openBuild } from './build-dialog';
import { dataDirOf, forgetGameDir, isDesktop, rememberedGameDir, reopenGameDir, reopenGameDirDesktop, setProject } from './desktop';
import { classifyFolder, folderBanner, folderLine } from './folder-service';
import type { FolderState } from './folder-service';
import { $, CRUMB, el, esc, plural, toast } from './dom';
import { focusFirst, menuKeys, rememberOpener, restoreOpener, roveTree, setUnavailable, treeKeys } from './keynav';
import { FOCUS_HTML, SIDE_HTML, qaClick, focusClick, closeTyping, focusInput, insertText, renderFocus, renderSidePanel, afterSendFollowUp, send, sideClick, step } from './focus';
import { wireDiscuss } from './discuss';
import { realOf } from './hintcards';
import { approveOpenRow } from './rowpanel';
import { wireTermCard } from './termcard';
import { wireLinks } from './links';
import { wireRowsChip } from './links-panel';
import { SCENE_HTML, focusCard, hasScenes, renderSceneView, sceneClick, sceneFocus, sceneIdOf, sceneInput } from './scene-view';
import { SCENES_HTML, renderScenesPanel, sceneQuery, scenesClick, setSceneQuery, wireScenes } from './scenes-panel';
import { undoByKey, undoToast } from './undo-toast';
import { FILES_DRAG, GROUPS_HTML, dragFiles, groupsClick, placeMenuHtml, renderGroupsBlock, startNewGroup, wireGroups } from './groups-panel';
import type { PlaceTarget } from './groups-panel';
import { GLOSSARY_HTML, editTerm, glossaryClick, newTerm, renderGlossaryPanel, showTerm, wireGlossary } from './glossary-panel';
import { pickGameFolder, readFiles, reopenHandle } from './folder';
import type { DirHandle, PickedFile } from './folder';
import { IdbStore, LoadFailure, loadHandle, saveHandle } from './idb';
import { announceQa } from './qalive';
import { showRecovery } from './recovery';
import { openImport } from './import-dialog';

import { autoCheck, updateNow } from './updates';
import { openFindReplace } from './tools-dialogs';
import { openLinkTool } from './links-dialog';
import { openTermSyncTool } from './termsync-dialog';
import { openPluginTexts } from './plugins-dialog';
import { openActivity, openAutofill } from './activity-dialog';
import { askAnotherGame, openIngestReport } from './ingest-dialog';
import { markup } from './markup';
import { trackActivePane } from './activepane';
import { loadRowMemo, rowNumber, saveRowMemo } from './rowmemo';
import { openSettings } from './settings';
import { overlayScrollbars, refreshScrollbars } from './scrollbars';
import type { SettingsTab } from './settings';
import { openSpeakers } from './speakers-dialog';
import { initMobile } from './mobile';
import { holdInert } from './modal';
import { WINDOW_CONTROLS_HTML, initWindowControls } from './winctl';
import { GROUP, SEP, STATUS_LABEL, buildTm, noteChange, shownStatus, splitKey } from './state';
import type { Ctx, Filter, LeftTab, Mode, SortMode, State } from './state';
import { publishWidget } from './android';
import { artifactDb, describeClaude, loadClaudeConfig, runClaudeSync } from './claude';
import { describeGithub, githubConfigured, loadGithubConfig, runGithubSync } from './github';
import { describe as describeSync, loadSyncConfig, runSync, syncConfigured } from './sync';
import { initResize, initRightResize } from './resize';
import { mountRows, patchRow, reveal } from './chunks';
import { pagesClick, planRows, renderPager, takeWantTop, wirePages } from './pages';
import { buildAndRunGame, playInGame } from './play';
import { BRANCH_ICON, branchMenuClick, branchMenuHtml, chooseMerge } from './branches';
import type { BranchActions } from './branches';
import { openProjectSettings } from './project-settings';
import type { ProjectTab } from './project-settings';
import { openMergeScreen } from './merge-screen';
import { invalidateUsage, renderStrands, wireStrands } from './strands-panel';
import { wireMine } from './mine-panel';

const SVG = {
  files: '<svg viewBox="0 0 16 16"><path d="M2 4.5h4l1.2 1.5H14V12.5H2z"/></svg>',
  rows: '<svg viewBox="0 0 16 16"><path d="M3 4h10M3 8h10M3 12h10"/></svg>',
  both: '<svg viewBox="0 0 16 16"><rect x="2.5" y="2.5" width="11" height="11" rx="1.5"/><path d="M2.5 8h11"/></svg>',
  menu: '<svg viewBox="0 0 16 16"><path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11"/></svg>',
  search: '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/></svg>',
  searchBig: '<svg viewBox="0 0 16 16"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/></svg>',
  caret: '<svg class="caret" viewBox="0 0 10 10"><path d="M2 3.6L5 6.6l3-3"/></svg>',
  bell: '<svg viewBox="0 0 16 16"><path d="M4 11V7.5a4 4 0 0 1 8 0V11l1 1.5H3zM6.5 14h3"/></svg>',
  keys: '<svg viewBox="0 0 16 16"><rect x="1.5" y="3.5" width="13" height="9" rx="1.8"/><path d="M4.2 6.5h.01M6.7 6.5h.01M9.3 6.5h.01M11.8 6.5h.01M4.5 9.5h7"/></svg>',
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
/** The dot of a status filter: the same one the rows and the editor wear (see `.sd` in theme.css). */
export const FILTER_DOT: Partial<Record<Filter, string>> = { new: 'new', draft: 'draft', auto: 'draft auto', done: 'done', appr: 'appr', qa: 'qa' };
const LEN_LABEL = { far: 'далеко від оригіналу', longer: 'довші за оригінал', shorter: 'коротші за оригінал' } as const;
const FORMAT_LABEL: Record<string, string> = { json: 'RPG Maker MV · UTF-8', po: 'gettext · UTF-8', pot: 'gettext · UTF-8', csv: 'CSV · UTF-8', tsv: 'TSV · UTF-8', rpy: 'Ren’Py · UTF-8' };

const SHELL = `<div class="scroll-x"><div class="ide mode-table lp-open" id="ide">
  <header class="topbar">
    <div class="tb-l">
      <div class="logo" aria-hidden="true">T</div>
      <button class="tb-ic" id="hamb" title="Головне меню" aria-haspopup="menu" aria-expanded="false">${SVG.menu}</button>
      <nav class="menubar" id="menubar" role="menubar" aria-label="Головне меню" hidden></nav>
      <button class="tpill" id="proj-btn" aria-haspopup="menu" aria-expanded="false" title="Проєкт: відкрити іншу гру, налаштування"><span class="pj" id="proj-av" aria-hidden="true">T</span><span id="proj-name">Проєкт</span><span class="dd" aria-hidden="true">${SVG.caret}</span></button>
      <button class="tpill br-btn" id="br-btn" aria-haspopup="menu" aria-expanded="false" title="Гілка перекладу: перемкнути, створити, злити"><span class="br-ic" aria-hidden="true">${BRANCH_ICON}</span><span id="br-name">main</span><span class="dd" aria-hidden="true">${SVG.caret}</span></button>
      <div class="seg" id="seg" role="group" aria-label="Режим">
        <button aria-pressed="true" data-m="table" class="on" title="Таблиця: усі рядки файлу" aria-label="Таблиця"><svg viewBox="0 0 16 16"><path d="M2.5 3.5h11v9h-11zM2.5 7h11M6.5 3.5v9"/></svg></button>
        <button aria-pressed="false" data-m="edit" title="Редагування: один рядок" aria-label="Редагування"><svg viewBox="0 0 16 16"><path d="M2.5 3.5h11v9h-11zM6 3.5v9M6 8h7.5"/></svg></button>
        <button aria-pressed="false" data-m="scene" id="m-scene" title="Сцена: репліки подій поспіль" aria-label="Сцена"><svg viewBox="0 0 16 16"><rect x="2.5" y="3" width="11" height="6" rx="1.5"/><rect x="2.5" y="11" width="7" height="2.5" rx="1"/></svg></button>
      </div>
    </div>
    <div class="prog" id="pg" title="" role="progressbar" aria-label="Прогрес перекладу" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div class="bar"><i class="a" id="pg-a"></i><i class="b" id="pg-b"></i><i class="c" id="pg-c"></i></div><span id="pg-txt" style="font-family:var(--mono);font-size:11.5px"></span></div>
    <div class="tb-r">
      <button class="tpill run" id="cfg-btn" aria-haspopup="menu" aria-expanded="false" title="Що запускає кнопка ▶">${SVG.build}<span id="cfg-name">Збірка (файл)</span><span class="dd" aria-hidden="true">${SVG.caret}</span></button>
      <button class="tb-ic play" id="run-btn" title="Запустити (F5)" aria-label="Запустити">${SVG.play}</button>
      <div class="tsep"></div>
      <button class="tb-ic bellb" id="bell" title="Сповіщення: що потребує уваги й що змінили інші" aria-label="Сповіщення" aria-haspopup="menu" aria-expanded="false">${SVG.bell}<b id="bell-n" hidden>0</b></button>
      <button class="tb-ic" id="hk" title="Гарячі клавіші" aria-label="Гарячі клавіші">${SVG.keys}</button>
    </div>
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
      <button data-lp="glossary" title="Пов’язане: слова, конструкції, однакові рядки" aria-label="Пов’язане">${SVG.book}</button>
    </nav>
    <aside class="tree" id="lpanel" aria-label="Бічна панель: файли й рядки">
      <div class="mtabs" id="mtabs" role="group" aria-label="Бічна панель"><button data-lt="files">Файли</button><button data-lt="rows">Рядки</button><button data-lt="scenes">Сцени</button><button data-lt="glossary">Пов’язане</button><button class="ab-ic" id="mt-open" aria-label="Відкрити файли або вставити JSON" title="Відкрити файли або вставити JSON">${SVG.import}</button><button class="ab-ic" id="mt-search" aria-label="Пошук скрізь">${SVG.searchBig}</button></div>
      <div class="ph"><span class="grow" id="lp-title">Файли гри</span><button class="ico ico-btn" id="lp-search" type="button" aria-label="Знайти скрізь (Ctrl+K)" title="Знайти скрізь (Ctrl+K або двічі Shift)">${SVG.search}</button><span class="ico" id="lp-close" title="Сховати панель" role="button" aria-label="Сховати панель">—</span></div>
      <div class="treebody" id="tree"><div class="ph card-ph" data-card="files"><span class="grow"><span class="ttl">Файли гри</span></span><label class="fin hq" id="hq-f">${SVG.search}<input class="qin" id="fq" placeholder="Пошук у файлах гри" aria-label="Пошук у файлах гри" autocomplete="off" spellcheck="false"><span class="kbd" aria-hidden="true">Ctrl+F</span><button class="hqx" type="button" id="fq-x" aria-label="Очистити пошук">✕</button></label><button class="ico ico-btn rs-t" id="fs-menu" type="button" aria-haspopup="true" aria-expanded="false" aria-label="Меню вікна «Файли гри»: пошук" title="Пошук (Ctrl+F)">⋮</button><span class="ico" data-hide-left="files" role="button" tabindex="0" aria-label="Сховати панель «Файли гри»" title="Сховати">—</span></div>${GROUPS_HTML}<div id="tree-list" role="tree" aria-label="Файли гри"></div></div>
      <div class="rz rz-y" id="rz-y" role="separator" aria-orientation="horizontal" aria-label="Розділ між файлами й рядками" aria-valuemin="15" aria-valuemax="85" tabindex="0" title="Потягніть, щоб змінити співвідношення (подвійний клік — навпіл)" hidden></div>
      <div class="slist" id="lp-rows" hidden>
        <div class="ph card-ph" data-card="rows"><span class="grow"><span class="ttl">Рядки</span> <span class="lt-f" data-fname></span></span><label class="fin hq" id="hq">${SVG.search}<input class="qin" id="q2" placeholder="Пошук рядків" aria-label="Пошук рядків" autocomplete="off" spellcheck="false"><span class="kbd" aria-hidden="true">Ctrl+F</span><button class="hqx" type="button" id="q2-x" aria-label="Очистити пошук">✕</button></label><button class="ico ico-btn rs-t" id="rs-menu" type="button" aria-haspopup="true" aria-expanded="false" aria-label="Меню вікна «Рядки»: вигляд, фільтри, пошук" title="Вигляд, фільтри, пошук (Ctrl+F)">⋮</button><span class="ico" data-hide-left="rows" role="button" tabindex="0" aria-label="Сховати панель «Рядки файлу»" title="Сховати">—</span></div>
        <div class="fh"><div class="chips2"><button class="chip hm" id="sortbtn" aria-haspopup="menu">↕ За порядком</button><span class="chipsHost" id="chips2"></span></div></div>
        <div class="sl-body" id="slist"></div>
        <div class="pgb" id="pgb" hidden></div>
      </div>
      ${SCENES_HTML}
      ${GLOSSARY_HTML}
    </aside>
    <div class="rz rz-x" id="rz-x" role="separator" aria-orientation="vertical" aria-label="Ширина бічної панелі" aria-valuemin="200" aria-valuemax="640" tabindex="0" title="Потягніть, щоб змінити ширину (подвійний клік — стандартна)"></div>
    <main class="editor" id="main">
      <div class="tabs"><span class="tabs-host" id="tabs-host"></span></div>
      <div class="view" id="v-table">
        <div class="filters"><div class="fin">${SVG.search}<input class="qin" id="q" placeholder="Фільтр у цьому файлі" aria-label="Фільтр"></div><span class="chipsHost" id="chips1"></span>
          <div class="r"><button class="chip" id="spkbtn">Мовець${SVG.caret}</button><button class="chip" id="lenbtn">Довжина${SVG.caret}</button></div></div>
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
    <span id="sb-upd" class="sbtn" role="button" tabindex="0" hidden title="Нову версію завантажено й перевірено. Натисніть, щоб оновитися зараз: застосунок закриється, оновиться без вікон і сам запуститься знову">↻ Оновлення готове</span><span id="sb-sync" class="sbtn" role="button" tabindex="0" title="Налаштування синхронізації"></span><span id="sb-build" class="sbtn" role="button" tabindex="0" title="Зібрати (F5)"></span>
    <div class="r"><span id="sb-file"></span><span id="sb-sess"></span></div>
  </footer>
</div></div>
<div class="scrim" id="scrim"></div>
<div class="pop cfgpop projpop" id="projpop" role="menu" aria-label="Проєкт" hidden></div>
<div class="pop cfgpop projpop" id="brpop" role="menu" aria-label="Гілки перекладу" hidden></div>
<div class="pop cfgpop" id="cfgpop" role="menu" aria-label="Що запускати" hidden></div>
<div class="pop cfgpop inboxpop" id="inboxpop" role="menu" aria-label="Сповіщення" hidden></div>
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
<div class="sd-wrap" id="sd" hidden><div class="sd-box" role="dialog" aria-modal="true" aria-label="Пошук скрізь"><div class="sd-tabs" id="sd-tabs" role="tablist" aria-label="Розділи результатів"><button type="button" role="tab" data-sdk="" aria-selected="true" tabindex="-1">Усе</button><button type="button" role="tab" data-sdk="Файли" aria-selected="false" tabindex="-1">Файли</button><button type="button" role="tab" data-sdk="Рядки" aria-selected="false" tabindex="-1">Рядки</button><button type="button" role="tab" data-sdk="Терміни" aria-selected="false" tabindex="-1">Терміни</button></div><input id="sd-in" placeholder="Рядки, файли, терміни…" aria-label="Пошук скрізь" autocomplete="off" role="combobox" aria-autocomplete="list" aria-controls="sd-res" aria-expanded="true" aria-activedescendant=""><div id="sd-res" role="listbox" aria-label="Результати"></div><div class="sd-foot"><span><kbd>↑↓</kbd> вибрати</span><span><kbd>Enter</kbd> відкрити</span><span><kbd>Tab</kbd> розділ</span><span><kbd>Esc</kbd> закрити</span><span class="sd-n" id="sd-n" role="status"></span></div></div></div>
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
    views: [], game: [], saved, current: null, open: [], rowAt: {}, rowAtFor: '', group: null, groupSel: null, picked: new Set(), cur: null, scene: null, mode: mq.matches ? 'edit' : 'table', filters: [], q: '', speaker: null, lenFilter: 'all', sort: 'order', compact: ls('transly.compact') === '1', kb: false,
    checked: new Set(), sideTab: 'panel', sideOn: ['panel'], saveOk: true, savedAt: null, who: saved.settings.who, phone: mq.matches,
    leftTab: { table: 'files', edit: 'rows', scene: 'scenes' }, leftOpen: !mq.matches, leftBoth: false, rightOpen: false, collapsed: new Set(), sess: { n: 0, t0: Date.now(), seen: new Set() }, lastBuild: null,
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
  const qaLive = el('div', 'vh'); qaLive.id = 'qa-live'; qaLive.setAttribute('role', 'status'); qaLive.setAttribute('aria-live', 'polite'); root.appendChild(qaLive);
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
    invalidateTm: () => { tmCache = null; tmStale = false; invalidateUsage(); },
    softTm: () => { tmStale = true; },
    refreshTop: () => { window.clearTimeout(topTimer); topTimer = window.setTimeout(() => { renderTop(); renderStatus(); }, 500); },
    links: () => { if (!linkCache || linkCache.views !== s.views) linkCache = { views: s.views, idx: new LinkIndex(s.views) }; return linkCache.idx; },
    persist: () => { inboxDirty = true; autosave.queue(s.saved); },
    stage: () => 'translate',
    history: new UndoStack(),
    fileTitle: name => fileTitle(name),
    commit: (changes, kind, what) => { const id = commitRows(file => ctx.entries(file), changes, kind, s.who, Date.now(), what); for (const c of changes) noteChange(s, c.file, c.key); ctx.history.record(id); return id; },
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
  /** The short name of the open file (`Town`, not `Town · Map001`), for the chip of the windows below the files and for the status bar. */
  const shortLabel = (): string => (s.current === GROUP ? groupTitle() : ctx.view()?.label || currentLabel());
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
  /** A table cell shows the beginning of a very long text (the whole of it is in the editor): laying out a hundred thousand letters in a narrow cell takes the browser half a minute. */
  const CELL_MAX = 2000;
  const cellText = (t: string): string => (t.length > CELL_MAX ? `${t.slice(0, CELL_MAX)}… (ще ${(t.length - CELL_MAX).toLocaleString('uk-UA')} символів)` : t);
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
  /** A row passes when no status is chosen or it matches any of the chosen ones. */
  const passesStatus = (u: Unit, e: Entry | undefined, opts?: QaOptions): boolean => !s.filters.length || s.filters.some(f => matchesStatus(u, e, f, opts));
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
  /** The rows that pass the filters. `sorted` false is the table's order: the sort chosen for the list (Редагування, the left panel) is not applied to it, so the table is not reordered behind the reader's back. */
  function visibleUnits(withStatus: boolean, sorted = true): Unit[] {
    const v = ctx.view();
    if (!v) return [];
    const ents = ctx.entries(v.name);
    const opts = withStatus && s.filters.includes('adv') ? qaOpts() : undefined;
    const list = v.units.filter(u => inContext(u, ents[u.key]) && (!withStatus || passesStatus(u, ents[u.key], opts)));
    if (s.sort === 'order' || !sorted) return list;
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
    try { localStorage.setItem(UI_KEY, JSON.stringify({ current: s.current, cur: s.cur, filters: s.filters, q: s.q, speaker: s.speaker, sort: s.sort, mode: s.mode, scroll: document.getElementById('slist')?.scrollTop ?? 0 })); } catch { /* private mode */ }
  }
  function restoreUi(): void {
    // Before the game's files are read there is nothing to go back to; try again once they are.
    if (uiRestored || !s.views.length) return;
    let u: { current?: string; cur?: string | null; filter?: Filter; filters?: unknown; q?: string; speaker?: string | null; sort?: SortMode; mode?: Mode; scroll?: number } = {};
    try { u = JSON.parse(ls(UI_KEY) ?? '{}') as typeof u; } catch { /* damaged: start fresh */ }
    uiRestored = true;
    if (!u.current || !s.views.some(v => v.name === u.current)) return;
    if (s.current !== u.current) openFile(u.current);
    const known = (f: unknown): f is Filter => typeof f === 'string' && f !== 'all' && FILTERS.some(x => x[0] === f);
    if (Array.isArray(u.filters)) s.filters = u.filters.filter(known) as Filter[];
    else if (known(u.filter)) s.filters = [u.filter];
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
  /** The windows of the left rail a mode has: the table is the rows already, and the scene mode shows its own lines instead of the list of rows. */
  const leftTabsOf = (mode: Mode): LeftTab[] => (s.phone ? ['files', 'rows', 'scenes', 'glossary'] : mode === 'table' ? ['files', 'glossary'] : mode === 'scene' ? ['files', 'scenes', 'glossary'] : ['files', 'rows', 'scenes', 'glossary']);
  /** What was chosen in another mode may not exist in this one: it falls back to the files (the scenes in the scene mode). */
  function fitLeftTab(): void {
    if (s.phone) return;
    if (!leftTabsOf(s.mode).includes(s.leftTab[s.mode])) s.leftTab[s.mode] = s.mode === 'scene' ? 'scenes' : 'files';
    if (s.mode === 'table') s.leftBoth = false;
    else if (s.mode === 'scene' && s.leftBoth && s.leftTab[s.mode] === 'files') s.leftTab[s.mode] = 'scenes';
  }
  /** The buttons of the rail are the windows of this mode; a hairline stands only between two buttons that are shown. */
  function showRail(): void {
    const has = leftTabsOf(s.mode);
    let sep: HTMLElement | null = null, seen = false;
    for (const el of [...$('#strip').children] as HTMLElement[]) {
      if (el.tagName === 'HR') { el.hidden = true; sep = el; continue; }
      const on = has.includes(el.dataset.lp as LeftTab);
      el.hidden = !on;
      if (on) { if (seen && sep) sep.hidden = false; seen = true; sep = null; }
    }
    document.querySelectorAll<HTMLElement>('#mtabs [data-lt]').forEach(b => { b.hidden = !has.includes(b.dataset.lt as LeftTab); });
  }

  function renderLayout(): void {
    const ide = $('#ide');
    fitLeftTab();
    showRail();
    const l = lp();
    const over = narrow.matches && !s.phone && s.sideOn.length > 0;
    ide.className = `ide mode-${s.mode === 'table' ? 'table' : 'focus'}${s.mode === 'scene' ? ' scene-mode' : ''} ${l ? 'lp-open' : 'lp-closed'}${s.phone ? ' sz-s' : ''}${s.rightOpen ? ' sheet-open' : ''}${(!s.sideOn.length || over) && !s.phone ? ' rp-collapsed' : ''}${over ? ' rp-over' : ''}${s.compact ? ' compact' : ''}${s.kb ? ' kb' : ''}`;
    const both = (l === 'files' || l === 'rows' || l === 'scenes') && s.leftBoth && !s.phone;
    /** With both windows on, the files are above and this one is below: the rows (the default) or the scenes. */
    const second = both ? (l === 'scenes' ? 'scenes' : 'rows') : null;
    $('#lpanel').classList.toggle('split', both);
    $('#rz-y').hidden = !both;
    document.querySelectorAll<HTMLElement>('#strip button').forEach(b => { const on = both ? b.dataset.lp === 'files' || b.dataset.lp === second : b.dataset.lp === l; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
    $('#tree').hidden = !both && l !== 'files';
    $('#lp-rows').hidden = both ? second !== 'rows' : l !== 'rows';
    $('#lp-gl').hidden = l !== 'glossary';
    $('#lp-sc').hidden = l !== 'scenes';
    renderFileChips();
    placeRowsTools(both, l);
    syncRowsSearch();
    $('#lp-title').innerHTML = both ? (second === 'scenes' ? 'Файли й сцени' : 'Файли й рядки') : l === 'rows' ? `Рядки <span class="lt-f">${esc(currentLabel())}</span>` : l === 'glossary' ? 'Пов’язане' : l === 'scenes' ? `Сцени <span class="lt-f">${esc(currentLabel())}</span>` : 'Файли гри';
    document.querySelectorAll<HTMLElement>('#mtabs [data-lt]').forEach(b => { const on = b.dataset.lt === s.leftTab[s.mode]; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
    document.querySelectorAll<HTMLElement>('#seg [data-m]').forEach(b => { const on = b.dataset.m === s.mode; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
    const here = s.rightOpen ? 'help' : s.leftOpen ? s.leftTab[s.mode] : s.mode === 'table' ? 'rows' : 'edit';
    document.querySelectorAll<HTMLElement>('#bnav [data-bn]').forEach(b => { const on = b.dataset.bn === here; b.classList.toggle('on', on); b.setAttribute('aria-current', String(on)); });
  }

  /** The windows below the files say which file they show (the file → rows / scenes order), and ask for a file while none is open. */
  function renderFileChips(): void {
    const v = ctx.view();
    const html = v ? (s.current === GROUP ? esc(currentLabel()) : `<span class="ic ${fileIcon(s.current!)[0]}">${fileIcon(s.current!)[1]}</span>${esc(shortLabel())}`) : 'файл не вибрано';
    document.querySelectorAll<HTMLElement>('[data-fchip]').forEach(c => { c.innerHTML = html; c.classList.toggle('none', !v); });
    document.querySelectorAll<HTMLElement>('[data-fname]').forEach(c => { c.textContent = v ? currentLabel() : 'файл не вибрано'; c.classList.toggle('none', !v); });
    document.querySelectorAll<HTMLElement>('#lp-rows .fh, #lp-sc .fh').forEach(f => { f.hidden = !v; });
    if (!v) {
      const ask = (what: string): string => `<div class="emptybox"><b>Спершу оберіть файл угорі</b>Тут з’являться ${what} вибраного файлу.</div>`;
      $('#slist').innerHTML = ask('рядки');
      $('#sc-list').innerHTML = ask('сцени');
    }
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
    // everything about the groups (all the files together, a new group, the picked files) is in the menu ⋮ of the window; the dot says that files are picked
    $('#fs-menu').classList.toggle('dot', s.picked.size > 0);
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
    box.innerHTML = (s.leftBoth && !s.phone && !coachSeen() ? `<div class="coach" role="note"><span>${ctx.view() ? '<b>Порядок:</b> файл › рядок › переклад' : '<b>Оберіть файл.</b> Потім — рядок у вікні нижче.'}</span><button class="btn" type="button" data-coach-ok>Зрозуміло</button></div>` : '') + nodes.map(n => {
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
      return `<div class="node ${cur ? 'cur' : ''} ${s.picked.has(n.name) ? 'pick' : ''} ${!st.translated ? 'idle' : ''}" style="--d:${n.d}" data-file="${esc(n.name)}" draggable="true" role="treeitem" tabindex="-1" aria-level="${n.d + 1}" aria-selected="${cur}" title="${cur ? 'Відкрито · ' : ''}${v.label ? esc(v.label) + ' · ' : ''}Перекладено ${pc}% · вичитано ${pcA}%"><span class="chev"></span><span class="ic ${ic}">${lab}</span><span class="nm">${fileGroupDot(n.name)}${v.label ? `${esc(v.label)}<span class="lc">${esc(n.label.replace(/\.json$/, ''))}</span>` : esc(n.label)}</span>${rowMemo()[n.name] && leftAt(n.name, v.units) ? `<span class="mem" title="Ви зупинилися на рядку ${leftAt(n.name, v.units)}">↩ ${leftAt(n.name, v.units)}</span>` : ''}<span class="mini"><i class="${full ? 'f' : ''}" style="width:${pc}%"></i></span><span class="pc ${full ? 'full' : ''}">${pc}%</span></div>`;
    }).join('');
    // Picked files that stand one after another share one outline: only the first has its top corners rounded, only the last its bottom ones.
    box.querySelectorAll<HTMLElement>('.node.pick').forEach(n => { n.classList.toggle('pk-top', !n.previousElementSibling?.classList.contains('pick')); n.classList.toggle('pk-bot', !n.nextElementSibling?.classList.contains('pick')); });
    // One tab stop for the whole tree; the node that had the focus keeps it after the redraw.
    const mine = hadId ? [...box.querySelectorAll<HTMLElement>('.node')].find(n => hadId.file ? n.dataset.file === hadId.file : n.dataset.dir === hadId.dir) : undefined;
    roveTree(box, mine);
    if (mine) mine.focus({ preventScroll: true });
  }

  /** The statuses to choose from, in the popover «Ще ▾»: what a row is, and what else it can have. */
  const STATUS_FILTERS = FILTERS.filter(f => ['new', 'draft', 'auto', 'done', 'appr'].includes(f[0]));
  const EXTRA_FILTERS = FILTERS.filter(f => ['qa', 'adv', 'cm'].includes(f[0]));
  const filterDot = (f: Filter): string => (FILTER_DOT[f] ? `<i class="sd ${FILTER_DOT[f]}" aria-hidden="true"></i>` : '');
  /** How many rows of the open file (inside the search and the other filters) each status has. */
  function filterCounts(): Map<Filter, number> {
    const out = new Map<Filter, number>();
    const v = ctx.view();
    if (!v) return out;
    const ents = ctx.entries(v.name), opts = qaOpts();
    const units = v.units.filter(u => inContext(u, ents[u.key]));
    for (const [f] of FILTERS) out.set(f, f === 'all' ? units.length : units.filter(u => matchesStatus(u, ents[u.key], f, opts)).length);
    return out;
  }
  /**
   * The statuses that are chosen show as chips (a click drops one); the rest is in «Ще ▾», so no row of chips takes the room of the rows
   * and nothing moves when a filter is switched on. `host` tells the two places apart (the table's bar and the rows window).
   */
  function chipsHtml(host: string, lead = ''): string {
    if (!ctx.view()) return '';
    const n = filterCounts();
    const chips = s.filters.map(f => { const l = FILTERS.find(x => x[0] === f)?.[1] ?? f; return `<button class="chip on" data-filter="${f}" aria-pressed="true" title="Прибрати фільтр «${l}»">${filterDot(f)}${l} <span class="n">${(n.get(f) ?? 0).toLocaleString('uk-UA')}</span><span class="x" aria-hidden="true">✕</span></button>`; }).join('');
    // «Ще ▾» comes first, where the eye looks for it; the chosen ones (the speaker, the statuses) follow it
    return `<button class="chip more${host === '2' ? ' hm' : ''}${s.filters.length ? ' on' : ''}" id="more-${host}" data-more aria-haspopup="true" aria-expanded="false">Ще${SVG.caret}</button>${lead}${chips}${s.filters.length ? '<button class="chip" data-reset title="Скинути всі фільтри">Скинути</button>' : ''}`;
  }
  /** The popover «Ще ▾»: a box for each status with how many rows have it; the boxes can be mixed. */
  function moreHtml(): string {
    const n = filterCounts();
    const row = ([f, l]: [Filter, string]): string => { const on = s.filters.includes(f), idle = !on && !(n.get(f) ?? 0); return `<button class="fi${on ? ' on' : ''}${idle ? ' idle' : ''}" data-filter="${f}" role="menuitemcheckbox" aria-checked="${on}"${idle ? ' disabled' : ''}><span class="cb" aria-hidden="true">${on ? '✓' : ''}</span>${filterDot(f)}<span class="fl">${l}</span><span class="n">${(n.get(f) ?? 0).toLocaleString('uk-UA')}</span></button>`; };
    return `<div class="group">Статус</div>${STATUS_FILTERS.map(row).join('')}<hr><div class="group">Додатково</div>${EXTRA_FILTERS.map(row).join('')}${s.filters.length ? '<hr><button data-reset>Скинути всі фільтри</button>' : ''}`;
  }

  /** The speaker and length buttons show the chosen value themselves, with a cross to drop it. */
  function renderFilterButtons(): void {
    const set = (id: string, on: boolean, label: string, clear: string): void => {
      const b = $(id);
      b.setAttribute('aria-haspopup', 'true'); if (!b.hasAttribute('aria-expanded')) b.setAttribute('aria-expanded', 'false');
      b.classList.toggle('on', on);
      b.innerHTML = `${esc(label)}${SVG.caret}${on ? `<span class="x" data-clear="${clear}" title="Скинути" role="button" tabindex="0" aria-label="Скинути фільтр">✕</span>` : ''}`;
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
      <div class="st" role="gridcell"><span class="sd ${st}${autoDraft(st, e) ? ' auto' : ''}" aria-hidden="true" title="${STATUS_LABEL[st]}${autoDraft(st, e) ? ' (заповнено застосунком, ще не переглянуто)' : ''}"${st === 'qa' ? ` data-hc="qa" data-hk="${esc(u.key)}"` : ''}></span><span class="vh">${STATUS_LABEL[st]}${autoDraft(st, e) ? ', авто' : ''}</span>${adv ? '<span class="adv" title="Є порада QA: відкрийте рядок, щоб побачити" data-hc="qa" data-hk="' + esc(u.key) + '"></span><span class="vh">Є порада</span>' : ''}</div>
      <div role="gridcell"><span class="key" title="${esc(u.key.split(SEP).join(' › '))}">${esc(shortKey(u.key))}</span>${cmIcon(e)}</div>
      <div class="who" role="gridcell">${esc(ctx.speaker(u))}</div>
      <div class="src" role="gridcell" lang="en">${markup(cellText(flow(u.source)), hits)}<span class="skey" aria-hidden="true">${esc(shortKey(u.key))}</span></div>
      <div class="tr ${e?.target ? '' : 'empty'}" role="gridcell" title="Клікніть, щоб писати прямо тут">${e?.target ? markup(cellText(flow(e.target))) : '—'}</div>
      <div class="len ${lenCls(u, e)}" role="gridcell" title="Символів у перекладі / в оригіналі">${len}</div></div>`;
  }
  let enforcedCache: { stamp: string; en: string[] } | null = null;
  function enforced(): string[] {
    // The stamp changes with the list's identity, its length and every `touchTerms` (a renamed term keeps the length).
    const stamp = termsStamp(s.saved.terms);
    if (!enforcedCache || enforcedCache.stamp !== stamp) enforcedCache = { stamp, en: s.saved.terms.filter(t => t.qa !== false).map(t => t.en) };
    return enforcedCache.en;
  }

  /** `page` is the number of the page this row begins (the continuous list marks it), or 0. */
  const siHtml = (u: Unit, n: number, page = 0): string => {
    const e = entryOf(u), st = shownStatus(ctx, u, e);
    return `<div class="si ${u.key === s.cur ? 'sel' : ''}${page ? ' pg-first' : ''}"${page ? ` data-page="${page}"` : ''} data-key="${esc(u.key)}" role="button" tabindex="0"><span class="sd ${st}${autoDraft(st, e) ? ' auto' : ''}" title="${STATUS_LABEL[st]}${autoDraft(st, e) ? ' (заповнено застосунком, ще не переглянуто)' : ''}"></span><div><div class="a"><span>${n}</span><b>${esc(ctx.speaker(u) || KIND_LABEL[u.kind])}</b><span>${esc(shortKey(u.key))}</span>${cmIcon(e)}</div><div class="s" lang="en">${esc(flow(u.source))}</div><div class="t">${e?.target ? esc(flow(e.target)) : '—'}</div></div></div>`;
  };
  const emptyHtml = '<div class="empty-state"><b>Нічого не знайдено</b><span>Немає рядків за поточним пошуком і статусом.</span><button class="btn" data-reset>Скинути фільтри</button></div>';

  const SORT_LABEL: Record<SortMode, string> = { order: 'За порядком', new: 'Без перекладу спершу', qa: 'Помилки спершу', long: 'Найдовші спершу' };
  /** The search of a window of the left panel (the files, the rows, the scenes) is a field in its header: it opens with Ctrl+F or the menu ⋮ and stays open while there is something typed. */
  let rowsSearchOpen = false;
  const winSearchOpen = { files: false, scenes: false };
  type SearchWin = 'files' | 'rows' | 'scenes';
  const SEARCH_WINS: readonly SearchWin[] = ['files', 'rows', 'scenes'];
  const WIN_TOOLS: Record<SearchWin, readonly string[]> = { files: ['hq-f', 'fs-menu'], rows: ['hq', 'rs-menu'], scenes: ['hq-s', 'sc-menu'] };
  const winQuery = (w: SearchWin): string => w === 'files' ? fileQ : w === 'rows' ? s.q : sceneQuery();
  const winOpen = (w: SearchWin): boolean => (w === 'rows' ? rowsSearchOpen : winSearchOpen[w]) || winQuery(w) !== '';
  const winInput = (w: SearchWin): HTMLInputElement => $(w === 'files' ? '#fq' : w === 'rows' ? '#q2' : '#sc-q') as HTMLInputElement;
  function syncRowsSearch(): void {
    const both = $('#lpanel').classList.contains('split'), cur = lp(), single = document.querySelector<HTMLElement>('#lpanel > .ph');
    for (const w of SEARCH_WINS) {
      const inSingle = !both && cur === w;
      document.querySelector<HTMLElement>(`[data-card="${w}"]`)?.classList.toggle('searching', !inSingle && winOpen(w));
      if (inSingle) single?.classList.toggle('searching', winOpen(w));
    }
    if (both || !cur || !SEARCH_WINS.includes(cur as SearchWin)) single?.classList.remove('searching');
    for (const w of SEARCH_WINS) { const i = winInput(w); if (i.value !== winQuery(w)) i.value = winQuery(w); }
    const shown: Record<SearchWin, boolean> = { files: s.views.length > 0, rows: !!ctx.view(), scenes: !!ctx.view() };
    for (const w of SEARCH_WINS) for (const id of WIN_TOOLS[w]) { const x = document.getElementById(id); if (x) x.hidden = !shown[w]; }
  }
  /** The menu ⋮ and the search field of each window stand in its header: in its own card when two windows are shown, in the header of the panel when only that one is. */
  function placeRowsTools(both: boolean, l: string | null): void {
    const single = document.querySelector<HTMLElement>('#lpanel > .ph');
    if (!single) return;
    for (const w of SEARCH_WINS) {
      const card = document.querySelector<HTMLElement>(`[data-card="${w}"]`);
      if (!card) continue;
      const host = !both && l === w ? single : card;
      const before = host === single ? $('#lp-search') : card.querySelector<HTMLElement>('[data-hide-left]');
      for (const id of WIN_TOOLS[w]) { const t = document.getElementById(id); if (t && t.parentElement !== host) host.insertBefore(t, before); }
      card.classList.toggle('rs-head', host === card);
    }
    single.classList.toggle('rs-head', !both && SEARCH_WINS.includes(l as SearchWin));
  }
  function openRowsSearch(): void {
    if (!ctx.view()) return;
    if (!s.leftOpen || (lp() !== 'rows' && !s.leftBoth)) { s.leftOpen = true; s.leftTab[s.mode] = 'rows'; renderAll(); }
    rowsSearchOpen = true; syncRowsSearch();
    const box = $('#q2') as HTMLInputElement;
    box.focus(); box.select();
  }
  function closeRowsSearch(): void {
    rowsSearchOpen = false;
    if (s.q !== '') { s.q = ''; renderAll(); } else syncRowsSearch();
  }
  /** Opens the search field of the files or of the scenes (the rows have their own, above) and puts the cursor in it. */
  function openWinSearch(w: 'files' | 'scenes'): void {
    if (w === 'files' ? !s.views.length : !ctx.view()) return;
    const shown = s.leftOpen && (w === 'files' ? lp() === 'files' || s.leftBoth : lp() === 'scenes');
    if (!shown) { s.leftOpen = true; s.leftTab[s.mode] = w; renderAll(); }
    winSearchOpen[w] = true; syncRowsSearch();
    const box = winInput(w);
    box.focus(); box.select();
  }
  function closeWinSearch(w: 'files' | 'scenes'): void {
    winSearchOpen[w] = false;
    if (w === 'files') { fileQ = ''; renderTree(); } else setSceneQuery(ctx, '');
    syncRowsSearch();
  }
  const winMenuHtml = (w: 'files' | 'scenes'): string => {
    const find = `<button data-wm="${w}:find" role="menuitem">⌕ ${w === 'files' ? 'Пошук у файлах' : 'Пошук сцени'}<span class="sk">Ctrl+F</span></button>${winQuery(w) !== '' ? `<button data-wm="${w}:reset" role="menuitem">Скинути пошук</button>` : ''}`;
    const hide = `<hr><button data-wm="${w}:hide" role="menuitem">Сховати панель</button>`;
    if (w !== 'files') return find + hide;
    return `${find}<hr><button data-sub="files-groups" role="menuitem" aria-haspopup="menu" aria-expanded="false" title="Усі файли разом, нова група, вибрані файли">Групи<span class="sk">▸</span></button>${hide}`;
  };
  const sortMenuHtml = (): string => `<div class="group">Порядок</div>${(Object.keys(SORT_LABEL) as SortMode[]).map(k => `<button data-sort="${k}" role="menuitemradio" aria-checked="${s.sort === k}" ${s.sort === k ? 'class="on"' : ''}>${SORT_LABEL[k]}</button>`).join('')}`;
  const rowsMenuHtml = (): string => {
    const active = s.filters.length > 0 || s.speaker !== null || s.sort !== 'order' || s.q !== '';
    return `<button data-sub="rows-sort" role="menuitem" aria-haspopup="menu" aria-expanded="false">↕ Вигляд<span class="sk">▸</span></button><button data-sub="rows-more" role="menuitem" aria-haspopup="menu" aria-expanded="false">Фільтри${s.filters.length ? ` · ${s.filters.length}` : ''}<span class="sk">▸</span></button><hr><button data-rm="find" role="menuitem">⌕ Пошук у файлі<span class="sk">Ctrl+F</span></button>${active ? '<button data-rm="reset" role="menuitem">Скинути пошук і фільтри</button>' : ''}<hr><button data-rm="hide" role="menuitem">Сховати панель</button>`;
  };
  function renderRowsList(): void {
    $('#chips2').innerHTML = chipsHtml('2', (s.sort !== 'order' ? `<button class="chip on" data-sort="order" title="Повернути порядок за номером">↕ ${esc(SORT_LABEL[s.sort])} ✕</button>` : '') + (s.speaker !== null ? `<button class="chip on" data-clear="speaker" title="Скинути фільтр за мовцем">${esc(s.speaker || 'Без мовця')} ✕</button>` : ''));
    // the strip of what is switched on stands under the header only while something is; the menu ⋮ carries a dot then
    const active = s.filters.length > 0 || s.speaker !== null || s.sort !== 'order';
    $('#lp-rows').classList.toggle('has-active', active);
    $('#rs-menu').classList.toggle('dot', active);
    syncRowsSearch();
    $('#sortbtn').innerHTML = `Вигляд${SVG.caret}`;
    $('#sortbtn').title = $('#sortbtn').ariaLabel = `Вигляд: порядок «${SORT_LABEL[s.sort]}»`;
    $('#sortbtn').classList.toggle('on', s.sort !== 'order');
    const v = ctx.view();
    if (!v) { $('#slist').innerHTML = '<div class="emptybox"><b>Спершу оберіть файл угорі</b>Тут з’являться рядки вибраного файлу.</div>'; return; }
    const idx = new Map(v.units.map((u, i) => [u.key, i + 1]));
    const list = visibleUnits(true);
    const box = $('#slist');
    // pages: only the rows of one page are drawn; the continuous list marks where each page begins; both have the bubble of the pages
    const plan = planRows(`${s.current ?? ''}|${s.filters.join(',')}|${s.q}|${s.speaker ?? ''}|${s.lenFilter}|${s.sort}`, list.map(u => u.key), s.cur);
    renderPager(document.getElementById('pgb'), document.getElementById('lp-rows'), plan);
    if (list.length) {
      const part = plan.mode === 'pages' ? list.slice(plan.from, plan.to) : list;
      mountRows('slist', box, box, '', part.map(u => u.key), i => siHtml(part[i]!, idx.get(part[i]!.key)!, plan.mode === 'flow' && i % plan.size === 0 ? i / plan.size + 1 : 0), s.current ?? '', 72, 'si');
      const top = takeWantTop();
      if (top !== null) box.scrollTop = top;
    } else box.innerHTML = emptyHtml;
  }


  /** The number of the row a file was left on (0 when there is none), for the title of its tab. */
  const leftAt = (name: string, units: readonly { key: string }[]): number => rowNumber(units, rowMemo()[name]);
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
      return `<div class="tab ${on ? 'on' : ''}"><button class="tb" data-tab="${esc(n)}" aria-current="${on}" title="${esc(fileTitle(n) + (n.includes('/') ? ' · ' + n : '') + (leftAt(n, v.units) ? ` · ви зупинилися на рядку ${leftAt(n, v.units)}` : ''))}"><span class="tico ${ic === 'map' ? '' : 'j'}">${lab}</span>${esc(twin ? fileTitle(n) : short)}${qa ? `<span class="badge" title="Проблеми QA у файлі">${qa}</span>` : ''}</button><button class="x" data-closetab="${esc(n)}" aria-label="Закрити вкладку ${esc(n)}">✕</button></div>`;
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
    renderBulk(visibleUnits(true, false).map(u => u.key));
  }
  /** Is the table showing every row (no filter, search, speaker, length or sort)? Then a changed row stays where it is. */
  const tablePlain = (): boolean => s.mode === 'table' && !s.filters.length && !s.q && s.speaker === null && s.lenFilter === 'all' && !s.phone && !(lp() === 'rows' || s.leftBoth);
  /**
   * One row of the table changed (a cell was edited): draw that row again and bring the totals in line, instead of
   * drawing the whole workspace. Anything that could move or remove the row (a filter, a search, a sort) or a view
   * other than the plain table falls back to the full redraw.
   */
  /** A mouse button is held down: the tree, the tabs and the filter chips are not redrawn now, or the click that began on one of them would be lost. */
  let pointerHeld = false, deferChrome = false;
  const redrawChrome = (): void => { $('#chips1').innerHTML = chipsHtml('1'); renderTabs(); renderTree(); };
  addEventListener('pointerdown', () => { pointerHeld = true; }, true);
  addEventListener('pointerup', () => { pointerHeld = false; if (deferChrome) { deferChrome = false; setTimeout(redrawChrome, 0); } }, true);
  function rowChanged(key: string): void {
    const u = ctx.unit(key);
    const old = u && tablePlain() ? document.querySelector<HTMLElement>(`#grid .gr[data-key="${CSS.escape(key)}"]:not(.lazy)`) : null;
    if (!u || !old || !patchRow('grid', key, rowHtml(u, Number(old.querySelector('.num')?.textContent) || 1))) { renderAll(); return; }
    renderTop(); renderSidePanel(ctx); renderStatus();
    if (pointerHeld) deferChrome = true; else redrawChrome();
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
    $('#chips1').innerHTML = chipsHtml('1');
    renderFilterButtons();
    ($('#q') as HTMLInputElement).value = s.q;
    if (!v) { grid.innerHTML = ''; return; }
    const idx = new Map(v.units.map((u, i) => [u.key, i + 1]));
    const list = visibleUnits(true, false);
    const ids = list.map(u => u.key);
    const nSel = ids.filter(k => s.checked.has(k)).length;
    const hasWho = v.units.some(u => ctx.speaker(u));
    grid.classList.toggle('no-who', !hasWho);
    grid.style.setProperty('--cols', hasWho ? '34px 22px 110px 96px minmax(160px,.9fr) minmax(180px,1fr) 78px' : '34px 22px 110px minmax(160px,.9fr) minmax(180px,1fr) 78px');
    let h = `<div class="gh" role="row"><div class="gcheck" role="columnheader"><input type="checkbox" id="selall" aria-label="Вибрати всі видимі рядки" ${nSel && nSel === ids.length ? 'checked' : ''}></div><div title="Статус" role="columnheader" class="s"><span class="vh">Статус</span></div><div class="s" role="columnheader">Ключ</div><div class="s" role="columnheader">Мовець</div><div role="columnheader">Оригінал · EN</div><div class="s" role="columnheader">Переклад · UK</div><div class="s" role="columnheader" title="Кількість знаків: переклад / оригінал (без керівних кодів). Рекомендація: якнайближче до оригіналу" style="justify-content:flex-end;border-right:0">К-сть зн.</div></div>`;
    // Every row has its place; a row is drawn when it comes near the screen: nothing is cut off, however long the file or the group is.
    if (list.length) mountRows('grid', grid, grid.parentElement!, h, ids, i => rowHtml(list[i]!, idx.get(list[i]!.key)!), s.current ?? '', 56);
    else { grid.innerHTML = h + `<div class="empty-wrap" role="row"><div role="gridcell">${emptyHtml}</div></div>`; grid.removeAttribute('aria-rowcount'); grid.removeAttribute('aria-colcount'); }
    renderBulk(ids);
    ensureGridStop();
  }

  let topTimer = 0;
  function renderTop(): void {
    const title = projectTitle(s.saved), letters = iconLetters(s.saved);
    syncTheme(document.documentElement, { name: title, settings: s.saved.settings });
    $('#proj-name').textContent = title;
    $('#proj-av').textContent = letters; $('#proj-av').classList.toggle('two', Array.from(letters).length > 1);
    $('#br-name').textContent = branchOf(s.saved);
    syncGlow();
    // the four states of a row (see core/progress.ts): without text, draft, sent (not proofread yet), proofread
    const prog = sumProgress(s.views.map(v => progressOf(v.units, s.saved.files[v.name] ?? {})));
    const total = prog.total, A = prog.approved, D = prog.sent, W = prog.draft;
    const cur = ctx.view();
    const nextU = cur && cur.name !== GROUP ? cur.units.find(u => !s.saved.files[cur.name]?.[u.key]?.target && u.kind !== 'name' && u.kind !== 'term') : undefined;
    publishWidget({ name: title, file: s.current === GROUP ? '' : s.current ?? '', total, approved: A, done: D, draft: W, ...(cur && nextU ? { next: { file: cur.name, key: nextU.key, text: nextU.source.replace(/\s+/g, ' ').slice(0, 160) } } : {}) });
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
    stale = built ? builtDrift(s.saved, built.mt).n : 0;
    $('#run-btn').classList.toggle('stale', stale > 0);
    renderBell();
    $('#sb-build').hidden = !built;
    $('#sb-build').textContent = built ? `Збірка: ${ago(built.mt, Date.now())}${built.n !== undefined ? ` · ${plural(built.n, ['рядок', 'рядки', 'рядків'])}` : ''}` : '';
    renderRunCfg();
    setUnavailable($('#cfg-btn'), !s.views.length, 'Спершу відкрийте гру', 'Що запускає кнопка ▶');
    setUnavailable($('#run-btn'), !s.views.length, 'Спершу відкрийте гру', `Запустити «${CFG[runCfg].name}» (F5)${stale ? ` · після останньої збірки змінено ${plural(stale, ['рядок', 'рядки', 'рядків'])}` : ''}`);
  }

  function renderStatus(): void {
    noteRow();
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
    $('#sb-qa').className = qa ? 'sbtn bad' : 'sbtn ok';
    const ab = $('#sb-adv');
    ab.hidden = !adv;
    ab.textContent = adv ? `Поради: ${adv}` : '';
    const u = s.cur ? ctx.unit(s.cur) : undefined;
    $('#st-sel').textContent = u && v ? `${s.current === GROUP ? 'Група' : 'Файл'}: ${shortLabel()} › рядок ${v.units.indexOf(u) + 1} з ${v.units.length} · ${STATUS_LABEL[shownStatus(ctx, u, entryOf(u))]}` : '';
    if (v) {
      const st = statsOf(v.units, ents);
      $('#sb-file').textContent = `${s.current === GROUP ? 'Група' : 'Файл'}: ${st.approved} / ${st.total} вичитано · ${st.done} ${st.done % 10 === 1 && st.done % 100 !== 11 ? 'чекає' : 'чекають'} вичитки`;
    } else $('#sb-file').textContent = '';
    const mins = Math.max(0, Math.round((Date.now() - s.sess.t0) / 60000));
    $('#sb-sess').textContent = `Сесія: ${plural(s.sess.n, ['рядок змінено', 'рядки змінено', 'рядків змінено'])} · ${mins} хв`;
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
    showPendingRow();
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

  /** The hint over the list of files (the order file → row → translation) is shown until it is dismissed or the translator opens a file from the list. */
  const coachSeen = (): boolean => { try { return localStorage.getItem('transly.coach.files') === '1'; } catch { return true; } };
  const coachDone = (): void => { try { localStorage.setItem('transly.coach.files', '1'); } catch { /* the hint comes back next time, that is all */ } };
  function openFile(name: string): void {
    if (!s.views.some(v => v.name === name)) return;
    if (!s.open.includes(name)) s.open.push(name);
    s.current = name; s.q = ''; s.lenFilter = 'all'; s.checked.clear();
    s.filters = [];
    unitMap = new Map((ctx.view()?.units ?? []).map(u => [u.key, u]));
    // a file opens on the row it was left on
    const left = rowMemo()[name];
    if (left && unitMap.has(left)) { s.cur = left; showRowAfterDraw = left; }
    else s.cur = s.mode === 'table' ? null : ctx.visible()[0]?.key ?? null;
  }

  /** The rows the files were left on (loaded for the open project), see rowmemo.ts. */
  function rowMemo(): Record<string, string> {
    if (s.rowAtFor !== s.saved.name) { s.rowAt = loadRowMemo(s.saved.name); s.rowAtFor = s.saved.name; }
    return s.rowAt;
  }
  let memoTimer = 0;
  /** Remember the row of the open file (called whenever the status is drawn: that is whenever the choice of a row changes). */
  function noteRow(): void {
    const f = s.current;
    if (!f || f === GROUP || !s.cur) return;
    const memo = rowMemo();
    if (memo[f] === s.cur) return;
    memo[f] = s.cur;
    clearTimeout(memoTimer); memoTimer = window.setTimeout(() => saveRowMemo(s.saved.name, memo), 400);
  }
  /** The row a tab was opened on is brought into view once the file is drawn. */
  let showRowAfterDraw: string | null = null;
  function showPendingRow(): void {
    const key = showRowAfterDraw;
    showRowAfterDraw = null;
    if (!key) return;
    if (s.mode === 'table') { reveal('grid', key); document.querySelector<HTMLElement>(`.gr[data-key="${CSS.escape(key)}"]`)?.scrollIntoView({ block: 'nearest' }); }
    else if (s.mode === 'edit') { reveal('slist', key); document.querySelector<HTMLElement>(`.si[data-key="${CSS.escape(key)}"]`)?.scrollIntoView({ block: 'nearest' }); }
  }

  /** Show the rows of several files in one table (a group keeps its tab until it is closed). */
  function openGroup(names: string[]): void {
    const known = names.filter(n => s.views.some(v => v.name === n));
    if (!known.length) return;
    s.group = known; s.groupSel = null;
    s.current = GROUP; s.q = ''; s.lenFilter = 'all'; s.checked.clear();
    s.filters = [];
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
    s.filters = [];
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
    // another game in a project that holds translations: asked before the rows are mixed (a new version of the same game is not asked about)
    if (!keep && !quiet && looksLikeAnotherGame(s.saved.snapshot, readGame(files, { pluginCommands: s.saved.settings.pluginCommands }), s.saved.files) && !(await askAnotherGame())) { renderAll(); return; }
    const reset = ingest(files, keep);
    const ingested = lastIngest;
    dataDir = isDesktop() ? dataDirOf(picked) : null;
    if (!s.views.length) { s.current = null; renderAll(); toast('У цих файлах немає тексту для перекладу'); return; }
    if (failed.length) toast(`Не вдалося прочитати: ${failed.slice(0, 4).join(', ')}${failed.length > 4 ? ` і ще ${failed.length - 4}` : ''}. Файл пошкоджений або не є JSON: його рядків у проєкті не буде`, { sticky: true });
    const fromBackup = picked.filter(f => f.fromBackup).length;
    const translated = sumProgress(s.views.map(v => progressOf(v.units, s.saved.files[v.name] ?? {}))).translated;
    const heavy = isDesktop() && !fromBackup && translated >= 10 && (lastReconcile?.demoted ?? 0) / translated >= 0.2;
    if (ingested && !heavy) toast(`Нова версія гри: ${ingestNote(ingested.report)}`, { action: { label: 'Показати', run: () => openIngestReport(ctx, ingested.report, ingested.batch) } });
    if (heavy) {
      // Many originals changed at once and there is no backup to read them from: most likely the folder already holds the translation.
      toast('Оригінали в папці гри змінилися майже скрізь, а резервної копії немає: схоже, там уже лежить переклад. Натисніть «Збірка (файл)» → «Повернути оригінали», потім відкрийте папку знову', { sticky: true });
    } else if (reset && lastReconcile) {
      // said when this reading took rows back to drafts; a draft whose original changed earlier stays marked, and reading the same folder again does not report it again
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

  /** The name of the game's folder is what the project is called until the translator names it (see core/projname.ts). */
  function noteFolderName(raw: string): void {
    const n = nameFromFolder(raw);
    if (!n || s.saved.settings.folderName === n) return;
    s.saved.settings.folderName = n; s.saved.settingsAt = Date.now(); ctx.persist();
  }

  async function openFolder(): Promise<void> {
    const picked = await pickGameFolder(input);
    if (!picked) return;
    // the folder the files were picked from: its full path on the desktop, its name in the browser
    const first = picked.files[0]?.path ?? '';
    noteFolderName(isDesktop() ? rememberedGameDir() ?? '' : picked.handle?.name ?? (first.includes('/') ? first.split('/')[0]! : ''));
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
    if (found?.ok) noteFolderName(found.root);
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
  /** One icon for each of the three, so that they are told apart at a glance: a box (a file), a screen with ▶ (the game), a flag (the start from here). */
  const CFG_ICON: Record<RunCfg, string> = {
    file: '<path d="M2.5 5h11v8h-11z"/><path d="M2.5 5l1.5-2h8l1.5 2M6.5 8h3"/>',
    game: '<rect x="2" y="3" width="12" height="8.5" rx="1.5"/><path d="M6.7 5.4l3 1.85-3 1.85z"/><path d="M5.5 13.5h5"/>',
    scene: '<path d="M4 14V2.5M4 3h8.5l-2.2 2.6 2.2 2.6H4"/>',
  };
  const loadCfg = (): RunCfg => { try { const v = localStorage.getItem('transly.runcfg'); return (v === 'game' || v === 'scene') && isDesktop() ? v : 'file'; } catch { return 'file'; } };
  let runCfg: RunCfg = loadCfg();
  function renderRunCfg(): void {
    if (CFG[runCfg].desk && !isDesktop()) runCfg = 'file';
    $('#cfg-name').textContent = CFG[runCfg].name;
    $('#cfg-btn').setAttribute('aria-label', `Що запускає кнопка ▶: ${CFG[runCfg].name}`);
    $('#run-btn').title = `Запустити «${CFG[runCfg].name}» (F5)${stale ? ` · після останньої збірки змінено ${plural(stale, ['рядок', 'рядки', 'рядків'])}` : ''}`;
    $('#run-btn').setAttribute('aria-label', `Запустити «${CFG[runCfg].name}»`);
  }
  function openCfgMenu(): void {
    const pop = $('#cfgpop'), btn = $('#cfg-btn');
    if (!pop.hidden) { pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); return; }
    pop.innerHTML = buildStatusHtml() + (Object.keys(CFG) as RunCfg[]).map(k => {
      const off = CFG[k].desk && !isDesktop();
      return `<div class="cfg-row ${k === runCfg ? 'on' : ''}"><button role="menuitemradio" aria-checked="${k === runCfg}" data-cfg="${k}" ${off ? 'disabled' : ''}><span class="cfg-t"><svg class="cfg-i" viewBox="0 0 16 16" aria-hidden="true">${CFG_ICON[k]}</svg>${CFG[k].name}</span><small>${off ? 'Лише в застосунку на ПК' : CFG[k].sub}</small></button>${off ? '' : `<button class="cfg-go" data-cfg-run="${k}" title="Запустити «${CFG[k].name}»" aria-label="Запустити «${CFG[k].name}»">${SVG.play}</button>`}</div>`;
    }).join('') + `<hr><button role="menuitem" data-cfg-edit><span class="cfg-t">Налаштувати збірку…</span></button>`;
    const r = btn.getBoundingClientRect();
    pop.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - 300))}px`; pop.style.top = `${r.bottom + 6}px`;
    rememberOpener(btn); pop.hidden = false; btn.setAttribute('aria-expanded', 'true'); focusFirst(pop); refreshScrollbars();
  }
  /* ---------- notifications: what needs attention and what the others did since the translator last looked ---------- */
  const SEEN_KEY = 'transly.inboxSeen';
  let inboxSeen = (() => { const v = Number(ls(SEEN_KEY)); if (Number.isFinite(v) && v > 0) return v; const now = Date.now(); try { localStorage.setItem(SEEN_KEY, String(now)); } catch { /* private mode: the news count from now on */ } return now; })();
  let inboxItems: InboxItem[] = [], inboxErrors: { file: string; key: string }[] = [], inboxDirty = true, inboxTimer = 0, stale = 0;
  const IB_PATH: Record<InboxItem['kind'], string> = { error: 'M8 2.5L14 13H2zM8 7v3M8 11.5v.2', draft: 'M10.5 2.5l3 3L5.5 13.5l-3.5.5.5-3.5z', unreviewed: 'M3 8.5l3.2 3.2L13 4.8', source: 'M13 6a5 5 0 0 0-9-1.5M3 2.5v2.5h2.5M3 10a5 5 0 0 0 9 1.5M13 13.5V11h-2.5', replies: 'M2.5 3.5h11v7h-5l-3 2.5v-2.5h-3z', others: 'M8 8a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM3 13.5c.5-2.5 2.5-3.5 5-3.5s4.5 1 5 3.5' };
  /** The list, with the QA errors of the whole project: the pass of the QA over every row is made once the data stops changing, not at every redraw. */
  function renderBell(): void {
    inboxItems = inboxOf({ views: s.views, saved: s.saved, who: s.who, seen: inboxSeen, errors: inboxErrors });
    const n = inboxItems.length, b = $('#bell-n');
    b.hidden = !n; b.textContent = String(n);
    b.classList.toggle('bad', inboxItems.some(i => i.kind === 'error'));
    $('#bell').setAttribute('aria-label', n ? `Сповіщення: ${n}` : 'Сповіщення');
    if (inboxDirty && !inboxTimer) inboxTimer = window.setTimeout(() => { inboxTimer = 0; inboxDirty = false; inboxErrors = queueRows(s.views, s.saved, 'error', qaOpts()); renderBell(); }, 2500);
  }
  const closeInbox = (): void => { hidePop($('#inboxpop')); $('#bell').setAttribute('aria-expanded', 'false'); };
  function openInbox(): void {
    const pop = $('#inboxpop'), btn = $('#bell');
    if (!pop.hidden) { closeInbox(); return; }
    if (inboxDirty) { inboxDirty = false; inboxErrors = queueRows(s.views, s.saved, 'error', qaOpts()); }
    renderBell();
    const row = (i: InboxItem): string => `<button role="menuitem" data-ib="${esc(i.id)}"><span class="cfg-t"><svg class="cfg-i" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="${IB_PATH[i.kind]}"/></svg>${esc(i.title)}</span><small>${esc(i.sub)}</small></button>`;
    const state = inboxItems.filter(i => !i.news), news = inboxItems.filter(i => i.news);
    pop.innerHTML = !inboxItems.length ? '<div class="pj-h">Усе гаразд</div><div class="ib-none">Немає помилок QA, чернеток і рядків на вичитку, нових змін від інших теж.</div>'
      : (state.length ? `<div class="pj-h">Потребує уваги</div>${state.map(row).join('')}` : '')
        + (news.length ? `${state.length ? '<hr>' : ''}<div class="pj-h">Нове від інших</div>${news.map(row).join('')}<hr><button role="menuitem" data-ib="~read"><span class="cfg-t">Позначити нове прочитаним</span></button>` : '');
    const r = btn.getBoundingClientRect();
    pop.style.left = `${Math.max(8, Math.min(r.right - 340, window.innerWidth - 348))}px`; pop.style.top = `${r.bottom + 6}px`;
    rememberOpener(btn); pop.hidden = false; btn.setAttribute('aria-expanded', 'true'); focusFirst(pop); refreshScrollbars();
  }
  /** The state of the last build, at the head of the build menu: how old it is, and what was written after it (so a build that is out of date is seen where it is made). */
  function buildStatusHtml(): string {
    const built = stampOf(s.saved, 'build');
    const icon = (d: string): string => `<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
    if (!built) return `<div class="pj-h">Остання збірка</div><div class="bs"><span class="bi">${icon('M2.5 5.5h11v7h-11zM2 3.5h12v2H2zM6.5 8h3')}</span><div><b>Збірки ще не було</b><small>Тут буде видно, чи зібраний переклад актуальний</small></div></div><hr>`;
    const d = builtDrift(s.saved, built.mt);
    const when = `${new Date(built.mt).toLocaleString('uk-UA', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} · ${ago(built.mt, Date.now())}${built.n !== undefined ? ` · ${plural(built.n, ['рядок', 'рядки', 'рядків'])}` : ''}`;
    if (!d.n) return `<div class="pj-h">Остання збірка</div><div class="bs"><span class="bi ok">${icon('M3 8.5l3.2 3.2L13 4.8')}</span><div><b>Збірка свіжа</b><small>${esc(when)}</small><small>Після неї нічого не змінювалось</small></div></div><hr>`;
    const parts = [d.approved ? `${d.approved} вичитано` : '', d.sent ? `${d.sent} надіслано` : ''].filter(Boolean).join(', ');
    return `<div class="pj-h">Остання збірка</div><div class="bs"><span class="bi">${icon('M8 2.5L14 13H2zM8 7v3M8 11.5v.2')}</span><div><b>Збірка застаріла</b><small>${esc(when)}</small><small class="w">Після неї змінено ${plural(d.n, ['рядок', 'рядки', 'рядків'])}: ${esc(parts)}</small><div class="acts"><button class="btn p" type="button" data-bs="build">Зібрати зараз</button><button class="btn" type="button" data-bs="changes">Що змінилося</button></div></div></div><hr>`;
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
      <div class="pj-card"><span class="pj lg${Array.from(iconLetters(s.saved)).length > 1 ? ' two' : ''}">${esc(iconLetters(s.saved))}</span><div><b>${esc(projectTitle(s.saved))}</b><small class="${folder.kind === 'missing' || folder.kind === 'other' ? 'warn' : ''}" title="${esc(folderLine(folder, remembered))}">${esc(folderLine(folder, remembered))}</small><small>${total ? `Перекладено ${done.toLocaleString('uk-UA')} з ${total.toLocaleString('uk-UA')}` : 'Файлів ще немає'}</small></div></div>
      <hr><button role="menuitem" data-pj="project"><span class="cfg-t">Налаштування проєкту…</span></button>
      <button role="menuitem" data-pj="settings"><span class="cfg-t">Налаштування застосунку…</span></button>`;
    const r = btn.getBoundingClientRect();
    pop.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - 340))}px`; pop.style.top = `${r.bottom + 6}px`;
    rememberOpener(btn); pop.hidden = false; btn.setAttribute('aria-expanded', 'true'); focusFirst(pop); refreshScrollbars();
  }
  /* ---------- submenus: an item with data-sub opens its list beside it and the menu stays open; a list can lead on to a further list.
     Hover (after a short wait), a click or → opens it; ← or Esc closes the last one; a choice closes them all. ---------- */
  const subHtml = new Map<string, () => string>();
  const subEls: HTMLElement[] = [];
  const subFrom = new Map<HTMLElement, HTMLElement>();
  const popLevel = (host: HTMLElement | null): number => !host ? -1 : host.id === 'fpop' ? 0 : subEls.indexOf(host) + 1 || -1;
  function syncSubMarks(): void {
    const open = new Set(subEls.map(e => e.dataset.subof));
    document.querySelectorAll<HTMLElement>('.pop [data-sub]').forEach(b => b.setAttribute('aria-expanded', String(open.has(b.dataset.sub))));
  }
  /** Close the submenus from level `from` on; the focus that was in them goes back to the item that opened the first of them. */
  function closeSubs(from = 0, back = true): void {
    if (from >= subEls.length) return;
    const first = subEls[from]!, item = subFrom.get(first), had = subEls.slice(from).some(e => e.contains(document.activeElement));
    for (const e of subEls.splice(from)) { subFrom.delete(e); e.remove(); }
    syncSubMarks();
    if (had && back) item?.focus({ preventScroll: true });
  }
  function openSub(item: HTMLElement, focusIt: boolean): void {
    const host = item.closest<HTMLElement>('.pop'), level = popLevel(host), key = item.dataset.sub ?? '';
    if (!host || level < 0) return;
    if (subEls[level]?.dataset.subof === key) { if (focusIt) focusFirst(subEls[level]!); return; }
    const html = subHtml.get(key)?.();
    if (!html) return;
    closeSubs(level, false);
    const el = document.createElement('div');
    el.className = 'pop sub'; el.setAttribute('role', 'menu'); el.dataset.subof = key; el.innerHTML = html;
    fpop().after(el); subEls.push(el); subFrom.set(el, item);
    const hr = host.getBoundingClientRect(), r = item.getBoundingClientRect();
    el.style.left = (hr.right + el.offsetWidth + 8 <= innerWidth ? hr.right - 3 : Math.max(8, hr.left - el.offsetWidth + 3)) + 'px';
    el.style.top = Math.max(8, Math.min(r.top - 5, innerHeight - el.offsetHeight - 8)) + 'px';
    syncSubMarks();
    if (focusIt) focusFirst(el);
    refreshScrollbars();
  }
  // the lists the menus open beside themselves (see the engine above)
  subHtml.set('rows-sort', () => sortMenuHtml());
  subHtml.set('rows-more', () => moreHtml());
  subHtml.set('files-groups', () => {
    const picked = s.picked.size ? `<hr><div class="group">Вибрано файлів: ${s.picked.size}</div><button data-act="group-picked" role="menuitem">Відкрити вибрані разом</button><button data-sub="files-place" role="menuitem" aria-haspopup="menu" aria-expanded="false">Додати вибрані до групи<span class="sk">▸</span></button><button data-act="group-clear" role="menuitem">Зняти позначки</button>` : '';
    return `${s.views.length > 1 ? '<button data-act="group-all" role="menuitem" title="Усі рядки всіх файлів в одній таблиці">Усі файли разом</button>' : ''}<button data-wm="files:newgroup" role="menuitem" title="Файли в групу: Ctrl+клік по файлах, потім «Додати вибрані до групи» (або перетягніть файл на групу)">+ Нова група…</button>${picked}`;
  });
  subHtml.set('files-place', () => { const first = [...s.picked][0]; return first ? placeMenuHtml(ctx, filesTarget(first)) : ''; });
  /** Hide a popover; the focus that was inside it goes back to the control that opened it. */
  const hidePop = (pop: HTMLElement): void => {
    const had = pop.contains(document.activeElement) || (pop.id === 'fpop' && subEls.some(e => e.contains(document.activeElement))); pop.hidden = true;
    if (pop.id === 'fpop') closeSubs(0, false);
    if (pop.dataset.for) document.getElementById(pop.dataset.for)?.setAttribute('aria-expanded', 'false');
    if (had) restoreOpener();
  };
  const closeProjMenu = (): void => { hidePop($('#projpop')); $('#proj-btn').setAttribute('aria-expanded', 'false'); };
  /** The glow of the window starts at the project's icon, a little to the right of it. */
  function syncGlow(): void {
    const av = $('#proj-av').getBoundingClientRect();
    if (av.width) $('#ide').style.setProperty('--gx', `${Math.round(av.left + av.width / 2 + 60)}px`);
  }
  window.addEventListener('resize', syncGlow);
  /** What the branch dialogs act on: the project stands as `next` now (saved, redrawn), and the merge screen. */
  const branchActions: BranchActions = {
    saved: () => s.saved,
    apply: (next, note) => { s.saved = next; closeMerge?.(); adopt(); toast(note); },
    merge: source => { closeMerge = openMergeScreen(ctx, source, () => { closeMerge = null; adopt(); }); },
  };
  let closeMerge: (() => void) | null = null;
  function openBranchMenu(): void {
    const pop = $('#brpop'), btn = $('#br-btn');
    if (!pop.hidden) { closeBranchMenu(); return; }
    pop.innerHTML = branchMenuHtml(s.saved);
    const r = btn.getBoundingClientRect();
    pop.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - 340))}px`; pop.style.top = `${r.bottom + 6}px`;
    rememberOpener(btn); pop.hidden = false; btn.setAttribute('aria-expanded', 'true'); focusFirst(pop); refreshScrollbars();
  }
  const closeBranchMenu = (): void => { hidePop($('#brpop')); $('#br-btn').setAttribute('aria-expanded', 'false'); };
  const closeCfgMenu = (): void => { hidePop($('#cfgpop')); $('#cfg-btn').setAttribute('aria-expanded', 'false'); };
  const runCfgNow = (k: RunCfg): void => {
    if (!s.views.length) { toast('Спершу відкрийте гру'); return; }
    const fail = (err: unknown) => toast('Не вдалося запустити: ' + (err instanceof Error ? err.message : String(err)));
    if (k === 'game') buildAndRunGame(ctx).catch(fail);
    else if (k === 'scene') {
      if (!s.current) { toast('Відкрийте файл і виберіть рядок: гра почнеться з його сцени'); return; }
      if (s.current === GROUP) { toast('Запуск у грі працює для файлу, відкритого окремо: відкрийте його зі списку файлів'); return; }
      const u = sceneStartRow();
      if (!u) { toast('У цьому файлі немає рядків із сценою (події мапи, загальні події, бої): відкрийте інший файл'); return; }
      playInGame(ctx, s.current, u, 'event', 0).catch(fail);
    } else doBuild();
  };
  /** The row the scene test starts from: the selected one, else the one in focus in the table, else the first row of the file that has a scene. */
  function sceneStartRow(): Unit | undefined {
    const file = s.current;
    if (!file) return undefined;
    const at = (key: string | null | undefined): Unit | undefined => (key ? ctx.unit(key) : undefined);
    const chosen = at(s.cur);
    if (chosen) return chosen; // an explicit choice stands, even when it has no scene: the answer says why
    const hasScene = (u: Unit): boolean => !!jumpTarget(file, u.key, s.game, 'event');
    const stop = at(document.querySelector<HTMLElement>('#grid .gr[tabindex="0"]')?.dataset.key);
    if (stop && hasScene(stop)) return stop;
    return (ctx.view()?.units ?? []).find(hasScene);
  }
  const runSelected = (): void => runCfgNow(runCfg);
  const doBuild = () => openBuild(ctx, dataDir, n => { s.lastBuild = { at: Date.now(), n }; stamp(s.saved, 'build', 'збірка', Date.now(), n); ctx.persist(); renderTop(); }, () => void openFolder());

  /** The project is empty again, so the game's strings have to be read into it afresh (plugin texts are off by default). */
  function afterReset(): void {
    if (s.game.length) { ingest(s.game); unitMap = new Map((ctx.view()?.units ?? []).map(u => [u.key, u])); if (s.cur && !unitMap.has(s.cur)) s.cur = null; }
    // No game folder in memory (the files on screen came from the stored snapshot): the rows stay the project's game, so keep their snapshot.
    else if (s.views.length) s.saved.snapshot = snapshotOf(s.views);
    s.views.forEach(v => { s.saved.files[v.name] = {}; });
    renderAll(); ctx.persist();
  }
  const folderActions = {
    text: () => folderLine(folder, rememberedGameDir()),
    change: () => { void openFolder(); },
    forget: () => { forgetGameDir(); folderSeq++; folder = { kind: 'none' }; dataDir = null; renderFolderBar(); renderTop(); },
  };
  function openProjectDlg(tab?: ProjectTab): void {
    openProjectSettings(ctx, { branches: branchActions, folder: folderActions, reset: afterReset, app: t => openSettingsDlg(t) }, tab);
  }
  function openSettingsDlg(tab?: SettingsTab): void {
    openSettings(ctx, {
      project: () => openProjectDlg(),
      reset: afterReset,
      adopt,
      folder: folderActions,
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
    closeSubs(0, false);
    if (!p.hidden && p.dataset.for === btn.id) { hidePop(p); return; }
    rememberOpener(btn);
    if (p.dataset.for) document.getElementById(p.dataset.for)?.setAttribute('aria-expanded', 'false');
    p.innerHTML = html; p.dataset.for = btn.id; p.hidden = false; btn.setAttribute('aria-expanded', 'true');
    const r = btn.getBoundingClientRect();
    p.style.left = Math.min(r.left, innerWidth - p.offsetWidth - 8) + 'px';
    // under the button when it fits, above it when it does not (a long list such as «Ще ▾» near the bottom of the window)
    const h = p.offsetHeight, below = r.bottom + 4;
    p.style.top = (below + h <= innerHeight - 8 ? below : Math.max(8, r.top - 4 - h >= 8 ? r.top - 4 - h : innerHeight - h - 8)) + 'px';
    focusFirst(p);
    refreshScrollbars();
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
  let subTimer = 0;
  document.addEventListener('pointerover', e => {
    if ((e as PointerEvent).pointerType === 'touch') return;
    const b = (e.target as HTMLElement).closest<HTMLElement>('.pop button');
    const host = b?.closest<HTMLElement>('.pop') ?? null, level = popLevel(host);
    if (!b || level < 0) return;
    window.clearTimeout(subTimer);
    subTimer = window.setTimeout(() => { if (b.dataset.sub) openSub(b, false); else closeSubs(level, false); }, b.dataset.sub ? 120 : 250);
  });
  const closePops = () => { closeSubs(0, false); hidePop(fpop()); closeCfgMenu(); closeProjMenu(); closeBranchMenu(); closeInbox(); };
  const groupsApi = { pop: (a: HTMLElement, html: string) => showPop(a, html), closePops: () => closePops() };
  /** A menu at the pointer. */
  function popAt(x: number, y: number, html: string): void {
    const p = fpop();
    closeSubs(0, false);
    rememberOpener();
    p.innerHTML = html; p.dataset.for = 'at'; p.hidden = false;
    p.style.left = Math.max(8, Math.min(x, innerWidth - p.offsetWidth - 8)) + 'px';
    p.style.top = Math.max(8, Math.min(y, innerHeight - p.offsetHeight - 8)) + 'px';
    focusFirst(p);
    refreshScrollbars();
  }
  const filesTarget = (name: string): PlaceTarget => {
    const many = s.picked.has(name) && s.picked.size > 1;
    return many ? { files: [...s.picked], label: plural(s.picked.size, ['файл', 'файли', 'файлів']) } : { files: [name], label: name.replace(/\.json$/, '') };
  };

  /* ---------- global search ---------- */
  interface SdItem { t: 'file' | 'row' | 'term'; file?: string; key?: string; term?: string; kind: string; title: string; sub?: string; where?: string; status?: string }
  let sdItems: SdItem[] = [];
  let sdSel = 0;
  let sdKind = '';
  let searchFrom: HTMLElement | null = null;
  function openSearch(): void { searchFrom = document.activeElement instanceof HTMLElement ? document.activeElement : null; $('#sd').hidden = false; const i = $('#sd-in') as HTMLInputElement; i.value = ''; sdKind = ''; sdRender(); i.focus(); holdInert('search', true); }
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
  /** A piece of `text` of at most `max` characters that contains the first match of `q` (the start of the text when there is none). */
  const around = (text: string, q: string, max = 90): string => {
    const flat = text.replace(/\s+/g, ' ');
    if (flat.length <= max) return flat;
    const at = q ? flat.toLowerCase().indexOf(q) : -1;
    if (at < max - 12) return flat.slice(0, max);
    const from = Math.max(0, Math.min(at - 20, flat.length - max));
    return `…${flat.slice(from + 1, from + max)}`;
  };
  /** The text with the matches of `q` marked (the text is escaped here). */
  const marked = (text: string, q: string): string => {
    if (!q) return esc(text);
    const low = text.toLowerCase();
    let out = '', i = 0;
    for (let at = low.indexOf(q); at >= 0; at = low.indexOf(q, i)) { out += esc(text.slice(i, at)) + '<mark>' + esc(text.slice(at, at + q.length)) + '</mark>'; i = at + q.length; }
    return out + esc(text.slice(i));
  };
  function sdRender(): void {
    const q = ($('#sd-in') as HTMLInputElement).value.trim().toLowerCase();
    const files: SdItem[] = [], rows: SdItem[] = [], terms: SdItem[] = [];
    /** A chosen section shows more of its results (nothing else competes for the room). */
    const only = sdKind !== '', capF = only ? 50 : 5, capR = only ? 60 : 8, capT = only ? 50 : 4;
    const want = (k: string): boolean => !only || sdKind === k;
    /** How many results each group really has, when more than it shows (the group header then says «показано 8 з 37»). */
    const total: Record<string, number> = {};
    const CAP = 999;
    const fileItem = (name: string): SdItem => ({ t: 'file', file: name, kind: 'Файли', title: fileTitle(name), sub: name.includes('/') ? name : undefined });
    if (!q) {
      const first = [...new Set([...s.open, ...s.views.map(v => v.name)])].filter(n => s.views.some(v => v.name === n));
      if (want('Файли')) first.slice(0, only ? 50 : 8).forEach(n => files.push(fileItem(n)));
    } else {
      let nFiles = 0;
      for (const v of s.views) if (want('Файли') && `${v.name} ${v.label ?? ''}`.toLowerCase().includes(q)) { nFiles++; if (files.length < capF) files.push(fileItem(v.name)); }
      total['Файли'] = nFiles;
      let nRows = 0;
      if (want('Рядки')) outer: for (const v of s.views) {
        const ents = s.saved.files[v.name] ?? {};
        for (const u of v.units) {
          const e = ents[u.key];
          if (!(u.source + ' ' + flowText(e?.target ?? '') + ' ' + u.key).toLowerCase().includes(q)) continue;
          nRows++;
          if (rows.length < capR) rows.push({ t: 'row', file: v.name, key: u.key, kind: 'Рядки', title: around(u.source, q), sub: e?.target ? around(e.target, q) : '', where: `${fileTitle(v.name)} · ${shortKey(u.key)}`, status: shownStatus(ctx, u, e) });
          else if (nRows >= CAP) break outer;
        }
      }
      total['Рядки'] = nRows;
      const hitTerms = want('Терміни') ? s.saved.terms.filter(t => (t.en + ' ' + t.uk).toLowerCase().includes(q)) : [];
      total['Терміни'] = hitTerms.length;
      hitTerms.slice(0, capT).forEach(t => terms.push({ t: 'term', term: t.en, kind: 'Терміни', title: t.en, sub: t.uk }));
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
      html += `<div class="sd-it ${i === 0 ? 'on' : ''}" id="sd-opt-${i}" data-sd="${i}" role="option" aria-selected="${i === 0}">${dot}<span class="sd-b"><span class="sd-t">${marked(x.title, q)}</span>${x.sub ? `<span class="sd-s">${marked(x.sub, q)}</span>` : ''}${x.where ? `<span class="sd-w">${marked(x.where, q)}</span>` : ''}</span></div>`;
    });
    $('#sd-res').innerHTML = html || '<div class="sd-empty" role="status">Нічого не знайдено</div>';
    $('#sd-in').setAttribute('aria-activedescendant', sdItems.length ? 'sd-opt-0' : '');
    $('#sd-n').textContent = sdItems.length ? plural(sdItems.length, ['результат', 'результати', 'результатів']) : '';
    document.querySelectorAll<HTMLElement>('#sd-tabs [role=tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.sdk === sdKind)));
  }
  /** The sections of the search: «Усе», the files, the rows, the terms (Tab goes to the next one). */
  const SD_KINDS = ['', 'Файли', 'Рядки', 'Терміни'];
  function sdSection(step: number): void { sdKind = SD_KINDS[(SD_KINDS.indexOf(sdKind) + step + SD_KINDS.length) % SD_KINDS.length]!; sdRender(); }
  function sdGo(i: number): void {
    const it = sdItems[i];
    if (!it) return;
    closeSearch();
    if (it.t === 'term') { s.leftOpen = true; s.leftBoth = false; s.leftTab[s.mode] = 'glossary'; renderAll(); showTerm(ctx, it.term ?? ''); return; }
    if (it.file) {
      if (it.file !== s.current) openFile(it.file);
      if (it.key) { s.filters = []; s.q = ''; s.speaker = null; s.lenFilter = 'all'; ctx.select(it.key, s.mode === 'table' ? undefined : s.mode); } else renderAll();
    }
  }

  /* ---------- menu bar ---------- */
  type MenuItem = '-' | { t: string; fn: () => void; sc?: string };
  /** The menu bar of the desktop: what is already a button of the title bar (the modes, the shortcuts) is not repeated here. */
  const MENUS: Record<string, MenuItem[]> = {
    'Файл': [{ t: 'Відкрити папку гри…', fn: () => void openFolder() }, { t: 'Відкрити файли або вставити JSON…', fn: openImportDlg }, '-', { t: 'Зібрати…', fn: doBuild }, { t: 'Запустити вибране', fn: runSelected, sc: 'F5' }, '-', { t: 'Налаштування…', fn: () => openSettingsDlg() }],
    'Перехід': [{ t: 'Наступний рядок без перекладу', fn: () => jump('untranslated', 1), sc: 'Alt+⇧+↓' }, { t: 'Наступна помилка QA', fn: () => jump('error', 1), sc: 'F8' }, { t: 'Наступна порада', fn: () => jump('advice', 1) }, { t: 'Наступний на вичитку', fn: () => jump('unreviewed', 1) }, { t: 'Наступний зі зміненим оригіналом', fn: () => jump('sourceChanged', 1) }, '-', { t: 'Пошук скрізь…', fn: openSearch, sc: 'Ctrl+K' }],
    'Інструменти': [{ t: 'Визначити мовців…', fn: () => openSpeakers(ctx) }, { t: 'Знайти й замінити…', fn: () => openFindReplace(ctx) }, { t: 'Оновити за глосарієм…', fn: () => openTermSyncTool(ctx) }, { t: 'Автозаповнення…', fn: () => openAutofill(ctx, () => openLinkTool(ctx)) }, { t: 'Злити гілку…', fn: () => chooseMerge(branchActions) }, { t: 'Активність…', fn: () => openActivity(ctx) }, { t: 'Тексти плагінів…', fn: () => openPluginTexts(ctx, setPluginCommands) }, { t: 'Перенесення рядків…', fn: () => openWrapTool(ctx, { wrapFile }) }, { t: 'Правила QA…', fn: () => openQaRules(ctx) }],
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
    // with no width known from the originals the default one is used, the same as the preview of the dialog
    if (plan.disabled) { toast('Ширину рядка вимкнено в «Перенесення рядків»'); return; }
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
    s.filters = []; s.q = ''; s.speaker = null; s.lenFilter = 'all';
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
    refreshScrollbars();
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
    const visible = new Set(visibleUnits(true, false));
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
    const visible = new Set(visibleUnits(true, false));
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
  /** The fill from the memory is going on (it works in steps, so the page stays alive; Esc stops it). */
  let tmBusy = false, tmCancel = false;
  window.addEventListener('keydown', e => { if (e.key === 'Escape' && tmBusy) tmCancel = true; }, true);
  async function bulkTm(): Promise<void> {
    const v = ctx.view();
    if (!v || tmBusy) return;
    const ents = ctx.entries(v.name);
    const keys = [...s.checked].filter(k => unitMap.has(k) && !ents[k]?.target);
    const changes: RowChange[] = [];
    tmBusy = true; tmCancel = false;
    let last = performance.now();
    try {
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i]!, u = unitMap.get(k)!;
        const m = ctx.tm().find(u.source, { min: 70, limit: 1 })[0];
        if (m) changes.push({ file: v.name, key: k, next: edit(ents[k], u, m.t, ctx.stage(), Date.now()), text: m.t, what: `підставлено з пам’яті (${m.score}%)` });
        // after a fifth of a second the page gets to breathe, and the reader sees how far it is (Esc stops it, what is found so far is kept)
        if (performance.now() - last > 200) { showLoad(`З пам’яті: ${i + 1} з ${keys.length} (Esc зупинить)`); await new Promise(r => setTimeout(r, 0)); last = performance.now(); if (tmCancel) break; }
      }
    } finally { tmBusy = false; showLoad(null); }
    const n = changes.length;
    const batch = n ? ctx.commit(changes, 'memory') : undefined;
    ctx.persist(); ctx.invalidateTm(); renderAll();
    if (n) undoToast(ctx, `Підставлено з пам’яті: ${n}${tmCancel ? ' (зупинено)' : ''}`, batch); else toast(tmCancel ? 'Зупинено: збігів поки немає' : 'Збігів від 70% для порожніх вибраних рядків немає');
  }

  /* ---------- inline cell editing ---------- */
  function startInline(key: string): void {
    reveal('grid', key);
    const cell = document.querySelector<HTMLElement>(`.gr[data-key="${CSS.escape(key)}"] .tr`);
    const u = ctx.unit(key);
    if (!cell || !u || cell.querySelector('textarea')) return;
    const ta = el('textarea', 'cell-ed');
    ta.rows = 2; ta.value = entryOf(u)?.target ?? ''; ta.setAttribute('aria-label', 'Переклад рядка');
    // the editor is as tall as its text (up to half the window): the first line is not cut in half and a long text can be read
    const fit = (): void => { ta.style.height = 'auto'; ta.style.height = `${Math.min(ta.scrollHeight + 2, Math.round(window.innerHeight * 0.5))}px`; };
    ta.addEventListener('input', fit);
    // The caret goes to the end: the first letter typed must not wipe the translation.
    cell.innerHTML = ''; cell.appendChild(ta); fit(); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
    let cancelled = false;
    const save = (): void => {
      if (!cancelled && ta.value !== (entryOf(u)?.target ?? '')) {
        // a change of the cell is an action of the journal: Ctrl+Z takes it back (an overwritten draft is not lost)
        const next = edit(entryOf(u), u, ta.value, ctx.stage(), Date.now());
        ctx.commit([{ file: s.current!, key, next, text: next.target }], 'edit');
        ctx.persist(); ctx.softTm();
      }
    };
    const finish = () => { save(); rowChanged(key); };
    ta.addEventListener('blur', finish, { once: true });
    ta.addEventListener('keydown', e => {
      if (e.key === 'Escape') { cancelled = true; e.preventDefault(); ta.blur(); }
      // Enter and Tab keep the translation and carry on in the next row's cell (Shift+Enter writes a line break, Shift+Tab goes back).
      else if ((e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) || (e.key === 'Tab' && !e.ctrlKey && !e.altKey)) {
        e.preventDefault(); ta.removeEventListener('blur', finish); save();
        const list = visibleUnits(true, false), at = list.findIndex(x => x.key === key);
        const next = list[at + (e.key === 'Tab' && e.shiftKey ? -1 : 1)];
        rowChanged(key);
        if (next) { reveal('grid', next.key); selectRowLight(next.key); }
        startInline(next?.key ?? key);
      }
      else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); ta.removeEventListener('blur', finish); const ents = ctx.entries(s.current!); ents[key] = edit(ents[key], u, ta.value, 'translate', Date.now()); const r = submit(ents[key], u, 'translate', Date.now(), { blockErrors: s.saved.settings.blockErrors, qa: qaOpts() }); if (r.ok) { afterSendFollowUp(ctx, u, ctx.commit([{ file: s.current!, key, next: r.entry, text: r.entry.target }], 'send'), Date.now()); } else toast(r.reason, { sticky: true }); ctx.persist(); ctx.invalidateTm();
        // «send and go on»: the next row's cell is opened (the row that was sent may leave a filtered list)
        const list = visibleUnits(true, false), at = list.findIndex(x => x.key === key), go = r.ok ? list[at + 1] : undefined;
        renderAll();
        if (go) { reveal('grid', go.key); selectRowLight(go.key); startInline(go.key); } else if (!r.ok) startInline(key);
      }
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
    if (!t.closest('#fpop,#spkbtn,#lenbtn,#sortbtn,[data-more],#bnav,#cfgpop,#cfg-btn,#projpop,#proj-btn,#brpop,#br-btn,#inboxpop,#bell,#rs-menu,#fs-menu,#sc-menu,.pop.sub')) closePops();
    if (!t.closest('#keypop,#hk')) $('#keypop').hidden = true;
    if (pagesClick(t)) return;
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
    if (!t.closest('#cfgpop,#cfg-btn')) closeCfgMenu();
    if (!t.closest('#projpop,#proj-btn')) closeProjMenu();
    if (!t.closest('#brpop,#br-btn')) closeBranchMenu();
    if (t.closest('#proj-btn')) { openProjMenu(); return; }
    if (t.closest('#br-btn')) { openBranchMenu(); return; }
    const bi = t.closest<HTMLElement>('#brpop [data-br],#brpop [data-bra]');
    if (bi) { closeBranchMenu(); branchMenuClick(branchActions, bi); return; }
    if (t.closest('#bell')) { openInbox(); return; }
    const ib = t.closest<HTMLElement>('#inboxpop [data-ib]');
    if (ib) {
      closeInbox();
      const id = ib.dataset.ib!, it = inboxItems.find(i => i.id === id);
      if (id === '~read') { inboxSeen = Date.now(); try { localStorage.setItem(SEEN_KEY, String(inboxSeen)); } catch { /* private mode */ } renderBell(); }
      else if (it?.kind === 'error') jump('error', 1);
      else if (it) openRows(it.title, it.rows);
      return;
    }
    const bs = t.closest<HTMLElement>('#cfgpop [data-bs]');
    if (bs) {
      closeCfgMenu();
      const b = stampOf(s.saved, 'build');
      if (bs.dataset.bs === 'build') runSelected(); else if (b) openRows('Змінено після збірки', builtDrift(s.saved, b.mt).rows);
      return;
    }
    const pj = t.closest<HTMLElement>('#projpop [data-pj]');
    if (pj) { closeProjMenu(); if (pj.dataset.pj === 'folder') void openFolder(); else if (pj.dataset.pj === 'files') openImportDlg(); else if (pj.dataset.pj === 'project') openProjectDlg(); else openSettingsDlg(); return; }
    if (t.closest('#cfg-btn')) { openCfgMenu(); return; }
    const cfgRun = t.closest<HTMLElement>('#cfgpop [data-cfg-run]');
    if (cfgRun) { closeCfgMenu(); runCfgNow(cfgRun.dataset.cfgRun as RunCfg); return; }
    if (t.closest('#cfgpop [data-cfg-edit]')) { closeCfgMenu(); doBuild(); return; }
    const cfgItem = t.closest<HTMLElement>('#cfgpop [data-cfg]');
    if (cfgItem) { runCfg = cfgItem.dataset.cfg as RunCfg; try { localStorage.setItem('transly.runcfg', runCfg); } catch { /* private mode */ } closeCfgMenu(); renderRunCfg(); return; }
    if (t.closest('#run-btn')) { runSelected(); return; }
    if (t.closest('#sb-adv')) { s.filters = ['adv']; renderAll(); return; }
    if (t.closest('#sb-qa')) { jump('error', 1); return; }
    if (t.closest('#sb-build')) { doBuild(); return; }
    if (t.closest('#sb-upd')) { updateNow(); return; }
    if (t.closest('#sb-sync')) { openSettingsDlg('file'); return; }
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
    if (hl) {
      const h = hl.dataset.hideLeft;
      if (h === 'glossary' || (h === 'scenes' && !s.leftBoth)) s.leftOpen = false;
      else if (h === 'scenes') { s.leftBoth = false; s.leftTab[s.mode] = 'files'; }
      else { const sc = s.leftTab[s.mode] === 'scenes' && s.leftBoth; s.leftBoth = false; s.leftTab[s.mode] = h === 'files' ? (sc ? 'scenes' : 'rows') : 'files'; }
      renderAll(); return;
    }
    const sb = t.closest<HTMLElement>('#strip [data-lp]');
    if (sb) {
      // Each button switches its own window on or off. The files can share the zone with the rows or with the scenes (the files above,
      // what is in the chosen file below); the related panel takes the whole zone.
      const want: LeftTab = (['rows', 'glossary', 'scenes'] as const).find(x => x === sb.dataset.lp) ?? 'files';
      const cur = s.leftTab[s.mode];
      const both = s.leftOpen && s.leftBoth && !s.phone && (cur === 'files' || cur === 'rows' || cur === 'scenes');
      const second: LeftTab = cur === 'scenes' ? 'scenes' : 'rows';
      const only = (x: LeftTab): void => { s.leftOpen = true; s.leftBoth = false; s.leftTab[s.mode] = x; };
      if (want === 'glossary' || cur === 'glossary' || s.phone) { if (s.leftOpen && cur === want) s.leftOpen = false; else only(want); s.leftBoth = false; }
      else if (!s.leftOpen) only(want);
      else if (both) {
        if (want === 'files') only(second);
        else if (want === second) only('files');
        else { s.leftTab[s.mode] = want === 'scenes' ? 'scenes' : 'files'; }
      }
      else if (cur === want) s.leftOpen = false;
      else if (cur === 'files') { s.leftBoth = true; s.leftTab[s.mode] = want === 'scenes' ? 'scenes' : 'files'; }
      else if (want === 'files') s.leftBoth = true;
      else only(want);
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
    if (t.closest('[data-coach-ok]')) { coachDone(); renderTree(); return; }
    if (f) { coachDone(); openFile(f.dataset.file!); if (s.phone) s.leftTab[s.mode] = 'rows'; renderAll(); return; }
    const ch = t.closest<HTMLElement>('[data-filter]');
    if (ch) {
      const f = ch.dataset.filter as Filter;
      s.filters = s.filters.includes(f) ? s.filters.filter(x => x !== f) : [...s.filters, f];
      if (s.mode !== 'table' && !ctx.visible().some(u => u.key === s.cur)) s.cur = ctx.visible()[0]?.key ?? null;
      const pop = fpop(), keep = !pop.hidden && pop.dataset.for?.startsWith('more-'), subMore = subEls.find(e => e.dataset.subof === 'rows-more');
      renderAll();
      if (subMore) { subMore.innerHTML = moreHtml(); subMore.querySelector<HTMLElement>(`[data-filter="${f}"]`)?.focus(); }
      // the popover stays open while boxes are ticked: it is redrawn with the new counts and the focus stays on the box
      if (keep) { pop.innerHTML = moreHtml(); document.getElementById(pop.dataset.for!)?.setAttribute('aria-expanded', 'true'); pop.querySelector<HTMLElement>(`[data-filter="${f}"]`)?.focus(); }
      return;
    }
    const more = t.closest<HTMLElement>('[data-more]');
    if (more) { showPop(more, moreHtml()); return; }
    const clr = t.closest<HTMLElement>('[data-clear]');
    if (clr) { closePops(); if (clr.dataset.clear === 'speaker') s.speaker = null; else s.lenFilter = 'all'; renderAll(); return; }
    if (t.closest('[data-reset]')) { closePops(); rowsSearchOpen = false; s.filters = []; s.q = ''; s.speaker = null; s.lenFilter = 'all'; renderAll(); return; }
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
    const subItem = t.closest<HTMLElement>('.pop [data-sub]');
    if (subItem) { openSub(subItem, true); return; }
    if (t.closest('#q2-x')) { closeRowsSearch(); return; }
    if (t.closest('#fq-x')) { closeWinSearch('files'); return; }
    if (t.closest('#sc-x')) { closeWinSearch('scenes'); return; }
    if (t.closest('#fs-menu')) { showPop(t.closest<HTMLElement>('#fs-menu')!, winMenuHtml('files')); return; }
    if (t.closest('#sc-menu')) { showPop(t.closest<HTMLElement>('#sc-menu')!, winMenuHtml('scenes')); return; }
    const wm = t.closest<HTMLElement>('[data-wm]');
    if (wm) {
      hidePop(fpop());
      const [w, act] = (wm.dataset.wm ?? '').split(':') as ['files' | 'scenes', string];
      if (act === 'find') openWinSearch(w);
      else if (act === 'reset') closeWinSearch(w);
      else if (act === 'hide') { s.leftOpen = false; renderAll(); }
      else if (act === 'newgroup') startNewGroup(ctx);
      return;
    }
    if (t.closest('#rs-menu')) { showPop(t.closest<HTMLElement>('#rs-menu')!, rowsMenuHtml()); return; }
    const rm = t.closest<HTMLElement>('[data-rm]');
    if (rm) {
      hidePop(fpop());
      const act = rm.dataset.rm;
      if (act === 'find') openRowsSearch();
      else if (act === 'reset') { rowsSearchOpen = false; s.filters = []; s.q = ''; s.speaker = null; s.lenFilter = 'all'; s.sort = 'order'; renderAll(); }
      else if (act === 'hide') { s.leftOpen = false; renderAll(); }
      return;
    }
    if (t.closest('#sortbtn')) { showPop(t.closest<HTMLElement>('#sortbtn')!, sortMenuHtml()); return; }
    const so = t.closest<HTMLElement>('[data-sort]');
    if (so) { s.sort = so.dataset.sort as SortMode; closePops(); renderAll(); return; }
    if (t.closest('#lenbtn')) { showPop(t.closest<HTMLElement>('#lenbtn')!, `<div class="group">Довжина відносно оригіналу</div>${(Object.keys(LEN_LABEL) as (keyof typeof LEN_LABEL)[]).map(k => `<button data-len="${k}">${LEN_LABEL[k]}</button>`).join('')}`); return; }
    const ln = t.closest<HTMLElement>('[data-len]');
    if (ln) { s.lenFilter = ln.dataset.len as typeof s.lenFilter; closePops(); renderAll(); return; }
    if (t.closest('#bb-ok')) { bulkSend(); return; }
    if (t.closest('#bb-appr')) { bulkApprove(); return; }
    if (t.closest('#bb-tm')) { void bulkTm(); return; }
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

  $('#fq').addEventListener('input', e => { fileQ = (e.target as HTMLInputElement).value; renderTree(); syncRowsSearch(); });
  // The tab strip scrolls sideways with the wheel and with a faint thumb drawn over its top edge (no scrollbar row of its own).
  {
    const host = $('#tabs-host'), bar = host.parentElement!;
    const track = el('div', 'tabs-track'), thumb = el('i', 'tabs-thumb');
    track.appendChild(thumb); bar.appendChild(track);
    const sync = (): void => {
      const over = host.scrollWidth - host.clientWidth;
      track.hidden = over <= 1;
      // the tabs fade out at the edge that has more of them behind it
      host.classList.toggle('fade-l', over > 1 && host.scrollLeft > 1);
      host.classList.toggle('fade-r', over > 1 && host.scrollLeft < over - 1);
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
  // leaving the editor field: what was typed there is one action of the journal
  root.addEventListener('focusout', e => { const t = e.target as HTMLElement; if (t instanceof HTMLTextAreaElement && t.id === 'i-tr') closeTyping(ctx); });
  // the search field of a window goes back to the title when it is left empty (a click elsewhere, Tab); with a typed query it stays
  root.addEventListener('focusout', e => {
    const t = e.target as HTMLElement, to = (e as FocusEvent).relatedTarget as HTMLElement | null;
    const w: SearchWin | null = t.id === 'q2' ? 'rows' : t.id === 'fq' ? 'files' : t.id === 'sc-q' ? 'scenes' : null;
    if (!w || winQuery(w) !== '' || !(w === 'rows' ? rowsSearchOpen : winSearchOpen[w]) || !document.hasFocus() || to?.closest('.hq')) return;
    if (w === 'rows') rowsSearchOpen = false; else winSearchOpen[w] = false;
    syncRowsSearch();
  });
  root.addEventListener('focusin', e => {
    const t = e.target as HTMLElement;
    if (t instanceof HTMLTextAreaElement) sceneFocus(ctx, t, () => { renderSidePanel(ctx); renderStatus(); saveUi(); });
  });
  root.addEventListener('input', e => {
    const t = e.target as HTMLElement;
    if (t instanceof HTMLTextAreaElement && t.id === 'i-tr') { focusInput(ctx, t); renderStatus(); const u = ctx.unit(t.dataset.key ?? ''); if (u && s.current) announceQa(ctx, t, u, ctx.entries(s.current)[u.key]); return; }
    if (t instanceof HTMLTextAreaElement && sceneInput(ctx, t)) { const u = ctx.unit(t.dataset.key ?? ''); if (u && s.current) announceQa(ctx, t, u, ctx.entries(s.current)[u.key]); renderStatus(); window.clearTimeout(scenePanelTimer); scenePanelTimer = window.setTimeout(() => renderSidePanel(ctx), 250); return; }
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
    else if (k === 'Tab') { e.preventDefault(); sdSection((e as KeyboardEvent).shiftKey ? -1 : 1); }
  });
  $('#sd-tabs').addEventListener('click', e => { const b = (e.target as HTMLElement).closest<HTMLElement>('[data-sdk]'); if (b) { sdKind = b.dataset.sdk ?? ''; sdRender(); $('#sd-in').focus(); } });

  let qTimer = 0;
  let lastShift = 0;
  document.addEventListener('keydown', e => {
    const t = e.target as HTMLElement;
    if (e.key === 'Escape') {
      if (!$('#sd').hidden) { closeSearch(); return; }
      if (subEls.length) { closeSubs(subEls.length - 1); return; }
      if (!$('#fpop').hidden || !$('#cfgpop').hidden || !$('#projpop').hidden || !$('#brpop').hidden || !$('#inboxpop').hidden || !$('#keypop').hidden) {
        closePops(); hidePop($('#keypop'));
        return;
      }
      if (!mdd().hidden) { const g = mbOpen; mbClose(); document.querySelector<HTMLElement>(`#menubar [data-mg="${CSS.escape(g ?? '')}"]`)?.focus(); return; }
      if (!$('#menubar').hidden) { mbToggle(false); return; }
      if (s.phone && (s.leftOpen || s.rightOpen)) { s.leftOpen = false; s.rightOpen = false; renderAll(); return; }
    }
    if (document.querySelector('dialog[open]')) return;
    // Menus, popovers, the menu bar and the file tree answer the arrows.
    const pop = t.closest<HTMLElement>('#projpop,#brpop,#cfgpop,#fpop,.pop.sub,#keypop,#mdd');
    if (pop && !pop.hidden) {
      if (e.key === 'ArrowRight' && t.closest('.pop [data-sub]')) { e.preventDefault(); openSub(t.closest<HTMLElement>('[data-sub]')!, true); return; }
      if (e.key === 'ArrowLeft' && pop.classList.contains('sub')) { e.preventDefault(); closeSubs(subEls.indexOf(pop)); return; }
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
    // Ctrl+F in a window of the left panel (or while it is the one worked in) opens its search; elsewhere it is left alone
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'f') {
      const pane = document.documentElement.dataset.pane, at = document.activeElement;
      if (ctx.view() && (pane === 'rows' || at?.closest('#lp-rows'))) { e.preventDefault(); openRowsSearch(); return; }
      if (s.views.length && (pane === 'files' || at?.closest('#tree'))) { e.preventDefault(); openWinSearch('files'); return; }
      if (ctx.view() && (pane === 'scenes' || at?.closest('#lp-sc'))) { e.preventDefault(); openWinSearch('scenes'); return; }
    }
    // Esc in the search field of the files or of the scenes: what is typed goes first, then the field closes and the focus goes back to the list
    if (e.key === 'Escape' && (document.activeElement?.id === 'fq' || document.activeElement?.id === 'sc-q')) {
      e.preventDefault(); e.stopPropagation();
      const w = document.activeElement.id === 'fq' ? 'files' : 'scenes', box = document.activeElement as HTMLInputElement;
      if (box.value !== '') { winSearchOpen[w] = true; if (w === 'files') { fileQ = ''; renderTree(); } else setSceneQuery(ctx, ''); syncRowsSearch(); box.focus(); return; }
      closeWinSearch(w);
      document.querySelector<HTMLElement>(w === 'files' ? '#tree-list .node.cur, #tree-list .node' : '#sc-list .sc-item.cur, #sc-list .sc-item')?.focus();
      return;
    }
    // Esc in the search field of the rows window: what is typed goes first, then the field closes and the focus goes back to the list
    if (e.key === 'Escape' && document.activeElement?.id === 'q2') {
      e.preventDefault(); e.stopPropagation();
      const had = (document.activeElement as HTMLInputElement).value !== '';
      if (had) { rowsSearchOpen = true; s.q = ''; renderAll(); ($('#q2') as HTMLInputElement).focus(); return; }
      closeRowsSearch();
      document.querySelector<HTMLElement>('#slist .si.sel, #slist .si')?.focus();
      return;
    }
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
    // A name, a choice or a glossary term is one line in the game: Enter there sends the row instead of putting a line break into it
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey && !e.isComposing && t.id === 'i-tr') { const u1 = ctx.unit((t as HTMLTextAreaElement).dataset.key ?? ''); if (u1 && (u1.kind === 'name' || u1.kind === 'choice' || u1.kind === 'term')) { e.preventDefault(); send(ctx); return; } }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && t.classList.contains('sv-in')) { e.preventDefault(); s.cur = t.dataset.key ?? s.cur; send(ctx); return; }
    if (s.mode === 'table' && t.classList.contains('gr')) {
      const list = visibleUnits(true, false);
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
    // a cell that is being written in is committed first: its text is saved with the rest
    document.querySelector<HTMLTextAreaElement>('textarea.cell-ed')?.blur();
    autosave.rescueNow(); void autosave.flush();
    if (autosave.failures > 0 && autosave.unsaved) { e.preventDefault(); e.returnValue = ''; }
  });
  addEventListener('pagehide', () => { document.querySelector<HTMLTextAreaElement>('textarea.cell-ed')?.blur(); autosave.rescueNow(); void autosave.flush(); });
  setTimeout(() => void autoCheck(), 4000);
  // The Android app goes to the background without unloading the page: save what was typed.
  document.addEventListener('visibilitychange', () => { if (document.hidden) { document.querySelector<HTMLTextAreaElement>('textarea.cell-ed')?.blur(); autosave.rescueNow(); void autosave.flush(); } });
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
      s.filters = []; s.q = ''; s.speaker = null; s.lenFilter = 'all';
      if (!ctx.unit(key)) { renderAll(); return; }
      ctx.select(key, s.mode === 'table' ? 'edit' : s.mode);
    } else if (tries < 40) setTimeout(() => openRow(file, key, tries + 1), 250);
  }
  Object.assign(window, { __back: backStep, __flush: () => autosave.flush(), __open: (file: string, key: string) => openRow(file, key) });
  if (s.current) { unitMap = new Map((ctx.view()?.units ?? []).map(u => [u.key, u])); if (s.mode !== 'table') s.cur = ctx.visible()[0]?.key ?? null; }
  restoreUi();
  trackActivePane();
  overlayScrollbars();
  wireDiscuss(ctx);
  wireLinks(ctx);
  wireRowsChip(ctx);
  wirePages({ render: renderRowsList, list: () => document.getElementById('slist'), bubble: () => document.getElementById('pgb') });
  wireTermCard(ctx, {
    insert: text => insertText(ctx, text),
    goto: (file, key) => openRow(file, key),
    remark: (button, key) => { s.cur = key; qaClick(ctx, button); },
    edit: en => { s.leftOpen = true; s.leftBoth = false; s.leftTab[s.mode] = 'glossary'; renderAll(); editTerm(ctx, en); },
  });
  wireGlossary(ctx);
  // a proposal of a new construction opens the form of «Пов’язане» with the pattern filled in. Once the proposals (or the index of the words) are found, only what shows them is drawn again.
  const redrawThreads = (): void => {
    if (lp() === 'glossary') renderGlossaryPanel(ctx);
    if (s.mode === 'edit') { const u = s.cur ? ctx.unit(s.cur) : undefined; if (u) renderStrands(ctx, u, ($('#i-tr') as HTMLTextAreaElement).value); }
    else renderSidePanel(ctx);
  };
  wireStrands(redrawThreads);
  wireMine((en, uk) => { s.leftOpen = true; s.leftBoth = false; s.leftTab[s.mode] = 'glossary'; renderAll(); newTerm(ctx, en, uk); }, redrawThreads);
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
