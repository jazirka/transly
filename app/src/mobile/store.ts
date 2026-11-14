import { isAutoFilled, planIngest, ingestQuiet, adoptSynced, applyPlan, planMessage, planOf, reconcileChanges, rowState, nextIn, positionOf, queueRows, adviceCount, check, fixRule, hasAdvice, knownStatus, qaOf, ruleStats, GROUP_COLORS, proposeTermSync, termChange, termChanges, LinkIndex, afterSend, clearMain, linkChanges, linkModeOf, linkView, planLinkSync, relinkRow, reviewClusters, setMain, unlinkRow, GroupIndex, createGroup, deleteGroup, liveGroups, placeFile, recolorGroup, renameGroup, deleteComment, editComment, replyTo, resolveThread, touchTerms, removeTerm, saveTerm, commitRows, journalBatches, newBatch, recordChange, undoJournal, usageKey, buildUsage, parseDelimited, parseHtmlTable, parseTerms, pluginCandidates, termsFromTable, autoBatches, autoUndone, undoAuto, sendBatches, undoBatch, undoneBatches, almost as autofillAlmost, learnWords, proposals as autofillProposals, addComment, alignReference, extract, withReference, withoutReference, Autosave, TmIndex, findReplace, referenceSets, activeIssues, autoLineLimit, deserialize, edit, emptyProject, labelsOf, limitFor, mergeProjects, readGame, snapshotOf, speakerOf, statsOf, submit, sysNamesOf, termsIn, viewsFromSnapshot, wrapLines, approveEntry, sendBack, threadsOf, rowsOfGroup, flowText, wrapMessage, wrapOf, outboxRescue, takeOutbox } from '../core';
import type { IngestReport, Protect, QueueKind, Issue, QaSettings, RuleStat, LinkRowView, QaOptions, TermChange, TermProposal, TermSync, WrapPlan } from '../core';
import { pxMeasure } from '../ui/measure';
import type { BatchKind, Group, Entry, GlossaryTerm, RowChange, FileStats, FileView, GameFile, SavedProject, Stage, Status, Unit } from '../core';
import { IdbStore, LoadFailure } from '../ui/idb';

/**
 * The phone app's own model: what is loaded, what is open and what the rows list shows. It talks to the shared core
 * (formats, QA, merging, glossary, sync) and to the browser's storage, and knows nothing about the desktop UI.
 */
export type Filter = 'all' | 'new' | 'draft' | 'auto' | 'done' | 'appr' | 'qa' | 'adv' | 'cm';
export type Sort = 'order' | 'new' | 'qa' | 'long';
export type Shown = Status | 'qa';

/** What a bulk action did: how many rows, how many were left out and why (reason → count), which rows a QA error stopped, and the action's id for the undo. */
export interface BulkResult { done: number; skipped: number; auto?: number; why: Map<string, number>; blocked: { key: string; reason: string }[]; batch?: string }

/** A short name for why a row was left out (the full reason of `submit` is long). */
export const reasonKey = (reason: string): string => (reason.startsWith('Є помилка QA') ? 'помилка QA' : reason === 'Переклад порожній' ? 'без перекладу' : reason);

/** The words for a toast about the rows that were left out: «пропущено: 3 (помилка QA: 2; уже надіслано: 1)». */
export function skippedText(r: Pick<BulkResult, 'skipped' | 'why'>): string {
  if (!r.skipped) return '';
  const parts = [...r.why].slice(0, 3).map(([k, n]) => `${k.replace(/^Рядок /, '').replace(/^уже /, 'уже ')}: ${n}`);
  return ` · пропущено: ${r.skipped}${parts.length ? ` (${parts.join('; ')})` : ''}`;
}

export const FILTERS: [Filter, string][] = [['all', 'Усі'], ['new', 'Без перекладу'], ['draft', 'Чернетки'], ['auto', 'Авто'], ['done', 'Надіслані'], ['appr', 'Вичитано'], ['qa', 'Помилки'], ['adv', 'З порадами'], ['cm', 'З коментарями']];
export const STATUS_LABEL: Record<Shown, string> = { new: 'без перекладу', draft: 'чернетка', done: 'надіслано', appr: 'вичитано', qa: 'є помилка QA' };
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
  private tmFlow = false;
  private linkCache: { views: FileView[]; idx: LinkIndex } | null = null;
  private linkTodoCache: number | null = null;

  /** What the last reading of the game files did to rows whose original changed (for the message that follows). */
  lastReconcile: { batch: string; demoted: number } | null = null;
  /** What lining the new version of the game up with the old one did (for the message that follows). */
  lastIngest: { batch: string | undefined; report: IngestReport } | null = null;
  /** Told when work from another tab was merged into this one, so the screen can say so. */
  onForeignNotice: (() => void) | null = null;
  /** Rows taken back from the outbox at start (work the previous session could not finish writing); 0 when none. */
  rescuedRows = 0;
  private constructor(private idb: IdbStore, saved: SavedProject, rescuedRows = 0) {
    this.saved = saved;
    this.rescuedRows = rescuedRows;
    const kv = (() => { try { return window.localStorage; } catch { return null; } })();
    this.autosave = new Autosave(idb, 400, ok => { this.saveOk = ok; if (ok) this.savedAt = Date.now(); this.emit(); }, undefined, kv ? outboxRescue(kv, 'default') : null);
    if (rescuedRows) { this.autosave.keepAll(); this.autosave.queue(saved); }
    // another tab wrote to the same stored project and the save merged its work in: take it over (no redraw: the translator may be typing)
    idb.onForeign = merged => { this.saved = adoptSynced(this.saved, merged); this.tmCache = null; this.persist(); this.onForeignNotice?.(); };
    this.views = viewsFromSnapshot(saved);
    try { const at = JSON.parse(localStorage.getItem('transly-m-pos') ?? 'null') as { file?: string; key?: string } | null; if (at?.file && this.view(at.file)) { this.file = at.file; this.key = at.key ?? null; } } catch { /* first run */ }
    if (!this.file && this.views[0]) this.file = this.views[0].name;
  }

  /** `onFailure` is shown when the stored project cannot be read; it resolves when the translator has chosen to start an empty one. */
  static async open(onFailure: (failure: LoadFailure, keepAndStartEmpty: () => Promise<void>) => Promise<void>): Promise<Store> {
    const idb = new IdbStore('default');
    let saved: SavedProject;
    try { saved = (await idb.load()) ?? emptyProject('Новий проєкт'); }
    catch (e) {
      // never replace an unreadable stored project silently: the next autosave would overwrite it
      if (!(e instanceof LoadFailure)) throw e;
      await onFailure(e, () => idb.releaseAfterBackup(e.raw));
      saved = emptyProject('Новий проєкт');
    }
    // what the previous session could not finish writing (the page went away within the delay of the autosave)
    let rows = 0;
    try { const back = takeOutbox(window.localStorage, 'default', saved, Date.now()); if (back) { saved = back.project; rows = back.rows; } } catch { /* no localStorage here */ }
    return new Store(idb, saved, rows);
  }

  onChange(fn: () => void): void { this.listeners.add(fn); }
  private emit(): void { this.linkTodoCache = null; for (const f of this.listeners) f(); }
  persist(): void { this.autosave.queue(this.saved); }
  flush(): Promise<void> { return this.autosave.flush(); }
  /** The page is going away: keep the unsaved rows in the synchronous outbox and start the write. */
  leaving(): void { this.autosave.rescueNow(); void this.autosave.flush(); }
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

  /** What the project says about wrapping messages (the tool «Перенесення рядків»), with the width resolved. */
  wrapPlan(): WrapPlan { const w = wrapOf(this.saved.settings); return { settings: w, limit: this.lineLimit(), disabled: this.saved.settings.lineLimit < 0, ...(w.unit === 'px' ? { measure: pxMeasure(w.px.font) } : {}) }; }
  qaOpts(): QaOptions { return { tolerancePct: this.saved.settings.tolerancePct, terms: this.saved.terms, lineLimit: this.lineLimit(), wrap: this.wrapPlan(), rules: qaOf(this.saved.settings) }; }
  private autoLim: { views: FileView[]; n: number } | null = null;
  /** The automatic limit scans every file: it is computed once per set of files, not once per row. */
  lineLimit(): number {
    const l = this.saved.settings.lineLimit; if (l !== 0) return l < 0 ? 0 : l;
    if (this.autoLim?.views !== this.views) this.autoLim = { views: this.views, n: autoLineLimit(this.views) };
    return this.autoLim.n;
  }
  issues(u: Unit, e: Entry | undefined): ReturnType<typeof activeIssues> { return e && e.target ? activeIssues(u, e, this.qaOpts()) : []; }
  /** The remarks of a row the translator has set aside, so they can be brought back. */
  ignored(u: Unit, e: Entry | undefined): Issue[] { return e?.target && e.ign?.length ? check(u, e.target, this.qaOpts()).filter(i => e.ign!.includes(i.key)) : []; }
  /** The rows of the open file that have an advice (the counter of the rows list and the filter «З порадами»). */
  adviceCount(): number { const v = this.view(); return v ? adviceCount([v], this.saved, this.qaOpts()) : 0; }
  /** What each rule of form found in the open file. */
  ruleStats(): RuleStat[] { const v = this.view(); return v ? ruleStats(v, this.saved, this.qaOpts()) : []; }
  /** Mend one rule over the open file as one action of the journal. */
  fixRule(id: string): { n: number; batch?: string; skipped: number } {
    const v = this.view(); if (!v) return { n: 0, skipped: 0 };
    const changes = fixRule([v], this.saved, id, this.qaOpts(), Date.now());
    if (!changes.length) return { n: 0, skipped: 0 };
    // proofread rows are not rewritten by a bulk tool; `skipped` says how many were left alone
    const plan = planOf(f => this.entries(f), changes, 'fix');
    const batch = applyPlan((c, k, w) => this.commit(c, k, w), plan);
    if (batch) { this.tmCache = null; this.persist(); this.emit(); }
    return { n: plan.changes.length, batch, skipped: plan.skipped.length };
  }
  /** Keep the choices about the QA rules in the project (an empty choice is not stored). */
  setQa(q: QaSettings): void {
    const keep = q.keep?.length ? q.keep : undefined, apos = q.apostrophe && q.apostrophe !== 'any' ? q.apostrophe : undefined;
    const out: QaSettings = { ...(q.rules ? { rules: q.rules } : {}), ...(keep ? { keep } : {}), ...(apos ? { apostrophe: apos } : {}) };
    if (Object.keys(out).length) this.saved.settings.qa = out; else delete this.saved.settings.qa;
    this.saved.settingsAt = Date.now();
    this.persist(); this.emit();
  }
  shown(u: Unit, e: Entry | undefined): Shown { const st = knownStatus(e?.status); return st !== 'new' && this.issues(u, e).some(i => i.severity === 'bad') ? 'qa' : st; }
  terms(u: Unit): ReturnType<typeof termsIn<SavedProject['terms'][number]>> { return termsIn(u.source, this.saved.terms); }
  tm(): TmIndex {
    const flow = wrapOf(this.saved.settings).mode === 'text';
    if (this.tmCache && this.tmFlow === flow) return this.tmCache;
    this.tmFlow = flow;
    const tm = new TmIndex({ flow });
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
        if ((u.source + ' ' + flowText(ents[u.key]?.target ?? '') + ' ' + u.key).toLowerCase().includes(needle)) { out.push({ file: v.name, unit: u }); if (out.length >= limit) return out; }
      }
    }
    return out;
  }
  /** The rows that share an original (linked rows), by the files that are loaded. */
  links(): LinkIndex { if (!this.linkCache || this.linkCache.views !== this.views) this.linkCache = { views: this.views, idx: new LinkIndex(this.views) }; return this.linkCache.idx; }

  /** Rows of the open file after the filter, the search and the sort. */
  rows(): Unit[] {
    const v = this.view(); if (!v) return [];
    const ents = this.saved.files[v.name] ?? {};
    const q = this.q.trim().toLowerCase();
    const opts = this.filter === 'adv' ? this.qaOpts() : undefined;
    let list = v.units.filter(u => {
      const e = ents[u.key];
      if (this.filter === 'cm') { if (!threadsOf(e?.comments).length) return false; }
      else if (this.filter === 'adv') { if (!hasAdvice(u, e, opts!)) return false; }
      else if (this.filter !== 'all') {
        const st = this.shown(u, e);
        if (this.filter === 'qa' ? st !== 'qa' : this.filter === 'new' ? rowState(e) !== 'untranslated' : this.filter === 'auto' ? !isAutoFilled(e) : (e?.status ?? 'new') !== this.filter) return false;
      }
      return !q || (u.source + ' ' + flowText(e?.target ?? '') + ' ' + u.key + ' ' + this.speaker(u)).toLowerCase().includes(q);
    });
    if (this.sort === 'new') list = [...list].sort((a, b) => Number(!!ents[a.key]?.target) - Number(!!ents[b.key]?.target));
    else if (this.sort === 'long') list = [...list].sort((a, b) => b.source.length - a.source.length);
    else if (this.sort === 'qa') list = [...list].sort((a, b) => Number(this.shown(b, ents[b.key]) === 'qa') - Number(this.shown(a, ents[a.key]) === 'qa'));
    return list;
  }

  /* ---------- moving around ---------- */
  /** Open a file; without a row it returns to the row that was active in that file last time. */
  open(file: string, key: string | null = null): void {
    this.file = file; this.key = key ?? this.lastRow(file); this.q = ''; this.filter = 'all';
    this.remember(); this.emit();
  }
  private lastRows(): Record<string, string> { try { return JSON.parse(localStorage.getItem('transly-m-rows') ?? '{}') as Record<string, string>; } catch { return {}; } }
  private lastRow(file: string): string | null { const k = this.lastRows()[file]; return k && this.unit(file, k) ? k : null; }
  select(key: string): void { this.key = key; this.remember(); this.emit(); }
  /**
   * Go to the next (or previous) row of a queue in the WHOLE project (see core/queue.ts), from the open row, going round at
   * the ends; the file is opened when the row is in another one. Returns where it went (the place in the queue) or nothing.
   */
  nextQueue(kind: QueueKind, dir: 1 | -1 = 1): { place: number; total: number } | null {
    const rows = queueRows(this.views, this.saved, kind, this.qaOpts());
    const hit = nextIn(rows, positionOf(this.views, this.file && this.key ? { file: this.file, key: this.key } : null), dir);
    if (!hit) return null;
    this.open(hit.row.file, hit.row.key);
    return { place: hit.place, total: rows.length };
  }
  private remember(): void {
    try {
      localStorage.setItem('transly-m-pos', JSON.stringify({ file: this.file, key: this.key }));
      if (this.file && this.key) { const m = this.lastRows(); m[this.file] = this.key; localStorage.setItem('transly-m-rows', JSON.stringify(m)); }
    } catch { /* private mode */ }
  }
  /** The row `d` places away in the list that is on screen; null at the ends. */
  neighbour(d: 1 | -1): Unit | null {
    const list = this.rows(); const i = list.findIndex(u => u.key === this.key);
    return list[i + d] ?? null;
  }
  setFilter(f: Filter): void { this.filter = f; this.emit(); }
  setQuery(q: string): void { this.q = q; this.emit(); }
  setSort(s: Sort): void { this.sort = s; this.emit(); }
  /** There is no review mode: a translation is approved with `approve`. */
  setStage(_s: Stage): void { /* kept for old callers */ }

  /* ---------- writing ---------- */
  /** Typing: the text is stored at once; the screen is not redrawn (the field has the focus). */
  write(text: string): void {
    const c = this.current; if (!c) return;
    this.entries(c.file)[c.unit.key] = edit(c.entry, c.unit, text, this.stage, Date.now());
    this.tmCache = null; this.linkTodoCache = null; this.persist();
  }
  /** Put the original into the empty translations of these rows, as one action of the journal (rows that have a translation stay as they are). */
  copyMany(file: string, units: Unit[]): { n: number; batch?: string } {
    const now = Date.now(), changes: RowChange[] = [];
    for (const u of units) { if (this.entry(file, u.key)?.target) continue; changes.push({ file, key: u.key, next: edit(this.entry(file, u.key), u, u.source, this.stage, now), text: u.source }); }
    const batch = changes.length ? this.commit(changes, 'copy') : undefined;
    if (batch) { this.tmCache = null; this.persist(); this.emit(); }
    return { n: changes.length, batch };
  }
  /** Typing into a cell of the table: any row, not only the open one. */
  writeAt(file: string, key: string, text: string): void {
    const u = this.unit(file, key); if (!u) return;
    this.entries(file)[key] = edit(this.entry(file, key), u, text, this.stage, Date.now());
    this.tmCache = null; this.persist(); this.emit();
  }
  /** Typing into a field of the scene screen: any row, stored at once, the screen is not redrawn. */
  writeAtQuiet(file: string, key: string, text: string): void {
    const u = this.unit(file, key); if (!u) return;
    this.entries(file)[key] = edit(this.entry(file, key), u, text, this.stage, Date.now());
    this.tmCache = null; this.linkTodoCache = null; this.persist();
  }
  /**
   * Send the open row. Refused with a reason (`why`), or done as an action of the journal (`batch`) that can be taken back.
   * `link` tells what the mode of the project did with the rows that have the same original: the empty ones were filled
   * (its own action `link.batch`), `link.pending` rows differ and wait for a look.
   */
  send(): { why?: string; batch?: string; link?: { batch?: string; n: number; pending: number } } {
    const c = this.current; if (!c) return { why: 'Рядок не вибрано' };
    const r = submit(c.entry, c.unit, this.stage, Date.now(), { blockErrors: this.saved.settings.blockErrors, qa: this.qaOpts() });
    if (!r.ok) return { why: r.reason };
    const now = Date.now();
    const batch = this.commit([{ file: c.file, key: c.unit.key, next: r.entry, text: r.entry.target }], 'send', 'надіслано');
    const sync = afterSend(this.saved, this.links(), linkModeOf(this.saved.settings), c.file, c.unit.key, now);
    // the twins are filled in as drafts marked «авто»; a proofread twin is not touched
    const filled = planOf(f => this.entries(f), sync.changes, 'link');
    const lb = applyPlan((c2, k, w) => this.commit(c2, k, w), filled);
    this.tmCache = null; this.persist(); this.emit();
    return { batch, ...(lb || sync.pending ? { link: { ...(lb ? { batch: lb } : {}), n: filled.changes.length, pending: sync.pending } } : {}) };
  }
  /** Approve the open row: a draft is sent first, so the history says both. */
  approve(): { why?: string; batch?: string } {
    const c = this.current; if (!c) return { why: 'Рядок не вибрано' };
    const r = approveEntry(c.entry, c.unit, Date.now(), { blockErrors: this.saved.settings.blockErrors, qa: this.qaOpts() });
    if (!r.ok) return { why: r.reason };
    const batch = this.commit([{ file: c.file, key: c.unit.key, next: r.entry, text: r.entry.target }], 'approve', 'вичитано');
    this.tmCache = null; this.persist(); this.emit(); return { batch };
  }
  /** Send a sent or approved row back to the translator (it becomes a draft marked «повернено»). */
  back(): { why?: string; batch?: string } {
    const c = this.current; if (!c) return { why: 'Рядок не вибрано' };
    if (c.entry?.status !== 'done' && c.entry?.status !== 'appr') return { why: 'Рядок ще не надіслано' };
    const batch = this.commit([{ file: c.file, key: c.unit.key, next: sendBack(c.entry, Date.now()), text: c.entry.target }], 'back');
    this.tmCache = null; this.persist(); this.emit(); return { batch };
  }
  /** Approve every row of these units that can be approved (a draft is sent first). */
  approveMany(file: string, units: Unit[], what = 'вичитано'): BulkResult {
    const now = Date.now(), changes: RowChange[] = [], why = new Map<string, number>(), blocked: { key: string; reason: string }[] = [];
    const opts = { blockErrors: this.saved.settings.blockErrors, qa: this.qaOpts() };
    for (const u of units) {
      const r = approveEntry(this.entry(file, u.key), u, now, opts);
      if (r.ok) changes.push({ file, key: u.key, next: r.entry, text: r.entry.target });
      else { const k = reasonKey(r.reason); why.set(k, (why.get(k) ?? 0) + 1); if (k === 'помилка QA') blocked.push({ key: u.key, reason: r.reason }); }
    }
    const auto = changes.filter(c => isAutoFilled(this.entry(file, c.key))).length;
    const batch = changes.length ? this.commit(changes, 'approve', what) : undefined;
    if (batch) { this.tmCache = null; this.persist(); this.emit(); }
    return { done: changes.length, skipped: units.length - changes.length, auto, why, blocked, batch };
  }
  /** Fill the empty rows of these units from the translation memory (a match of 70% or more); a batch of rows at a time, so a long selection does not freeze the screen. */
  async memoryFill(file: string, units: Unit[], progress?: (n: number, total: number) => void): Promise<{ n: number; batch?: string }> {
    const now = Date.now(), changes: RowChange[] = [], todo = units.filter(u => !this.entry(file, u.key)?.target);
    for (let i = 0; i < todo.length; i++) {
      const u = todo[i]!;
      const m = this.tm().find(u.source, { min: 70, limit: 1 })[0];
      if (m) changes.push({ file, key: u.key, next: edit(this.entry(file, u.key), u, m.t, this.stage, now), text: m.t, what: `підставлено з пам’яті (${m.score}%)` });
      if (i % 40 === 39) { progress?.(i + 1, todo.length); await new Promise(r => setTimeout(r, 0)); }
    }
    const batch = changes.length ? this.commit(changes, 'memory') : undefined;
    if (batch) { this.tmCache = null; this.persist(); this.emit(); }
    return { n: changes.length, batch };
  }
  comment(text: string): void { this.mutate((_f, _u, e) => addComment(e, this.who, text, Date.now())); }
  /** Answer a comment of the open row; the answer joins the thread. */
  reply(parentId: string, text: string): void { this.mutate((_f, _u, e) => replyTo(e, parentId, this.who, text, Date.now())); }
  /** Close a thread of the open row (or open it again). */
  resolve(rootId: string, on: boolean): void { const c = this.current; if (c?.entry) this.mutate((_f, _u, e) => resolveThread(e!, rootId, on, this.who, Date.now())); }
  editComment(id: string, text: string): void { const c = this.current; if (c?.entry) this.mutate((_f, _u, e) => editComment(e!, id, text, Date.now())); }
  deleteComment(id: string): void { const c = this.current; if (c?.entry) this.mutate((_f, _u, e) => deleteComment(e!, id, Date.now())); }
  /** Bring a text back into the open row; it is a change of its own in the history (with what was there before), so it can be taken back too. */
  restore(text: string, what: string): void {
    const c = this.current; if (!c) return;
    const now = Date.now();
    this.entries(c.file)[c.unit.key] = recordChange(c.entry, edit(c.entry, c.unit, text, this.stage, now), what, text, this.who, now);
    this.tmCache = null; this.persist(); this.emit();
  }
  mutate(fn: (file: string, unit: Unit, e: Entry | undefined) => Entry): void {
    const c = this.current; if (!c) return;
    this.entries(c.file)[c.unit.key] = fn(c.file, c.unit, c.entry);
    this.tmCache = null; this.persist(); this.emit();
  }
  /** Write rows as one action of the journal (each gets a history record with what it was before; the whole action can be taken back). */
  commit(changes: RowChange[], kind: BatchKind, what?: string): string { return commitRows(f => this.entries(f), changes, kind, this.who, Date.now(), what); }
  /** Empty the translation of these rows; an action of the journal, so it can be taken back from the activity feed. */
  clearMany(file: string, units: Unit[]): { n: number; batch?: string } {
    const now = Date.now(), changes: RowChange[] = [];
    for (const u of units) { const e = this.entry(file, u.key); if (!e?.target) continue; changes.push({ file, key: u.key, next: edit(e, u, '', this.stage, now), text: '' }); }
    const batch = changes.length ? this.commit(changes, 'clear') : undefined;
    if (batch) { this.tmCache = null; this.persist(); this.emit(); }
    return { n: changes.length, batch };
  }
  /** Send every translated row of these units that can be sent (the rest are counted with the reason, not blocked). Rows that are already sent are not an error and are not counted. */
  sendMany(file: string, units: Unit[], kind: BatchKind = 'send'): BulkResult {
    const now = Date.now(), changes: RowChange[] = [], why = new Map<string, number>(), blocked: { key: string; reason: string }[] = [];
    const opts = { blockErrors: this.saved.settings.blockErrors, qa: this.qaOpts() };
    let already = 0;
    for (const u of units) {
      const e = this.entry(file, u.key);
      if (e && (e.status === 'done' || e.status === 'appr')) { already++; continue; }
      const r = submit(e, u, this.stage, now, opts);
      if (r.ok) { changes.push({ file, key: u.key, next: r.entry, text: r.entry.target }); continue; }
      const k = reasonKey(r.reason);
      why.set(k, (why.get(k) ?? 0) + 1);
      if (k === 'помилка QA') blocked.push({ key: u.key, reason: r.reason });
    }
    const batch = changes.length ? this.commit(changes, kind, kind === 'send' ? 'надіслано' : undefined) : undefined;
    if (batch) { this.tmCache = null; this.persist(); this.emit(); }
    void already;
    return { done: changes.length, skipped: [...why.values()].reduce((a, b) => a + b, 0), why, blocked, batch };
  }
  /* ---------- groups of files ---------- */
  groupsList(): Group[] { return liveGroups(this.saved); }
  /** Files of a group, in the order of the game's files. */
  groupFiles(id: string): string[] { const idx = new GroupIndex(this.saved); return this.views.filter(v => idx.groupOf(v.name, '\u0000') === id).map(v => v.name); }
  /** The group of a file, or null. */
  fileGroup(file: string): Group | null { const id = new GroupIndex(this.saved).groupOf(file, '\u0000'); return id ? this.groupsList().find(g => g.id === id) ?? null : null; }
  /** The colours a group can take. */
  readonly groupColors = GROUP_COLORS;
  addGroup(name: string): Group | null { const g = createGroup(this.saved, name, Date.now()); if (g) { this.persist(); this.emit(); } return g; }
  placeFiles(files: string[], id: string | null): void { const now = Date.now(); for (const f of files) placeFile(this.saved, f, id, now); this.persist(); this.emit(); }
  renameGroup(id: string, name: string): 'ok' | 'empty' | 'exists' | 'missing' { const r = renameGroup(this.saved, id, name, Date.now()); if (r === 'ok') { this.persist(); this.emit(); } return r; }
  recolorGroup(id: string, color: string): void { if (recolorGroup(this.saved, id, color, Date.now())) { this.persist(); this.emit(); } }
  removeGroup(id: string): void { if (deleteGroup(this.saved, id, Date.now())) { this.persist(); this.emit(); } }
  /** Send every row of the files of a group that can be sent, as one action of the journal. */
  sendGroup(id: string): BulkResult {
    const files = this.groupFiles(id);
    const total: BulkResult = { done: 0, skipped: 0, why: new Map(), blocked: [], batch: undefined };
    const changesAll: RowChange[] = [];
    const now = Date.now(), opts = { blockErrors: this.saved.settings.blockErrors, qa: this.qaOpts() };
    for (const file of files) for (const u of this.view(file)?.units ?? []) {
      const e = this.entry(file, u.key);
      if (e && (e.status === 'done' || e.status === 'appr')) continue;
      const r = submit(e, u, this.stage, now, opts);
      if (r.ok) { changesAll.push({ file, key: u.key, next: r.entry, text: r.entry.target }); continue; }
      const k = reasonKey(r.reason);
      total.why.set(k, (total.why.get(k) ?? 0) + 1); total.skipped++;
      if (k === 'помилка QA') total.blocked.push({ key: `${file}\u001f${u.key}`, reason: r.reason });
    }
    total.done = changesAll.length;
    if (changesAll.length) { total.batch = this.commit(changesAll, 'send', 'надіслано'); this.tmCache = null; this.persist(); this.emit(); }
    return total;
  }
  /** The rows of every file of a group, as (file, row) pairs in the order of the game (the phone shows them as one list, a tap opens the row). */
  groupRowList(id: string): { file: string; unit: Unit }[] {
    const by = new Map(this.views.map(v => [v.name, new Map(v.units.map(u => [u.key, u]))] as const));
    const out: { file: string; unit: Unit }[] = [];
    for (const r of rowsOfGroup(this.saved, this.views, id)) { const u = by.get(r.file)?.get(r.key); if (u) out.push({ file: r.file, unit: u }); }
    return out;
  }
  find(o: { find: string; replace: string; caseSensitive: boolean; wholeWord: boolean }): ReturnType<typeof findReplace> { return findReplace(this.views, this.saved, o); }
  /** What a replacement would do to proofread and sent rows (for the screen, before anything is written). */
  replaceImpact(matches: ReturnType<typeof findReplace>): { appr: number; done: number } {
    let appr = 0, done = 0;
    for (const m of matches) { const st = this.entry(m.file, m.key)?.status; if (st === 'appr') appr++; else if (st === 'done') done++; }
    return { appr, done };
  }
  /** Replace as one action; proofread rows are left alone unless `includeApproved` (they then fall back to drafts). `note` says what was left out. */
  replaceAll(matches: ReturnType<typeof findReplace>, includeApproved = false): { n: number; batch?: string; message: string } {
    const now = Date.now(), changes: RowChange[] = [];
    for (const m of matches) {
      const u = this.unit(m.file, m.key); if (!u) continue;
      changes.push({ file: m.file, key: m.key, next: edit(this.entry(m.file, m.key), u, m.after, this.stage, now), text: m.after });
    }
    const plan = planOf(f => this.entries(f), changes, 'replace', includeApproved ? 'include' : 'skip');
    const batch = applyPlan((c, k, w) => this.commit(c, k, w), plan);
    if (batch) { this.tmCache = null; this.persist(); this.emit(); }
    return { n: plan.changes.length, batch, message: planMessage(plan, plan.changes.length) };
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
  /** What the last change of a term means for the rows (see `termChange`); null when nothing has to be replaced. */
  lastTermChange: TermChange | null = null;
  saveTerm(en: string, uk: string, alt: string, qa: boolean): boolean {
    const key = en.trim().toLowerCase();
    const was = this.saved.terms.find(x => x.en.trim().toLowerCase() === key);
    // a copy of the term as it was: after the change its old rendering is looked for in the translations
    const prev = was ? { en: was.en, uk: was.uk, alt: [...(was.alt ?? [])] } : undefined;
    const r = saveTerm(this.saved, { en, uk, alt, qa }, Date.now(), was ? en : undefined);
    if (r === null) return false;
    const now = this.saved.terms.find(x => x.en.trim().toLowerCase() === key);
    this.lastTermChange = r === 'changed' && now ? termChange(prev, { en: now.en, uk: now.uk, alt: now.alt }) : null;
    this.tmCache = null; this.persist(); this.emit(); return true;
  }
  /** The rows that hold the old rendering of a term, with what to put in their place. */
  planTermSync(change: TermChange, limit = 2000): TermSync { return proposeTermSync(this.views, this.saved, change, { limit }); }
  /** Write the chosen replacements as one action of the journal; the rows keep their status. */
  applyTermSync(picks: { proposal: TermProposal; choice?: number[] }[]): { n: number; batch?: string; skipped: number } {
    const changes = termChanges(picks, this.saved, Date.now());
    if (!changes.length) return { n: 0, skipped: 0 };
    // a proofread row keeps its text: the glossary tool does not rewrite it unasked
    const plan = planOf(f => this.entries(f), changes, 'term');
    const batch = applyPlan((c, k, w) => this.commit(c, k, w), plan);
    if (batch) { this.tmCache = null; this.persist(); this.emit(); }
    return { n: plan.changes.length, batch, skipped: plan.skipped.length };
  }
  removeTerm(en: string): void {
    removeTerm(this.saved, en, Date.now());
    this.persist(); this.emit();
  }
  /* ---------- autofill by words ---------- */
  wordCount(): number { return learnWords(this.views, this.saved).size; }
  autofill(): ReturnType<typeof autofillProposals> { return autofillProposals(this.views, this.saved); }
  /** Sends that can still be taken back (newest first). */
  sends(): ReturnType<typeof sendBatches> { return sendBatches(this.views, this.saved); }
  autos(): ReturnType<typeof autoBatches> { return autoBatches(this.views, this.saved); }
  autosUndone(): ReturnType<typeof autoUndone> { return autoUndone(this.views, this.saved); }
  undoAutoFill(at: number, kind: string): number {
    const b = this.autos().find(x => x.at === at && x.kind === kind); if (!b) return 0;
    const n = undoAuto(this.saved, b, this.who, Date.now());
    if (n) { this.tmCache = null; this.persist(); this.emit(); }
    return n;
  }
  undone(): ReturnType<typeof undoneBatches> { return undoneBatches(this.views, this.saved); }
  /** Bulk actions of the journal that can still be taken back. */
  journal(): ReturnType<typeof journalBatches> { return journalBatches(this.views, this.saved); }
  undoJournalBatch(id: string): ReturnType<typeof undoJournal> {
    const r = undoJournal(this.saved, id, this.who, Date.now());
    if (r.done) { this.tmCache = null; this.persist(); this.emit(); }
    return r;
  }
  undoSend(at: number, kind: string, guessed = false): number {
    const b = this.sends().find(x => x.at === at && x.kind === kind && !!x.guessed === guessed); if (!b) return 0;
    const n = undoBatch(this.saved, b, this.who, Date.now());
    if (n) { this.persist(); this.emit(); }
    return n;
  }
  /** Short untranslated lines that are one or two words short of being composed, with the words that block them. */
  almost(): ReturnType<typeof autofillAlmost> { return autofillAlmost(this.views, this.saved); }
  /** Write the proposals as drafts marked as autofilled; rows that got a translation meanwhile are skipped. */
  applyAutofill(list: { file: string; key: string; target: string }[]): { n: number; batch?: string } {
    const now = Date.now(), changes: RowChange[] = [];
    for (const p of list) {
      const u = this.unit(p.file, p.key); if (!u || this.entry(p.file, p.key)?.target?.trim()) continue;
      changes.push({ file: p.file, key: p.key, next: edit(this.entry(p.file, p.key), u, p.target, this.stage, now), text: p.target });
    }
    const batch = changes.length ? this.commit(changes, 'words') : undefined;
    if (batch) { this.tmCache = null; this.persist(); this.emit(); }
    return { n: changes.length, batch };
  }
  /** The mode of the project for rows with the same original. */
  linkMode(): ReturnType<typeof linkModeOf> { return linkModeOf(this.saved.settings); }
  /** The cluster of rows that share the original of this row, with the state of each, or null. */
  linkView(file: string, key: string): ReturnType<typeof linkView> { return linkView(this.saved, this.links(), file, key); }
  linkPlan(file: string, key: string): ReturnType<typeof planLinkSync> { return planLinkSync(this.saved, this.links(), file, key); }
  /** Clusters with rows that differ or are empty next to a translation, the biggest first. */
  linkClusters(limit = 60): ReturnType<typeof reviewClusters> { return reviewClusters(this.saved, this.links(), limit); }
  /** How many clusters have something to look at (for the badge of the menu; remembered until the next change). */
  linkTodo(): number { return (this.linkTodoCache ??= reviewClusters(this.saved, this.links(), 1).total); }
  /** Write the reference into the given rows as one action of the journal. */
  applyLinks(reference: string, rows: LinkRowView[], protect: Protect = 'skip'): { n: number; skipped: number; batch?: string } {
    // A proofread row keeps its text unless it was ticked by hand (`protect: 'include'`).
    const plan = planOf(f => this.entries(f), linkChanges(reference, rows, Date.now()), 'link', protect);
    if (!plan.changes.length) return { n: 0, skipped: plan.skipped.length };
    const batch = applyPlan(c => this.commit(c, 'link'), plan);
    this.tmCache = null; this.persist(); this.emit();
    return { n: plan.changes.length, skipped: plan.skipped.length, batch };
  }
  /** Keep this variant in a cluster: its row becomes the main one and the rest (also the empty rows) take its text. */
  keepVariant(file: string, key: string, variantRow: { file: string; key: string; source: string }): { n: number; skipped?: number; batch?: string } {
    setMain(this.saved, variantRow, Date.now());
    const v = this.linkView(file, key), ref = v?.reference;
    if (!v || !ref) { this.persist(); this.emit(); return { n: 0, skipped: 0 }; }
    return this.applyLinks(ref.target, v.rows.filter(r => r.state === 'empty' || r.state === 'differs' || r.state === 'edited'));
  }
  /** Fill the empty rows of a cluster from its reference. */
  fillLinked(file: string, key: string): { n: number; skipped?: number; batch?: string } {
    const plan = this.linkPlan(file, key);
    return plan?.view.reference ? this.applyLinks(plan.view.reference.target, plan.fills) : { n: 0 };
  }
  setMainRow(row: { file: string; key: string; source: string }): void { setMain(this.saved, row, Date.now()); this.persist(); this.emit(); }
  clearMainRow(source: string): void { clearMain(this.saved, source, Date.now()); this.persist(); this.emit(); }
  unlinkRow(row: { file: string; key: string; source: string }): void { unlinkRow(this.saved, row, Date.now()); this.persist(); this.emit(); }
  relinkRow(row: { file: string; key: string }): void { relinkRow(this.saved, row, Date.now()); this.persist(); this.emit(); }
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
  /** Re-flow the open row to the width of the game window; the batch of the action, or undefined when nothing had to change. */
  wrap(): { batch?: string } | null {
    const c = this.current; if (!c) return null;
    const plan = this.wrapPlan(); if (plan.disabled) return null;
    const text = wrapMessage(plan, c.unit, c.entry?.target ?? '').text;
    if (text === (c.entry?.target ?? '')) return null;
    const batch = this.commit([{ file: c.file, key: c.unit.key, next: edit(c.entry, c.unit, text, this.stage, Date.now()), text }], 'wrap');
    this.tmCache = null; this.persist(); this.emit();
    return { batch };
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
    // a new version of the game is lined up with the old one by the text of the originals, so a line put in does not shift the translations
    const ing = planIngest(this.saved.snapshot, kept, this.saved.files, Date.now());
    this.lastIngest = ingestQuiet(ing.report) ? null : { batch: ing.changes.length ? this.commit(ing.changes, 'rekey') : undefined, report: ing.report };
    const snap = snapshotOf(this.views);
    if (JSON.stringify(snap) !== JSON.stringify(this.saved.snapshot ?? null)) { this.saved.assetsRev = Date.now(); this.saved.snapshot = snap; }
    // rows whose original changed: the sent and proofread ones go back to drafts as one action of the journal (visible, can be taken back)
    const rec = reconcileChanges(this.views, this.saved.files, Date.now());
    this.lastReconcile = rec.changes.length ? { batch: this.commit(rec.changes, 'reconcile'), demoted: rec.changes.length } : null;
    const changed = rec.changed;
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

  /* ---------- importing glossary and memory, plugin texts, reset, search ---------- */
  /** New terms are added; a known word only gets the extra variants. */
  addTerms(terms: GlossaryTerm[]): { added: number; merged: number } {
    let added = 0, merged = 0;
    const have = new Map(this.saved.terms.map(t => [t.en.toLowerCase(), t]));
    for (const t of terms) {
      const cur = have.get(t.en.toLowerCase());
      if (!cur) { this.saved.terms.push(t); have.set(t.en.toLowerCase(), t); added++; continue; }
      const known = new Set([cur.uk, ...(cur.alt ?? [])].map(x => x.toLowerCase()));
      const more = [t.uk, ...(t.alt ?? [])].filter(x => !known.has(x.toLowerCase()));
      if (more.length) { cur.alt = [...(cur.alt ?? []), ...more]; cur.mt = Date.now(); merged++; }
    }
    touchTerms(this.saved.terms);
    this.tmCache = null; this.persist(); this.emit();
    return { added, merged };
  }
  /** A sheet saved as .html or a .csv / .tsv with «Оригінал», «Переклад 1…» columns. */
  importTermsFile(name: string, text: string, qa: boolean): { added: number; merged: number; skipped: number } | null {
    const rows = /\.html?$/i.test(name) || /<table/i.test(text.slice(0, 5000)) ? parseHtmlTable(text) : parseDelimited(text);
    const { terms, skipped } = termsFromTable(rows, Date.now(), qa);
    return terms.length ? { ...this.addTerms(terms), skipped } : null;
  }
  /** Lines «english, tab, ukrainian». */
  importTermsText(text: string): { added: number; rejected: number } {
    const { terms, rejected } = parseTerms(text);
    let added = 0;
    for (const t of terms) if (!this.saved.terms.some(x => x.en.toLowerCase() === t.en.toLowerCase())) { this.saved.terms.push({ ...t, mt: Date.now() }); added++; }
    touchTerms(this.saved.terms);
    this.tmCache = null; this.persist(); this.emit();
    return { added, rejected };
  }
  /** Lines «original, tab, translation» go to the translation memory. */
  importMemory(text: string): { added: number; rejected: number } {
    let added = 0, rejected = 0;
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const [a, b] = line.split('\t');
      if (!a?.trim() || !b?.trim()) { rejected++; continue; }
      if (!this.saved.memory.some(m => m.s === a.trim() && m.t === b.trim())) { this.saved.memory.push({ s: a.trim(), t: b.trim(), mt: Date.now() }); added++; }
    }
    this.tmCache = null; this.persist(); this.emit();
    return { added, rejected };
  }
  /** Everything translated and imported is dropped; the game files stay as they are. */
  resetProject(): void {
    const keep = this.saved.resetEpoch;
    this.saved = { ...emptyProject(this.saved.name), resetEpoch: Math.max(keep, Date.now()) };
    this.views = []; this.game = []; this.file = null; this.key = null; this.tmCache = null;
    this.persist(); this.emit();
  }
  pluginCands(): ReturnType<typeof pluginCandidates> { return pluginCandidates(this.game); }
  /** Which plugin commands hold text. Returns how many rows that added (or took away). */
  setPluginCommands(names: string[]): number {
    const st = this.saved.settings;
    st.pluginsAsked = true;
    if (names.length === st.pluginCommands.length && names.every(n => st.pluginCommands.includes(n))) { this.persist(); return 0; }
    st.pluginCommands = names; this.saved.settingsAt = Date.now();
    const total = (): number => this.views.reduce((n, v) => n + v.units.length, 0), was = total();
    this.ingest(this.game);
    return total() - was;
  }
  /** Rows, files and terms that match, newest rule of the desktop «Знайти скрізь»: original, translation or key. */
  searchAll(q: string, limit = 60): { file: string; key: string; source: string; target: string }[] {
    const w = q.trim().toLowerCase(); if (!w) return [];
    const out: { file: string; key: string; source: string; target: string }[] = [];
    for (const v of this.views) {
      const ents = this.saved.files[v.name] ?? {};
      for (const u of v.units) {
        const t = ents[u.key]?.target ?? '';
        if ((u.source + ' ' + t + ' ' + u.key).toLowerCase().includes(w)) { out.push({ file: v.name, key: u.key, source: u.source, target: t }); if (out.length >= limit) return out; }
      }
    }
    return out;
  }
  private usageCache: { game: GameFile[]; u: ReturnType<typeof buildUsage> } | null = null;
  /** Where the game hands out an item, weapon, armour or skill (only while the game files are loaded). */
  usageOf(file: string, key: string): string[] {
    if (!this.game.length || !/^(Items|Weapons|Armors|Skills)\.json$/.test(file)) return [];
    if (!this.usageCache || this.usageCache.game !== this.game) this.usageCache = { game: this.game, u: buildUsage(this.game, f => this.saved.labels?.[f]) };
    return this.usageCache.u.get(usageKey(file, key) ?? '') ?? [];
  }
  /** `saved` was replaced (sync, import): rebuild what is shown from it. */
  adopt(): void {
    if (!this.game.length) this.views = viewsFromSnapshot(this.saved);
    this.tmCache = null;
    if (!this.file || !this.view(this.file)) { this.file = this.views[0]?.name ?? null; this.key = null; }
    this.persist(); this.emit();
  }
}
