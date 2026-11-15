import { mineConstructions, prepareText, termMatchesIn, termsStamp } from '../core';
import type { ConstructionSuggestion } from '../core';
import { esc, plural } from './dom';
import type { Ctx } from './state';

/**
 * Constructions found in the translator's own rows («take … off» always rendered «зняти»), proposed as cards: add (the form opens
 * with the pattern filled in, nothing is stored until it is saved), show the rows, not now. Found in the background, in slices; they are
 * looked for again at most every ten seconds, and only when something asks for them.
 */

const KEY = 'transly.mine.no';
const AGAIN_MS = 10000;

let mined: { stamp: string; at: number; list: ConstructionSuggestion[] } | null = null;
let running = false, dirty = false;
let redraw: (() => void) | null = null;
let add: ((en: string, uk: string) => void) | null = null;

const dismissed = (): Set<string> => { try { return new Set(JSON.parse(localStorage.getItem(KEY) ?? '[]') as string[]); } catch { return new Set(); } };
const dismiss = (en: string): void => { try { localStorage.setItem(KEY, JSON.stringify([...dismissed(), en])); } catch { /* private mode */ } };

/** The shell says how an entry is started from a proposal, and how to draw again once the proposals are found. */
export function wireMine(addEntry: (en: string, uk: string) => void, again: () => void): void { add = addEntry; redraw = again; }
/** The translations changed: the proposals may have. */
export function invalidateMined(): void { dirty = true; }

const pause = (): Promise<void> => new Promise(r => setTimeout(r, 0));

/** The proposals so far (empty until they are found). Asks for them to be found when there are none yet or they are old. */
export function suggestions(ctx: Ctx): ConstructionSuggestion[] {
  const stamp = `${termsStamp(ctx.s.saved.terms)}|${ctx.s.views.length}`;
  const stale = !mined || mined.stamp !== stamp || (dirty && Date.now() - mined.at > AGAIN_MS);
  if (stale && !running && ctx.s.views.length) {
    running = true; dirty = false;
    void mineConstructions(ctx.s.views, ctx.s.saved, ctx.s.saved.terms, pause)
      .then(list => { mined = { stamp, at: Date.now(), list }; })
      .catch(e => { console.error('mine failed', e); mined = { stamp, at: Date.now(), list: [] }; })
      .finally(() => { running = false; redraw?.(); });
  }
  const no = dismissed();
  return (mined?.list ?? []).filter(x => !no.has(x.en));
}

function card(x: ConstructionSuggestion): string {
  return `<div class="thc new" data-mn-en="${esc(x.en)}"><span class="thc-dot" aria-hidden="true"></span>
    <div class="thc-t"><b>${esc(x.en)}</b><span class="arr" aria-hidden="true">→</span><b>${esc(x.uk)}</b><span class="tg k">нова конструкція</span><div class="hint">так уже перекладено в ${plural(x.rows.length, ['рядку', 'рядках', 'рядках'])}</div></div>
    <div class="thc-u"></div>
    <div class="thc-a"><button type="button" class="btn p" data-mn="add" data-en="${esc(x.en)}">Додати</button><button type="button" class="btn" data-mn="show" data-en="${esc(x.en)}">Показати ${x.rows.length}</button><button type="button" class="btn" data-mn="no" data-en="${esc(x.en)}">Не зараз</button></div></div>`;
}

/** The proposals whose pattern stands in this original (under the cards of the open row). */
export function suggestionsForRow(ctx: Ctx, source: string): string {
  const p = prepareText(source);
  return suggestions(ctx).filter(x => termMatchesIn(p, x.en).length).slice(0, 3).map(card).join('');
}

/** All proposals (the list of constructions in «Пов’язане»). */
export function suggestionsList(ctx: Ctx): { html: string; running: boolean } {
  const list = suggestions(ctx);
  return { html: list.slice(0, 20).map(card).join(''), running: running && !mined };
}

/** The buttons of a proposal. */
export function mineClick(ctx: Ctx, t: HTMLElement): boolean {
  const b = t.closest<HTMLElement>('[data-mn]');
  if (!b) return false;
  const en = b.dataset.en ?? '';
  const x = (mined?.list ?? []).find(y => y.en === en);
  if (!x) return true;
  if (b.dataset.mn === 'add') add?.(x.en, x.uk);
  else if (b.dataset.mn === 'show') ctx.openRows(`«${x.en}»: так уже перекладено`, x.rows);
  else if (b.dataset.mn === 'no') { dismiss(x.en); redraw?.(); }
  return true;
}
