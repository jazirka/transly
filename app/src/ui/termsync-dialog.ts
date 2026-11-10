import { proposeTermSync, termChanges } from '../core';
import type { TermChange, TermProposal, TermSpan, TermSync } from '../core';
import { $, esc, plural, toast } from './dom';
import { dialog } from './settings';
import { undoToast } from './undo-toast';
import type { Ctx } from './state';

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

/** The last change of a term in this session: the tool «Оновити за глосарієм…» offers it again. */
let last: TermChange | null = null;
/** How many rows are drawn at first and each time «Показати ще». */
const PAGE = 100;

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

/** After a term was changed: say, in a message with a button, how many rows hold the old rendering. Nothing opens by itself. */
export function offerTermSync(ctx: Ctx, change: TermChange): void {
  last = change;
  const r = proposeTermSync(ctx.s.views, ctx.s.saved, change, { limit: 1 });
  if (!r.total) return;
  toast(`Знайдено ${plural(r.total, ['рядок', 'рядки', 'рядків'])} зі старою формою «${change.old[0]}»`, { action: { label: 'Переглянути', run: () => openTermSync(ctx, change) } });
}

/** The review list: every row that holds an old rendering, «було → стане», ticked when sure. */
export function openTermSync(ctx: Ctx, change: TermChange): void {
  const { s } = ctx;
  last = change;
  const res: TermSync = proposeTermSync(s.views, s.saved, change);
  if (!res.total) { toast(`Рядків зі старою формою «${change.old.join('», «')}» не знайдено`); return; }
  const on = new Map<string, boolean>(), pick = new Map<string, number[]>();
  const id = (p: TermProposal): string => `${p.file}\u0001${p.key}`;
  for (const p of res.proposals) on.set(id(p), p.tick);
  let shown = PAGE;
  const dlg = dialog(`<form method="dialog"><h2 id="ts-t">Оновити за глосарієм: ${esc(change.old.join(', '))} → ${esc(change.next)}</h2>
    <p class="hint">Рядки, де стоїть стара форма в будь-якому відмінку, і те саме з новим перекладом. Позначені лише впевнені заміни, де в оригіналі є цей термін; решту перевірте самі. Статус рядків не змінюється, дію можна скасувати.</p>
    <p class="sum" id="ts-sum" role="status"></p><div class="sp-list" id="ts-list"></div>
    <div class="acts"><button class="btn" value="cancel">Закрити</button><button class="btn" type="button" id="ts-more">Показати ще</button><button class="btn" type="button" id="ts-sure">Позначити лише впевнені</button><button class="btn p" type="button" id="ts-go">Оновити вибрані</button></div></form>`, 'ts-t');
  const draw = (): void => {
    const n = [...on.values()].filter(Boolean).length;
    const sure = res.proposals.filter(p => p.tick).length;
    $('#ts-sum', dlg).textContent = `Знайдено ${res.total}${res.truncated ? `, перші ${res.proposals.length}` : ''}. Вибрано ${n}; впевнених ${sure}.${shown < res.proposals.length ? ` Показано ${shown}.` : ''}`;
    ($('#ts-go', dlg) as HTMLButtonElement).disabled = !n;
    ($('#ts-more', dlg) as HTMLButtonElement).hidden = shown >= res.proposals.length;
  };
  const row = (p: TermProposal): string => {
    const ch = pick.get(id(p)) ?? [];
    const alts = p.spans.map((sp, si) => (sp.alts.length ? `<select data-alt="${esc(id(p))}|${si}" aria-label="Інша форма"><option value="-1" ${(ch[si] ?? -1) < 0 ? 'selected' : ''}>${esc(sp.text)}</option>${sp.alts.map((a, ai) => `<option value="${ai}" ${ch[si] === ai ? 'selected' : ''}>${esc(a.text)}</option>`).join('')}</select>` : '')).join('');
    const why = p.conf.level === 'high' ? '' : flagsText(p.conf.flags);
    return `<label class="sp-row fr-row ts-row"><input type="checkbox" data-id="${esc(id(p))}" ${on.get(id(p)) ? 'checked' : ''} aria-label="Замінити в ${esc(ctx.fileTitle(p.file))}"><div class="sp-b"><span class="hint">${esc(ctx.fileTitle(p.file))} · <span class="ts-conf ${p.conf.level}" ${why ? `title="${esc(why)}"` : ''}>${CONF_LABEL[p.conf.level]}</span>${why ? ` <small>${esc(why)}</small>` : ''}${p.status === 'appr' ? ' · вичитано' : p.status === 'done' ? ' · надіслано' : ''}</span><div class="fr-b">${markHtml(p, 'old')}</div><div class="fr-a">${markHtml(p, 'new', ch)}</div>${alts}</div></label>`;
  };
  const list = (): void => { $('#ts-list', dlg).innerHTML = res.proposals.slice(0, shown).map(row).join(''); draw(); };
  dlg.addEventListener('change', e => {
    const t = e.target as HTMLInputElement | HTMLSelectElement;
    if (t instanceof HTMLSelectElement && t.dataset.alt) { const [k, si] = t.dataset.alt.split('|'); const cur = pick.get(k!) ?? []; cur[Number(si)] = Number(t.value); pick.set(k!, cur); list(); return; }
    if ((t as HTMLInputElement).dataset.id) { on.set((t as HTMLInputElement).dataset.id!, (t as HTMLInputElement).checked); draw(); }
  });
  $('#ts-more', dlg).addEventListener('click', () => { shown += PAGE; list(); });
  $('#ts-sure', dlg).addEventListener('click', () => { for (const p of res.proposals) on.set(id(p), p.tick); list(); });
  $('#ts-go', dlg).addEventListener('click', () => {
    const picks = res.proposals.filter(p => on.get(id(p))).map(p => ({ proposal: p, choice: pick.get(id(p)) ?? [] }));
    const changes = termChanges(picks, s.saved, Date.now());
    if (!changes.length) { toast('Нічого оновлювати: рядки вже змінено'); return; }
    const batch = ctx.commit(changes, 'term');
    ctx.persist(); ctx.invalidateTm(); ctx.render();
    undoToast(ctx, `Оновлено за глосарієм: ${plural(changes.length, ['рядок', 'рядки', 'рядків'])}`, batch);
    dlg.close();
  });
  list();
}

/** The tool «Оновити за глосарієм…»: pick a term and say what its old rendering was. */
export function openTermSyncTool(ctx: Ctx): void {
  const terms = [...ctx.s.saved.terms].sort((a, b) => a.en.localeCompare(b.en, 'en'));
  if (!terms.length) { toast('У глосарії ще немає термінів'); return; }
  const start = terms.find(t => t.en.toLowerCase() === last?.en.toLowerCase()) ?? terms[0]!;
  const dlg = dialog(`<form method="dialog"><h2 id="tt-t">Оновити за глосарієм</h2>
    <p class="hint">Оберіть термін і напишіть, яким був його переклад раніше (наприклад «меч»). Знайдуться всі рядки зі старою формою в будь-якому відмінку, і ви побачите, чим їх замінити.</p>
    <div class="grid"><label for="tt-term">Термін</label><select id="tt-term">${terms.map(t => `<option value="${esc(t.en)}" ${t === start ? 'selected' : ''}>${esc(t.en)} → ${esc(t.uk)}</option>`).join('')}</select>
      <label for="tt-old">Старий переклад</label><input id="tt-old" autocomplete="off" value="${esc(last && last.en.toLowerCase() === start.en.toLowerCase() ? last.old[0] ?? '' : '')}"></div>
    <div class="acts"><button class="btn" value="cancel">Закрити</button><button class="btn p" type="button" id="tt-go">Знайти</button></div></form>`, 'tt-t');
  $('#tt-term', dlg).addEventListener('change', () => { const en = ($('#tt-term', dlg) as HTMLSelectElement).value; ($('#tt-old', dlg) as HTMLInputElement).value = last && last.en.toLowerCase() === en.toLowerCase() ? last.old[0] ?? '' : ''; });
  $('#tt-go', dlg).addEventListener('click', () => {
    const en = ($('#tt-term', dlg) as HTMLSelectElement).value, old = ($('#tt-old', dlg) as HTMLInputElement).value.trim();
    const term = terms.find(t => t.en === en);
    if (!term || !old) { toast('Вкажіть, яким був старий переклад'); return; }
    if (old.toLowerCase() === term.uk.trim().toLowerCase()) { toast('Старий і новий переклад однакові'); return; }
    dlg.close();
    openTermSync(ctx, { en, old: [old], next: term.uk.trim() });
  });
}
