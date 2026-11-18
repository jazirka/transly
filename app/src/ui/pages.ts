import { DEFAULT_PAGES, clampPage, normalizePages, normalizePlaces, pageCount, pageOfIndex, pageOfKey, pageRange, rememberPlace } from '../core';
import type { PagesPrefs, Place } from '../core';
import { reveal } from './chunks';

/**
 * The pages of the list of rows (see `core/pages.ts` for the arithmetic). Two ways to show them, both with a bubble at the bottom of the window:
 * pages (only the rows of one page are drawn; the bubble has «‹ 3 / 12 ›») and one continuous list with a mark where every page begins (the
 * bubble says the page that is in view). The translator can turn them off. Where the translator was in a list (the page, the first row in
 * view, how far it was scrolled) is remembered for every file and set of filters, and it comes back when the list is opened again.
 */

const PREFS_KEY = 'transly.pages';
const PLACES_KEY = 'transly.places';

let prefs: PagesPrefs | null = null;
export function pagesPrefs(): PagesPrefs {
  if (!prefs) { try { prefs = normalizePages(JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null')); } catch { prefs = { ...DEFAULT_PAGES }; } }
  return prefs;
}
export function setPagesPrefs(p: Partial<PagesPrefs>): PagesPrefs {
  prefs = normalizePages({ ...pagesPrefs(), ...p });
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* private mode: the choice lasts until the page is closed */ }
  view = null;
  return prefs;
}

let places: Record<string, Place> | null = null;
function loadPlaces(): Record<string, Place> {
  if (!places) { try { places = normalizePlaces(JSON.parse(localStorage.getItem(PLACES_KEY) ?? 'null')); } catch { places = {}; } }
  return places;
}
function savePlace(sig: string, p: Place): void {
  if (!pagesPrefs().remember) return;
  places = rememberPlace(loadPlaces(), sig, p);
  try { localStorage.setItem(PLACES_KEY, JSON.stringify(places)); } catch { /* the place is not kept, that is all */ }
}
/** The remembered places are forgotten (the translator turned the memory off). */
export function forgetPlaces(): void { places = {}; try { localStorage.removeItem(PLACES_KEY); } catch { /* nothing to do */ } }

interface View {
  sig: string;
  page: number;
  lastCur: string | null;
  keys: string[];
  /** Where each row is, for the page that is in view while the list scrolls. */
  at: Map<string, number>;
  top: number;
}
let view: View | null = null;
/** The scroll the list is to be put at once it is drawn (a remembered place), or 0 for a page that was just turned to. */
let wantTop: number | null = null;

export interface RowsPlan {
  mode: PagesPrefs['mode'];
  /** The rows to draw: all of them, or one page. */
  from: number;
  to: number;
  page: number;
  pages: number;
  size: number;
  total: number;
}

/**
 * Which rows of the list are drawn. `sig` says which list this is (the file and the filters), `keys` are its rows in order and `cur` is the
 * open row: a new list opens where it was left (if the memory is on), and a row that is opened on another page brings its page in.
 */
export function planRows(sig: string, keys: string[], cur: string | null): RowsPlan {
  const P = pagesPrefs();
  const total = keys.length, pages = pageCount(total, P.size);
  if (view && view.sig !== sig) savePlace(view.sig, { page: view.page, ...(view.top ? { top: view.top } : {}) });
  let page = 0;
  if (!view || view.sig !== sig) {
    const mem = P.remember ? loadPlaces()[sig] : undefined;
    const byCur = pageOfKey(keys, cur, P.size);
    // a list that is opened again comes back to the page it was left on; a row that is opened later brings its own page in (below)
    page = mem ? mem.page : byCur ?? 0;
    wantTop = mem && mem.page === clampPage(page, total, P.size) && mem.top !== undefined ? mem.top : null;
  } else {
    page = view.page;
    if (cur !== view.lastCur) { const byCur = pageOfKey(keys, cur, P.size); if (byCur !== null && P.mode === 'pages') { if (byCur !== page) wantTop = null; page = byCur; } }
  }
  page = clampPage(page, total, P.size);
  const at = new Map<string, number>();
  if (P.mode === 'flow') keys.forEach((k, i) => at.set(k, i));
  view = { sig, page, lastCur: cur, keys, at, top: view && view.sig === sig ? view.top : (wantTop ?? 0) };
  const [from, to] = P.mode === 'pages' ? pageRange(page, total, P.size) : [0, total];
  return { mode: P.mode, from, to, page, pages, size: P.size, total };
}

/** Where the list is to be scrolled once it is drawn (a remembered place), once. */
export function takeWantTop(): number | null { const t = wantTop; wantTop = null; return t; }

/** Draws the bubble of the pages (or hides it: off, or a list of one page). */
export function renderPager(bubble: HTMLElement | null, host: HTMLElement | null, plan: RowsPlan): void {
  if (!bubble) return;
  const show = plan.mode !== 'off' && plan.pages > 1;
  bubble.hidden = !show;
  host?.classList.toggle('has-pager', show);
  if (!show) { bubble.innerHTML = ''; return; }
  const p = plan.page + 1;
  const range = plan.mode === 'pages' ? `${(plan.from + 1).toLocaleString('uk-UA')}–${plan.to.toLocaleString('uk-UA')} з ${plan.total.toLocaleString('uk-UA')}` : `${plan.size} рядків на сторінці`;
  bubble.classList.toggle('flow', plan.mode === 'flow');
  bubble.innerHTML = `${plan.mode === 'pages' ? `<button type="button" class="pg-a" data-pg="prev" aria-label="Попередня сторінка"${plan.page === 0 ? ' disabled' : ''}>‹</button>` : ''}<button type="button" class="pg-n" data-pg="jump" title="${range}. Клік — перейти до сторінки" aria-label="Сторінка ${p} з ${plan.pages}. Перейти до сторінки">${p} / ${plan.pages}</button>${plan.mode === 'pages' ? `<button type="button" class="pg-a" data-pg="next" aria-label="Наступна сторінка"${plan.page >= plan.pages - 1 ? ' disabled' : ''}>›</button>` : ''}`;
}

interface Wire { render: () => void; list: () => HTMLElement | null; bubble: () => HTMLElement | null }
let wire: Wire | null = null;
let ticking = false;

/** The shell tells how to draw the list again and where the list and the bubble are. */
export function wirePages(w: Wire): void {
  wire = w;
  document.addEventListener('scroll', e => {
    const list = wire?.list();
    if (!list || e.target !== list || ticking) return;
    ticking = true;
    requestAnimationFrame(() => { ticking = false; onScroll(); });
  }, { capture: true, passive: true });
}

let scrollSave = 0;
function onScroll(): void {
  const list = wire?.list();
  if (!list || !view) return;
  view.top = list.scrollTop;
  window.clearTimeout(scrollSave);
  scrollSave = window.setTimeout(() => { if (view) savePlace(view.sig, { page: view.page, ...(view.top ? { top: view.top } : {}) }); }, 400);
  if (pagesPrefs().mode !== 'flow') return;
  // the page of the first row in view
  const top = list.getBoundingClientRect().top + 4;
  let key: string | undefined;
  for (const r of list.querySelectorAll<HTMLElement>('.si:not(.lazy)')) { if (r.getBoundingClientRect().bottom > top) { key = r.dataset.key; break; } }
  const i = key !== undefined ? view.at.get(key) : undefined;
  if (i === undefined) return;
  const page = pageOfIndex(i, pagesPrefs().size);
  if (page === view.page) return;
  view.page = page;
  const n = wire?.bubble()?.querySelector('.pg-n');
  if (n) { const pages = pageCount(view.keys.length, pagesPrefs().size); n.textContent = `${page + 1} / ${pages}`; }
}

/** Go to the page `page` (counted from 0): the page is drawn, or the continuous list is scrolled to its first row. */
export function goToPage(page: number): void {
  if (!view || !wire) return;
  const P = pagesPrefs();
  const p = clampPage(page, view.keys.length, P.size);
  if (P.mode === 'pages') { view.page = p; wantTop = 0; wire.render(); const l = wire.list(); if (l) l.scrollTop = 0; return; }
  if (P.mode === 'flow') {
    const key = view.keys[p * P.size];
    const list = wire.list();
    if (!key || !list) return;
    view.page = p;
    reveal('slist', key);
    list.querySelector<HTMLElement>(`.si[data-key="${CSS.escape(key)}"]`)?.scrollIntoView({ block: 'start' });
    const n = wire.bubble()?.querySelector('.pg-n');
    if (n) n.textContent = `${p + 1} / ${pageCount(view.keys.length, P.size)}`;
  }
}

/** Clicks on the bubble. */
export function pagesClick(t: HTMLElement): boolean {
  const b = t.closest<HTMLElement>('[data-pg]');
  if (!b || !view || !wire) return false;
  const act = b.dataset.pg;
  if (act === 'prev') goToPage(view.page - 1);
  else if (act === 'next') goToPage(view.page + 1);
  else if (act === 'jump') askPage(b);
  return true;
}

/** The label of the bubble becomes a field for the number of the page. */
function askPage(label: HTMLElement): void {
  if (!view) return;
  const bubble = wire?.bubble();
  if (!bubble || bubble.querySelector('.pg-in')) return;
  const pages = pageCount(view.keys.length, pagesPrefs().size);
  const input = document.createElement('input');
  input.type = 'number'; input.min = '1'; input.max = String(pages); input.value = String(view.page + 1);
  input.className = 'pg-in'; input.setAttribute('aria-label', `Номер сторінки від 1 до ${pages}`);
  label.replaceWith(input);
  input.focus(); input.select();
  let done = false;
  const finish = (go: boolean): void => {
    if (done) return;
    done = true;
    const n = Number(input.value);
    if (go && Number.isFinite(n) && n >= 1) goToPage(n - 1);
    // the bubble is drawn again when the page changed; in the continuous list the label is put back here
    if (input.isConnected && view) { const l = document.createElement('button'); l.type = 'button'; l.className = 'pg-n'; l.dataset.pg = 'jump'; l.textContent = `${view.page + 1} / ${pages}`; input.replaceWith(l); }
  };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); finish(true); } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); } });
  input.addEventListener('blur', () => finish(false));
}

