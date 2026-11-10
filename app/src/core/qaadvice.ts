import type { FileView, SavedProject } from './project';
import type { Entry, Unit } from './model';
import { activeIssues } from './qa';
import type { Issue, QaOptions } from './qa';
import type { RowChange } from './journal';
import { QA_RULES, RULE_BY_ID } from './qarules';

/**
 * The overview of advices (remarks that do not block anything): how many rows have one, how many rows each rule of form
 * has found in a file, and the one-click fix of a rule for a whole file. The answers come from the remembered QA results
 * of the rows, so asking again after a redraw is cheap.
 */
type RowLike = Pick<Unit, 'source'> & Partial<Pick<Unit, 'kind' | 'face' | 'key'>>;

/** The advices of a row that the translator has not ignored. */
export const adviceOf = (unit: RowLike, entry: Entry | undefined, opts: QaOptions): Issue[] => activeIssues(unit, entry, opts).filter(i => i.severity === 'warn');

/**
 * Remarks the overview does not count. A length that differs from the original is a recommendation under the field, and
 * a translation is longer or shorter than its original in many rows by nature: counting them would drown the advices
 * the translator can actually mend.
 */
const NOT_COUNTED = new Set(['len']);

/** Does the row have an advice the overview shows (the counter, the filter «З порадами», the jump to the next one)? */
export const hasAdvice = (unit: RowLike, entry: Entry | undefined, opts: QaOptions): boolean => !!entry?.target && adviceOf(unit, entry, opts).some(i => !NOT_COUNTED.has(i.key));

/** The number of rows with an advice in the files. */
export function adviceCount(views: FileView[], saved: SavedProject, opts: QaOptions): number {
  let n = 0;
  for (const v of views) {
    const ents = saved.files[v.name];
    if (!ents) continue;
    for (const u of v.units) if (hasAdvice(u, ents[u.key], opts)) n++;
  }
  return n;
}

export interface RuleStat { id: string; /** Rows where the rule has a remark now. */ rows: number; /** Of them, rows the rule can mend by itself. */ fixable: number }

/** For each rule of form, how many rows of the file it has a remark on and how many of those it can mend. */
export function ruleStats(view: FileView, saved: SavedProject, opts: QaOptions): RuleStat[] {
  const stat = new Map(QA_RULES.map(r => [r.id, { id: r.id, rows: 0, fixable: 0 }]));
  const ents = saved.files[view.name] ?? {};
  for (const u of view.units) {
    const e = ents[u.key];
    if (!e?.target) continue;
    for (const i of activeIssues(u, e, opts)) {
      const s = stat.get(i.key);
      if (!s) continue;
      s.rows++;
      if (i.fix) s.fixable++;
    }
  }
  return [...stat.values()];
}

/**
 * The corrections of one rule over the files, ready for `commitRows` as one action. A row is mended from its present
 * text; its status stays as it is (a mended spelling does not send a row back to review), and a row where the translator
 * ignored the remark, or where the rule has no ready correction, is left alone.
 */
export function fixRule(views: FileView[], saved: SavedProject, ruleId: string, opts: QaOptions, now: number): RowChange[] {
  const rule = RULE_BY_ID[ruleId];
  if (!rule) return [];
  const out: RowChange[] = [];
  for (const v of views) {
    const ents = saved.files[v.name];
    if (!ents) continue;
    for (const u of v.units) {
      const cur = ents[u.key];
      if (!cur?.target) continue;
      const hit = activeIssues(u, cur, opts).find(i => i.key === ruleId);
      const text = hit?.fix?.text;
      if (text === undefined || text === cur.target) continue;
      out.push({ file: v.name, key: u.key, text, what: `виправлено за правилом «${rule.title}»`, next: { ...cur, target: text, mt: now, ...(cur.orig !== undefined ? { orig: text } : {}) } });
    }
  }
  return out;
}
