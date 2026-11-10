import { QA_RULES } from './qarules';
import type { QaRules, RuleSeverity } from './qarules';

/**
 * What the translator chose about the QA rules of form (the dialog «Правила QA»). It lives in the project settings as an
 * optional `qa` object: a project saved before it existed, or a copy from another device without it, gets the defaults
 * for every rule that is not mentioned, and a value this build does not know is ignored.
 */
export interface QaSettings {
  /** The level of a rule by its id: `off`, `warn` (an advice) or `bad` (an error that blocks sending and building). */
  rules?: Record<string, RuleSeverity>;
  /** Latin words that may stay in Ukrainian text. */
  keep?: string[];
  /** The apostrophe of the project: any of the right ones, or the one sign every apostrophe must be. */
  apostrophe?: 'any' | '’' | 'ʼ' | "'";
}

export const APOSTROPHES = ['any', '’', 'ʼ', "'"] as const;
const LEVELS: readonly RuleSeverity[] = ['off', 'warn', 'bad'];

const cache = new WeakMap<object, QaRules>();
const DEFAULTS: QaRules = build(undefined);

function build(q: QaSettings | undefined): QaRules {
  const sev: Record<string, RuleSeverity> = {};
  for (const r of QA_RULES) {
    const v = q?.rules?.[r.id];
    sev[r.id] = LEVELS.includes(v as RuleSeverity) ? (v as RuleSeverity) : r.def;
  }
  const keep = new Set<string>();
  for (const w of Array.isArray(q?.keep) ? q.keep : []) {
    const t = typeof w === 'string' ? w.trim().toLowerCase() : '';
    if (t && t.length <= 40) keep.add(t);
  }
  const apostrophe = APOSTROPHES.includes(q?.apostrophe as (typeof APOSTROPHES)[number]) ? (q!.apostrophe as QaRules['apostrophe']) : 'any';
  const sig = `${QA_RULES.map(r => `${r.id}=${sev[r.id]}`).join(',')}|${[...keep].sort().join(',')}|${apostrophe}`;
  return { sev, keep, apostrophe, sig };
}

/** The QA rules of a project with every field checked and filled in; the answer is remembered per `settings.qa` object. */
export function qaOf(settings: { qa?: QaSettings | undefined } | undefined): QaRules {
  const q = settings?.qa;
  if (!q || typeof q !== 'object') return DEFAULTS;
  let hit = cache.get(q);
  if (!hit) cache.set(q, hit = build(q));
  return hit;
}

/** A copy of the settings with one rule set to a level (the default level is stored as «not mentioned»). */
export function withRuleLevel(q: QaSettings | undefined, id: string, level: RuleSeverity): QaSettings {
  const rules = { ...(q?.rules ?? {}) };
  const def = QA_RULES.find(r => r.id === id)?.def;
  if (level === def) delete rules[id]; else rules[id] = level;
  const out: QaSettings = { ...(q ?? {}), rules };
  if (!Object.keys(rules).length) delete out.rules;
  return out;
}

/** The words of the «keep» list as one editable text (one word per line) and back. */
export const keepToText = (keep: string[] | undefined): string => (keep ?? []).join('\n');
export const keepFromText = (text: string): string[] => [...new Set(text.split(/[\s,;]+/).map(w => w.trim().toLowerCase()).filter(Boolean))].slice(0, 500);
