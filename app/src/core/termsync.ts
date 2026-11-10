import { hasTermIn, prepareText } from './glossary';
import type { Entry, Status } from './model';
import type { FileView, SavedProject } from './project';
import type { RowChange } from './journal';
import { levelOf, ukRetarget, ukWordForms } from './ukmorph';
import type { Cell, Conf, MorphDict } from './ukmorph';

/**
 * When the translator changes how a glossary term is rendered (меч → клинок), the rows that hold the old rendering in some
 * case or number (мечем, залізних мечів) are found, and the same case of the new rendering is proposed for each (клинком,
 * сталевих клинків). Nothing is written here: the proposals are shown with their confidence, the translator ticks the ones
 * to apply, and `termChanges` turns those into one action of the journal.
 */
export interface TermRendering { uk: string; alt?: string[] | undefined }
export interface TermChange { en: string; /** Renderings that are gone. */ old: string[]; /** The rendering that replaces them. */ next: string }

const key = (s: string): string => s.trim().toLowerCase().replace(/['ʼ`]/g, '’');

/**
 * What a change of a term means for the rows: null when nothing has to be replaced (a new term, a renamed original, the first
 * rendering unchanged); otherwise the renderings that are gone and the one that replaces them. An old rendering that stays
 * as an alternative is not touched.
 */
export function termChange(prev: ({ en: string } & TermRendering) | undefined, next: { en: string } & TermRendering): TermChange | null {
  if (!prev || key(prev.en) !== key(next.en)) return null;
  if (key(prev.uk) === key(next.uk)) return null;
  const kept = new Set([next.uk, ...(next.alt ?? [])].map(key));
  const old = [prev.uk, ...(prev.alt ?? [])].filter(f => f.trim() && !kept.has(key(f)));
  return old.length ? { en: next.en, old, next: next.uk.trim() } : null;
}

export interface TermSpan {
  start: number; end: number;
  /** The text that stands there now. */
  old: string;
  /** What is proposed in its place. */
  text: string;
  conf: Conf;
  /** Other forms the same place can have (the observed form fits several cases that give different new forms). */
  alts: { text: string; conf: Conf }[];
  cells: Cell[];
}

export interface TermProposal {
  file: string; key: string; source: string;
  before: string; after: string;
  spans: TermSpan[];
  /** The weakest span; with no term in the original it is `low`. */
  conf: Conf;
  /** The original of the row has the term (so the old rendering was the translation of the term and not of another word). */
  hasSource: boolean;
  status: Status;
  /** Ticked by default: sure, and the original has the term. */
  tick: boolean;
}

export interface TermSync {
  /** The best first. */
  proposals: TermProposal[];
  /** How many rows hold an old rendering; `proposals` is cut to `limit`. */
  total: number;
  truncated: boolean;
}

const WORD = /[\p{L}\p{N}]+(?:['’ʼ`][\p{L}]+)*/gu;
const BETWEEN = /^[\s\-–—]+$/;
const RANK = { high: 0, medium: 1, low: 2 } as const;

/** The text with the spans replaced by their proposals (`choice[i]` picks an alternative of span `i`: -1 or missing is the main one). */
export function applySpans(before: string, spans: TermSpan[], choice: number[] = []): string {
  let out = before;
  for (let i = spans.length - 1; i >= 0; i--) {
    const s = spans[i]!, c = choice[i] ?? -1;
    out = out.slice(0, s.start) + (c >= 0 && s.alts[c] ? s.alts[c]!.text : s.text) + out.slice(s.end);
  }
  return out;
}

/**
 * Find the old renderings of a term in the translations and propose their replacement. Each rendering is looked up by its
 * exact forms (all cases and numbers it can have), then checked as a whole phrase; a word that only looks like it
 * (мечник, клин) is not one. `opts.limit` cuts what is returned, `total` is what was found.
 */
export function proposeTermSync(views: FileView[], saved: SavedProject, change: TermChange, opts: { limit?: number; dict?: MorphDict } = {}): TermSync {
  const limit = opts.limit ?? 2000;
  const olds = change.old.map(o => ({ phrase: o, sets: ukWordForms(o, opts.dict) })).filter((x): x is { phrase: string; sets: Set<string>[] } => !!x.sets && x.sets.length > 0);
  const all: TermProposal[] = [];
  if (!olds.length) return { proposals: all, total: 0, truncated: false };
  for (const v of views) {
    const ents = saved.files[v.name];
    if (!ents) continue;
    for (const u of v.units) {
      const e: Entry | undefined = ents[u.key];
      if (!e?.target.trim()) continue;
      const toks = [...e.target.matchAll(WORD)].map(m => ({ w: m[0].toLowerCase().replace(/['ʼ`]/g, '’'), start: m.index!, end: m.index! + m[0].length }));
      const spans: TermSpan[] = [];
      for (const o of olds) {
        const n = o.sets.length;
        for (let i = 0; i + n <= toks.length; i++) {
          if (!o.sets[0]!.has(toks[i]!.w)) continue;
          let ok = true;
          for (let j = 1; j < n && ok; j++) ok = o.sets[j]!.has(toks[i + j]!.w) && BETWEEN.test(e.target.slice(toks[i + j - 1]!.end, toks[i + j]!.start));
          if (!ok) continue;
          const start = toks[i]!.start, end = toks[i + n - 1]!.end;
          if (spans.some(s => start < s.end && end > s.start)) continue;
          const prev = i > 0 && /^[\s]+$/.test(e.target.slice(toks[i - 1]!.end, start)) ? toks[i - 1]!.w : undefined;
          const r = ukRetarget(o.phrase, change.next, e.target.slice(start, end), { ...(prev ? { prev } : {}), ...(opts.dict ? { dict: opts.dict } : {}) });
          if (!r) continue;
          spans.push({ start, end, old: e.target.slice(start, end), text: r.text, conf: r.conf, alts: r.alts, cells: r.cells });
        }
      }
      if (!spans.length) continue;
      spans.sort((a, b) => a.start - b.start);
      const hasSource = hasTermIn(prepareText(u.source), change.en);
      const worst = spans.reduce((a, s) => (s.conf.score < a.score ? s.conf : a), spans[0]!.conf);
      const conf: Conf = hasSource ? worst : { score: Math.min(worst.score, 0.5), level: levelOf(Math.min(worst.score, 0.5)), flags: [...worst.flags, 'no-source'] };
      all.push({ file: v.name, key: u.key, source: u.source, before: e.target, after: applySpans(e.target, spans), spans, conf, hasSource, status: e.status, tick: hasSource && conf.level === 'high' });
    }
  }
  all.sort((a, b) => RANK[a.conf.level] - RANK[b.conf.level] || b.conf.score - a.conf.score);
  return { proposals: all.slice(0, limit), total: all.length, truncated: all.length > limit };
}

/**
 * The rows as they are after the replacement. The status of a row stays as it is (a mechanical change of a word does not
 * un-send or un-approve it); the history shows «змінено термін» with the new text and what was there before.
 */
export function termChanges(picks: { proposal: TermProposal; choice?: number[] }[], saved: SavedProject, now: number): RowChange[] {
  const out: RowChange[] = [];
  for (const { proposal: p, choice } of picks) {
    const cur = saved.files[p.file]?.[p.key];
    if (!cur) continue;
    const after = applySpans(p.before, p.spans, choice);
    // a row that changed after the proposals were made is not touched
    if (cur.target !== p.before || after === cur.target) continue;
    out.push({ file: p.file, key: p.key, text: after, next: { ...cur, target: after, mt: now, ...(cur.orig !== undefined ? { orig: after } : {}) } });
  }
  return out;
}
