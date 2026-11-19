import type { Drop, Entry, Vote } from './model';

const hashText = (t: string): string => { let h = 0x811c9dc5; for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(36); };

/** One contribution to a row: a translation that was sent, and who sent it first. */
export interface Variant { /** Identifies the contribution in the votes (its text). */ id: string; who: string; at: number; text: string; /** When it was sent the last time (a contribution taken off the card shows again when it is sent anew). */ sentAt: number; /** The translation the row holds now. */ current: boolean; /** The row is proofread and this is its translation. */ approved: boolean }

/** Id of a contribution: its text. The same text sent by another translator (or by the one who approved it) is the same contribution, so its votes stay with it. */
export const variantId = (text: string): string => hashText(text);

const isSend = (what: string): boolean => what.startsWith('надіслано') || what === 'send';

/**
 * The contributions to a row: the translations that were sent, one card for each different text, the newest first. The translator who sent a text first keeps
 * the credit when it is sent again (by anyone, also by the one who approved it). The translation the row holds now is in the list even when the history does not
 * say who sent it (a translation that came with the game or an import).
 */
export function sentVariants(e: Entry | undefined): Variant[] {
  if (!e) return [];
  const sent = e.status === 'done' || e.status === 'appr';
  const out: Variant[] = [];
  for (const h of e.history ?? []) {
    if (!isSend(h.what) || !h.text.trim()) continue;
    const same = out.find(v => v.text === h.text);
    if (same) { same.sentAt = Math.max(same.sentAt, h.at); continue; }
    out.push({ id: variantId(h.text), who: h.who, at: h.at, sentAt: h.at, text: h.text, current: false, approved: false });
  }
  if (sent && e.target.trim()) {
    const own = out.find(v => v.text === e.target);
    if (own) { own.current = true; own.approved = e.status === 'appr'; }
    else out.push({ id: variantId(e.target), who: e.history?.[e.history.length - 1]?.who ?? '', at: e.mt, sentAt: e.mt, text: e.target, current: true, approved: e.status === 'appr' });
  }
  // a contribution that was taken off stays off until it is sent anew, except the one the row holds now
  const off = new Map<string, Drop>();
  for (const d of e.drops ?? []) off.set(d.on, d);
  return out.filter(v => v.current || !off.get(v.id) || off.get(v.id)!.off || v.sentAt > off.get(v.id)!.at).reverse();
}

/** The id under which a vote is stored: one vote of one translator for one contribution. */
export const voteId = (v: Vote): string => `${v.who}\u0001${v.on}`;
/** Of two copies of the same vote the later one; at the same time the greater form, so the answer does not depend on which copy is which. */
export const laterVote = (a: Vote, b: Vote): Vote => (a.at !== b.at ? (b.at > a.at ? b : a) : JSON.stringify(b) > JSON.stringify(a) ? b : a);
/** The votes in a fixed order (oldest first), so a merge does not show in the result. */
export const byVote = (x: Vote, y: Vote): number => x.at - y.at || (voteId(x) < voteId(y) ? -1 : voteId(x) > voteId(y) ? 1 : 0);

export interface Tally { up: number; down: number; /** The vote of `who`: 1, -1 or 0 (none). */ mine: -1 | 0 | 1 }

/** The votes a contribution has, and what `who` voted. */
export function tallyOf(e: Entry | undefined, id: string, who: string): Tally {
  const t: Tally = { up: 0, down: 0, mine: 0 };
  for (const v of e?.votes ?? []) {
    if (v.on !== id) continue;
    if (v.v === 1) t.up++; else if (v.v === -1) t.down++;
    if (v.who === who) t.mine = v.v;
  }
  return t;
}

const VOTES_LIMIT = 300;

/**
 * `who` votes `v` for the contribution `id`; the same vote again takes it back. A vote is not a change of the translation, so `mt` stays as it is
 * (a vote on a device that has not seen the newest translation yet must not win a merge over it). The time of a vote is always later than the one it replaces.
 */
export function castVote(e: Entry, id: string, who: string, v: 1 | -1, now: number): Entry {
  const cur = (e.votes ?? []).find(x => x.who === who && x.on === id);
  const next: Vote = { who, on: id, v: cur?.v === v ? 0 : v, at: Math.max(now, (cur?.at ?? 0) + 1) };
  const rest = (e.votes ?? []).filter(x => x !== cur);
  return { ...e, votes: [...rest, next].sort(byVote).slice(-VOTES_LIMIT) };
}

/** Of two copies of the same drop record the later one (at the same time the greater form, the same on every device). */
export const laterDrop = (a: Drop, b: Drop): Drop => (a.at !== b.at ? (b.at > a.at ? b : a) : JSON.stringify(b) > JSON.stringify(a) ? b : a);
export const byDrop = (x: Drop, y: Drop): number => x.at - y.at || (x.on < y.on ? -1 : x.on > y.on ? 1 : 0);

/** Take a contribution off the card (`off` false) or put it back (`off` true). Not a change of the translation: `mt` stays. */
export function setDropped(e: Entry, id: string, who: string, off: boolean, now: number): Entry {
  const cur = (e.drops ?? []).find(d => d.on === id);
  const next: Drop = { who, on: id, at: Math.max(now, (cur?.at ?? 0) + 1), ...(off ? { off: true } : {}) };
  return { ...e, drops: [...(e.drops ?? []).filter(d => d !== cur), next].sort(byDrop).slice(-VOTES_LIMIT) };
}
