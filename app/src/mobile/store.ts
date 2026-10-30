import { sendBatches, undoBatch, undoneBatches, almost as autofillAlmost, learnWords, proposals as autofillProposals, addComment, alignReference, extract, withReference, withoutReference, Autosave, DupIndex, TmIndex, findReplace, inconsistencies, propagate, referenceSets, activeIssues, autoLineLimit, deserialize, edit, emptyProject, labelsOf, limitFor, mergeProjects, note, readGame, reconcile, snapshotOf, speakerOf, statsOf, submit, sysNamesOf, termsIn, viewsFromSnapshot, wrapLines } from '../core';
import type { Entry, FileStats, FileView, GameFile, SavedProject, Stage, Status, Unit } from '../core';
import { IdbStore } from '../ui/idb';

/**
 * The phone app's own model: what is loaded, what is open and what the rows list shows. It talks to the shared core
 * (formats, QA, merging, glossary, sync) and to the browser's storage, and knows nothing about the desktop UI.
 */
export type Filter = 'all' | 'new' | 'draft' | 'done' | 'appr' | 'qa';
export type Sort = 'order' | 'new' | 'qa' | 'long';
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
  /** How many identical rows the last send filled in too. */
  lastSame = 0;
  saveOk = true;
  savedAt: number | null = null;
  private autosave: Autosave;
  private listeners = new Set<() => void>();
  private tmCache: TmIndex | null = null;
  private dupCache: { views: FileView[]; idx: DupIndex } | null = null;

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
  private autoLim: { views: FileView[]; n: number } | null = null;
  /** The automatic limit scans every file: it is computed once per set of files, not once per row. */
  lineLimit(): number {
    const l = this.saved.settings.lineLimit; if (l !== 0) return l < 0 ? 0 : l;
    if (this.autoLim?.views !== this.views) this.autoLim = { views: this.views, n: autoLineLimit(this.views) };
    return this.autoLim.n;
  }
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

  /** The same row in the reference languages (what other versions of the game say). */
  refs(file: string, key: string): { lang: string; text: string }[] {
    return referenceSets(this.saved.reference).map(r => ({ lang: r.lang, text: r.texts[file]?.[key] ?? '' })).filter(r => r.text);
  }
  /** Rows of every file that match the search words; capped so the list stays light. */
  findAll(q: string, limit = 200): { file: string; unit: Unit }[] {
    const needle = q.trim().toLowerCase(); if (!needle) return [];
    const out: { file: string; unit: Unit }[] = [];
    for (const v of this.views) {
      const ents = this.saved.files[v.name] ?? {};
      for (const u of v.units) {
        if ((u.source + ' ' + (ents[u.key]?.target ?? '') + ' ' + u.key).toLowerCase().includes(needle)) { out.push({ file: v.name, unit: u }); if (out.length >= limit) return out; }
      }
    }
    return out;
  }
  private dups(): DupIndex { if (!this.dupCache || this.dupCache.views !== this.views) this.dupCache = { views: this.views, idx: new DupIndex(this.views) }; return this.dupCache.idx; }

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
    else if (this.sort === 'long') list = [...list].sort((a, b) => b.source.length - a.source.length);
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
  /** Copy the original into an empty translation; false when there already is a translation. */
  writeAtCopy(file: string, u: Unit): boolean {
    if (this.entry(file, u.key)?.target) return false;
    this.writeAt(file, u.key, u.source); return true;
  }
  /** Typing into a cell of the table: any row, not only the open one. */
  writeAt(file: string, key: string, text: string): void {
    const u = this.unit(file, key); if (!u) return;
    this.entries(file)[key] = edit(this.entry(file, key), u, text, this.stage, Date.now());
    this.tmCache = null; this.persist(); this.emit();
  }
  /** Send to review / approve the open row. Returns a reason when it is refused. */
  send(): string | null {
    const c = this.current; if (!c) return 'Рядок не вибрано';
    const r = submit(c.entry, c.unit, this.stage, Date.now(), { blockErrors: this.saved.settings.blockErrors, qa: this.qaOpts() });
    if (!r.ok) return r.reason;
    const now = Date.now();
    this.entries(c.file)[c.unit.key] = note(r.entry, this.stage === 'translate' ? 'надіслано на вичитування' : 'вичитано', r.entry.target, this.who, now);
    this.lastSame = this.saved.settings.propagate ? propagate(this.saved, this.dups(), c.file, c.unit, this.entries(c.file)[c.unit.key]!, this.stage, now, this.who) : 0;
    this.tmCache = null; this.persist(); this.emit(); return null;
  }
  comment(text: string): void { this.mutate((_f, _u, e) => addComment(e, this.who, text, Date.now())); }
  mutate(fn: (file: string, unit: Unit, e: Entry | undefined) => Entry): void {
    const c = this.current; if (!c) return;
    this.entries(c.file)[c.unit.key] = fn(c.file, c.unit, c.entry);
    this.tmCache = null; this.persist(); this.emit();
  }
  /** Empty the translation of these rows (kept in the history as a cleared edit). */
  clearMany(file: string, units: Unit[]): number {
    let n = 0; const now = Date.now();
    for (const u of units) { const e = this.entry(file, u.key); if (!e?.target) continue; this.entries(file)[u.key] = edit(e, u, '', this.stage, now); n++; }
    if (n) { this.tmCache = null; this.persist(); this.emit(); }
    return n;
  }
  /** Send every translated row of these units that can be sent (the rest are counted, not blocked). */
  sendMany(file: string, units: Unit[]): { sent: number; skipped: number } {
    let sent = 0, skipped = 0; const now = Date.now();
    for (const u of units) {
      const e = this.entry(file, u.key);
      if (!e?.target.trim()) { skipped++; continue; }
      const r = submit(e, u, this.stage, now, { blockErrors: this.saved.settings.blockErrors, qa: this.qaOpts() });
      if (!r.ok) { skipped++; continue; }
      this.entries(file)[u.key] = note(r.entry, this.stage === 'translate' ? 'надіслано на вичитування' : 'вичитано', r.entry.target, this.who, now); sent++;
    }
    if (sent) { this.persist(); this.emit(); }
    return { sent, skipped };
  }
  find(o: { find: string; replace: string; caseSensitive: boolean; wholeWord: boolean }): ReturnType<typeof findReplace> { return findReplace(this.views, this.saved, o); }
  replaceAll(matches: ReturnType<typeof findReplace>): number {
    let n = 0; const now = Date.now();
    for (const m of matches) {
      const u = this.unit(m.file, m.key); if (!u) continue;
      this.entries(m.file)[m.key] = note(edit(this.entry(m.file, m.key), u, m.after, this.stage, now), 'замінено', m.after, this.who, now); n++;
    }
    if (n) { this.tmCache = null; this.persist(); this.emit(); }
    return n;
  }
  refLangs(): string[] { return referenceSets(this.saved.reference).map(r => r.lang); }
  /** Another-language copy of the game: its lines are paired with the originals. Returns pairs found and rows in the paired files. */
  importReference(lang: string, game: GameFile[]): { paired: number; total: number } {
    const snap = this.saved.snapshot; const texts: Record<string, ReturnType<typeof alignReference>> = {};
    let paired = 0, total = 0;
    for (const f of game) {
      const units = snap?.[f.name]; if (!units) continue;
      const ref = alignReference(units, extract(f)); texts[f.name] = ref; total += units.length; paired += Object.keys(ref).length;
    }
    if (!paired) return { paired: 0, total: 0 };
    this.saved.reference = withReference(this.saved.reference, { lang, texts });
    this.saved.assetsRev = Date.now(); this.persist(); this.emit();
    return { paired, total };
  }
  removeReference(lang: string): void {
    const next = withoutReference(this.saved.reference, lang);
    if (next) this.saved.reference = next; else delete this.saved.reference;
    this.saved.assetsRev = Date.now(); this.persist(); this.emit();
  }
  /* ---------- glossary ---------- */
  /** Add a term, or change the one with the same original word. Returns false when a field is empty. */
  saveTerm(en: string, uk: string, alt: string, qa: boolean): boolean {
    en = en.trim(); uk = uk.trim(); if (!en || !uk) return false;
    const alts = alt.split(/[;,]/).map(x => x.trim()).filter(Boolean);
    const t = { en, uk, mt: Date.now(), ...(alts.length ? { alt: alts } : {}), ...(qa ? {} : { qa: false }) };
    const i = this.saved.terms.findIndex(x => x.en.toLowerCase() === en.toLowerCase());
    if (i >= 0) this.saved.terms[i] = { ...this.saved.terms[i], ...t, alt: alts.length ? alts : undefined } as typeof t; else this.saved.terms.push(t);
    this.tmCache = null; this.persist(); this.emit(); return true;
  }
  removeTerm(en: string): void {
    this.saved.terms = this.saved.terms.filter(x => x.en.toLowerCase() !== en.toLowerCase());
    this.persist(); this.emit();
  }
  /* ---------- autofill by words ---------- */
  wordCount(): number { return learnWords(this.views, this.saved).size; }
  autofill(): ReturnType<typeof autofillProposals> { return autofillProposals(this.views, this.saved); }
  /** Sends that can still be taken back (newest first). */
  sends(): ReturnType<typeof sendBatches> { return sendBatches(this.views, this.saved); }
  undone(): ReturnType<typeof undoneBatches> { return undoneBatches(this.views, this.saved); }
  undoSend(at: number, kind: string, guessed = false): number {
    const b = this.sends().find(x => x.at === at && x.kind === kind && !!x.guessed === guessed); if (!b) return 0;
    const n = undoBatch(this.saved, b, this.who, Date.now());
    if (n) { this.persist(); this.emit(); }
    return n;
  }
  /** Short untranslated lines that are one or two words short of being composed, with the words that block them. */
  almost(): ReturnType<typeof autofillAlmost> { return autofillAlmost(this.views, this.saved); }
  /** Write the proposals as drafts marked as autofilled; rows that got a translation meanwhile are skipped. */
  applyAutofill(list: { file: string; key: string; target: string }[]): number {
    let n = 0; const now = Date.now();
    for (const p of list) {
      const u = this.unit(p.file, p.key); if (!u || this.entry(p.file, p.key)?.target?.trim()) continue;
      this.entries(p.file)[p.key] = note(edit(this.entry(p.file, p.key), u, p.target, this.stage, now), 'автозаповнено за словами', p.target, this.who, now); n++;
    }
    if (n) { this.tmCache = null; this.persist(); this.emit(); }
    return n;
  }
  /** The same original translated in different ways. */
  inconsistent(): ReturnType<typeof inconsistencies> { return inconsistencies(this.views, this.saved, 60); }
  /** Give every row of one original the chosen translation; returns how many rows changed. */
  unify(source: string, target: string): number {
    const g = this.inconsistent().find(x => x.source === source); if (!g) return 0;
    let n = 0; const now = Date.now();
    for (const v of g.variants) {
      if (v.target === target) continue;
      for (const w of v.where) {
        const u = this.unit(w.file, w.key); if (!u) continue;
        this.entries(w.file)[w.key] = note(edit(this.entry(w.file, w.key), u, target, this.stage, now), 'уніфіковано', target, this.who, now); n++;
      }
    }
    if (n) { this.tmCache = null; this.persist(); this.emit(); }
    return n;
  }
  setSpeakers(draft: Map<string, string>): number {
    const m = (this.saved.speakers ??= {}); let changed = 0;
    for (const [k, v] of draft) {
      const name = v.trim();
      if (name && m[k]?.name !== name) { m[k] = { name, mt: Date.now() }; changed++; }
      // An emptied name stays as a dated entry, otherwise the other device's copy would bring the old name back on the next merge.
      else if (!name && m[k]?.name) { m[k] = { name: '', mt: Date.now() }; changed++; }
    }
    if (changed) { this.persist(); this.emit(); }
    return changed;
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
