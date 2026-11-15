import { nextMt } from './model';
import type { Entry, Unit } from './model';
import type { RowChange } from './journal';

/**
 * A row's key is its position in the game file, so one message put in at the start of an event moves every later key by one:
 * the translations would stay where they were and end up next to the wrong lines. When a new version of the game is read,
 * `planIngest` therefore lines the old rows of each file up with the new ones by the text of the original (the order of the
 * file is kept) and moves the translations to the keys their lines now have. Lines that are gone are not thrown away: their
 * translation is parked under a key no row has (`parkedKey`) and is given back if the same original turns up again.
 */

/** Parked translations live under `<old key>` + this marker: no row of any game has such a key, so they never show up, never count and are never overwritten. */
export const GONE = '\u0002gone';
export const isParked = (key: string): boolean => key.includes(GONE);

/** How many edits (inserted plus removed lines) a file may differ by before the alignment is not tried (the cost grows with it). */
export const MAX_EDITS = 600;

/**
 * The lines the two lists have in common, as pairs of indexes (old, new) in ascending order, or `null` when they differ in
 * more than `maxEdits` lines. The common start and end are matched first, the rest by the shortest edit script (Myers).
 */
export function alignSources(a: string[], b: string[], maxEdits = MAX_EDITS): [number, number][] | null {
  const n = a.length, m = b.length;
  let head = 0;
  while (head < n && head < m && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < n - head && tail < m - head && a[n - 1 - tail] === b[m - 1 - tail]) tail++;
  const out: [number, number][] = [];
  for (let i = 0; i < head; i++) out.push([i, i]);
  const mid = myers(a.slice(head, n - tail), b.slice(head, m - tail), maxEdits);
  if (!mid) return null;
  for (const [i, j] of mid) out.push([i + head, j + head]);
  for (let k = tail; k > 0; k--) out.push([n - k, m - k]);
  return out;
}

function myers(a: string[], b: string[], maxEdits: number): [number, number][] | null {
  const N = a.length, M = b.length;
  if (!N || !M) return [];
  const max = Math.min(N + M, maxEdits), off = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  for (let d = 0; d <= max; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[k - 1 + off]! < v[k + 1 + off]!) ? v[k + 1 + off]! : v[k - 1 + off]! + 1;
      let y = x - k;
      while (x < N && y < M && a[x] === b[y]) { x++; y++; }
      v[k + off] = x;
      if (x >= N && y >= M) {
        const out: [number, number][] = [];
        x = N; y = M;
        for (let dd = d; dd >= 0; dd--) {
          const vd = trace[dd]!, kk = x - y;
          const prevK = kk === -dd || (kk !== dd && vd[kk - 1 + off]! < vd[kk + 1 + off]!) ? kk + 1 : kk - 1;
          const px = vd[prevK + off]!, py = px - prevK;
          while (x > px && y > py) { x--; y--; out.push([x, y]); }
          x = px; y = py;
        }
        return out.reverse();
      }
    }
  }
  return null;
}

export interface IngestRow { file: string; key: string; source: string; target: string }
export interface IngestReport {
  /** Translations that went to another key because the line moved (same text). */
  moved: number;
  /** Translations that went along with a line whose text was edited (the usual «original changed» handling follows). */
  edited: number;
  /** Translations given back to a line whose original reappeared (they were parked before). */
  adopted: number;
  /** Lines that are gone from the game: their translation is kept, parked. */
  gone: IngestRow[];
  /** Lines that are new in the game and have no translation. */
  added: IngestRow[];
  /** Files that differ too much to be lined up: they are left as they were. */
  unaligned: string[];
}
export interface IngestPlan { changes: RowChange[]; report: IngestReport }

const hasContent = (e: Entry | undefined): e is Entry => !!e && (!!e.target?.trim() || !!e.comments?.length);

export const ingestCount = (r: IngestReport): number => r.moved + r.edited + r.adopted + r.gone.length;
/** Nothing to tell the translator. */
export const ingestQuiet = (r: IngestReport): boolean => !ingestCount(r) && !r.added.length && !r.unaligned.length;

/** The translated game rows by their original, for the translator to see what happened (a few of each kind). */
export function ingestNote(r: IngestReport): string {
  const parts: string[] = [];
  const n = r.moved + r.edited + r.adopted;
  if (n) parts.push(`перенесено за текстом оригіналу: ${n}`);
  if (r.added.length) parts.push(`нових рядків: ${r.added.length}`);
  if (r.gone.length) parts.push(`зникло з гри (переклад збережено): ${r.gone.length}`);
  if (r.unaligned.length) parts.push(`надто змінені, не зіставлено: ${r.unaligned.length} ${r.unaligned.length === 1 ? 'файл' : 'файлів'}`);
  return parts.join(' · ');
}

/**
 * Work out how the translations must move when `views` (the new version) replace `oldSnap` (the rows the translations were
 * written against). Nothing is written here: the caller commits `changes` as one action of the journal (kind `rekey`).
 */
export function planIngest(oldSnap: Record<string, Unit[]> | undefined, views: { name: string; units: Unit[] }[], files: Record<string, Record<string, Entry>>, now: number): IngestPlan {
  const report: IngestReport = { moved: 0, edited: 0, adopted: 0, gone: [], added: [], unaligned: [] };
  const changes: RowChange[] = [];
  if (!oldSnap) return { changes, report };
  for (const v of views) {
    const old = oldSnap[v.name];
    if (!old?.length) continue;
    const units = v.units;
    if (old.length === units.length && old.every((u, i) => u.key === units[i]!.key && u.source === units[i]!.source)) continue;
    // The speaker is part of what a line is: two people saying the same words are two lines (otherwise a line put in between swaps their translations).
    const sig = (u: Unit): string => `${u.speaker ?? ''}\u241F${u.source}`;
    const pairs = alignSources(old.map(sig), units.map(sig));
    // almost nothing in common (and not the same number of lines): this is another text, not an update of this one
    if (!pairs || (old.length !== units.length && pairs.length < 0.2 * Math.min(old.length, units.length))) { report.unaligned.push(v.name); continue; }
    const ents = files[v.name] ?? {};
    /** old index -> new index (a line that stayed, moved or was edited in place) */
    const dest = new Map<number, number>(), edited = new Set<number>();
    const matchedNew = new Set<number>();
    let pi = -1, pj = -1;
    for (const [i, j] of [...pairs, [old.length, units.length] as [number, number]]) {
      const olds: number[] = [], news: number[] = [];
      for (let k = pi + 1; k < i; k++) olds.push(k);
      for (let k = pj + 1; k < j; k++) news.push(k);
      // the same number of lines between two common lines: they were edited in place
      if (olds.length === news.length) olds.forEach((oi, k) => { dest.set(oi, news[k]!); edited.add(oi); matchedNew.add(news[k]!); });
      if (i < old.length) { dest.set(i, j); matchedNew.add(j); }
      pi = i; pj = j;
    }
    // what moves where: [from key, to key (or a parking key), the entry, how it is counted]
    const moves: { from: string; to: string; entry: Entry; how: 'moved' | 'edited' | 'gone' }[] = [];
    old.forEach((u, i) => {
      const e = ents[u.key];
      if (!hasContent(e)) return;
      const j = dest.get(i);
      if (j === undefined) moves.push({ from: u.key, to: u.key + GONE, entry: e, how: 'gone' });
      else if (units[j]!.key !== u.key) moves.push({ from: u.key, to: units[j]!.key, entry: e, how: edited.has(i) ? 'edited' : 'moved' });
    });
    const leaving = new Set(moves.map(m => m.from));
    // a target key that already holds somebody else's translation (not leaving itself) is not overwritten: the mover is parked instead
    for (const m of moves) {
      if (m.how !== 'gone' && hasContent(ents[m.to]) && !leaving.has(m.to)) { m.to = m.from + GONE; m.how = 'gone'; }
    }
    const put = new Map<string, Entry>(), cleared = new Set<string>();
    const wording = new Map<string, string>();
    const row = (key: string, entry: Entry): IngestRow => ({ file: v.name, key, source: entry.src ?? '', target: entry.target });
    for (const m of moves) {
      cleared.add(m.from);
      put.set(m.to, m.entry);
      if (m.how === 'gone') { wording.set(m.to, 'рядка вже немає в грі: переклад збережено окремо'); report.gone.push(row(m.from, m.entry)); }
      else { wording.set(m.to, m.how === 'moved' ? 'рядок пересунувся в грі: переклад перенесено за текстом' : 'оригінал змінено в грі: переклад лишився при рядку'); report.moved += m.how === 'moved' ? 1 : 0; report.edited += m.how === 'edited' ? 1 : 0; }
    }
    // a line that appeared (or came back) takes a parked translation of the same original, once
    const parked = new Map<string, string[]>();
    const park = (key: string, e: Entry | undefined): void => { if (isParked(key) && hasContent(e) && e.target.trim() && e.src !== undefined) (parked.get(e.src) ?? parked.set(e.src, []).get(e.src)!).push(key); };
    for (const [k, e] of Object.entries(ents)) if (!cleared.has(k)) park(k, e);
    for (const [k, e] of put) park(k, e);
    const taken = new Set<string>();
    units.forEach((u, j) => {
      const here = put.has(u.key) ? put.get(u.key) : cleared.has(u.key) ? undefined : ents[u.key];
      if (hasContent(here)) return;
      if (matchedNew.has(j)) return;   // a line that was there before is not given somebody else's translation
      const pk = parked.get(u.source)?.find(k => !taken.has(k));
      if (pk === undefined) { report.added.push({ file: v.name, key: u.key, source: u.source, target: '' }); return; }
      taken.add(pk);
      const entry = put.get(pk) ?? ents[pk]!;
      put.set(u.key, entry); cleared.add(pk); put.delete(pk);
      wording.set(u.key, 'рядок знову є в грі: переклад повернуто');
      report.adopted++;
      const gi = report.gone.findIndex(g => g.file === v.name && g.key + GONE === pk);
      if (gi >= 0) report.gone.splice(gi, 1);
    });
    for (const key of cleared) if (!put.has(key) && ents[key]) changes.push({ file: v.name, key, next: { target: '', status: 'new', mt: nextMt(ents[key]?.mt, now) }, text: '', what: 'рядок пересунувся: цей ключ тепер порожній' });
    for (const [key, entry] of put) changes.push({ file: v.name, key, next: { ...entry, mt: nextMt(Math.max(entry.mt, ents[key]?.mt ?? 0), now) }, text: entry.target, what: wording.get(key) ?? 'перенесено' });
  }
  return { changes, report };
}

/**
 * Is the game that was read another one than the project's (not a new version of it)? Of the lines that have a translation in files the
 * two share by name, hardly any original is found again. A project with only a few translated lines is never asked about.
 */
export function looksLikeAnotherGame(oldSnap: Record<string, Unit[]> | undefined, views: { name: string; units: Unit[] }[], files: Record<string, Record<string, Entry>>): boolean {
  if (!oldSnap) return false;
  let total = 0, shared = 0;
  for (const v of views) {
    const old = oldSnap[v.name];
    if (!old?.length) continue;
    const ents = files[v.name] ?? {};
    const now = new Set(v.units.map(u => u.source));
    for (const u of old) if (ents[u.key]?.target?.trim()) { total++; if (now.has(u.source)) shared++; }
  }
  return total >= 5 && shared / total < 0.15;
}
