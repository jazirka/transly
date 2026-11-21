import { displayLength } from '../controlCodes';
import { literalPattern } from '../findreplace';
import { maskCodes } from '../qacodes';
import type { QaRule } from '../qarules';
import { i18n, t } from './i18n';
import type { PluginRecord } from './registry';
import type { QaRuleContribution, TextMatch } from './types';

/**
 * The rules of QA a plugin describes as data become the rules the application runs itself: the plugin brings no code, and the checks are the four
 * kinds below, made of plain text matches (never a regular expression a stranger wrote, which could hang the program). Control codes of the game are
 * hidden before a match is looked for, so `\C[2]` never counts as text.
 */

const cache = new Map<string, RegExp>();
const pattern = (m: TextMatch): RegExp => {
  const k = `${m.wholeWord ? 1 : 0}${m.caseSensitive ? 1 : 0}${m.find}`;
  let re = cache.get(k);
  if (!re) { if (cache.size > 2000) cache.clear(); cache.set(k, re = literalPattern(m.find, m.wholeWord === true, m.caseSensitive === true)); }
  re.lastIndex = 0;
  return re;
};
const has = (text: string, m: TextMatch): boolean => { const re = pattern(m); const r = re.test(text); re.lastIndex = 0; return r; };

/** The id of a plugin's rule in the application: it never clashes with an application's rule or another plugin's. */
export const pluginRuleId = (pluginId: string, local: string): string => `${pluginId}:${local}`;

const quote = (s: string): string => `«${s.length > 40 ? s.slice(0, 40) + '…' : s}»`;

export function declarativeRule(rec: Pick<PluginRecord, 'manifest'>, q: QaRuleContribution): QaRule {
  const pid = rec.manifest.id;
  const tr = (s: string): string => i18n.t(s, undefined, `plugin:${pid}`);
  /** The plugin's own wording of the message when it has one; the application's wording otherwise. */
  const own = (s: string | undefined, fallback: () => string): string => (s ? tr(s) : fallback());
  const c = q.check;
  const base = {
    id: pluginRuleId(pid, q.id), title: tr(q.title), explain: q.description ? tr(q.description) : tr(q.title),
    cat: (q.severity === 'bad' ? 'error' : 'style') as QaRule['cat'], def: (q.severity === 'bad' ? 'bad' : 'warn') as QaRule['def'],
    plugin: pid, ...(q.kinds ? { kinds: q.kinds } : {}),
  };
  switch (c.type) {
    case 'forbid':
      return {
        ...base, fixable: c.items.some(i => i.replace !== undefined),
        run(x) {
          const found = c.items.filter(i => has(x.mt, i) && !has(x.ms, i));
          if (!found.length) return null;
          const fixes = found.filter(i => i.replace !== undefined);
          let fixed: string | undefined;
          if (fixes.length === found.length) { fixed = x.target; for (const i of fixes) fixed = fixed.replace(pattern(i), () => i.replace!); }
          return { message: own(c.message, () => t('Не варто вживати')) + ': ' + found.slice(0, 3).map(i => quote(i.find)).join(' ') + (found.length > 3 ? '…' : ''), ...(fixed !== undefined ? { fixed } : {}) };
        },
      };
    case 'require':
      return {
        ...base, fixable: false,
        run(x) {
          if (!has(x.ms, c.when) || has(x.mt, c.then)) return null;
          return { message: own(c.message, () => t('В оригіналі є {when}: у перекладі має бути {then}', { when: quote(c.when.find), then: quote(c.then.find) })) };
        },
      };
    case 'maxLength':
      return {
        ...base, fixable: false,
        run(x) {
          const n = displayLength(x.target);
          return n > c.max ? { message: own(c.message, () => t('Переклад довший за {max} знаків ({n})', { max: c.max, n })) } : null;
        },
      };
    case 'sameAsSource':
      return {
        ...base, fixable: false,
        run(x) {
          const a = maskCodes(x.source).trim().toLowerCase(), b = maskCodes(x.target).trim().toLowerCase();
          // a row that is only numbers, signs or a code is the same in every language
          return a === b && (a.match(/\p{L}/gu)?.length ?? 0) >= 4 ? { message: own(c.message, () => t('Переклад збігається з оригіналом')) } : null;
        },
      };
  }
}

/** The rules of every working plugin, in the order the plugins were added. */
export function declarativeRules(recs: readonly Pick<PluginRecord, 'manifest' | 'state'>[]): QaRule[] {
  return recs.filter(r => r.state === 'enabled').flatMap(r => (r.manifest.contributes?.qaRules ?? []).map(q => declarativeRule(r, q)));
}
