import { Autosave, check, edit, emptyProject, readGame, statsOf, submit } from '../core';
import type { Entry, FileView, GameFile, SavedProject, Stage, Status, Unit } from '../core';
import { $, el, esc, toast } from './dom';
import { pickGameFolder, readFiles } from './folder';
import { IdbStore } from './idb';

type Filter = 'all' | 'new' | 'draft' | 'done' | 'qa';
const STATUS_LABEL: Record<Status, string> = { new: 'Без перекладу', draft: 'Чернетка', done: 'Очікує вичитування', appr: 'Вичитано' };
const FILTERS: [Filter, string][] = [['all', 'Усі'], ['new', 'Без перекладу'], ['draft', 'Чернетки'], ['done', 'Очікують вичитування'], ['qa', 'Проблеми']];

interface State {
  views: FileView[];
  saved: SavedProject;
  current: string | null;
  stage: Stage;
  filter: Filter;
  q: string;
  saveOk: boolean;
}

export async function start(root: HTMLElement): Promise<void> {
  const store = new IdbStore('default');
  let saved: SavedProject;
  try { saved = (await store.load()) ?? emptyProject('Новий проєкт'); }
  catch { saved = emptyProject('Новий проєкт'); }
  const s: State = { views: [], saved, current: null, stage: 'translate', filter: 'all', q: '', saveOk: true };
  const autosave = new Autosave(store, 400, ok => { s.saveOk = ok; renderSave(); });
  const input = el('input');
  input.type = 'file';
  input.hidden = true;
  input.setAttribute('webkitdirectory', '');
  input.id = 'folder-input';
  input.setAttribute('aria-label', 'Папка гри');

  root.innerHTML = `
    <header class="top"><div class="logo" aria-hidden="true">T</div><b>Transly</b><span class="grow"></span>
      <div class="seg" role="group" aria-label="Етап"><button data-stage="translate" aria-pressed="true">Переклад</button><button data-stage="review" aria-pressed="false">Вичитування</button></div>
      <span class="save" id="save" role="status"></span>
      <button class="btn p" id="open">Відкрити папку гри</button></header>
    <div class="main"><aside class="panel tree" aria-label="Файли"><div class="phd">Файли гри</div><div class="files" id="files"></div></aside>
      <main class="panel table" id="table"></main></div>`;
  root.appendChild(input);

  const entries = (file: string): Record<string, Entry> => (s.saved.files[file] ??= {});
  const qaOpts = () => ({ tolerancePct: 25, terms: s.saved.terms.map(t => ({ en: t.en, uk: t.uk })) });
  const view = () => s.views.find(v => v.name === s.current) ?? null;

  function renderSave(): void {
    const e = $('#save');
    e.textContent = s.saveOk ? 'Збережено' : 'Не збережено: повторю спробу';
    e.classList.toggle('bad', !s.saveOk);
  }

  function renderTree(): void {
    const box = $('#files');
    if (!s.views.length) { box.innerHTML = '<div class="empty">Папку гри ще не відкрито</div>'; return; }
    box.innerHTML = s.views.map(v => {
      const st = statsOf(v.units, s.saved.files[v.name] ?? {});
      const pct = Math.round((st.translated / st.total) * 100);
      return `<button class="file" data-file="${esc(v.name)}" aria-current="${v.name === s.current}"><span class="nm">${esc(v.name)}</span><span class="mini ${pct === 100 ? 'full' : ''}" aria-hidden="true"><i style="width:${pct}%"></i></span><span class="pc">${pct}%</span></button>`;
    }).join('');
  }

  const matches = (u: Unit, e: Entry | undefined): boolean => {
    if (s.q) {
      const q = s.q.toLowerCase();
      if (!(u.source + ' ' + (e?.target ?? '') + ' ' + u.key + ' ' + u.speaker).toLowerCase().includes(q)) return false;
    }
    const st = e?.status ?? 'new';
    switch (s.filter) {
      case 'new': return st === 'new';
      case 'draft': return st === 'draft';
      case 'done': return st === 'done';
      case 'qa': return !!e && check(u, e.target, qaOpts()).length > 0;
      default: return true;
    }
  };

  function qaHtml(u: Unit, e: Entry | undefined): string {
    if (!e || !e.target) return '';
    return check(u, e.target, qaOpts()).map(i => `<div class="qa ${i.severity}">${esc(i.message)}</div>`).join('');
  }

  function rowHtml(u: Unit, n: number, e: Entry | undefined): string {
    const st = e?.status ?? 'new';
    const lines = Math.max(2, u.source.split('\n').length);
    return `<div class="row" data-key="${esc(u.key)}"><div class="n">${n}</div><div class="who">${esc(u.speaker)}</div><div class="src">${esc(u.source)}</div>
      <div class="trc"><textarea rows="${lines}" aria-label="Переклад рядка ${n}" data-key="${esc(u.key)}">${esc(e?.target ?? '')}</textarea><div class="qas">${qaHtml(u, e)}</div></div>
      <div class="st"><span class="dot ${st}" title="${STATUS_LABEL[st]}" role="img" aria-label="${STATUS_LABEL[st]}"></span></div></div>`;
  }

  function renderTable(): void {
    const box = $('#table');
    const v = view();
    if (!v) {
      box.innerHTML = s.views.length
        ? '<div class="empty"><h2>Оберіть файл</h2>Файл зліва відкриє його рядки.</div>'
        : `<div class="empty"><h2>Відкрийте папку гри</h2>Оберіть папку <b>data</b> гри на RPG Maker (або саму папку гри). Ваш переклад зберігається в цьому браузері, файли гри не змінюються.</div>`;
      return;
    }
    const ents = entries(v.name);
    const shown: string[] = [];
    v.units.forEach((u, i) => { if (matches(u, ents[u.key])) shown.push(rowHtml(u, i + 1, ents[u.key])); });
    box.innerHTML = `<div class="phd">${esc(v.name)} · ${v.units.length} рядків</div>
      <div class="filters">${FILTERS.map(([f, l]) => `<button class="chip" data-filter="${f}" aria-pressed="${s.filter === f}">${l}</button>`).join('')}
        <input id="q" type="search" placeholder="Пошук у файлі" aria-label="Пошук у файлі" value="${esc(s.q)}"></div>
      <div class="scroll" id="scroll">${shown.join('') || '<div class="empty">Нічого не знайдено</div>'}</div>`;
  }

  function renderAll(): void { renderTree(); renderTable(); renderSave(); }

  function updateRow(row: HTMLElement, u: Unit, e: Entry | undefined): void {
    const st = e?.status ?? 'new';
    const dot = $('.dot', row);
    dot.className = `dot ${st}`;
    dot.title = STATUS_LABEL[st];
    dot.setAttribute('aria-label', STATUS_LABEL[st]);
    $('.qas', row).innerHTML = qaHtml(u, e);
  }

  function unitOf(key: string): Unit | undefined { return view()?.units.find(u => u.key === key); }

  function persist(): void { autosave.queue(s.saved); }

  async function openFolder(): Promise<void> {
    const picked = await pickGameFolder(input);
    if (!picked) return;
    if (!picked.length) { toast('У вибраній папці немає файлів .json'); return; }
    const box = $('#table');
    box.innerHTML = '<div class="empty"><h2>Читаю файли гри…</h2><div class="progress"><i id="bar"></i></div><span id="pct"></span></div>';
    const { files, failed } = await readFiles(picked, (d, t) => {
      $('#bar').style.width = `${(d / t) * 100}%`;
      $('#pct').textContent = `${d} з ${t}`;
    });
    const game: GameFile[] = files;
    s.views = readGame(game);
    s.current = s.views[0]?.name ?? null;
    if (!s.views.length) { renderAll(); toast('У цих файлах немає тексту для перекладу'); return; }
    if (failed.length) toast(`Не вдалося прочитати файлів: ${failed.length}`);
    renderAll();
  }

  root.addEventListener('click', e => {
    const t = e.target as HTMLElement;
    if (t.closest('#open')) { void openFolder(); return; }
    const f = t.closest<HTMLElement>('[data-file]');
    if (f) { s.current = f.dataset.file ?? null; s.q = ''; s.filter = 'all'; renderAll(); return; }
    const st = t.closest<HTMLElement>('[data-stage]');
    if (st) {
      s.stage = st.dataset.stage === 'review' ? 'review' : 'translate';
      root.querySelectorAll<HTMLElement>('[data-stage]').forEach(b => b.setAttribute('aria-pressed', String(b === st)));
      return;
    }
    const ch = t.closest<HTMLElement>('[data-filter]');
    if (ch) { s.filter = ch.dataset.filter as Filter; renderTable(); }
  });

  root.addEventListener('input', e => {
    const t = e.target as HTMLElement;
    if (t instanceof HTMLTextAreaElement && t.dataset.key) {
      const u = unitOf(t.dataset.key);
      const v = view();
      if (!u || !v) return;
      const ents = entries(v.name);
      ents[u.key] = edit(ents[u.key], u, t.value, s.stage, Date.now());
      updateRow(t.closest<HTMLElement>('.row')!, u, ents[u.key]);
      persist();
    } else if (t.id === 'q') {
      s.q = (t as HTMLInputElement).value;
      const pos = (t as HTMLInputElement).selectionStart ?? s.q.length;
      renderTable();
      const q = $('#q') as HTMLInputElement;
      q.focus();
      q.setSelectionRange(pos, pos);
    }
  });

  root.addEventListener('keydown', e => {
    const t = e.target as HTMLElement;
    if (!(t instanceof HTMLTextAreaElement) || !t.dataset.key) return;
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      const u = unitOf(t.dataset.key);
      const v = view();
      if (!u || !v) return;
      const ents = entries(v.name);
      const r = submit(ents[u.key], u, s.stage, Date.now(), { blockErrors: true, qa: qaOpts() });
      if (!r.ok) { toast(r.reason); return; }
      ents[u.key] = r.entry;
      updateRow(t.closest<HTMLElement>('.row')!, u, r.entry);
      renderTree();
      persist();
      const next = t.closest('.row')?.nextElementSibling?.querySelector('textarea');
      if (next instanceof HTMLTextAreaElement) next.focus();
      toast(s.stage === 'translate' ? 'Надіслано на вичитування' : 'Вичитано');
    }
  });

  addEventListener('beforeunload', () => { void autosave.flush(); });
  renderAll();
}
