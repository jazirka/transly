import type { TermProposal, TermSpan } from '../core';
import { esc } from './dom';

/** The words for how sure a replacement is. */
export const CONF_LABEL = { high: 'впевнено', medium: 'перевірте', low: 'сумнівно' } as const;
/** Why a replacement is not sure, in plain words. */
export const FLAG_TEXT: Record<string, string> = {
  fleeting: 'випадна голосна', 'fleeting?': 'можлива випадна голосна', alt: 'чергування голосної', 'alt?': 'можливе чергування голосної',
  'gen-a-u': 'родовий на -а чи на -у?', 'ambiguous-case': 'форма підходить до кількох відмінків', 'no-source': 'в оригіналі немає цього терміна',
  'animacy-guess': 'істота чи ні: вгадано', compound: 'складне слово', 'adj-guess': 'прикметник упізнано за місцем у фразі', 'soft-guess': 'тип слова вгадано',
  'mass-noun': 'збірне слово у множині', 'rare-plural': 'рідкісна форма множини', voc: 'кличний відмінок', 'gen-pl?': 'родовий множини вгадано',
  'frozen-differs': 'решта фрази відрізняється', 'й-stem': 'основа на -й', 'unknown-shape': 'незвична будова слова',
};
export const flagsText = (flags: string[]): string => [...new Set(flags.map(f => FLAG_TEXT[f]).filter(Boolean))].join('; ');

/** The text with the changed places marked: `<del>` for what is replaced, `<ins>` for what comes. */
export function markHtml(p: TermProposal, side: 'old' | 'new', choice: number[] = []): string {
  let out = '', at = 0;
  p.spans.forEach((s: TermSpan, i) => {
    const text = (choice[i] ?? -1) >= 0 && s.alts[choice[i]!] ? s.alts[choice[i]!]!.text : s.text;
    if (side === 'old') { out += esc(p.before.slice(at, s.start)) + `<del>${esc(s.old)}</del>`; at = s.end; }
    else { out += esc(p.before.slice(at, s.start)) + `<ins>${esc(text)}</ins>`; at = s.end; }
  });
  return (out + esc(p.before.slice(at))).replace(/\n/g, '<br>');
}
