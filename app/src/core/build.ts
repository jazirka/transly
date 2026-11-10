import { activeIssues } from './qa';
import type { QaOptions } from './qa';
import { apply, isTextFormat, formatOf } from './engine';
import type { Entry, GameFile, Translations } from './model';
import type { FileView, SavedProject } from './project';
import { isMessageUnit, wrapMessage } from './wrap';

export interface BuildOptions {
  /** Only reviewed (appr) units go into the build; otherwise units waiting for review (done) are included too. */
  onlyApproved: boolean;
  /** Also put drafts in: for checking a translation in the game while it is still being written. */
  includeDrafts?: boolean;
  /** Units with a QA error are left in the original language. */
  blockErrors: boolean;
  qa: QaOptions;
}

export interface BuildResult {
  /** Changed game files, ready to write. */
  /** Changed files. `text` is set for text formats (.po, .csv, .rpy); otherwise serialise `json`. */
  files: { name: string; json: unknown; text?: string }[];
  included: number;
  /** Units that have a translation but were left out (status or QA error). */
  skipped: number;
  /** Keys (`file::key`) left out because of QA errors. */
  blocked: string[];
  /** The line wrapping done by the build (mode «at build»; the project's own text is never changed). */
  wrap: { /** Messages whose lines were rearranged. */ messages: number; /** Hyphens put into words. */ hyphens: number; /** Messages that have more lines than the window shows. */ tooMany: number; /** Messages with a word that still does not fit a line. */ over: number };
}

/** The row as the game gets it: its message wrapped for the window. The project's row is not touched. */
function wrapped(plan: NonNullable<QaOptions['wrap']>, u: FileView['units'][number], e: Entry, stats: BuildResult['wrap']): Entry {
  const r = wrapMessage(plan, u, e.target);
  if (r.tooMany) stats.tooMany++;
  if (r.over.length) stats.over++;
  if (!r.changed) return e;
  stats.messages++;
  stats.hyphens += r.hyphenated;
  return { ...e, target: r.text };
}

export function build(game: GameFile[], views: FileView[], saved: SavedProject, opts: BuildOptions): BuildResult {
  const byName = new Map(game.map(f => [f.name, f]));
  const out: BuildResult = { files: [], included: 0, skipped: 0, blocked: [], wrap: { messages: 0, hyphens: 0, tooMany: 0, over: 0 } };
  const plan = opts.qa.wrap, wrapping = !!plan && plan.settings.mode === 'build';
  for (const v of views) {
    const file = byName.get(v.name);
    const entries = saved.files[v.name];
    if (!file || !entries) continue;
    const use: Translations = {};
    for (const u of v.units) {
      const e: Entry | undefined = entries[u.key];
      if (!e || !e.target.trim()) continue;
      const stageOk = e.status === 'appr' || (!opts.onlyApproved && e.status === 'done') || (!!opts.includeDrafts && e.status === 'draft');
      if (!stageOk) { out.skipped++; continue; }
      if (opts.blockErrors && activeIssues(u, e, opts.qa).some(i => i.severity === 'bad')) {
        out.skipped++;
        out.blocked.push(`${v.name}::${u.key}`);
        continue;
      }
      use[u.key] = wrapping && plan && formatOf(file) === 'rpgmaker' && isMessageUnit(u) ? wrapped(plan, u, e, out.wrap) : e;
      out.included++;
    }
    if (Object.keys(use).length) {
      const res = apply(file, use);
      out.files.push(isTextFormat(formatOf(file)) ? { name: v.name, json: null, text: String(res) } : { name: v.name, json: res });
    }
  }
  return out;
}

/** Bytes-ready text of a built file. */
export const fileText = (f: { json: unknown; text?: string }): string => f.text ?? JSON.stringify(f.json);
