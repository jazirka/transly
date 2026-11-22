import { diffWords, edit, learnWords, plausible, proposals } from '../core';
import type { RowChange } from '../core';
import { esc, plural, toast } from './dom';
import type { Ctx } from './state';
import { undoToast } from './undo-toast';

/**
 * The autofill is not a screen of its own: it is a mode of the table of the project. Switched on, it looks for what can be written in the
 * empty rows (a line with the same original that was translated, the translation memory with how close the match is, the words of
 * translated short lines) and shows each find in the «Переклад» cell of its row, in grey, with the dot of its source. A find is taken
 * (written when the translator says «Вписати») from the closeness the slider says, or by the translator's own decision. What is learned
 * from is the translator's choice: the lines that were sent (the default) or the drafts too. Nothing is written until then; the rows are
 * written as one action of the journal («autofill»), drafts with the note «авто», with its «Скасувати».
 */

export type From = 'same' | 'tm' | 'words';
export interface FillRow { file: string; key: string; source: string; target: string; from: From; score: number; base?: string }
export const FROMS: { id: From; label: string; dot: string; tip: string }[] = [
  { id: 'same', label: 'Однакові оригінали', dot: 'ok', tip: 'такий самий оригінал уже перекладено' },
  { id: 'tm', label: 'З пам’яті', dot: 'info', tip: 'збіг у пам’яті перекладів' },
  { id: 'words', label: 'За словами', dot: 'bad', tip: 'складено зі слів перекладених рядків' },
];
export const idOf = (r: { file: string; key: string }): string => `${r.file}\u0001${r.key}`;
const store = (k: string, v?: string): string | null => { try { if (v !== undefined) localStorage.setItem(k, v); return localStorage.getItem(k); } catch { return null; } };

export type Choice = { take: 'yes' } | { take: 'no' } | { take: 'custom'; text: string };
export const fill = {
  on: false,
  building: false,
  found: 0,
  rows: [] as FillRow[],
  byId: new Map<string, FillRow>(),
  /** The number of finds of each file (kept up to date as they are found, so the tabs and the bar do not count them again). */
  perFile: new Map<string, number>(),
  choice: new Map<string, Choice>(),
  drafts: store('transly.af.drafts') === '1',
  only: false,
  threshold: Math.min(100, Math.max(50, Number(store('transly.af.min')) || 85)),
};
let buildId = 0;

/** The find for a row, while the mode is on. */
export const fillOf = (file: string, key: string): FillRow | undefined => (fill.on ? fill.byId.get(`${file}\u0001${key}`) : undefined);
export const fillChoice = (r: FillRow): Choice | undefined => fill.choice.get(idOf(r)) ?? (r.score >= fill.threshold ? { take: 'yes' } : undefined);
export const fillText = (r: FillRow): string => { const c = fillChoice(r); return c?.take === 'custom' ? c.text : r.target; };
export const fillWrites = (r: FillRow): boolean => { const c = fillChoice(r); return !!c && c.take !== 'no' && !!fillText(r).trim(); };
export const fillCounts = (): { goes: number; no: number; pending: number } => {
  const c = { goes: 0, no: 0, pending: 0 };
  for (const r of fill.rows) { const d = fillChoice(r); if (!d) c.pending++; else if (fillWrites(r)) c.goes++; else c.no++; }
  return c;
};
export const fillFiles = (): string[] => [...fill.perFile.keys()];

export function setThreshold(n: number): void { fill.threshold = Math.min(100, Math.max(50, n)); store('transly.af.min', String(fill.threshold)); }
export function setDrafts(on: boolean): void { fill.drafts = on; store('transly.af.drafts', on ? '1' : '0'); fill.choice.clear(); }

/** Look for what can be written: the same originals and the words at once, the memory step by step (the page stays alive). */
export async function buildFill(ctx: Ctx, progress: () => void): Promise<void> {
  const me = ++buildId, s = ctx.s;
  fill.building = true; fill.rows = []; fill.found = 0; fill.byId = new Map(); fill.perFile = new Map();
  progress();
  const o = { drafts: fill.drafts };
  const dict = learnWords(s.views, s.saved, o);
  const rows = fill.rows;
  const add = (r: FillRow): void => { rows.push(r); fill.byId.set(idOf(r), r); fill.perFile.set(r.file, (fill.perFile.get(r.file) ?? 0) + 1); fill.found = rows.length; };
  const first = proposals(s.views, s.saved, dict, 5000, o);
  const have = new Set<string>();
  for (const p of first) { have.add(idOf(p)); add({ file: p.file, key: p.key, source: p.source, target: p.target, from: p.from, score: p.from === 'same' ? 100 : 60, ...(p.from === 'same' ? { base: p.source } : {}) }); }
  progress();
  const tm = ctx.tm();
  let last = performance.now();
  for (const v of s.views) {
    const ents = ctx.entries(v.name);
    for (const u of v.units) {
      if (have.has(idOf({ file: v.name, key: u.key })) || ents[u.key]?.target?.trim()) continue;
      const m = tm.find(u.source, { min: 70, limit: 1 })[0];
      if (m && plausible(u.source, m.t)) {
        // a word that was swapped for another one (not added, not dropped) means the memory's translation names the wrong thing («Red cat» for «Red cow»)
        const g = diffWords(m.s, u.source);
        const swapped = g.some(x => x.t === 'del') && g.some(x => x.t === 'add');
        // such a find is not offered at all: «Abella's head» → «Абелла [голова]» is a name of someone else
        if (!swapped) add({ file: v.name, key: u.key, source: u.source, target: m.t, from: 'tm', score: m.score, base: m.s });
      }
      if (performance.now() - last > 40) {
        progress();
        await new Promise(r => setTimeout(r, 0));
        if (me !== buildId) return;
        last = performance.now();
      }
    }
  }
  if (me !== buildId) return;
  rows.sort((a, b) => (a.file === b.file ? 0 : a.file < b.file ? -1 : 1));
  fill.building = false;
  progress();
}

export function stopFill(): void { buildId++; fill.on = false; fill.only = false; fill.building = false; fill.rows = []; fill.byId = new Map(); fill.perFile = new Map(); fill.choice.clear(); }

const WHAT: Record<From, (r: FillRow) => string> = { same: () => 'підставлено з однакового рядка', words: () => 'автозаповнено за словами', tm: r => `підставлено з пам’яті (${r.score}%)` };

/** Write what is taken, as one action of the journal; returns false when there was nothing to write. */
export function applyFill(ctx: Ctx): boolean {
  const s = ctx.s, now = Date.now(), changes: RowChange[] = [];
  let skipped = 0;
  for (const r of fill.rows) {
    if (!fillWrites(r)) continue;
    const u = s.views.find(v => v.name === r.file)?.units.find(x => x.key === r.key), ents = ctx.entries(r.file);
    // a row that got a translation while the mode was on is left alone
    if (!u || ents[r.key]?.target?.trim()) { skipped++; continue; }
    const text = fillText(r);
    changes.push({ file: r.file, key: r.key, next: edit(ents[r.key], u, text, ctx.stage(), now), text, what: WHAT[r.from](r) });
  }
  if (!changes.length) { toast(skipped ? 'Ці рядки вже мають переклад' : 'Нічого вписувати: поставте «+» хоча б в одному рядку'); return false; }
  const batch = ctx.commit(changes, 'autofill');
  ctx.invalidateTm(); ctx.persist();
  const n = changes.length;
  stopFill();
  ctx.render();
  undoToast(ctx, `Автозаповнено ${plural(n, ['рядок', 'рядки', 'рядків'])} як чернетки з позначкою «авто»${skipped ? `. Ще ${skipped} вже мали переклад` : ''}`, batch);
  return true;
}

/** The cell «Переклад» of a row that has a find: the text in grey, with the dot of its source, and «−» / «+» to settle it. */
export function fillCellHtml(r: FillRow): string {
  const kind = FROMS.find(f => f.id === r.from)!, taken = fillWrites(r), c = fillChoice(r), own = fill.choice.get(idOf(r));
  const btn = (d: 'no' | 'yes'): string => `<button type="button" class="fb2 ${d === 'no' ? 'm' : 'p'}${own && (d === 'no' ? own.take === 'no' : own.take !== 'no') ? ' on' : ''}" data-fd="${d}" aria-label="${d === 'no' ? 'Не заповнювати' : 'Вписати'}" title="${d === 'no' ? 'Не заповнювати (ще раз — повернути)' : 'Вписати (ще раз — повернути)'}">${d === 'no' ? '−' : '+'}</button>`;
  return `<span class="fl ${taken ? 'yes' : c?.take === 'no' ? 'no' : ''}" title="${esc(kind.tip)}${r.from === 'tm' ? `: ${r.score}%` : ''}"><i class="dot ${kind.dot}"></i>${esc(fillText(r))}</span><span class="fl-b">${btn('no')}${btn('yes')}</span>`;
}
/** The cell «К-сть зн.» of such a row: how close the find is. */
export const fillLenHtml = (r: FillRow): string => `<span class="fs ${r.from}">${r.from === 'tm' ? `${r.score}%` : r.from === 'same' ? '=' : 'слова'}</span>`;
