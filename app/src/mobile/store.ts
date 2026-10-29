import { Autosave, TmIndex, activeIssues, autoLineLimit, deserialize, edit, emptyProject, labelsOf, limitFor, mergeProjects, note, readGame, reconcile, snapshotOf, speakerOf, statsOf, submit, sysNamesOf, termsIn, viewsFromSnapshot, wrapLines } from '../core';
import type { Entry, FileStats, FileView, GameFile, SavedProject, Stage, Status, Unit } from '../core';
import { IdbStore } from '../ui/idb';

/**
 * The phone app's own model: what is loaded, what is open and what the rows list shows. It talks to the shared core
 * (formats, QA, merging, glossary, sync) and to the browser's storage, and knows nothing about the desktop UI.
 */
export type Filter = 'all' | 'new' | 'draft' | 'done' | 'appr' | 'qa';
export type Sort = 'order' | 'new' | 'qa';
export type Shown = Status | 'qa';

export const FILTERS: [Filter, string][] = [['all', 'Усі'], ['new', 'Без перекладу'], ['draft', 'Чернетки'], ['done', 'На вичитуванні'], ['appr', 'Вичитано'], ['qa', 'Проблеми']];
export const STATUS_LABEL: Record<Shown, string> = { new: 'без перекладу', draft: 'чернетка', done: 'чекає вичитування', appr: 'вичитано', qa: 'є проблема QA' };
const natural = (a: string, b: string): number => a.localeCompare(b, 'en', { numeric: true });

export class Store {
  saved: SavedProject;
  views: FileView[] = [];
  game: GameFile[] = [];
  /** Open file and row. */
  file: string | null = null;
  key: string | null = null;
  filter: Filter = 'all';
  sort: Sort = 'order';
  q = '';
  /** Translate pass or review pass. */
  stage: Stage = 'translate';
  saveOk = true;
  savedAt: number | null = null;
  private autosave: Autosave;
  private listeners = new Set<() => void>();
  private tmCache: TmIndex | null = null;

  private constructor(private idb: IdbStore, saved: SavedProject) {
    this.saved = saved;
    this.autosave = new Autosave(idb, 400, ok => { this.saveOk = ok; if (ok) this.savedAt = Date.now(); this.emit(); });
    this.views = viewsFromSnapshot(saved);
    try { const at = JSON.parse(localStorage.getItem('transly-m-pos') ?? 'null') as { file?: string; key?: string } | null; if (at?.file && this.view(at.file)) { this.file = at.file; this.key = at.key ?? null; } } catch { /* first run */ }
    if (!this.file && this.views[0]) this.file = this.views[0].name;
  }

  static async open(): Promise<Store> {
    const idb = new IdbStore('default');
    let saved: SavedProject;
    try { saved = (await idb.load()) ?? emptyProject('Новий проєкт'); } catch { saved = emptyProject('Новий проєкт'); }
    return new Store(idb, saved);
  }

  onChange(fn: () => void): void { this.listeners.add(fn); }
  private emit(): void { for (const f of this.listeners) f(); }
  persist(): void { this.autosave.queue(this.saved); }
  flush(): Promise<void> { return this.autosave.flush(); }
  get who(): string { return this.saved.settings.who; }
  get hasGame(): boolean { return this.views.length > 0; }

  /* ---------- reading ---------- */
  view(name: string | null = this.file): FileView | null { return name ? this.views.find(v => v.name === name) ?? null : null; }
  entries(file: string): Record<string, Entry> { return (this.saved.files[file] ??= {}); }
  entry(file: string, key: string): Entry | undefined { return this.saved.files[file]?.[key]; }
  unit(file: string, key: string): Unit | undefined { return this.view(file)?.units.find(u => u.key === key); }
  get current(): { file: string; unit: Unit; entry: Entry | undefined } | null {
    if (!this.file || !this.key) return null;
    const unit = this.unit(this.file, this.key);
    return unit ? { file: this.file, unit, entry: this.entry(this.file, this.key) } : null;
  }
  stats(file: string): FileStats { const v = this.view(file); return v ? statsOf(v.units, this.saved.files[file] ?? {}) : { total: 0, translated: 0, approved: 0, done: 0 }; }
  totals(): FileStats { const t: FileStats = { total: 0, translated: 0, approved: 0, done: 0 }; for (const v of this.views) { const s = this.stats(v.name); t.total += s.total; t.translated += s.translated; t.approved += s.approved; t.done += s.done; } return t; }
  speaker(u: Unit): string { return speakerOf(u, this.saved.speakers ?? {}); }

  qaOpts(): { tolerancePct: number; terms: SavedProject['terms']; lineLimit: number } { return { tolerancePct: this.saved.settings.tolerancePct, terms: this.saved.terms, lineLimit: this.lineLimit() }; }
  lineLimit(): number { const l = this.saved.settings.lineLimit; return l < 0 ? 0 : l > 0 ? l : autoLineLimit(this.views); }
  issues(u: Unit, e: Entry | undefined): ReturnType<typeof activeIssues> { return e && e.target ? activeIssues(u, e, this.qaOpts()) : []; }
  shown(u: Unit, e: Entry | undefined): Shown { const st = e?.status ?? 'new'; return st !== 'new' && this.issues(u, e).length ? 'qa' : st; }
  terms(u: Unit): ReturnType<typeof termsIn<SavedProject['terms'][number]>> { return termsIn(u.source, this.saved.terms); }
  tm(): TmIndex {
    if (this.tmCache) return this.tmCache;
    const tm = new TmIndex();
    for (const v of this.views) { const ents = this.saved.files[v.name]; if (!ents) continue; for (const u of v.units) { const e = ents[u.key]; if (e?.target.trim()) tm.add({ s: u.source, t: e.target, src: v.name }); } }
    for (const m of this.saved.memory) tm.add({ s: m.s, t: m.t, src: 'Імпорт' });
    return (this.tmCache = tm);
  }
  suggestions(u: Unit, e: Entry | undefined): ReturnType<TmIndex['find']> { return this.tm().find(u.source, { min: 60, limit: 3, exclude: x => x.s === u.source && x.t === (e?.target ?? '') }); }

  /** Rows of the open file after the filter, the search and the sort. */
  rows(): Unit[] {
    const v = this.view(); if (!v) return [];
    const ents = this.saved.files[v.name] ?? {};
    const q = this.q.trim().toLowerCase();
    let list = v.units.filter(u => {
      const e = ents[u.key];
      if (this.filter !== 'all') {
        const st = this.shown(u, e);
        if (this.filter === 'qa' ? st !== 'qa' : (e?.status ?? 'new') !== this.filter) return false;
      }
      return !q || (u.source + ' ' + (e?.target ?? '') + ' ' + u.key + ' ' + this.speaker(u)).toLowerCase().includes(q);
    });
    if (this.sort === 'new') list = [...list].sort((a, b) => Number(!!ents[a.key]?.target) - Number(!!ents[b.key]?.target));
    else if (this.sort === 'qa') list = [...list].sort((a, b) => Number(this.shown(b, ents[b.key]) === 'qa') - Number(this.shown(a, ents[a.key]) === 'qa'));
    return list;
  }

  /* ---------- moving around ---------- */
  open(file: string, key: string | null = null): void {
    this.file = file; this.key = key; this.q = ''; this.filter = 'all';
    this.remember(); this.emit();
  }
  select(key: string): void { this.key = key; this.remember(); this.emit(); }
  private remember(): void { try { localStorage.setItem('transly-m-pos', JSON.stringify({ file: this.file, key: this.key })); } catch { /* private mode */ } }
  /** The row `d` places away in the list that is on screen; null at the ends. */
  neighbour(d: 1 | -1): Unit | null {
    const list = this.rows(); const i = list.findIndex(u => u.key === this.key);
    return list[i + d] ?? null;
  }
  setFilter(f: Filter): void { this.filter = f; this.emit(); }
  setQuery(q: string): void { this.q = q; this.emit(); }
  setSort(s: Sort): void { this.sort = s; this.emit(); }
  setStage(s: Stage): void { this.stage = s; this.emit(); }

  /* ---------- writing ---------- */
  /** Typing: the text is stored at once; the screen is not redrawn (the field has the focus). */
  write(text: string): void {
    const c = this.current; if (!c) return;
    this.entries(c.file)[c.unit.key] = edit(c.entry, c.unit, text, this.stage, Date.now());
    this.tmCache = null; this.persist();
  }
  /** Send to review / approve the open row. Returns a reason when it is refused. */
  send(): string | null {
    const c = this.current; if (!c) return 'Рядок не вибрано';
    const r = submit(c.entry, c.unit, this.stage, Date.now(), { blockErrors: this.saved.settings.blockErrors, qa: this.qaOpts() });
    if (!r.ok) return r.reason;
    this.entries(c.file)[c.unit.key] = note(r.entry, this.stage === 'translate' ? 'надіслано на вичитування' : 'вичитано', r.entry.target, this.who, Date.now());
    this.persist(); this.emit(); return null;
  }
  mutate(fn: (file: string, unit: Unit, e: Entry | undefined) => Entry): void {
    const c = this.current; if (!c) return;
    this.entries(c.file)[c.unit.key] = fn(c.file, c.unit, c.entry);
    this.tmCache = null; this.persist(); this.emit();
  }
  wrap(): boolean {
    const c = this.current; if (!c) return false;
    const lim = limitFor(this.lineLimit(), c.unit.face); if (!lim) return false;
    const text = wrapLines(c.entry?.target ?? '', lim);
    if (text === (c.entry?.target ?? '')) return false;
    this.mutate((_f, u, e) => note(edit(e, u, text, this.stage, Date.now()), 'перенесено рядки', text, this.who, Date.now()));
    return true;
  }

  /* ---------- bringing data in ---------- */
  /** Game files were read: they become the originals. Returns how many translated rows lost their match (back to draft). */
  ingest(game: GameFile[]): number {
    const fresh = readGame(game, { pluginCommands: this.saved.settings.pluginCommands });
    const names = new Set(game.map(g => g.name));
    const label = new Map(this.views.map(v => [v.name, v.label]));
    const kept = fresh.map(v => (v.label || !label.get(v.name) ? v : { ...v, label: label.get(v.name)! }));
    this.game = [...this.game.filter(g => !names.has(g.name)), ...game];
    this.views = [...this.views.filter(v => !names.has(v.name)), ...kept].sort((a, b) => natural(a.name, b.name));
    this.saved.labels = labelsOf(this.views);
    this.saved.sysNames = sysNamesOf(game) ?? this.saved.sysNames;
    const snap = snapshotOf(this.views);
    if (JSON.stringify(snap) !== JSON.stringify(this.saved.snapshot ?? null)) { this.saved.assetsRev = Date.now(); this.saved.snapshot = snap; }
    let changed = 0;
    for (const v of this.views) { const ents = this.saved.files[v.name]; if (ents) changed += reconcile(v.units, ents, Date.now()).length; }
    this.tmCache = null;
    if (!this.file || !this.view(this.file)) this.file = this.views[0]?.name ?? null;
    this.persist(); this.emit();
    return changed;
  }
  /** A project file (from a computer) is merged into this one. Returns the number of rows where the newer edit won. */
  importProject(text: string): number {
    const r = mergeProjects(this.saved, deserialize(text));
    this.saved = r.project; this.adopt();
    return r.conflicts.length;
  }
  /** `saved` was replaced (sync, import): rebuild what is shown from it. */
  adopt(): void {
    if (!this.game.length) this.views = viewsFromSnapshot(this.saved);
    this.tmCache = null;
    if (!this.file || !this.view(this.file)) { this.file = this.views[0]?.name ?? null; this.key = null; }
    this.persist(); this.emit();
  }
}
