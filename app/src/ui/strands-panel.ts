import { WordIndex, linkView, strandsOf, termUsage } from '../core';
import type { GlossaryTerm, StrandKind, TermUsage, Unit } from '../core';
import { esc, plural } from './dom';
import { namesOfRow, oneLine, termView, tmFind } from './hintcards';
import { linksClick, linksHtml } from './links-panel';
import { invalidateMined, mineClick, suggestionsForRow } from './mine-panel';
import { showCard } from './termcard';
import { realOf } from './hintcards';
import type { Ctx } from './state';

/**
 * «Нитки цього рядка»: a card for every glossary entry the original contains (a word, a phrase, a construction with a
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

/** The cards of the row, or '' when there is nothing to show. `target` is the translation as it stands now. */
export function strandsHtml(ctx: Ctx, u: Unit, target: string): string {
  const cards: string[] = [];
  for (const st of strandsOf(u.source, target, ctx.s.saved.terms)) {
    const t = st.term as GlossaryTerm, use = usageOf(ctx, t, realOf(ctx, u));
    const verdict = st.state === 'pending' ? '' : st.state === 'missing' ? '<span class="thc-st warn">▲ немає в перекладі</span>' : st.state === 'alt' ? '<span class="thc-st ok">✔ альтернатива</span>' : '<span class="thc-st ok">✔ є в перекладі</span>';
    const fix = use && use.other ? `<button type="button" class="btn p" data-th="fix" data-hk="${esc(t.en)}" title="Рядки, де «${esc(t.en)}» перекладено не так, як у записі: пройти їх по черзі">Узгодити (${use.other})</button>` : '';
    const all = (use && use.rows.length ? `<button type="button" class="btn" data-th="all" data-hk="${esc(t.en)}" title="Інші рядки, де вживається «${esc(t.en)}»">Інші ${use.rows.length}</button>` : '');
    cards.push(`<div class="thc sc${st.ci}" data-ci="${st.ci}" data-hk="${esc(t.en)}"><span class="thc-dot" aria-hidden="true"></span>
      <div class="thc-t"><button type="button" class="thc-name" data-hc="term" data-hk="${esc(t.en)}"><b>${esc(t.en)}</b><span class="arr" aria-hidden="true">→</span><b>${esc(t.uk)}</b></button><span class="tg k">${KIND_WORD[st.kind]}</span>${verdict}
        ${t.alt?.length ? `<div class="hint">також: ${esc(t.alt.join('; '))}</div>` : ''}${t.note ? `<div class="hint">${esc(t.note)}</div>` : ''}</div>
      <div class="thc-u">${usageHtml(use)}</div><div class="thc-a">${fix}${all}</div></div>`);
  }
  namesOfRow(ctx, u).forEach((g, i) => {
    const tr = ctx.entries(g.file)[g.key]?.target;
    cards.push(`<div class="thc name"><span class="thc-dot" aria-hidden="true"></span><div class="thc-t"><button type="button" class="thc-name" data-hc="name" data-hk="${i}"><b>${esc(g.name)}</b><span class="arr" aria-hidden="true">→</span>${tr ? `<b>${esc(tr)}</b>` : '<i>ще не перекладено</i>'}</button><span class="tg k">назва з гри</span></div></div>`);
  });
  // the translation memory: the rows that were already translated and read like this one; a click puts the translation into the field
  const srcLabel = (x: string): string => (x === 'Імпорт' ? 'імпорт' : x.replace(/\.json$/, ''));
  tmFind(ctx, u, target).forEach((x, n) => {
    cards.push(`<div class="thc mem"><span class="thc-dot" aria-hidden="true"></span>
      <div class="thc-t"><span class="thc-mt">${esc(oneLine(x.t, 140))}</span><span class="tg k">пам’ять ${x.score}%</span>${x.s !== u.source ? `<div class="hint">«${esc(oneLine(x.s, 70))}» · ${esc(srcLabel(x.src))}</div>` : `<div class="hint">той самий оригінал · ${esc(srcLabel(x.src))}</div>`}</div>
      <div class="thc-u"></div><div class="thc-a"><button type="button" class="btn" data-tm="${n}" title="Підставити цей переклад у поле">Підставити</button></div></div>`);
  });
  const r = realOf(ctx, u);
  if (linkView(ctx.s.saved, ctx.links(), r.file, r.key)) cards.push(`<div class="thc rows"><span class="thc-dot" aria-hidden="true"></span><div class="thc-t thc-lk">${linksHtml(ctx, u)}</div></div>`);
  cards.push(suggestionsForRow(ctx, u.source));
  return cards.join('');
}

let lastHtml = '';
/** Empty the block under the editor (the cards stand in the right panel when there is no editor). */
export function clearStrands(): void {
  const box = document.getElementById('f-threads'), body = document.getElementById('f-threads-b');
  if (box) box.hidden = true;
  if (body) body.replaceChildren();
  lastHtml = '';
}

/** Fill the block under the editor; it stays hidden when the row has nothing to show. */
export function renderStrands(ctx: Ctx, u: Unit | undefined, target: string): void {
  const box = document.getElementById('f-threads'), body = document.getElementById('f-threads-b');
  if (!box || !body) return;
  // Under the editor only in the editing view: elsewhere the cards stand in the right panel.
  const html = u && ctx.s.mode === 'edit' ? strandsHtml(ctx, u, target) : '';
  const chips = document.getElementById('f-thr-chips');
  if (chips) {
    const st = u ? strandsOf(u.source, target, ctx.s.saved.terms) : [];
    const gaps = st.filter(x => x.src.length > 1).length, bad = st.filter(x => x.state === 'missing').length;
    chips.innerHTML = st.length ? `<span class="chip">нитки: ${st.length}</span>${gaps ? `<span class="chip">розділені: ${gaps}</span>` : ''}${bad ? `<span class="chip warn">немає в перекладі: ${bad}</span>` : ''}` : '';
  }
  box.hidden = !html;
  if (html === lastHtml && !box.hidden) return;
  lastHtml = html;
  body.innerHTML = html;
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
  const all = t.closest<HTMLElement>('[data-th="all"]');
  if (!all) return false;
  const en = all.dataset.hk ?? '';
  termView.key = en; termView.tab = 'c'; termView.i = 0;
  showCard(ctx, all, 'term', en, true);
  return true;
}
