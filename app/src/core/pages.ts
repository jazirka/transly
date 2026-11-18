/**
 * Pages of a long list. A list can be shown as pages (only the rows of one page are drawn: a page is a place the translator can come back
 * to: «page 3, the fifth from the top»), as one continuous list with a mark where every page begins, or as one continuous list as before.
 * Everything here is arithmetic over the number of rows; what is drawn, and where the place is kept, is the screen's business (`ui/pages.ts`).
 */

export type PagesMode = 'pages' | 'flow' | 'off';

export interface PagesPrefs {
  mode: PagesMode;
  /** Rows on a page. */
  size: number;
  /** Whether the page, the row and the scroll of each list are remembered and come back. */
  remember: boolean;
}

export const PAGE_SIZES = [25, 50, 100, 200] as const;
export const DEFAULT_PAGES: PagesPrefs = { mode: 'pages', size: 50, remember: true };

/** Preferences from whatever was stored: a damaged or an old value falls back to the default one by one. */
export function normalizePages(raw: unknown): PagesPrefs {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const mode: PagesMode = r.mode === 'pages' || r.mode === 'flow' || r.mode === 'off' ? r.mode : DEFAULT_PAGES.mode;
  const size = typeof r.size === 'number' && (PAGE_SIZES as readonly number[]).includes(r.size) ? r.size : DEFAULT_PAGES.size;
  const remember = typeof r.remember === 'boolean' ? r.remember : DEFAULT_PAGES.remember;
  return { mode, size, remember };
}

/** How many pages `total` rows make (an empty list is one empty page). */
export const pageCount = (total: number, size: number): number => Math.max(1, Math.ceil(Math.max(0, total) / Math.max(1, size)));

/** The page (counted from 0) that is as near to `page` as the list allows. */
export const clampPage = (page: number, total: number, size: number): number => Math.min(Math.max(0, Math.floor(Number.isFinite(page) ? page : 0)), pageCount(total, size) - 1);

/** The page the row at `index` (counted from 0) is on. */
export const pageOfIndex = (index: number, size: number): number => Math.max(0, Math.floor(index / Math.max(1, size)));

/** The rows of `page` as [first, after the last) indexes. */
export function pageRange(page: number, total: number, size: number): [number, number] {
  const p = clampPage(page, total, size);
  return [p * size, Math.min(total, (p + 1) * size)];
}

/** The page where the row `key` stands in `keys`, or null when it is not there. */
export function pageOfKey(keys: readonly string[], key: string | null | undefined, size: number): number | null {
  if (!key) return null;
  const i = keys.indexOf(key);
  return i < 0 ? null : pageOfIndex(i, size);
}

/** What a list was when the translator left it: the page, the first row in view and how far the list was scrolled. */
export interface Place { page: number; key?: string; top?: number }

const PLACES_MAX = 120;

/** `places` with `place` for `id` put last (the oldest are dropped, so the memory does not grow with every file and filter tried). */
export function rememberPlace(places: Record<string, Place>, id: string, place: Place): Record<string, Place> {
  const out: Record<string, Place> = {};
  for (const [k, v] of Object.entries(places)) if (k !== id) out[k] = v;
  out[id] = place;
  const keys = Object.keys(out);
  if (keys.length > PLACES_MAX) for (const k of keys.slice(0, keys.length - PLACES_MAX)) delete out[k];
  return out;
}

/** Places from whatever was stored: anything that does not look like a place is left out. */
export function normalizePlaces(raw: unknown): Record<string, Place> {
  const out: Record<string, Place> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== 'object') continue;
    const p = v as Record<string, unknown>;
    if (typeof p.page !== 'number' || !Number.isFinite(p.page) || p.page < 0) continue;
    out[k] = { page: Math.floor(p.page), ...(typeof p.key === 'string' ? { key: p.key } : {}), ...(typeof p.top === 'number' && Number.isFinite(p.top) && p.top >= 0 ? { top: p.top } : {}) };
  }
  return out;
}
