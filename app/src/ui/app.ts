import { Autosave, DupIndex, isRpgMakerFile, build, check, edit, emptyProject, note, propagate, readGame, reconcile, snapshotOf, sourceChanged, statsOf, submit, viewsFromSnapshot } from '../core';
import type { Entry, GameFile, SavedProject, Status, Unit } from '../core';
import { $, el, esc, plural, toast } from './dom';
import { STATUS_LABEL, onEditorClick, setGlossQuery, onEditorInput, onEditorSubmit, renderEditor, send, step } from './edit';
import { applyToGame, dataDirOf, isDesktop, launchGame, pickExe, rememberedExe, rememberedGameDir, reopenGameDirDesktop, restoreGame } from './desktop';
import { canWriteFolder, downloadZip, writeToFolder } from './export';
import { pickGameFolder, readFiles, reopenHandle } from './folder';
import type { DirHandle, PickedFile } from './folder';
import { IdbStore, loadHandle, saveHandle } from './idb';
import { openSettings } from './settings';
import { describe as describeSync, loadSyncConfig, runSync, syncConfigured } from './sync';

import { buildTm } from './state';
import type { Ctx, Filter, Mode, State } from './state';

const FILTERS: [Filter, string][] = [['all', 'Усі'], ['new', 'Без перекладу'], ['draft', 'Чернетки'], ['done', 'Очікують вичитування'], ['appr', 'Вичитані'], ['qa', 'Проблеми']];
const MODES: [Mode, string][] = [['table', 'Таблиця'], ['edit', 'Редагування'], ['review', 'Вичитування']];

export async function start(root: HTMLElement): Promise<void> {
  const store = new IdbStore('default');
  let saved: SavedProject;
  try { saved = (await store.load()) ?? emptyProject('Новий проєкт'); }
  catch { saved = emptyProject('Новий проєкт'); }
  const s: State = { views: [], game: [], saved, current: null, cur: null, mode: 'table', filter: 'all', q: '', sideTab: 'hints', saveOk: true, who: saved.settings.who, phone: false, drawer: null, leftTab: 'files' };
  const mq = matchMedia('(max-width: 760px)');
  s.phone = mq.matches;
  if (s.phone) s.mode = 'edit';
  const fromSnapshot = viewsFromSnapshot(saved);
  if (fromSnapshot.length) { s.views = fromSnapshot; s.current = fromSnapshot[0]!.name; }
  let lastHandle: (DirHandle & { name: string }) | null = null;
  let dataDir: string | null = null;
  const desktopDir = isDesktop() ? rememberedGameDir() : null;
  try { lastHandle = (await loadHandle('default')) as typeof lastHandle; } catch { lastHandle = null; }
  const autosave = new Autosave(store, 400, ok => { s.saveOk = ok; renderSave(); });
  let tmCache: ReturnType<typeof buildTm> | null = null;
  let unitMap = new Map<string, Unit>();
  let dupCache: { views: State['views']; idx: DupIndex } | null = null;

  const input = el('input');
  input.type = 'file'; input.hidden = true; input.id = 'folder-input';
  input.setAttribute('webkitdirectory', ''); input.setAttribute('aria-label', 'Папка гри');

  root.innerHTML = `
    <header class="top"><button class="btn icon phone-only" id="btn-left" aria-label="Файли й рядки" aria-expanded="false">☰</button><div class="logo" aria-hidden="true">T</div><b class="brand">Transly</b><span class="ptitle phone-only" id="ptitle"></span><span class="grow"></span>
      <div class="seg" role="group" aria-label="Режим">${MODES.map(([m, l]) => `<button data-mode="${m}" aria-pressed="${m === 'table'}">${l}</button>`).join('')}</div>
      <span class="save" id="save" role="status"></span>
      <button class="btn icon phone-only" id="btn-side" aria-label="Вказівки, глосарій, коментарі" aria-expanded="false">▤</button>
      <button class="btn" id="settings" aria-label="Налаштування"><span class="lbl-d">Налаштування</span><span class="phone-only">⚙</span></button>
      <button class="btn" id="build" disabled>Зібрати…</button>
      <button class="btn p" id="open">Відкрити папку гри</button></header>
    <div class="main"><aside class="panel tree" aria-label="Файли"><div class="phd">Файли гри</div><div class="files" id="files"></div></aside>
      <main class="panel table" id="table"></main></div><div class="scrim" id="scrim"></div>`;
  root.appendChild(input);

  const qaOpts = () => ({ tolerancePct: s.saved.settings.tolerancePct, terms: s.saved.terms.map(t => ({ en: t.en, uk: t.uk })) });

  const ctx: Ctx = {
    s, autosave,
    entries: file => (s.saved.files[file] ??= {}),
    qaOpts,
    view: () => s.views.find(v => v.name === s.current) ?? null,
    unit: key => unitMap.get(key),
    visible: () => { const v = ctx.view(); if (!v) return []; const ents = ctx.entries(v.name); return v.units.filter(u => matches(u, ents[u.key])); },
    tm: () => (tmCache ??= buildTm(s)),
    invalidateTm: () => { tmCache = null; },
    dups: () => { if (!dupCache || dupCache.views !== s.views) dupCache = { views: s.views, idx: new DupIndex(s.views) }; return dupCache.idx; },
    persist: () => autosave.queue(s.saved),
    render: () => renderAll(),
    select: (key, mode) => {
      s.cur = key;
      if (mode) setMode(mode, false);
      renderAll();
      document.querySelector<HTMLElement>(s.mode === 'table' ? `.row[data-key="${CSS.escape(key)}"]` : '#ed-tr')?.scrollIntoView({ block: 'nearest' });
      if (s.mode !== 'table') $('#ed-tr').focus();
    },
  };

  function matches(u: Unit, e: Entry | undefined): boolean {
    if (s.q) {
      const q = s.q.toLowerCase();
      if (!(u.source + ' ' + (e?.target ?? '') + ' ' + u.key + ' ' + u.speaker).toLowerCase().includes(q)) return false;
    }
    const st: Status = e?.status ?? 'new';
    switch (s.filter) {
      case 'new': return st === 'new';
      case 'draft': return st === 'draft';
      case 'done': return st === 'done';
      case 'appr': return st === 'appr';
      case 'qa': return !!e && check(u, e.target, qaOpts()).length > 0;
      default: return true;
    }
  }

  function renderSave(): void {
    const e = $('#save');
    e.textContent = s.saveOk ? 'Збережено' : 'Не збережено: повторю спробу';
    e.classList.toggle('bad', !s.saveOk);
  }

  function rowsListHtml(): string {
    const v = ctx.view();
    if (!v) return '<div class="empty">Спершу відкрийте файл</div>';
    const ents = ctx.entries(v.name);
    const filters = `<div class="filters">${FILTERS.map(([f, l]) => `<button class="chip" data-filter="${f}" aria-pressed="${s.filter === f}">${l}</button>`).join('')}<input id="q" type="search" placeholder="Пошук рядків" aria-label="Пошук рядків" value="${esc(s.q)}"></div>`;
    const items = ctx.visible().map(u => {
      const e = ents[u.key], st = e?.status ?? 'new';
      return `<button class="si ${u.key === s.cur ? 'sel' : ''}" data-pick="${esc(u.key)}"><span class="dot ${st}" role="img" aria-label="${STATUS_LABEL[st]}"></span><span class="sib"><span class="sia">${esc(u.speaker || u.kind)}</span><span class="sis">${esc(u.source)}</span><span class="sit">${esc(e?.target || '—')}</span></span></button>`;
    });
    return filters + (items.join('') || '<div class="empty">Нічого не знайдено</div>');
  }

  function renderTree(): void {
    const box = $('#files');
    if (s.phone) {
      const tabs = `<div class="ltabs" role="group" aria-label="Бічна панель"><button data-ltab="files" aria-pressed="${s.leftTab === 'files'}">Файли</button><button data-ltab="rows" aria-pressed="${s.leftTab === 'rows'}">Рядки</button></div>`;
      if (s.leftTab === 'rows') { box.innerHTML = tabs + rowsListHtml(); return; }
      box.dataset.tabs = tabs;
    }
    if (!s.views.length) { box.innerHTML = '<div class="empty">Папку гри ще не відкрито</div>'; return; }
    const list = s.views.map(v => {
      const st = statsOf(v.units, s.saved.files[v.name] ?? {});
      const pct = Math.round((st.translated / st.total) * 100);
      return `<button class="file" data-file="${esc(v.name)}" aria-current="${v.name === s.current}"><span class="nm">${esc(v.name)}</span><span class="mini ${pct === 100 ? 'full' : ''}" aria-hidden="true"><i style="width:${pct}%"></i></span><span class="pc">${pct}%</span></button>`;
    }).join('');
    box.innerHTML = (s.phone ? box.dataset.tabs ?? '' : '') + list;
  }

  function qaHtml(u: Unit, e: Entry | undefined): string {
    if (!e || !e.target) return '';
    const changed = sourceChanged(e, u) ? `<div class="qa warn">Оригінал змінено в грі: було «${esc(e.src ?? '')}»</div>` : '';
    return changed + check(u, e.target, qaOpts()).map(i => `<div class="qa ${i.severity}">${esc(i.message)}</div>`).join('');
  }

  function rowHtml(u: Unit, n: number, e: Entry | undefined): string {
    const st = e?.status ?? 'new';
    return `<div class="row ${u.key === s.cur ? 'sel' : ''}" data-key="${esc(u.key)}"><div class="n">${n}</div><div class="who">${esc(u.speaker)}</div><div class="src">${esc(u.source)}</div>
      <div class="trc"><textarea rows="${Math.max(2, u.source.split('\n').length)}" aria-label="Переклад рядка ${n}" data-key="${esc(u.key)}">${esc(e?.target ?? '')}</textarea><div class="qas">${qaHtml(u, e)}</div></div>
      <div class="st"><span class="dot ${st}" title="${STATUS_LABEL[st]}" role="img" aria-label="${STATUS_LABEL[st]}"></span><button class="ib sm" data-open="${esc(u.key)}" aria-label="Відкрити рядок ${n} у редагуванні" title="Відкрити в редагуванні">↗</button></div></div>`;
  }

  function renderMain(): void {
    const box = $('#table');
    const v = ctx.view();
    if (!v) {
      box.innerHTML = s.views.length
        ? '<div class="empty"><h2>Оберіть файл</h2>Файл зліва відкриє його рядки.</div>'
        : `<div class="empty"><h2>Відкрийте папку гри</h2>${s.phone ? 'На телефоні проєкт береться з комп’ютера: на ПК відкрийте «Налаштування → Обмін проєктом → Зберегти проєкт у файл», а тут імпортуйте цей файл у «Налаштування → Обмін проєктом».' : 'Оберіть папку <b>data</b> гри на RPG Maker (або саму папку гри), папку з файлами <b>.po</b>, <b>.csv</b>, <b>.rpy</b> (Ren’Py) чи JSON-локалізацією. Ваш переклад зберігається в цьому браузері, файли гри не змінюються.'}${lastHandle || desktopDir ? `<p><button class="btn p" id="resume">Продовжити з папкою «${esc(lastHandle?.name ?? (desktopDir ?? '').split(/[\\/]/).filter(Boolean).pop() ?? '')}»</button></p>` : ''}</div>`;
      return;
    }
    const filters = `<div class="filters">${FILTERS.map(([f, l]) => `<button class="chip" data-filter="${f}" aria-pressed="${s.filter === f}">${l}</button>`).join('')}
        <input id="q" type="search" placeholder="Пошук у файлі" aria-label="Пошук у файлі" value="${esc(s.q)}"></div>`;
    if (s.mode === 'table' && !s.phone) {
      const ents = ctx.entries(v.name);
      const rows: string[] = [];
      v.units.forEach((u, i) => { if (matches(u, ents[u.key])) rows.push(rowHtml(u, i + 1, ents[u.key])); });
      box.innerHTML = `<div class="phd">${esc(v.name)} · ${plural(v.units.length, ['рядок', 'рядки', 'рядків'])}</div>${filters}<div class="scroll" id="scroll">${rows.join('') || '<div class="empty">Нічого не знайдено</div>'}</div>`;
    } else {
      box.innerHTML = `<div class="phd">${esc(v.name)} · ${s.mode === 'review' ? 'вичитування' : 'редагування'}</div>${s.phone ? '' : filters}<div class="scroll" id="edhost"></div>`;
      renderEditor(ctx, $('#edhost'));
    }
  }

  function renderAll(): void {
    root.dataset.phone = String(s.phone);
    root.dataset.drawer = s.drawer ?? '';
    $('#btn-left').setAttribute('aria-expanded', String(s.drawer === 'left'));
    $('#btn-side').setAttribute('aria-expanded', String(s.drawer === 'right'));
    $('#ptitle').textContent = s.current ?? 'Transly';
    root.querySelectorAll<HTMLElement>('[data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === s.mode)));
    renderTree(); renderMain(); renderSave();
    ($('#build') as HTMLButtonElement).disabled = !s.views.length;
    ($('#build') as HTMLButtonElement).title = s.game.length ? '' : 'Для збірки відкрийте папку гри';
  }

  function setMode(m: Mode, rerender = true): void {
    if (s.phone && m === 'table') m = 'edit';
    if (m === s.mode) return;
    const wasReview = s.mode === 'review';
    s.mode = m;
    if (m === 'review') s.filter = 'done'; else if (wasReview && s.filter === 'done') s.filter = 'all';
    if (m !== 'table' && !ctx.visible().some(u => u.key === s.cur)) s.cur = ctx.visible()[0]?.key ?? null;
    if (rerender) { renderAll(); if (m !== 'table' && s.cur) $('#ed-tr').focus(); }
    else if (m !== 'table' && !s.cur) renderAll();
  }

  function selectFile(name: string): void {
    s.current = name; s.q = ''; s.filter = s.mode === 'review' ? 'done' : 'all';
    unitMap = new Map((ctx.view()?.units ?? []).map(u => [u.key, u]));
    s.cur = s.mode === 'table' ? null : ctx.visible()[0]?.key ?? null;
  }

  function updateRow(row: HTMLElement, u: Unit, e: Entry | undefined): void {
    const st = e?.status ?? 'new';
    const dot = $('.dot', row);
    dot.className = `dot ${st}`; dot.title = STATUS_LABEL[st]; dot.setAttribute('aria-label', STATUS_LABEL[st]);
    $('.qas', row).innerHTML = qaHtml(u, e);
  }

  /** Take over a merged/imported/synced project: pick up its snapshot when this device has no files yet. */
  function adopt(): void {
    if (!s.views.length) { s.views = viewsFromSnapshot(s.saved); if (s.views[0]) selectFile(s.views[0].name); }
    else if (s.current) unitMap = new Map((ctx.view()?.units ?? []).map(u => [u.key, u]));
    s.who = s.saved.settings.who; tmCache = null; ctx.persist(); renderAll();
  }

  async function loadFiles(picked: PickedFile[]): Promise<void> {
    if (!picked.length) { toast('У вибраній папці немає файлів, які я вмію перекладати (RPG Maker JSON, .po, .csv, .rpy)'); return; }
    $('#table').innerHTML = '<div class="empty"><h2>Читаю файли гри…</h2><div class="progress"><i id="bar"></i></div><span id="pct"></span></div>';
    const { files, failed } = await readFiles(picked, (d, t) => { $('#bar').style.width = `${(d / t) * 100}%`; $('#pct').textContent = `${d} з ${t}`; });
    const game: GameFile[] = files;
    s.game = game; s.views = readGame(game); tmCache = null;
    dataDir = isDesktop() ? dataDirOf(picked) : null;
    const snap = snapshotOf(s.views);
    // Bump the revision only when the game's strings really changed, so other devices re-download them only then.
    if (JSON.stringify(snap) !== JSON.stringify(s.saved.snapshot ?? null)) { s.saved.assetsRev = Date.now(); s.saved.snapshot = snap; }
    if (!s.views.length) { s.current = null; renderAll(); toast('У цих файлах немає тексту для перекладу'); return; }
    if (failed.length) toast(`Не вдалося прочитати файлів: ${failed.length}`);
    // Originals may have changed in the game since the translation was written: send those units back to draft.
    let changed = 0;
    for (const v of s.views) { const ents = s.saved.files[v.name]; if (ents) changed += reconcile(v.units, ents, Date.now()).length; }
    if (changed) { toast(`Оригінал змінився в ${plural(changed, ['рядку', 'рядках', 'рядках'])}: їх повернуто в чернетки`); ctx.persist(); }
    selectFile(s.current && s.views.some(v => v.name === s.current) ? s.current : s.views[0]!.name);
    ctx.persist();
    renderAll();
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

  function openBuild(): void {
    if (!s.game.length) { toast('Для збірки відкрийте папку гри: вона потрібна лише тут'); return; }
    const desk = isDesktop() && !!dataDir && s.game.every(f => isRpgMakerFile(f.name));
    const dlg = el('dialog', 'dlg');
    dlg.setAttribute('aria-labelledby', 'bd-t');
    dlg.innerHTML = `<form method="dialog"><h2 id="bd-t">Збірка</h2>
      <p class="hint">Записує перекладені рядки в копії файлів гри. Оригінальні файли не змінюються: оберіть окрему папку або завантажте ZIP з папкою <b>data</b>.</p>
      <label class="chk"><input type="checkbox" id="bd-appr"> Лише вичитані рядки</label>
      <label class="chk"><input type="checkbox" id="bd-block" checked> Не брати рядки з помилкою QA</label>
      <p id="bd-sum" class="sum" role="status"></p>
      ${desk ? `<div class="gamebox"><div class="sh">Перевірка в грі</div><p class="hint">Переклад записується прямо в папку даних гри (${esc(dataDir ?? '')}). Оригінали зберігаються поруч, у папці з суфіксом «.transly-orig», і повертаються кнопкою нижче.</p>
        <p class="hint" id="bd-exe">${rememberedExe() ? 'Файл гри: ' + esc(rememberedExe() ?? '') : 'Файл гри ще не вибрано'}</p>
        <div class="acts l"><button class="btn p" id="bd-play" type="button">Застосувати й запустити гру</button><button class="btn" id="bd-apply" type="button">Лише застосувати</button><button class="btn" id="bd-restore" type="button">Повернути оригінали</button><button class="btn" id="bd-pickexe" type="button">Обрати файл гри…</button></div></div>` : ''}
      <div class="acts"><button class="btn" value="cancel">Закрити</button>
        ${canWriteFolder() && !desk ? '<button class="btn p" id="bd-dir" type="button">Зібрати в папку…</button>' : ''}
        <button class="btn ${canWriteFolder() && !desk ? '' : desk ? '' : 'p'}" id="bd-zip" type="button">Завантажити ZIP</button></div></form>`;
    document.body.appendChild(dlg);
    const run = () => build(s.game, s.views, s.saved, { onlyApproved: ($('#bd-appr', dlg) as HTMLInputElement).checked, blockErrors: ($('#bd-block', dlg) as HTMLInputElement).checked, qa: qaOpts() });
    const sum = () => {
      const r = run();
      $('#bd-sum', dlg).textContent = r.included
        ? `У збірку потрапить ${plural(r.included, ['рядок', 'рядки', 'рядків'])} у ${plural(r.files.length, ['файлі', 'файлах', 'файлах'])}. Пропущено: ${r.skipped}${r.blocked.length ? ` (з них через помилки QA: ${r.blocked.length})` : ''}.`
        : 'У збірку поки нічого не потрапить: немає надісланих на вичитування чи вичитаних рядків.';
      dlg.querySelectorAll<HTMLButtonElement>('#bd-dir,#bd-zip,#bd-play,#bd-apply').forEach(b => { b.disabled = !r.included; });
    };
    dlg.addEventListener('change', sum);
    dlg.addEventListener('close', () => dlg.remove());
    dlg.addEventListener('click', async e => {
      const t = e.target as HTMLElement;
      try {
        if (t.id === 'bd-zip') { if (await downloadZip(run())) { toast('ZIP збережено'); dlg.close(); } }
        else if (t.id === 'bd-dir') { if (await writeToFolder(run())) { toast('Збірку записано в папку'); dlg.close(); } }
        else if (t.id === 'bd-apply' || t.id === 'bd-play') {
          const n = await applyToGame(dataDir!, run().files);
          toast(`Записано файлів у гру: ${n}`);
          if (t.id === 'bd-play') { await launchGame(); toast('Гру запущено'); }
          dlg.close();
        } else if (t.id === 'bd-restore') { toast(`Повернуто оригінальних файлів: ${await restoreGame(dataDir!)}`); }
        else if (t.id === 'bd-pickexe') { const e = await pickExe(); if (e) $('#bd-exe', dlg).textContent = 'Файл гри: ' + e; }
      } catch (err) { toast('Не вдалося записати: ' + (err instanceof Error ? err.message : String(err))); }
    });
    sum();
    dlg.showModal();
  }

  root.addEventListener('click', e => {
    const t = e.target as HTMLElement;
    if (t.closest('#open')) { void openFolder(); return; }
    if (t.closest('#resume')) { void resume(); return; }
    if (t.closest('#btn-left')) { s.drawer = s.drawer === 'left' ? null : 'left'; renderAll(); return; }
    if (t.closest('#btn-side')) { s.drawer = s.drawer === 'right' ? null : 'right'; renderAll(); return; }
    if (t.closest('#scrim')) { s.drawer = null; renderAll(); return; }
    const lt = t.closest<HTMLElement>('[data-ltab]');
    if (lt) { s.leftTab = lt.dataset.ltab === 'rows' ? 'rows' : 'files'; renderAll(); return; }
    const pick = t.closest<HTMLElement>('[data-pick]');
    if (pick) { s.drawer = null; ctx.select(pick.dataset.pick ?? ''); return; }
    if (t.closest('#settings')) { openSettings(ctx, () => { s.views.forEach(v => { s.saved.files[v.name] = {}; }); renderAll(); ctx.persist(); }, adopt); return; }
    if (t.closest('#build')) { openBuild(); return; }
    const m = t.closest<HTMLElement>('[data-mode]');
    if (m) { setMode(m.dataset.mode as Mode); return; }
    const f = t.closest<HTMLElement>('[data-file]');
    if (f) { selectFile(f.dataset.file ?? ''); if (s.phone) s.leftTab = 'rows'; renderAll(); return; }
    const ch = t.closest<HTMLElement>('[data-filter]');
    if (ch) { s.filter = ch.dataset.filter as Filter; if (s.mode !== 'table' && !ctx.visible().some(u => u.key === s.cur)) s.cur = ctx.visible()[0]?.key ?? null; renderAll(); return; }
    const op = t.closest<HTMLElement>('[data-open]');
    if (op) { ctx.select(op.dataset.open ?? '', 'edit'); return; }
    if (s.mode !== 'table') { if (onEditorClick(ctx, t)) return; }
    const row = t.closest<HTMLElement>('.row');
    if (row && s.mode === 'table' && row.dataset.key !== s.cur) {
      document.querySelector('.row.sel')?.classList.remove('sel');
      row.classList.add('sel'); s.cur = row.dataset.key ?? null;
    }
  });

  root.addEventListener('dblclick', e => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('.row');
    if (row && !(e.target instanceof HTMLTextAreaElement) && s.mode === 'table') ctx.select(row.dataset.key ?? '', 'edit');
  });

  root.addEventListener('submit', e => {
    e.preventDefault();
    if (onEditorSubmit(ctx, e.target as HTMLFormElement)) (e.target as HTMLFormElement).reset();
  });

  root.addEventListener('input', e => {
    const t = e.target as HTMLElement;
    if (t instanceof HTMLTextAreaElement && t.dataset.key) {
      if (t.id === 'ed-tr') { onEditorInput(ctx, t); return; }
      const u = ctx.unit(t.dataset.key);
      if (!u || !s.current) return;
      const ents = ctx.entries(s.current);
      ents[u.key] = edit(ents[u.key], u, t.value, 'translate', Date.now());
      s.cur = u.key;
      updateRow(t.closest<HTMLElement>('.row')!, u, ents[u.key]);
      ctx.persist(); ctx.invalidateTm();
    } else if (t.id === 'gl-q') {
      setGlossQuery((t as HTMLInputElement).value);
      const pos = (t as HTMLInputElement).selectionStart ?? 0;
      renderMain();
      const g = $('#gl-q') as HTMLInputElement;
      g.focus(); g.setSelectionRange(pos, pos);
    } else if (t.id === 'q') {
      s.q = (t as HTMLInputElement).value;
      const pos = (t as HTMLInputElement).selectionStart ?? s.q.length;
      if (s.phone) renderTree(); else renderMain();
      const q = $('#q') as HTMLInputElement;
      q.focus(); q.setSelectionRange(pos, pos);
    }
  });

  root.addEventListener('keydown', e => {
    const t = e.target as HTMLElement;
    if (!(t instanceof HTMLTextAreaElement) || !t.dataset.key || !(e.key === 'Enter' && (e.ctrlKey || e.metaKey))) return;
    e.preventDefault();
    if (t.id === 'ed-tr') { send(ctx); return; }
    const u = ctx.unit(t.dataset.key);
    if (!u || !s.current) return;
    const ents = ctx.entries(s.current);
    const r = submit(ents[u.key], u, 'translate', Date.now(), { blockErrors: s.saved.settings.blockErrors, qa: qaOpts() });
    if (!r.ok) { toast(r.reason); return; }
    ents[u.key] = note(r.entry, 'надіслано на вичитування', r.entry.target, s.who, Date.now());
    updateRow(t.closest<HTMLElement>('.row')!, u, ents[u.key]);
    const same = s.saved.settings.propagate ? propagate(s.saved, ctx.dups(), s.current, u, ents[u.key]!, 'translate', Date.now(), s.who) : 0;
    renderTree(); ctx.persist(); ctx.invalidateTm();
    if (same) { toast(`Також підставлено в ${plural(same, ['однаковий рядок', 'однакові рядки', 'однакових рядків'])}`); renderMain(); }
    const next = t.closest('.row')?.nextElementSibling?.querySelector('textarea');
    if (next instanceof HTMLTextAreaElement) next.focus();
    toast('Надіслано на вичитування');
  });

  // Document-level so the shortcut still works after a re-render dropped focus to <body>.
  document.addEventListener('keydown', e => {
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && s.mode !== 'table' && !document.querySelector('dialog[open]')) { e.preventDefault(); step(ctx, e.key === 'ArrowDown' ? 1 : -1); }
  });

  if (s.current) unitMap = new Map((ctx.view()?.units ?? []).map(u => [u.key, u]));

  // Background sync on the chosen interval; failures are shown, never silent.
  setInterval(() => {
    const cfg = loadSyncConfig();
    if (!cfg.everyMin || !syncConfigured(cfg) || document.querySelector('dialog[open]')) return;
    if (Date.now() - cfg.last < cfg.everyMin * 60_000) return;
    runSync(ctx, cfg, adopt).then(r => toast(describeSync(r)), e => toast(e instanceof Error ? e.message : 'Не вдалося синхронізувати'));
  }, 60_000);

  mq.addEventListener('change', () => {
    s.phone = mq.matches; s.drawer = null;
    if (s.phone && s.mode === 'table') setMode('edit', false);
    renderAll();
  });

  addEventListener('beforeunload', () => { void autosave.flush(); });
  renderAll();
}
