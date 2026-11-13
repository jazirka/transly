import { displayLength, missingCodes } from './controlCodes';
import { candidateTerms, hasTermIn, prepareText, targetHasTerm, termsStamp } from './glossary';
import { isMessageUnit, limitFor, linesShown, maxLineWidth, planSig, tooWide, unitWord, wrapLines, wrapMessage } from './wrap';
import type { WrapPlan } from './wrap';
import { plural } from './plural';
import { runRules } from './qarules';
import type { QaRules } from './qarules';
import type { Entry, Unit } from './model';

export type Severity = 'bad' | 'warn';
/**
 * What kind of remark it is, so the translator does not mix a recommendation up with a must-fix:
 * `error` breaks the game text, `term` disagrees with the glossary, `context` comes from the situation of the line,
 * `style` is a recommendation, `info` is reference only.
 */
export type IssueCat = 'error' | 'term' | 'context' | 'style' | 'info';
/** A ready correction: `text` replaces the whole translation. */
export interface IssueFix { label: string; text: string }
export interface Issue {
  /** The rule that raised it. Ignoring a warning stores this key (`Entry.ign`). */
  key: 'codes' | 'len' | 'term' | 'wrap' | 'lines' | 'empty-src-changed' | (string & {});
  severity: Severity;
  cat: IssueCat;
  message: string;
  /** Why it matters or how to read it, shown on demand. */
  detail?: string;
  fix?: IssueFix;
  /** Control codes missing from the translation (key `codes`). */
  codes?: string[];
}
export interface Term { en: string; uk: string; alt?: string[]; /** false = hint only */ qa?: boolean }
export interface QaOptions {
  tolerancePct: number;
  terms: Term[];
  /** Longest allowed line of a message; 0 or missing = not checked. Ignored when `wrap` is given. */
  lineLimit?: number;
  /** The project's line wrapping: when it is given, the width rule follows its mode, unit and width, and the number of lines is watched. */
  wrap?: WrapPlan;
  /** The rules about the form of the text (letters, spaces, apostrophes, damaged codes), resolved from the project settings. Without it only the five checks above run. */
  rules?: QaRules;
}

export const DEFAULT_QA: QaOptions = { tolerancePct: 25, terms: [] };

/** Deviation of the translation length from the source, in percent (rounded). */
export function lengthDeviation(source: string, target: string): number {
  const s = displayLength(source);
  if (!s) return 0;
  return Math.round(((displayLength(target) - s) / s) * 100);
}

type UnitLike = Pick<Unit, 'source'> & Partial<Pick<Unit, 'kind' | 'face' | 'key'>>;

/**
 * The two advices about the shape of a message. `wrap`: a line is wider than the window, and nothing will wrap it (the
 * mode is «in the text» or «off»; in the mode «at build» the game files are wrapped by the build, so the project's own
 * text is not asked to fit). `lines`: the message has more lines than the window shows; the game pages it, so this is
 * only a heads-up.
 */
function wrapIssues(unit: UnitLike, target: string, plan: WrapPlan): Issue[] {
  if (!isMessageUnit(unit)) return [];
  const out: Issue[] = [];
  const mode = plan.settings.mode, wide = tooWide(plan, unit, target);
  if (wide.count && mode !== 'build') {
    const r = wrapMessage(plan, unit, target);
    out.push({ key: 'wrap', severity: 'warn', cat: 'style', message: `Рядок задовгий для вікна: ${Math.round(wide.widest)} ${unitWord(plan)}, зазвичай до ${wide.width}. ${r.changed ? 'Натисніть «Перенести за шириною»' : 'Слово не вміщається, скоротіть його'}`, ...(r.changed ? { fix: { label: 'Перенести за шириною', text: r.text } } : {}) });
  }
  const max = plan.settings.maxLines;
  if (unit.kind === 'dialogue' && max > 0) {
    // «At build» and «in the text»: the lines the game will really show; «off»: the lines as written.
    const n = linesShown(plan, unit, target);
    if (n > max) out.push({ key: 'lines', severity: 'warn', cat: 'style', message: `У повідомленні ${plural(n, ['рядок', 'рядки', 'рядків'])}, а вікно показує ${max}: гра покаже його на кількох сторінках` });
  }
  return out;
}

export function check(unit: UnitLike, target: string, opts: QaOptions = DEFAULT_QA): Issue[] {
  if (!target.trim()) return [];
  const out: Issue[] = [];
  const miss = missingCodes(unit.source, target);
  if (miss.length) out.push({ key: 'codes', severity: 'bad', cat: 'error', message: `Пропущено керівні коди: ${miss.join(' ')}`, detail: 'Керівні коди (кольори, імена, змінні) гра підставляє сама; без них текст у грі зламається.', fix: { label: `Вставити ${miss.join(' ')}`, text: target + miss.join('') }, codes: miss });
  const dev = lengthDeviation(unit.source, target);
  if (Math.abs(dev) > opts.tolerancePct) {
    out.push({ key: 'len', severity: 'warn', cat: 'style', message: `Довжина відрізняється від оригіналу на ${dev > 0 ? '+' : ''}${dev}%. Рекомендація: якнайближче до оригіналу` });
  }
  if (opts.wrap) out.push(...wrapIssues(unit, target, opts.wrap));
  else if (opts.lineLimit && (unit.kind === 'dialogue' || unit.kind === 'scroll')) {
    const limit = limitFor(opts.lineLimit, unit.face), w = maxLineWidth(target);
    if (w > limit) {
      const wrapped = wrapLines(target, limit);
      out.push({ key: 'wrap', severity: 'warn', cat: 'style', message: `Рядок задовгий для вікна: ${w} символів, зазвичай до ${limit}. Натисніть «Перенести за шириною»`, ...(wrapped !== target ? { fix: { label: 'Перенести за шириною', text: wrapped } } : {}) });
    }
  }
  const sourceText = prepareText(unit.source);
  for (const t of candidateTerms(sourceText, opts.terms)) {
    if (t.qa === false) continue;
    if (hasTermIn(sourceText, t.en) && !targetHasTerm(target, t.uk, t.alt)) {
      out.push({ key: 'term', severity: 'warn', cat: 'term', message: `Термін «${t.en}» має бути «${[t.uk, ...(t.alt ?? [])].join('» або «')}» за глосарієм` });
    }
  }
  if (opts.rules) out.push(...runRules(unit.source, target, opts.rules, unit.kind));
  return out;
}

/**
 * Results of `check` for a row, remembered per row object. Rows are replaced, never changed in place, so a row that is
 * still the same object with the same original and the same settings gives the same answer. A page draws a file several
 * times (filters, tabs, status bar); this makes every draw after the first cheap.
 */
const memo = new WeakMap<Entry, { sig: string; source: string; key?: string; kind?: string; face?: string; issues: Issue[] }>();

/** Everything `check` depends on besides the row and its original, as one short text. */
const optsSig = (o: QaOptions): string => `${o.tolerancePct}|${o.lineLimit ?? 0}|${planSig(o.wrap)}|${termsStamp(o.terms)}|${o.rules?.sig ?? ''}`;

/** Issues of a row (before the translator's ignores). */
function issuesOf(unit: UnitLike, entry: Entry, opts: QaOptions): Issue[] {
  const sig = optsSig(opts), hit = memo.get(entry);
  // The key is part of the answer: whether a row is a message (and so gets the wrap checks) is read from it, and the same
  // Entry object is shown under a file's own key and under the "all files" key.
  if (hit && hit.sig === sig && hit.source === unit.source && hit.key === unit.key && hit.kind === unit.kind && hit.face === unit.face) return hit.issues;
  const issues = check(unit, entry.target, opts);
  memo.set(entry, { sig, source: unit.source, key: unit.key, kind: unit.kind, face: unit.face, issues });
  return issues;
}

/** Issues the translator has not ignored. */
export function activeIssues(unit: UnitLike, entry: { target: string; ign?: string[] } | undefined, opts: QaOptions = DEFAULT_QA): Issue[] {
  if (!entry?.target) return [];
  const all = 'mt' in entry ? issuesOf(unit, entry as Entry, opts) : check(unit, entry.target, opts);
  const ign = entry.ign;
  return ign?.length ? all.filter(i => !ign.includes(i.key)) : all;
}
