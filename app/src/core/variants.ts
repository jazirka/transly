import type { Entry } from './model';

/** One sent translation of a row: who sent it and when. */
export interface Variant { who: string; at: number; text: string; /** The translation the row holds now. */ current: boolean; /** The row is proofread and this is its translation. */ approved: boolean }

const isSend = (what: string): boolean => what.startsWith('надіслано') || what === 'send';

/**
 * The translations of a row that were sent, as the translators sent them: one for each send in the history (several from one translator are all there),
 * the newest first. The translation the row holds now is in the list even when the history does not say who sent it (a translation that came with the game
 * or an import). A text sent again by the same translator, one after another, is one.
 */
export function sentVariants(e: Entry | undefined): Variant[] {
  if (!e) return [];
  const sent = e.status === 'done' || e.status === 'appr';
  const out: Variant[] = [];
  for (const h of e.history ?? []) {
    if (!isSend(h.what) || !h.text.trim()) continue;
    const last = out[out.length - 1];
    if (last && last.text === h.text && last.who === h.who) { last.at = h.at; continue; }
    out.push({ who: h.who, at: h.at, text: h.text, current: false, approved: false });
  }
  if (sent && e.target.trim()) {
    const last = out[out.length - 1];
    if (last && last.text === e.target) { last.current = true; last.approved = e.status === 'appr'; }
    else out.push({ who: e.history?.[e.history.length - 1]?.who ?? '', at: e.mt, text: e.target, current: true, approved: e.status === 'appr' });
  }
  return out.reverse();
}
