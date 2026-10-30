import { isAutoNote } from '../core';
import type { FileView, SavedProject } from '../core';

/** One row as the home-screen widgets show it: where it is, its original and its translation (shortened). */
export interface WRow { file: string; key: string; s: string; t: string; st: string }

export interface WidgetPayload {
  name: string; file: string; total: number; approved: number; done: number; draft: number;
  /** The row open in the editor (or the first one to continue with). */
  cur: (WRow & { pos: number; of: number }) | null;
  /** Next rows to work on, per mode: new (no translation), draft, auto (filled by the app), waiting (for review). */
  queue: Record<'new' | 'draft' | 'auto' | 'waiting', WRow[]>;
  counts: Record<'new' | 'draft' | 'auto' | 'waiting', number>;
  /** Rows touched per day, the last seven days, today last. */
  days: number[];
  today: number; week: number; streak: number;
  /** The open file: shown name and share of translated rows. */
  curName: string; curP: number;
  /** The biggest files: name and the share of translated rows. */
  files: { n: string; p: number }[];
  /** First untranslated row (kept for the older «next line» widget). */
  next?: { file: string; key: string; text: string };
}

const QUEUE = 8;
const clip = (t: string, n: number): string => { const s = t.replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const DAY = 86_400_000;
const startOfDay = (t: number): number => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };

/** Everything the widgets need in one small object; built from the project, not from the screen. */
export function buildWidget(views: FileView[], saved: SavedProject, cur: { file: string; key: string } | null, now = Date.now()): WidgetPayload {
  const out: WidgetPayload = {
    name: saved.name, file: cur?.file ?? '', total: 0, approved: 0, done: 0, draft: 0, cur: null,
    queue: { new: [], draft: [], auto: [], waiting: [] }, counts: { new: 0, draft: 0, auto: 0, waiting: 0 },
    days: [0, 0, 0, 0, 0, 0, 0], curName: '', curP: 0, today: 0, week: 0, streak: 0, files: [],
  };
  const today0 = startOfDay(now);
  // The open file first, the others after it; inside the open file the rows after the open one come first.
  const order = [...views].sort((a, b) => Number(b.name === cur?.file) - Number(a.name === cur?.file));
  const perFile: { id: string; n: string; total: number; tr: number }[] = [];
  for (const v of order) {
    const ents = saved.files[v.name] ?? {};
    const from = v.name === cur?.file ? Math.max(0, v.units.findIndex(u => u.key === cur.key) + 1) : 0;
    let tr = 0;
    const seq = [...v.units.slice(from), ...v.units.slice(0, from)];
    for (const u of seq) {
      const e = ents[u.key], target = e?.target?.trim() ?? '';
      const row = (): WRow => ({ file: v.name, key: u.key, s: clip(u.source, 140), t: clip(target, 140), st: e?.status ?? 'new' });
      out.total++;
      if (target) tr++;
      if (e?.status === 'appr') out.approved++; else if (e?.status === 'done') out.done++; else if (e?.status === 'draft') out.draft++;
      const last = e?.history?.at(-1);
      const mode: keyof WidgetPayload['queue'] | null = !target ? (u.kind !== 'name' && u.kind !== 'term' ? 'new' : null)
        : last && isAutoNote(last.what) ? 'auto' : e?.status === 'draft' ? 'draft' : e?.status === 'done' ? 'waiting' : null;
      if (mode) { out.counts[mode]++; if (out.queue[mode].length < QUEUE) out.queue[mode].push(row()); }
      if (e) {
        const seen = new Set<number>();
        for (const t of [e.mt, ...(e.history ?? []).map(h => h.at)]) { const ago = Math.round((today0 - startOfDay(t)) / DAY); if (ago >= 0 && ago < 7) seen.add(ago); }
        for (const ago of seen) out.days[6 - ago]!++;
      }
    }
    perFile.push({ id: v.name, n: v.label ?? v.name.replace(/\.json$/, ''), total: v.units.length, tr });
  }
  out.today = out.days[6]!; out.week = out.days.reduce((a, b) => a + b, 0);
  let i = out.today > 0 ? 6 : 5;
  while (i >= 0 && out.days[i]! > 0) { out.streak++; i--; }
  out.files = perFile.sort((a, b) => b.total - a.total).slice(0, 5).map(f => ({ n: f.n.slice(0, 18), p: f.total ? Math.round((100 * f.tr) / f.total) : 0 }));
  const cf = perFile.find(f => f.id === cur?.file);
  if (cf) { out.curName = cf.n; out.curP = cf.total ? Math.round((100 * cf.tr) / cf.total) : 0; }
  if (cur) {
    const v = views.find(x => x.name === cur.file), idx = v ? v.units.findIndex(u => u.key === cur.key) : -1;
    if (v && idx >= 0) { const u = v.units[idx]!, e = saved.files[v.name]?.[u.key]; out.cur = { file: v.name, key: u.key, s: clip(u.source, 200), t: clip(e?.target ?? '', 200), st: e?.status ?? 'new', pos: idx + 1, of: v.units.length }; }
  }
  const n = out.queue.new[0];
  if (n) out.next = { file: n.file, key: n.key, text: n.s };
  return out;
}
