import { WordIndex, strandsOf, termUsage } from '../core';
import type { GlossaryTerm, StrandKind, TermUsage, Unit } from '../core';
import { esc, plural } from './dom';
import { namesOfRow, oneLine, termView, tmFind } from './hintcards';
import { isPinned, numberTerms, showPinned, togglePin } from './links';
import { eqChipHtml, linksClick } from './links-panel';
import { invalidateMined, mineClick, suggestionsForRow } from './mine-panel';
import { cardOpenOver, hideTermCard, showCard } from './termcard';
import { realOf } from './hintcards';
import type { Ctx } from './state';
import { insertText } from './focus';

/**
 * «Пов’язане з рядком» (the cards under the field): a card for every glossary entry the original contains (a word, a phrase, a construction with a
 * gap), for every name the game defines in it, and for the rows that have the same original. A card says what the entry is
 * rendered as in this row and, across the whole game, how often it is rendered as the entry says. The colour of a card is the
 * colour of its thread in the editor (see `links.ts`). The numbers are worked out from the rows, never stored; the index of the
 * words that makes that quick is built in slices the first time it is needed, and the cards are drawn again when it is ready.
 */

const KIND_WORD: Record<StrandKind, string> = { word: 'слово', phrase: 'фраза', construction: 'конструкція' };

let index: WordIndex | null = null, indexFor: unknown = null, building = false;
const usageCache = new Map<string, TermUsage>();
let again: (() => void) | null = null;
let redrawFn: (() => void) | null = null;
/** The shell says how the cards are drawn again once the index of the words is ready: only what shows them, never the whole screen. */
export const wireStrands = (fn: () => void): void => { redrawFn = fn; again = fn; };

/** The translations changed (a row was sent, replaced, restored): the numbers are worked out again. */
export function invalidateUsage(): void { usageCache.clear(); usageRevision++; invalidateMined(); }
let usageRevision = 0;
/** Changes whenever the numbers may have changed: a list built from them is worked out again when it differs. */
export const usageRev = (): number => usageRevision;

const pause = (): Promise<void> => new Promise(r => setTimeout(r, 0));

function indexOf(ctx: Ctx): WordIndex | null {
  const views = ctx.s.views;
  if (index && indexFor === views) return index;
  if (!building) {
    building = true;
    void WordIndex.build(views, pause).then(ix => { index = ix; indexFor = views; building = false; usageCache.clear(); again?.(); }).catch(() => { building = false; });
  }
  return null;
}

function usageOf(ctx: Ctx, t: GlossaryTerm, row: { file: string; key: string }): TermUsage | null {
  const id = `${t.en}\u0001${row.file}\u0001${row.key}`;
  const hit = usageCache.get(id);
  if (hit) return hit;
  const ix = indexOf(ctx);
  if (!ix) return null;
  // the open row is left out: its own verdict is on the card, the numbers are about the other rows
  const u = termUsage(ix, ctx.s.saved, t, row);
  usageCache.set(id, u);
  return u;
}

/** How an entry is used across the whole game, or null while the index of the words is still being built. */
export function usageAll(ctx: Ctx, t: GlossaryTerm): TermUsage | null {
  const id = `${t.en}\u0001*`;
  const hit = usageCache.get(id);
  if (hit) return hit;
  const ix = indexOf(ctx);
  if (!ix) return null;
  const u = termUsage(ix, ctx.s.saved, t);
  usageCache.set(id, u);
  return u;
}

/** The entries whose renderings differ from the entry's own somewhere in the game, worked out in slices (the screen is given back between them). */
export async function entriesWithDifferences(ctx: Ctx, terms: GlossaryTerm[]): Promise<Set<string>> {
  const ix = await WordIndex.build(ctx.s.views, pause);
  const out = new Set<string>();
  for (let i = 0; i < terms.length; i++) {
    if (termUsage(ix, ctx.s.saved, terms[i]!).other > 0) out.add(terms[i]!.en);
    if (i % 40 === 39) await pause();
  }
  return out;
}

/** One line about the use of an entry (for the list): how many rows and whether they agree. */
export function usageLine(u: TermUsage | null): string {
  if (!u) return '';
  if (!u.rows.length) return 'ще ніде не вживається';
  return `${plural(u.rows.length, ['рядок', 'рядки', 'рядків'])} · ${u.other ? `${u.other} інакше` : 'усюди як у записі'}`;
}

function usageHtml(u: TermUsage | null): string {
  if (!u) return '<span class="hint">рахую вживання…</span>';
  if (!u.rows.length) return '<span class="hint">більше ніде</span>';
  const own = u.main + u.alt, done = own + u.other, pct = (n: number): number => (done ? Math.round((n / done) * 100) : 0);
  const bar = done ? `<span class="thc-bar" aria-hidden="true"><i class="ok" style="width:${pct(own)}%"></i><i class="warn" style="width:${pct(u.other)}%"></i></span>` : '';
  const text = [`ще ${plural(u.rows.length, ['рядок', 'рядки', 'рядків'])}`, done ? `${own} як у записі` : '', u.other ? `<span class="thc-w">${u.other} інакше</span>` : '', u.none ? `${u.none} без перекладу` : ''].filter(Boolean).join(' · ');
  return `${bar}<span class="hint">${text}</span>`;
}

/** One thread as a chip: a click on its body keeps the thread drawn, the pointer over it draws it (see `links.ts`), the small button opens the card. */
function chipHtml(ctx: Ctx, st: ReturnType<typeof strandsOf>[number], row: { file: string; key: string }): string {
  const t = st.term as GlossaryTerm, use = usageOf(ctx, t, row);
  // no marks of its own: a word that is not in the translation yet is dimmed, a click puts it in; the details are in the card (the small button, shown on hover)
  const tip = [`${t.en} → ${t.uk}`, KIND_WORD[st.kind], st.state === 'missing' ? 'ще немає в перекладі: клік вставить' : '', usageLine(use)].filter(Boolean).join(' · ');
  const fix = use && use.other ? `<button type="button" class="thc2-fix" data-th="fix" data-hk="${esc(t.en)}" title="Рядки, де «${esc(t.en)}» перекладено не так, як у записі: пройти їх по черзі">≠ ${use.other}</button>` : '';
  return `<span class="thc2 sc${st.ci}${st.state === 'missing' ? ' miss' : ''}${isPinned(t.en) ? ' on' : ''}" data-ci="${st.ci}" data-ck="${esc(t.en)}"><button type="button" class="thc2-b" data-thp="${esc(t.en)}" aria-pressed="${isPinned(t.en)}" title="${esc(tip)}"><i class="thc2-dot" aria-hidden="true"></i><b>${esc(t.en)}</b><span class="arr" aria-hidden="true">→</span><b>${esc(t.uk)}</b></button><button type="button" class="thc2-m" data-th="card" data-hk="${esc(t.en)}" aria-label="Картка: ${esc(t.en)}" title="Картка, форми, вживання">▾</button>${fix}</span>`;
}

/**
 * The threads of the row, or '' when there is nothing to show: one line of chips (a word, a phrase, a construction, a name), the pointer over a
 * chip draws its thread in the text and the small button opens its card; under them the proposals (the memory, new constructions). The link with
 * the rows that have the same original is not a thread: it stands beside the label of the translation (`links-panel.ts`); in the panel at the
 * right (`withRows`) its chip stands first.
 */
export function strandsHtml(ctx: Ctx, u: Unit, target: string, withRows = false): string {
  const chips: string[] = [];
  const r = realOf(ctx, u);
  if (withRows) chips.push(eqChipHtml(ctx, u));
  for (const st of strandsOf(u.source, target, ctx.s.saved.terms)) chips.push(chipHtml(ctx, st, r));
  namesOfRow(ctx, u).forEach((g, i) => {
    const tr = ctx.entries(g.file)[g.key]?.target;
    chips.push(`<span class="thc2 name"><span class="thc2-b" title="Назва з гри"><i class="thc2-dot" aria-hidden="true"></i><b>${esc(g.name)}</b><span class="arr" aria-hidden="true">→</span>${tr ? `<b>${esc(tr)}</b>` : '<i class="hint">ще не перекладено</i>'}</span><button type="button" class="thc2-m" data-th="name" data-hk="${i}" aria-label="Картка: ${esc(g.name)}" title="Картка назви">▾</button></span>`);
  });
  // the translation memory: the rows that were already translated and read like this one; a click puts the translation into the field
  const srcLabel = (x: string): string => (x === 'Імпорт' ? 'імпорт' : x.replace(/\.json$/, ''));
  const under: string[] = [];
  tmFind(ctx, u, target).forEach((x, n) => {
    under.push(`<div class="thc mem"><span class="thc-dot" aria-hidden="true"></span>
      <div class="thc-t"><span class="thc-mt">${esc(oneLine(x.t, 140))}</span><span class="tg k">пам’ять ${x.score}%</span>${x.s !== u.source ? `<div class="hint">«${esc(oneLine(x.s, 70))}» · ${esc(srcLabel(x.src))}</div>` : `<div class="hint">той самий оригінал · ${esc(srcLabel(x.src))}</div>`}</div>
      <div class="thc-u"></div><div class="thc-a"><button type="button" class="btn" data-tm="${n}" title="Підставити цей переклад у поле">Підставити</button></div></div>`);
  });
  under.push(suggestionsForRow(ctx, u.source));
  return (chips.length ? `<div class="thb" role="group" aria-label="Пов’язане">${chips.join('')}</div>` : '') + under.join('');
}

let lastHtml = '';
/** Empty the block of the related things in the right panel. */
export function clearStrands(): void {
  const body = document.getElementById('pn-th'), sec = document.querySelector<HTMLElement>('.pn-sec[data-sec="th"]');
  if (sec) sec.dataset.empty = '1';
  if (body) body.replaceChildren();
  lastHtml = '';
}

/**
 * Fill the block of the related things in the right panel (in the editing view too: there the cards follow the text of the field as it is typed);
 * the section is not drawn when the row has nothing to show.
 */
export function renderStrands(ctx: Ctx, u: Unit | undefined, target: string): void {
  const body = document.getElementById('pn-th'), sec = document.querySelector<HTMLElement>('.pn-sec[data-sec="th"]');
  if (!body || !sec) return;
  // the chip of the rows with the same original stands beside the label of the translation in the editing view, and first among the cards where there is no editor
  const html = u ? strandsHtml(ctx, u, target, ctx.s.mode !== 'edit') : '';
  sec.dataset.empty = html ? '' : '1';
  // nothing related: the tab says so, in the middle (not an empty dark panel)
  const shown = html || '<div class="pn-mid">Брак пов’язаного</div>';
  if (shown === lastHtml) return;
  lastHtml = shown;
  body.innerHTML = shown;
  numberTerms();
}

/** Clicks on the cards' own buttons. */
export function strandsClick(ctx: Ctx, t: HTMLElement): boolean {
  if (mineClick(ctx, t) || linksClick(ctx, t)) return true;
  const fix = t.closest<HTMLElement>('[data-th="fix"]');
  if (fix) {
    // The rows where the entry was rendered another way, to be gone through one by one (nothing is changed here: the translator decides row by row).
    const term = ctx.s.saved.terms.find(x => x.en === fix.dataset.hk);
    const cur = ctx.s.cur ? ctx.unit(ctx.s.cur) : undefined;
    const use = term && cur ? usageOf(ctx, term, realOf(ctx, cur)) : null;
    if (term && use?.otherRows.length) ctx.openRows(`«${term.en}»: перекладено інакше`, use.otherRows);
    return true;
  }
  const pin = t.closest<HTMLElement>('[data-thp]');
  if (pin) {
    // a click on the word of a thread puts its translation into the row at once (after the last character); what the pin did is on the hover
    const uk = ctx.s.saved.terms.find(x => x.en.trim().toLowerCase() === (pin.dataset.thp ?? '').trim().toLowerCase())?.uk;
    if (uk && ctx.s.cur) { hideTermCard(); insertText(ctx, uk); return true; }
    togglePin(ctx, pin.dataset.thp ?? ''); showPinned(); return true;
  }
  const card = t.closest<HTMLElement>('[data-th="card"], [data-th="name"]');
  if (!card) return false;
  const en = card.dataset.hk ?? '';
  if (cardOpenOver(card)) { hideTermCard(); return true; }
  if (card.dataset.th === 'name') { showCard(ctx, card, 'name', en, false); return true; }
  termView.key = en; termView.tab = 'a'; termView.i = 0; termView.forms = false;
  showCard(ctx, card, 'term', en, true);
  return true;
}
